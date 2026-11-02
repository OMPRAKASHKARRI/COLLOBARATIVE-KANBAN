import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { errorInfo, isConflict } from '../services/api';
import { applyPositions, groupByColumn, moveLocal, removeTask, upsertTask, isStaleEvent } from '../utils/board';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const FIELDS = ['title', 'description', 'assignedTo', 'priority', 'dueDate'];

/**
 * Board state + all mutations.
 *  - Optimistic moves with rollback / reconciliation against the authoritative server snapshot.
 *  - Server events are merged idempotently (stale versions ignored).
 *  - Undo/redo keeps an operation history; every undo is a normal versioned request, so it can never
 *    overwrite a newer change made by someone else (it fails with 409 and the board is reconciled).
 */
export function useBoard(boardId) {
  const { user } = useAuth();
  const { on, onResync } = useRealtime();
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', board: null, columns: [], tasks: [], error: null });
  const [history, setHistory] = useState({ undo: [], redo: [] });
  const hist = useRef(history); hist.current = history;
  const tasksRef = useRef([]); tasksRef.current = state.tasks;
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const { data } = await api.get(`/boards/${boardId}`);
      setState({ status: 'ready', board: data.board, columns: data.columns, tasks: data.tasks, error: null });
    } catch (e) {
      const info = errorInfo(e);
      setState((s) => (silent && s.status === 'ready' ? s : { ...s, status: 'error', error: info }));
    }
  }, [boardId]);

  // reset immediately when the board (or tenant) changes so no stale cards remain visible
  useEffect(() => { setState({ status: 'loading', board: null, columns: [], tasks: [], error: null }); setHistory({ undo: [], redo: [] }); load(); }, [boardId, load]);
  useEffect(() => onResync(() => load(true)), [onResync, load]);

  // ---- realtime merge ----
  useEffect(() => {
    const mine = (m) => m.boardId === boardId;
    const offs = [
      on('task:created', (m) => mine(m) && setState((s) => ({ ...s, tasks: applyPositions(upsertTask(s.tasks, m.data.task), m.data.positions) }))),
      on('task:updated', (m) => mine(m) && setState((s) => ({ ...s, tasks: upsertTask(s.tasks, m.data.task) }))),
      on('task:moved', (m) => {
        if (!mine(m)) return;
        setState((s) => {
          if (isStaleEvent(s.tasks, m.data.task)) return s;
          return { ...s, tasks: applyPositions(upsertTask(s.tasks, m.data.task), m.data.positions) };
        });
      }),
      on('task:deleted', (m) => mine(m) && setState((s) => ({ ...s, tasks: removeTask(s.tasks, m.data.taskId, m.data.positions) }))),
      on('board:updated', (m) => {
        if (m.data.action === 'deleted' && m.data.boardId === boardId) { setState((s) => ({ ...s, status: 'error', error: { status: 404, message: 'This board was deleted.' } })); return; }
        if (!mine(m)) return;
        if (m.data.action === 'columns_changed') { setState((s) => ({ ...s, columns: m.data.columns })); if (m.data.reloadTasks) load(true); }
        if (m.data.action === 'updated') setState((s) => ({ ...s, board: { ...s.board, ...m.data.board } }));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [on, boardId, load]);

  const columnsMap = useMemo(() => groupByColumn(state.columns, state.tasks), [state.columns, state.tasks]);
  const taskById = useCallback((id) => tasksRef.current.find((t) => t.id === id), []);

  const apply = (data) => setState((s) => ({ ...s, tasks: applyPositions(upsertTask(s.tasks, data.task), data.positions) }));

  const conflictToast = (e) => {
    const cur = e.response.data.error.details.current;
    toast.error(`Someone else changed “${cur.title}” first. The board was refreshed with the latest version.`);
    setState((s) => ({ ...s, tasks: upsertTask(s.tasks, cur) }));
    load(true);
  };

  // After one of OUR ops moved a task from version `from` to `to`, keep history entries chained
  // ONLY if nothing foreign slipped in (entry.version === from).
  const rechain = (stacks, taskId, from, to) => ({
    undo: stacks.undo.map((e) => (e.taskId === taskId && e.version === from ? { ...e, version: to } : e)),
    redo: stacks.redo.map((e) => (e.taskId === taskId && e.version === from ? { ...e, version: to } : e)),
  });
  const pushUndo = (entry) => setHistory((h) => ({ undo: [...rechain(h, entry.taskId, entry.version - 1, entry.version).undo, entry].slice(-50), redo: [] }));

  // ---- mutations ----
  const createTask = async (input) => {
    const { data } = await api.post('/tasks', { boardId, ...input });
    apply(data);
    return data.task;
  };

  const moveTask = async (taskId, columnId, index) => {
    const before = tasksRef.current;
    const task = before.find((t) => t.id === taskId);
    if (!task) return;
    const from = { columnId: task.columnId, position: task.position };
    setState((s) => ({ ...s, tasks: moveLocal(s.tasks, taskId, columnId, index) })); // optimistic
    try {
      const { data } = await api.patch(`/tasks/${taskId}/move`, { expectedVersion: task.version, columnId, position: index });
      apply(data);
      if (data.task.version !== task.version) pushUndo({ kind: 'move', taskId, label: `Move “${task.title}”`, undo: from, redo: { columnId, position: data.task.position }, version: data.task.version });
    } catch (e) {
      if (isConflict(e)) return conflictToast(e);
      setState((s) => ({ ...s, tasks: before })); // roll back, then reconcile with the server
      toast.error(errorInfo(e).message);
      load(true);
    }
  };

  const updateTask = async (taskId, expectedVersion, fields, { record = true } = {}) => {
    const task = taskById(taskId);
    const body = {}; for (const k of FIELDS) if (k in fields) body[k] = fields[k];
    const { data } = await api.put(`/tasks/${taskId}`, { expectedVersion, ...body }); // throws on 409 (caller shows conflict UI)
    apply(data);
    if (record && task) {
      const before = {}; for (const k of Object.keys(body)) before[k] = task[k];
      pushUndo({ kind: 'edit', taskId, label: `Edit “${task.title}”`, undo: before, redo: body, version: data.task.version });
    }
    return data.task;
  };

  const deleteTask = async (taskId) => {
    await api.delete(`/tasks/${taskId}`);
    setState((s) => ({ ...s, tasks: removeTask(s.tasks, taskId, []) }));
    load(true);
  };

  // ---- undo / redo ----
  const run = async (direction) => {
    const from = direction === 'undo' ? 'undo' : 'redo';
    const to = direction === 'undo' ? 'redo' : 'undo';
    const stack = hist.current[from];
    const entry = stack[stack.length - 1];
    if (!entry || busy) return;
    setBusy(true);
    const payload = direction === 'undo' ? entry.undo : entry.redo;
    try {
      let data;
      if (entry.kind === 'move') {
        ({ data } = await api.patch(`/tasks/${entry.taskId}/move`, { expectedVersion: entry.version, columnId: payload.columnId, position: payload.position }));
      } else {
        const body = { ...payload };
        if (body.dueDate && typeof body.dueDate === 'string') body.dueDate = body.dueDate.slice(0, 10);
        ({ data } = await api.put(`/tasks/${entry.taskId}`, { expectedVersion: entry.version, ...body }));
      }
      apply(data);
      setHistory((h) => {
        const moved = { ...entry, version: data.task.version };
        const chained = rechain({ undo: h.undo.slice(0, from === 'undo' ? -1 : h.undo.length), redo: h.redo.slice(0, from === 'redo' ? -1 : h.redo.length) }, entry.taskId, entry.version, data.task.version);
        return from === 'undo' ? { undo: chained.undo, redo: [...chained.redo, moved] } : { undo: [...chained.undo, moved], redo: chained.redo };
      });
      toast.success(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`);
    } catch (e) {
      // The task changed (or was deleted/moved) since this operation -> drop the entry, never overwrite.
      setHistory((h) => ({ ...h, [from]: h[from].filter((x) => x !== entry) }));
      if (isConflict(e)) toast.error(`Can't ${direction}: “${entry.label}” — someone changed this task since. Board refreshed.`);
      else toast.error(`Can't ${direction}: ${errorInfo(e).message}`);
      load(true);
    } finally { setBusy(false); }
    return to;
  };

  return {
    ...state, columnsMap, userId: user?.id, reload: () => load(), refresh: () => load(true),
    createTask, moveTask, updateTask, deleteTask,
    undo: () => run('undo'), redo: () => run('redo'), canUndo: history.undo.length > 0 && !busy, canRedo: history.redo.length > 0 && !busy,
    undoLabel: history.undo.at(-1)?.label, redoLabel: history.redo.at(-1)?.label,
  };
}
