import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import api, { errorInfo, isConflict } from '../services/api';
import { Avatar, ConfirmDialog, Modal } from './ui';
import { PRIORITIES, describeActivity, timeAgo, toDateInput } from '../utils/board';
import { useToast } from '../context/ToastContext';

const toDraft = (t) => ({ title: t.title, description: t.description || '', assignedTo: t.assignedTo || '', priority: t.priority, dueDate: toDateInput(t.dueDate) });
const toPayload = (d) => ({ title: d.title.trim(), description: d.description, assignedTo: d.assignedTo || null, priority: d.priority, dueDate: d.dueDate || null });

export default function TaskPanel({ task, tenantId, columns, members, canDelete, onClose, onSave, onMove, onDelete, groups }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => toDraft(task));
  const [baseVersion, setBaseVersion] = useState(task.version);
  const [conflict, setConflict] = useState(null); // authoritative task from a 409
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState({ loading: true, items: [] });

  const draftChanged = JSON.stringify(draft) !== JSON.stringify(toDraft(task));
  const remoteChanged = task.version !== baseVersion;

  // Someone else changed the task while the panel is open: silently follow if I have no edits, else warn.
  useEffect(() => {
    if (remoteChanged && !draftChanged) { setDraft(toDraft(task)); setBaseVersion(task.version); }
  }, [task, remoteChanged, draftChanged]);

  useEffect(() => {
    let live = true;
    api.get('/activity', { params: { tenantId, entityType: 'task', entityId: task.id, limit: 12 } })
      .then((r) => live && setHistory({ loading: false, items: r.data.activity }))
      .catch(() => live && setHistory({ loading: false, items: [] }));
    return () => { live = false; };
  }, [tenantId, task.id, task.version]);

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const loadLatest = (latest = task) => { setDraft(toDraft(latest)); setBaseVersion(latest.version); setConflict(null); };

  const save = async (versionOverride) => {
    if (!draft.title.trim()) return toast.error('A task needs a title.');
    setSaving(true);
    try {
      const saved = await onSave(task.id, versionOverride ?? baseVersion, toPayload(draft));
      setBaseVersion(saved.version); setDraft(toDraft(saved)); setConflict(null);
      toast.success('Task saved');
    } catch (e) {
      if (isConflict(e)) setConflict(e.response.data.error.details.current);
      else toast.error(errorInfo(e).message);
    } finally { setSaving(false); }
  };

  const del = async () => {
    setSaving(true);
    try { await onDelete(task.id); toast.success('Task deleted'); onClose(); }
    catch (e) { toast.error(errorInfo(e).message); setConfirm(false); }
    finally { setSaving(false); }
  };

  const changeColumn = (columnId) => onMove(task.id, columnId, (groups[columnId] || []).filter((t) => t.id !== task.id).length);

  return (
    <Modal side title="Task details" onClose={onClose}>
      <div className="space-y-5 p-5">
        {(conflict || (remoteChanged && draftChanged)) && (
          <div role="alert" className="rounded-xl border border-signal/60 bg-signal/15 p-3.5 text-sm">
            <div className="flex gap-2 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#7a5200]" />
              {conflict ? 'Someone else saved this task before you.' : 'This task was updated by someone else while you were editing.'}
            </div>
            <p className="mt-1 text-mute">Your unsaved changes have not been applied. Choose how to continue:</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button className="btn-outline !py-1.5" onClick={() => loadLatest(conflict || task)}><RefreshCw className="h-3.5 w-3.5" />Discard mine, load latest</button>
              <button className="btn-primary !py-1.5" disabled={saving} onClick={() => save((conflict || task).version)}>Keep mine &amp; overwrite</button>
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="tp-title">Title</label>
          <input id="tp-title" className="field !text-base !font-semibold" value={draft.title} maxLength={200} onChange={set('title')} />
        </div>
        <div>
          <label className="label" htmlFor="tp-desc">Description</label>
          <textarea id="tp-desc" rows={5} className="field resize-y" placeholder="Add context, links, acceptance criteria…" value={draft.description} onChange={set('description')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tp-col">Status</label>
            <select id="tp-col" className="field" value={task.columnId} onChange={(e) => changeColumn(e.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tp-pri">Priority</label>
            <select id="tp-pri" className="field" value={draft.priority} onChange={set('priority')}>
              {Object.entries(PRIORITIES).sort((a, b) => b[1].rank - a[1].rank).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tp-asg">Assignee</label>
            <select id="tp-asg" className="field" value={draft.assignedTo} onChange={set('assignedTo')}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tp-due">Due date</label>
            <input id="tp-due" type="date" className="field" value={draft.dueDate} onChange={set('dueDate')} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-primary" disabled={saving || !draftChanged} onClick={() => save()}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</button>
          {draftChanged && <button className="btn-ghost" onClick={() => loadLatest()}>Reset</button>}
          {canDelete && <button className="btn-ghost ml-auto !text-danger hover:!bg-danger-soft" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</button>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-sunken/60 p-3 text-xs text-mute">
          <dt>Created</dt><dd className="text-right text-ink">{new Date(task.createdAt).toLocaleString()}</dd>
          <dt>Last updated</dt><dd className="text-right text-ink">{new Date(task.updatedAt).toLocaleString()}</dd>
          <dt>Version</dt><dd className="text-right text-ink">{task.version}</dd>
        </dl>

        <section aria-labelledby="tp-hist">
          <h3 id="tp-hist" className="mb-2 text-sm font-bold">History</h3>
          {history.loading ? <div className="space-y-2"><div className="skeleton h-4 w-3/4" /><div className="skeleton h-4 w-1/2" /></div>
            : history.items.length === 0 ? <p className="text-sm text-mute">No recorded activity yet.</p>
              : <ol className="space-y-2.5">{history.items.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 text-sm"><Avatar user={a.user || { name: '?' }} size="sm" />
                  <span><strong>{a.user?.name || 'Someone'}</strong> {describeActivity(a)} <span className="text-xs text-mute">· {timeAgo(a.createdAt)}</span></span></li>))}</ol>}
        </section>
      </div>
      {confirm && <ConfirmDialog title="Delete this task?" message={`“${task.title}” will be permanently removed for everyone on this branch.`} onConfirm={del} onCancel={() => setConfirm(false)} busy={saving} />}
    </Modal>
  );
}
