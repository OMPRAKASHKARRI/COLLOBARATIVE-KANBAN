import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import api, { errorInfo } from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar, ConfirmDialog, EmptyState, ErrorState } from '../components/ui';

const LABEL = { ORG_ADMIN: 'Org admin', TENANT_ADMIN: 'Tenant admin', MEMBER: 'Member' };
const TONE = { ORG_ADMIN: 'bg-signal/25 text-[#7a5200]', TENANT_ADMIN: 'bg-brand-soft text-brand', MEMBER: 'bg-sunken text-mute' };

export default function TeamPage() {
  const { user } = useAuth();
  const { orgId, org, tenantId, tenant, role, canAdmin, isOrgAdmin } = useWorkspace();
  const toast = useToast();
  const [state, setState] = useState({ loading: true, rows: [], orgRows: [], error: null });
  const [form, setForm] = useState({ email: '', role: 'MEMBER', scope: 'tenant' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId || !canAdmin) return setState({ loading: false, rows: [], orgRows: [], error: null });
    try {
      const [t, o] = await Promise.all([
        api.get('/memberships', { params: { tenantId } }),
        isOrgAdmin ? api.get('/memberships', { params: { organizationId: orgId } }) : Promise.resolve({ data: { memberships: [] } }),
      ]);
      setState({ loading: false, rows: t.data.memberships, orgRows: o.data.memberships.filter((m) => m.tenantId === null), error: null });
    } catch (e) { setState({ loading: false, rows: [], orgRows: [], error: errorInfo(e).message }); }
  }, [tenantId, orgId, canAdmin, isOrgAdmin]);
  useEffect(() => { setState({ loading: true, rows: [], orgRows: [], error: null }); load(); }, [load]);

  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(errorInfo(e).message); } finally { setBusy(false); } };
  const add = (e) => {
    e.preventDefault();
    const orgLevel = form.scope === 'org';
    run(() => api.post('/memberships', { email: form.email.trim(), organizationId: orgId, tenantId: orgLevel ? null : tenantId, role: orgLevel ? 'ORG_ADMIN' : form.role }), 'Member added')
      .then(() => setForm((f) => ({ ...f, email: '' })));
  };

  if (!tenant) return <div className="p-6"><EmptyState icon={Users} title="Select a branch">Choose an organization and branch in the sidebar to see its team.</EmptyState></div>;
  if (!canAdmin) return <div className="p-6"><EmptyState icon={ShieldCheck} title="Team management is for administrators">You’re a {role?.replace('_', ' ').toLowerCase()} in {tenant.name}. Ask a tenant admin to change memberships.</EmptyState></div>;

  const rolesFor = (isOrgAdmin ? ['TENANT_ADMIN', 'MEMBER'] : ['MEMBER']);
  return (
    <div className="h-full overflow-y-auto"><div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      <header><p className="text-sm font-semibold text-mute">{org?.name}</p><h1 className="text-3xl font-bold">Team · {tenant.name}</h1></header>

      <form onSubmit={add} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold"><UserPlus className="h-4 w-4 text-brand" />Add someone</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
          <div><label className="label" htmlFor="m-email">Registered email</label><input id="m-email" type="email" className="field" placeholder="name@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div><label className="label" htmlFor="m-role">Role</label>
            <select id="m-role" className="field" value={form.scope === 'org' ? 'ORG_ADMIN' : form.role} disabled={form.scope === 'org'} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {form.scope === 'org' ? <option value="ORG_ADMIN">Org admin</option> : rolesFor.map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}</select></div>
          <div className="flex items-end"><button className="btn-primary w-full" disabled={busy || !form.email}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add</button></div>
        </div>
        {isOrgAdmin && <fieldset className="mt-3 flex flex-wrap gap-4 text-sm"><legend className="sr-only">Scope</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="scope" checked={form.scope === 'tenant'} onChange={() => setForm({ ...form, scope: 'tenant' })} />This branch ({tenant.name})</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="scope" checked={form.scope === 'org'} onChange={() => setForm({ ...form, scope: 'org' })} />Whole organization (org admin)</label></fieldset>}
        <p className="mt-2 text-xs text-mute">The person must already have registered. {isOrgAdmin ? '' : 'Only organization admins can grant the tenant admin role.'}</p>
      </form>

      <section aria-labelledby="t-members">
        <h2 id="t-members" className="mb-3 text-lg font-bold">Branch members</h2>
        {state.loading ? <div className="space-y-2" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14" />)}</div>
          : state.error ? <ErrorState message={state.error} onRetry={load} />
            : state.rows.length === 0 ? <EmptyState icon={Users} title="No direct members">Everyone here gets access through the organization.</EmptyState>
              : <MemberList rows={state.rows} meId={user.id} busy={busy} roles={rolesFor} isOrgAdmin={isOrgAdmin}
                onRole={(m, r) => run(() => api.put(`/memberships/${m.id}`, { role: r }), 'Role updated')} onRemove={(m) => setConfirm(m)} />}
      </section>

      {isOrgAdmin && (
        <section aria-labelledby="o-admins"><h2 id="o-admins" className="mb-1 text-lg font-bold">Organization admins</h2>
          <p className="mb-3 text-sm text-mute">Org admins can access every branch in {org.name}.</p>
          <MemberList rows={state.orgRows} meId={user.id} busy={busy} roles={[]} isOrgAdmin onRole={() => {}} onRemove={(m) => setConfirm(m)} orgLevel />
        </section>)}

      {confirm && <ConfirmDialog title={`Remove ${confirm.user.name}?`} confirmLabel="Remove" message={confirm.tenantId ? `${confirm.user.name} will lose access to ${tenant.name} immediately and their tasks here become unassigned.` : `${confirm.user.name} will lose organization-level admin access.`}
        busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { await run(() => api.delete(`/memberships/${confirm.id}`), 'Member removed'); setConfirm(null); }} />}
    </div></div>
  );
}

function MemberList({ rows, meId, busy, roles, onRole, onRemove, isOrgAdmin, orgLevel }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map((m) => {
        const self = m.userId === meId;
        const editable = !orgLevel && !self && (isOrgAdmin || m.role === 'MEMBER');
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar user={m.user} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{m.user.name}{self && <span className="ml-1.5 text-xs font-medium text-mute">(you)</span>}</p><p className="truncate text-xs text-mute">{m.user.email}</p></div>
            {editable ? (<><label className="sr-only" htmlFor={`r-${m.id}`}>Role for {m.user.name}</label>
              <select id={`r-${m.id}`} className="field !w-auto !py-1.5" value={m.role} disabled={busy} onChange={(e) => onRole(m, e.target.value)}>
                {[...new Set([m.role, ...roles])].map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}</select></>)
              : <span className={`chip ${TONE[m.role]}`}>{LABEL[m.role]}</span>}
            {!self && (isOrgAdmin || m.role === 'MEMBER') && <button className="btn-icon !text-danger" aria-label={`Remove ${m.user.name}`} disabled={busy} onClick={() => onRemove(m)}><Trash2 className="h-4 w-4" /></button>}
          </li>
        );
      })}
    </ul>
  );
}
