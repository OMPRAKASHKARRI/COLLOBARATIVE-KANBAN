import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const Ctx = createContext(null);
export const useWorkspace = () => useContext(Ctx);
const KEY = 'kb.ws';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

// Holds the active organization + tenant. Every list comes from the backend; the persisted ids
// are only a *preference* and are discarded unless the server still lists them for this user.
export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [tenant, setTenant] = useState(null); // active tenant with my effective role
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const seq = useRef(0);

  const loadTenants = useCallback(async (oid, preferred) => {
    const mine = ++seq.current;
    setTenants([]); setTenant(null); setTenantId(null); // clear previous context immediately
    if (!oid) return;
    const { data } = await api.get('/tenants', { params: { organizationId: oid } });
    if (mine !== seq.current) return;
    setTenants(data.tenants);
    const pick = data.tenants.find((t) => t.id === preferred) || data.tenants[0];
    if (pick) setTenantId(pick.id);
  }, []);

  const loadOrgs = useCallback(async () => {
    try {
      setStatus('loading');
      const { data } = await api.get('/organizations');
      setOrgs(data.organizations);
      const pref = load();
      const org = data.organizations.find((o) => o.id === pref.orgId) || data.organizations[0];
      setOrgId(org?.id || null);
      await loadTenants(org?.id, pref.tenantId);
      setStatus('ready');
    } catch { setStatus('error'); }
  }, [loadTenants]);

  useEffect(() => {
    if (user) loadOrgs();
    else { setOrgs([]); setTenants([]); setOrgId(null); setTenantId(null); setTenant(null); setStatus('loading'); }
  }, [user, loadOrgs]);

  // Resolve the active tenant + effective role from the server whenever the selection changes.
  useEffect(() => {
    if (!tenantId) { setTenant(null); return; }
    let live = true;
    api.get(`/tenants/${tenantId}`).then((r) => live && setTenant(r.data.tenant)).catch(() => live && setTenant(null));
    return () => { live = false; };
  }, [tenantId]);

  useEffect(() => { if (orgId) localStorage.setItem(KEY, JSON.stringify({ orgId, tenantId })); }, [orgId, tenantId]);

  const selectOrg = useCallback(async (id) => { setOrgId(id); await loadTenants(id); }, [loadTenants]);
  const selectTenant = useCallback((id) => { setTenant(null); setTenantId(id); }, []);
  const refreshTenants = useCallback(() => loadTenants(orgId, tenantId), [loadTenants, orgId, tenantId]);

  const org = orgs.find((o) => o.id === orgId) || null;
  const role = tenant?.role || null;
  const value = useMemo(() => ({
    orgs, org, orgId, tenants, tenantId, tenant, role, status,
    isOrgAdmin: org?.role === 'ORG_ADMIN',
    canAdmin: role === 'TENANT_ADMIN' || role === 'ORG_ADMIN',
    selectOrg, selectTenant, reload: loadOrgs, refreshTenants,
  }), [orgs, org, orgId, tenants, tenantId, tenant, role, status, selectOrg, selectTenant, loadOrgs, refreshTenants]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
