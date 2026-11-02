import { describe, it, expect } from 'vitest';
import { groupByColumn, applyPositions, upsertTask, removeTask, moveLocal, filterTasks, dueState, describeActivity } from './board';

const T = (id, columnId, position, extra = {}) => ({ id, columnId, position, version: 1, title: id, description: '', priority: 'MEDIUM', assignedTo: null, ...extra });
const cols = [{ id: 'c1' }, { id: 'c2' }];
const list = (tasks, c) => tasks.filter((t) => t.columnId === c).sort((a, b) => a.position - b.position).map((t) => [t.id, t.position]);

describe('board utils', () => {
  it('groups tasks by column ordered by position', () => {
    const g = groupByColumn(cols, [T('b', 'c1', 1), T('a', 'c1', 0), T('x', 'c2', 0)]);
    expect(g.c1.map((t) => t.id)).toEqual(['a', 'b']);
    expect(g.c2.map((t) => t.id)).toEqual(['x']);
  });

  it('moveLocal reorders within a column (index among the other tasks)', () => {
    const tasks = [T('a', 'c1', 0), T('b', 'c1', 1), T('c', 'c1', 2)];
    expect(list(moveLocal(tasks, 'c', 'c1', 0), 'c1')).toEqual([['c', 0], ['a', 1], ['b', 2]]);
    expect(list(moveLocal(tasks, 'a', 'c1', 99), 'c1')).toEqual([['b', 0], ['c', 1], ['a', 2]]);
  });

  it('moveLocal moves across columns and compacts the source', () => {
    const tasks = [T('a', 'c1', 0), T('b', 'c1', 1), T('c', 'c1', 2), T('x', 'c2', 0)];
    const out = moveLocal(tasks, 'a', 'c2', 1);
    expect(list(out, 'c1')).toEqual([['b', 0], ['c', 1]]);
    expect(list(out, 'c2')).toEqual([['x', 0], ['a', 1]]);
    expect(tasks[0].columnId).toBe('c1'); // input not mutated
  });

  it('applyPositions applies server positions', () => {
    const out = applyPositions([T('a', 'c1', 0), T('b', 'c1', 1)], [{ id: 'b', columnId: 'c2', position: 0 }]);
    expect(out.find((t) => t.id === 'b')).toMatchObject({ columnId: 'c2', position: 0 });
  });

  it('upsertTask ignores stale (older-version) events and accepts newer ones', () => {
    const base = [T('a', 'c1', 0, { version: 3, title: 'new' })];
    expect(upsertTask(base, T('a', 'c1', 0, { version: 2, title: 'old' }))[0].title).toBe('new');
    expect(upsertTask(base, T('a', 'c1', 0, { version: 4, title: 'newer' }))[0].title).toBe('newer');
    expect(upsertTask(base, T('z', 'c1', 1))).toHaveLength(2);
  });

  it('removeTask removes and re-applies compacted positions', () => {
    const out = removeTask([T('a', 'c1', 0), T('b', 'c1', 1)], 'a', [{ id: 'b', columnId: 'c1', position: 0 }]);
    expect(list(out, 'c1')).toEqual([['b', 0]]);
  });

  it('filters by text, assignee (including unassigned) and priority', () => {
    const tasks = [T('a', 'c1', 0, { title: 'Login page', assignedTo: 'u1', priority: 'HIGH' }), T('b', 'c1', 1, { description: 'about LOGIN' }), T('c', 'c1', 2, { title: 'Other' })];
    expect(filterTasks(tasks, { q: 'login' }).map((t) => t.id)).toEqual(['a', 'b']);
    expect(filterTasks(tasks, { assigneeId: 'u1' }).map((t) => t.id)).toEqual(['a']);
    expect(filterTasks(tasks, { assigneeId: '__none' }).map((t) => t.id)).toEqual(['b', 'c']);
    expect(filterTasks(tasks, { priority: 'HIGH' }).map((t) => t.id)).toEqual(['a']);
  });

  it('dueState classifies overdue / soon / later / none', () => {
    const now = new Date('2026-11-01T10:00:00');
    expect(dueState(null, now)).toBeNull();
    expect(dueState('2026-10-30T00:00:00', now)).toBe('overdue');
    expect(dueState('2026-11-02T00:00:00', now)).toBe('soon');
    expect(dueState('2026-12-25T00:00:00', now)).toBe('later');
  });

  it('describes activity entries in plain language', () => {
    expect(describeActivity({ entityType: 'task', action: 'moved', details: { title: 'X', from: 'To Do', to: 'To Do' } })).toBe('reordered “X” in To Do');
    expect(describeActivity({ entityType: 'task', action: 'moved', details: { title: 'X', from: 'To Do', to: 'Done' } })).toBe('moved “X” from To Do to Done');
    expect(describeActivity({ entityType: 'task', action: 'assigned', details: { title: 'X', to: 'Priya' } })).toBe('assigned “X” to Priya');
  });
});
