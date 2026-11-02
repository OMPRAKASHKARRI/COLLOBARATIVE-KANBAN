import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Me' } }) }));
const handlers = {};
vi.mock('../context/RealtimeContext', () => ({
  useRealtime: () => ({ on: (ev, fn) => { handlers[ev] = fn; return () => { delete handlers[ev]; }; }, onResync: () => () => {}, status: 'connected', online: [] }),
}));
vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
import api from '../services/api';
import { useBoard } from './useBoard';

const task = (id, columnId, position, version = 1) => ({ id, tenantId: 't', boardId: 'b', columnId, title: id, description: '', priority: 'MEDIUM', assignedTo: null, assignee: null, position, version, createdBy: 'u1' });
const snapshot = (tasks) => ({ data: { board: { id: 'b', tenantId: 't', name: 'B' }, columns: [{ id: 'c1', position: 0, name: 'To Do' }, { id: 'c2', position: 1, name: 'Done' }], tasks } });
const conflictErr = (cur) => Object.assign(new Error('409'), { response: { status: 409, data: { error: { code: 'VERSION_CONFLICT', details: { code: 'STALE_VERSION', current: cur } } } } });
const col = (r, c) => r.current.tasks.filter((t) => t.columnId === c).sort((a, b) => a.position - b.position).map((t) => t.id);

async function setup(tasks) {
  api.get.mockResolvedValue(snapshot(tasks));
  const hook = renderHook(() => useBoard('b'));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

beforeEach(() => { vi.clearAllMocks(); Object.keys(handlers).forEach((k) => delete handlers[k]); });

describe('useBoard', () => {
  it('moves optimistically, then applies the server response and records undo', async () => {
    const { result } = await setup([task('a', 'c1', 0), task('b', 'c1', 1)]);
    let release;
    api.patch.mockReturnValue(new Promise((r) => { release = r; }));
    let p;
    act(() => { p = result.current.moveTask('a', 'c2', 0); });
    expect(col(result, 'c2')).toEqual(['a']); // optimistic, request still pending
    await act(async () => { release({ data: { task: { ...task('a', 'c2', 0, 2) }, positions: [{ id: 'b', columnId: 'c1', position: 0 }] } }); await p; });
    expect(api.patch).toHaveBeenCalledWith('/tasks/a/move', { expectedVersion: 1, columnId: 'c2', position: 0 });
    expect(result.current.tasks.find((t) => t.id === 'a').version).toBe(2);
    expect(result.current.canUndo).toBe(true);
  });

  it('rolls back and reloads when the move fails', async () => {
    const { result } = await setup([task('a', 'c1', 0)]);
    api.patch.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 422, data: { error: { code: 'UNPROCESSABLE', message: 'Bad column' } } } }));
    await act(async () => { await result.current.moveTask('a', 'c2', 0); });
    expect(col(result, 'c1')).toEqual(['a']);
    expect(toast.error).toHaveBeenCalledWith('Bad column');
    expect(result.current.canUndo).toBe(false);
  });

  it('on a stale-version 409 adopts the authoritative task and tells the user', async () => {
    const { result } = await setup([task('a', 'c1', 0)]);
    api.patch.mockRejectedValue(conflictErr(task('a', 'c2', 0, 5)));
    api.get.mockResolvedValue(snapshot([task('a', 'c2', 0, 5)]));
    await act(async () => { await result.current.moveTask('a', 'c2', 0); });
    await waitFor(() => expect(result.current.tasks[0].version).toBe(5));
    expect(toast.error.mock.calls[0][0]).toMatch(/Someone else changed/);
  });

  it('merges realtime events and ignores stale ones', async () => {
    const { result } = await setup([task('a', 'c1', 0, 3)]);
    act(() => handlers['task:created']({ boardId: 'b', data: { task: task('n', 'c1', 1), positions: [] } }));
    expect(col(result, 'c1')).toEqual(['a', 'n']);
    act(() => handlers['task:moved']({ boardId: 'b', data: { task: { ...task('a', 'c2', 0, 2) }, positions: [] } })); // older version
    expect(result.current.tasks.find((t) => t.id === 'a').columnId).toBe('c1');
    act(() => handlers['task:moved']({ boardId: 'b', data: { task: { ...task('a', 'c2', 0, 4) }, positions: [{ id: 'n', columnId: 'c1', position: 0 }] } }));
    expect(col(result, 'c2')).toEqual(['a']);
    expect(result.current.tasks.find((t) => t.id === 'n').position).toBe(0);
    act(() => handlers['task:deleted']({ boardId: 'b', data: { taskId: 'n', columnId: 'c1', positions: [] } }));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['a']);
    act(() => handlers['task:created']({ boardId: 'OTHER', data: { task: task('x', 'c1', 0), positions: [] } })); // other board ignored
    expect(result.current.tasks).toHaveLength(1);
  });

  it('undo sends the inverse move with the version our op produced', async () => {
    const { result } = await setup([task('a', 'c1', 0)]);
    api.patch.mockResolvedValueOnce({ data: { task: task('a', 'c2', 0, 2), positions: [] } });
    await act(async () => { await result.current.moveTask('a', 'c2', 0); });
    api.patch.mockResolvedValueOnce({ data: { task: task('a', 'c1', 0, 3), positions: [] } });
    await act(async () => { await result.current.undo(); });
    expect(api.patch).toHaveBeenLastCalledWith('/tasks/a/move', { expectedVersion: 2, columnId: 'c1', position: 0 });
    expect(col(result, 'c1')).toEqual(['a']);
    expect(result.current.canRedo).toBe(true);
    api.patch.mockResolvedValueOnce({ data: { task: task('a', 'c2', 0, 4), positions: [] } });
    await act(async () => { await result.current.redo(); });
    expect(api.patch).toHaveBeenLastCalledWith('/tasks/a/move', { expectedVersion: 3, columnId: 'c2', position: 0 });
  });

  it('undo that conflicts with someone else\'s newer change is refused, dropped and reconciled', async () => {
    const { result } = await setup([task('a', 'c1', 0)]);
    api.patch.mockResolvedValueOnce({ data: { task: task('a', 'c2', 0, 2), positions: [] } });
    await act(async () => { await result.current.moveTask('a', 'c2', 0); });
    api.patch.mockRejectedValueOnce(conflictErr(task('a', 'c2', 0, 3)));
    api.get.mockResolvedValue(snapshot([task('a', 'c2', 0, 3)]));
    await act(async () => { await result.current.undo(); });
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/Can't undo/);
    expect(result.current.canUndo).toBe(false);
    await waitFor(() => expect(result.current.tasks[0].version).toBe(3));
  });

  it('records edits for undo and chains versions across consecutive own operations', async () => {
    const { result } = await setup([task('a', 'c1', 0)]);
    api.put.mockResolvedValueOnce({ data: { task: { ...task('a', 'c1', 0, 2), title: 'new' } } });
    await act(async () => { await result.current.updateTask('a', 1, { title: 'new' }); });
    api.patch.mockResolvedValueOnce({ data: { task: { ...task('a', 'c2', 0, 3), title: 'new' }, positions: [] } });
    await act(async () => { await result.current.moveTask('a', 'c2', 0); });
    api.patch.mockResolvedValueOnce({ data: { task: { ...task('a', 'c1', 0, 4), title: 'new' }, positions: [] } });
    await act(async () => { await result.current.undo(); }); // undo move (expects v3)
    api.put.mockResolvedValueOnce({ data: { task: task('a', 'c1', 0, 5) } });
    await act(async () => { await result.current.undo(); }); // undo edit must now expect v4 (chained)
    expect(api.put).toHaveBeenLastCalledWith('/tasks/a', { expectedVersion: 4, title: 'a' });
  });
});
