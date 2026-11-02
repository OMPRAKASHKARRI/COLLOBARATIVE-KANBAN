import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History, Plus, Redo2, Search, Trash2, Undo2, X, Pencil } from 'lucide-react';
import api, { errorInfo } from '../services/api';
import { useBoard } from '../hooks/useBoard';
import { useMembers } from '../hooks/useMembers';
import { useRealtime } from '../context/RealtimeContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import KanbanBoard from '../components/KanbanBoard';
import TaskPanel from '../components/TaskPanel';
import ActivityPanel from '../components/ActivityPanel';
import { BoardSkeleton, ConfirmDialog, ConnectionBadge, EmptyState, ErrorState, Modal, PresenceBar } from '../components/ui';
import { PRIORITIES, filterTasks, groupByColumn } from '../utils/board';

export default function BoardPage() {
  const { boardId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { tenantId, canAdmin, role } = useWorkspace();
  const { status: conn, online } = useRealtime();
  const b = useBoard(boardId);
  const { members } = useMembers(tenantId);
  const [openId, setOpenId] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [filters, setFilters] = useState({ q: '', assigneeId: '', priority: '' });
  const [manage, setManage] = useState(false);
  const [confirmBoard, setConfirmBoard] = useState(false);

  const filtersActive = !!(filters.q || filters.assigneeId || filters.priority);
  const visible = useMemo(() => groupByColumn(b.columns, filterTasks(b.tasks, filters)), [b.columns, b.tasks, filters]);
  const openTask = b.tasks.find((t) => t.id === openId);
  const me = b.userId;

  // The board belongs to a tenant; if the user switched branches, leave rather than show another tenant's board.
  if (b.status === 'ready' && b.board.tenantId !== tenantId) return <Navigate to="/" replace />;

  const create = async (columnId, title) => {
    try { await b.createTask({ columnId, title }); toast.success('Task added'); }
    catch (e) { toast.error(errorInfo(e).message); throw e; }
  };

  if (b.status === 'loading') return <div className="h-full"><div className="skeleton m-6 h-9 w-64" /><BoardSkeleton /></div>;
  if (b.status === 'error') return <div className="p-6"><button className="btn-ghost mb-4" onClick={() => nav('/')}><ArrowLeft className="h-4 w-4" />Back to boards</button><ErrorState message={b.error?.status === 404 ? 'This board doesn’t exist or you don’t have access to it.' : b.error?.message} onRetry={b.error?.status === 404 ? null : b.reload} /></div>;

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button className="btn-icon -ml-2" aria-label="Back to boards" onClick={() => nav('/')}><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 basis-[calc(100%-3rem)] sm:basis-auto sm:flex-1"><h1 className="truncate text-2xl font-bold">{b.board.name}</h1>{b.board.description && <p className="truncate text-sm text-mute">{b.board.description}</p>}</div>
          <PresenceBar online={online} meId={me} />
          <ConnectionBadge status={conn} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-mute" />
            <label htmlFor="board-search" className="sr-only">Search tasks</label>
            <input id="board-search" className="field !pl-8" placeholder="Search tasks" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          </div>
          <label className="sr-only" htmlFor="f-asg">Filter by assignee</label>
          <select id="f-asg" className="field !w-auto" value={filters.assigneeId} onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}>
            <option value="">All assignees</option><option value="__none">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-pri">Filter by priority</label>
          <select id="f-pri" className="field !w-auto" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Any priority</option>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {filtersActive && <button className="btn-ghost" onClick={() => setFilters({ q: '', assigneeId: '', priority: '' })}><X className="h-4 w-4" />Clear</button>}
          <div className="ml-auto flex items-center gap-1">
            <button className="btn-icon" onClick={b.undo} disabled={!b.canUndo} aria-label="Undo" title={b.undoLabel ? `Undo: ${b.undoLabel}` : 'Nothing to undo'}><Undo2 className="h-4 w-4" /></button>
            <button className="btn-icon" onClick={b.redo} disabled={!b.canRedo} aria-label="Redo" title={b.redoLabel ? `Redo: ${b.redoLabel}` : 'Nothing to redo'}><Redo2 className="h-4 w-4" /></button>
            {canAdmin && <button className="btn-outline" onClick={() => setManage(true)}><Pencil className="h-4 w-4" /><span className="hidden sm:inline">Board settings</span></button>}
            <button className={showActivity ? 'btn-primary' : 'btn-outline'} aria-pressed={showActivity} onClick={() => setShowActivity((v) => !v)}><History className="h-4 w-4" /><span className="hidden sm:inline">Activity</span></button>
          </div>
        </div>
        {filtersActive && <p className="text-xs font-semibold text-mute">Filters are on — drag-and-drop is paused so card positions stay accurate. Clear filters to reorder.</p>}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {b.columns.length === 0 ? <EmptyState icon={Plus} title="This board has no columns">{canAdmin ? 'Open board settings to add a column.' : 'A tenant admin needs to add columns.'}</EmptyState>
            : <KanbanBoard columns={b.columns} groups={b.columnsMap} visibleGroups={visible} onMove={b.moveTask} onOpen={(t) => setOpenId(t.id)} onCreate={create} filtersActive={filtersActive} />}
        </div>
        {showActivity && <aside aria-label="Board activity" className="hidden w-80 shrink-0 overflow-y-auto border-l border-line bg-surface md:block"><h2 className="border-b border-line px-4 py-3 text-base font-bold">Activity</h2><ActivityPanel tenantId={tenantId} /></aside>}
      </div>
      {showActivity && <div className="md:hidden"><Modal side title="Activity" onClose={() => setShowActivity(false)}><ActivityPanel tenantId={tenantId} /></Modal></div>}

      {openTask && (
        <TaskPanel key={openTask.id} task={openTask} tenantId={tenantId} columns={b.columns} members={members} groups={b.columnsMap}
          canDelete={canAdmin || openTask.createdBy === me} onClose={() => setOpenId(null)}
          onSave={b.updateTask} onMove={b.moveTask} onDelete={b.deleteTask} />
      )}
      {openId && !openTask && <Modal title="Task" onClose={() => setOpenId(null)}><p className="p-5 text-sm">This task was deleted by someone else.</p></Modal>}

      {manage && <BoardSettings board={b.board} columns={b.columns} onClose={() => setManage(false)} onDelete={() => { setManage(false); setConfirmBoard(true); }} />}
      {confirmBoard && <ConfirmDialog title="Delete this board?" message={`“${b.board.name}” and all of its tasks will be permanently deleted for everyone on this branch.`} confirmLabel="Delete board" onCancel={() => setConfirmBoard(false)}
        onConfirm={async () => { try { await api.delete(`/boards/${boardId}`); toast.success('Board deleted'); nav('/'); } catch (e) { toast.error(errorInfo(e).message); setConfirmBoard(false); } }} />}
    </div>
  );
}

function BoardSettings({ board, columns, onClose, onDelete }) {
  const toast = useToast();
  const [name, setName] = useState(board.name);
  const [desc, setDesc] = useState(board.description || '');
  const [newCol, setNewCol] = useState('');
  const [busy, setBusy] = useState(false);
  const [delCol, setDelCol] = useState(null);
  const [moveTo, setMoveTo] = useState('');

  const wrap = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(errorInfo(e).message); } finally { setBusy(false); } };
  const removeCol = (c) => wrap(async () => {
    try { await api.delete(`/columns/${c.id}`); setDelCol(null); }
    catch (e) {
      if (e.response?.data?.error?.details?.code === 'COLUMN_NOT_EMPTY') { setDelCol(c); setMoveTo(columns.find((x) => x.id !== c.id)?.id || ''); return; }
      throw e;
    }
  }, null);

  return (
    <Modal title="Board settings" onClose={onClose} wide>
      <div className="space-y-6 p-5">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); wrap(() => api.put(`/boards/${board.id}`, { name: name.trim(), description: desc }), 'Board updated'); }}>
          <div><label className="label" htmlFor="bs-name">Name</label><input id="bs-name" className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="bs-desc">Description</label><textarea id="bs-desc" rows={2} className="field" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <button className="btn-primary" disabled={busy || !name.trim()}>Save board</button>
        </form>
        <section aria-labelledby="bs-cols"><h3 id="bs-cols" className="mb-2 text-sm font-bold">Columns</h3>
          <ul className="space-y-1.5">{columns.map((c, i) => (
            <ColumnRow key={c.id} column={c} index={i} count={columns.length} busy={busy}
              onRename={(n) => wrap(() => api.put(`/columns/${c.id}`, { name: n }), 'Column renamed')}
              onMove={(d) => wrap(() => api.put(`/columns/${c.id}`, { position: i + d }))}
              onDelete={() => removeCol(c)} />))}</ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); wrap(async () => { await api.post('/columns', { boardId: board.id, name: newCol.trim() }); setNewCol(''); }, 'Column added'); }}>
            <label className="sr-only" htmlFor="bs-new">New column name</label>
            <input id="bs-new" className="field" placeholder="New column name" value={newCol} maxLength={80} onChange={(e) => setNewCol(e.target.value)} />
            <button className="btn-outline shrink-0" disabled={!newCol.trim() || busy}><Plus className="h-4 w-4" />Add</button>
          </form>
        </section>
        <div className="border-t border-line pt-4"><button className="btn-ghost !text-danger hover:!bg-danger-soft" onClick={onDelete}><Trash2 className="h-4 w-4" />Delete board</button></div>
      </div>
      {delCol && (
        <Modal title={`Delete “${delCol.name}”?`} onClose={() => setDelCol(null)} labelledBy="dc-title">
          <div className="space-y-4 p-5"><p className="text-sm">This column still has tasks. Choose where they should go:</p>
            <label className="sr-only" htmlFor="dc-to">Move tasks to</label>
            <select id="dc-to" className="field" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>{columns.filter((c) => c.id !== delCol.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="flex justify-end gap-2"><button className="btn-outline" onClick={() => setDelCol(null)}>Cancel</button>
              <button className="btn-danger" disabled={!moveTo || busy} onClick={() => wrap(async () => { await api.delete(`/columns/${delCol.id}`, { params: { moveTasksTo: moveTo } }); setDelCol(null); }, 'Column deleted')}>Move tasks &amp; delete</button></div></div>
        </Modal>)}
    </Modal>
  );
}

function ColumnRow({ column, index, count, busy, onRename, onMove, onDelete }) {
  const [v, setV] = useState(column.name);
  return (
    <li className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor={`cr-${column.id}`}>Column name</label>
      <input id={`cr-${column.id}`} className="field" value={v} maxLength={80} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v.trim() !== column.name && onRename(v.trim())} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <button className="btn-icon" aria-label={`Move ${column.name} left`} disabled={busy || index === 0} onClick={() => onMove(-1)}>←</button>
      <button className="btn-icon" aria-label={`Move ${column.name} right`} disabled={busy || index === count - 1} onClick={() => onMove(1)}>→</button>
      <button className="btn-icon !text-danger" aria-label={`Delete column ${column.name}`} disabled={busy || count <= 1} onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
    </li>
  );
}
