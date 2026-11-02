import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, KanbanSquare, Loader2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import api, { errorInfo } from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { ConfirmDialog, EmptyState, ErrorState, Modal } from '../components/ui';
import ActivityPanel from '../components/ActivityPanel';

function NameDialog({ title, label, initial = '', cta, onSubmit, onClose }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await onSubmit(v.trim()); onClose(); } catch (x) { setErr(errorInfo(x).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go} className="space-y-4 p-5">
        <div><label className="label" htmlFor="nd">{label}</label><input id="nd" autoFocus className="field" value={v} maxLength={120} onChange={(e) => setV(e.target.value)} /></div>
        {err && <p role="alert" className="text-sm font-semibold text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!v.trim() || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{cta}</button></div>
      </form>
    </Modal>
  );
}

export default function Dashboard() {
  const { org, orgId, tenants, tenantId, tenant, status, canAdmin, isOrgAdmin, reload, refreshTenants, selectTenant } = useWorkspace();
  const { on } = useRealtime();
  const toast = useToast();
  const [boards, setBoards] = useState({ loading: true, items: [], error: null });
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const loadBoards = async () => {
    if (!tenantId) return setBoards({ loading: false, items: [], error: null });
    try { const { data } = await api.get('/boards', { params: { tenantId } }); setBoards({ loading: false, items: data.boards, error: null }); }
    catch (e) { setBoards({ loading: false, items: [], error: errorInfo(e).message }); }
  };
  useEffect(() => { setBoards({ loading: true, items: [], error: null }); loadBoards(); /* eslint-disable-next-line */ }, [tenantId]);
  useEffect(() => on('board:updated', (m) => { if (m.tenantId === tenantId && ['created', 'deleted', 'updated'].includes(m.data.action)) loadBoards(); }), [on, tenantId]); // eslint-disable-line

  const act = async (fn, ok) => { await fn(); if (ok) toast.success(ok); };

  if (status === 'loading') return <div className="space-y-4 p-6" aria-busy="true"><div className="skeleton h-8 w-64" /><div className="skeleton h-32 w-full" /></div>;
  if (status === 'error') return <div className="p-6"><ErrorState message="Couldn’t load your workspaces." onRetry={reload} /></div>;

  if (!org) {
    return (
      <div className="p-6"><EmptyState icon={Building2} title="You’re not part of an organization yet"
        action={<button className="btn-primary" onClick={() => setDialog('org')}><Plus className="h-4 w-4" />Create an organization</button>}>
        Ask an administrator to add you to a branch, or create your own organization and invite your team.</EmptyState>
        {dialog === 'org' && <NameDialog title="Create organization" label="Organization name" cta="Create" onClose={() => setDialog(null)}
          onSubmit={(name) => act(async () => { await api.post('/organizations', { name }); await reload(); }, 'Organization created')} />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <header className="flex flex-wrap items-center gap-3">
            <div className="min-w-0"><p className="text-sm font-semibold text-mute">Organization</p><h1 className="truncate text-3xl font-bold">{org.name}</h1></div>
            {isOrgAdmin && <button className="btn-ghost" onClick={() => setDialog('renameOrg')}><Pencil className="h-4 w-4" />Rename</button>}
            <button className="btn-outline ml-auto" onClick={() => setDialog('org')}><Plus className="h-4 w-4" />New organization</button>
          </header>

          <section aria-labelledby="branches">
            <div className="mb-3 flex items-center justify-between"><h2 id="branches" className="text-lg font-bold">Branches</h2>
              {isOrgAdmin && <button className="btn-outline" onClick={() => setDialog('tenant')}><Plus className="h-4 w-4" />New branch</button>}</div>
            {tenants.length === 0 ? <EmptyState icon={MapPin} title="No branches you can access">{isOrgAdmin ? 'Create the first branch for this organization.' : 'An administrator needs to add you to a branch.'}</EmptyState> : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tenants.map((t) => (
                <li key={t.id}><button onClick={() => selectTenant(t.id)} aria-pressed={t.id === tenantId}
                  className={`w-full rounded-xl border p-4 text-left shadow-card transition ${t.id === tenantId ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-brand/50'}`}>
                  <span className="flex items-center gap-2 font-display text-base font-bold"><MapPin className="h-4 w-4 text-brand" />{t.name}</span>
                  <span className="mt-1 block text-xs text-mute">{t.boardCount} {t.boardCount === 1 ? 'board' : 'boards'}{t.id === tenantId ? ' · viewing' : ''}</span></button></li>))}</ul>
            )}
            {isOrgAdmin && tenant && (
              <div className="mt-3 flex gap-2"><button className="btn-ghost !px-2 text-xs" onClick={() => setDialog('renameTenant')}><Pencil className="h-3.5 w-3.5" />Rename “{tenant.name}”</button>
                <button className="btn-ghost !px-2 text-xs !text-danger" onClick={() => setConfirm('tenant')}><Trash2 className="h-3.5 w-3.5" />Delete branch</button></div>)}
          </section>

          {tenant && (
            <section aria-labelledby="boards">
              <div className="mb-3 flex items-center justify-between"><h2 id="boards" className="text-lg font-bold">Boards in {tenant.name}</h2>
                {canAdmin && <button className="btn-primary" onClick={() => setDialog('board')}><Plus className="h-4 w-4" />New board</button>}</div>
              {boards.loading ? <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">{[1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>
                : boards.error ? <ErrorState message={boards.error} onRetry={loadBoards} />
                  : boards.items.length === 0 ? <EmptyState icon={KanbanSquare} title="No boards yet">{canAdmin ? 'Create a board to start tracking work.' : 'A tenant admin can create the first board.'}</EmptyState>
                    : <ul className="grid gap-3 sm:grid-cols-2">{boards.items.map((b) => (
                      <li key={b.id}><Link to={`/boards/${b.id}`} className="block rounded-xl border border-line bg-surface p-4 shadow-card transition hover:border-brand/60 hover:shadow-lift/30">
                        <span className="flex items-center gap-2 font-display text-base font-bold"><KanbanSquare className="h-4 w-4 text-brand" />{b.name}</span>
                        {b.description && <span className="mt-1 line-clamp-2 block text-sm text-mute">{b.description}</span>}
                        <span className="mt-3 block text-xs font-semibold text-mute">{b.taskCount} {b.taskCount === 1 ? 'task' : 'tasks'}</span></Link></li>))}</ul>}
            </section>
          )}
        </div>
        {tenant && <aside aria-label="Recent activity" className="rounded-2xl border border-line bg-surface xl:self-start"><h2 className="border-b border-line px-4 py-3 text-base font-bold">Recent activity</h2><ActivityPanel tenantId={tenantId} limit={10} /></aside>}
      </div>

      {dialog === 'org' && <NameDialog title="Create organization" label="Organization name" cta="Create" onClose={() => setDialog(null)} onSubmit={(name) => act(async () => { await api.post('/organizations', { name }); await reload(); }, 'Organization created')} />}
      {dialog === 'renameOrg' && <NameDialog title="Rename organization" label="Name" initial={org.name} cta="Save" onClose={() => setDialog(null)} onSubmit={(name) => act(async () => { await api.put(`/organizations/${orgId}`, { name }); await reload(); }, 'Organization renamed')} />}
      {dialog === 'tenant' && <NameDialog title="Create branch" label="Branch name" cta="Create" onClose={() => setDialog(null)} onSubmit={(name) => act(async () => { await api.post('/tenants', { organizationId: orgId, name }); await refreshTenants(); }, 'Branch created')} />}
      {dialog === 'renameTenant' && <NameDialog title="Rename branch" label="Name" initial={tenant.name} cta="Save" onClose={() => setDialog(null)} onSubmit={(name) => act(async () => { await api.put(`/tenants/${tenantId}`, { name }); await refreshTenants(); }, 'Branch renamed')} />}
      {dialog === 'board' && <NameDialog title="Create board" label="Board name" cta="Create board" onClose={() => setDialog(null)} onSubmit={(name) => act(async () => { await api.post('/boards', { tenantId, name }); await loadBoards(); }, 'Board created')} />}
      {confirm === 'tenant' && <ConfirmDialog title={`Delete ${tenant?.name}?`} message="This permanently deletes the branch with all of its boards, tasks, members’ access and activity history." confirmLabel="Delete branch"
        onCancel={() => setConfirm(null)} onConfirm={async () => { try { await api.delete(`/tenants/${tenantId}`); toast.success('Branch deleted'); setConfirm(null); await refreshTenants(); } catch (e) { toast.error(errorInfo(e).message); setConfirm(null); } }} />}
    </div>
  );
}
