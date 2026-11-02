import { Building2, MapPin } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useNavigate } from 'react-router-dom';

// Organization selector + tenant (branch) switcher. Options come from the API, never hardcoded.
export default function WorkspaceSwitcher() {
  const { orgs, orgId, tenants, tenantId, selectOrg, selectTenant, role } = useWorkspace();
  const nav = useNavigate();
  return (
    <div className="space-y-2.5">
      <div>
        <label htmlFor="ws-org" className="label flex items-center gap-1 !text-white/65"><Building2 className="h-3.5 w-3.5" />Organization</label>
        <select id="ws-org" className="field !bg-white/10 !text-white !border-white/20" value={orgId || ''} disabled={!orgs.length}
          onChange={async (e) => { await selectOrg(e.target.value); nav('/'); }}>
          {!orgs.length && <option value="">No organizations</option>}
          {orgs.map((o) => <option key={o.id} value={o.id} className="text-ink">{o.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ws-tenant" className="label flex items-center gap-1 !text-white/65"><MapPin className="h-3.5 w-3.5" />Branch</label>
        <select id="ws-tenant" className="field !bg-white/10 !text-white !border-white/20" value={tenantId || ''} disabled={!tenants.length}
          onChange={(e) => { selectTenant(e.target.value); nav('/'); }}>
          {!tenants.length && <option value="">No branches available</option>}
          {tenants.map((t) => <option key={t.id} value={t.id} className="text-ink">{t.name}</option>)}
        </select>
        {role && <p className="mt-1 text-[11px] font-semibold text-white/60">Your role: {role.replace('_', ' ').toLowerCase()}</p>}
      </div>
    </div>
  );
}
