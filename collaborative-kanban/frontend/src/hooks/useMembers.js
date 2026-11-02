import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { useRealtime } from '../context/RealtimeContext';

// Users with access to the tenant (assignable people). Refreshes when memberships change.
export function useMembers(tenantId) {
  const { on, onResync } = useRealtime();
  const [state, setState] = useState({ loading: true, members: [], error: false });
  const load = useCallback(async () => {
    if (!tenantId) return;
    try { const { data } = await api.get(`/tenants/${tenantId}/members`); setState({ loading: false, members: data.members, error: false }); }
    catch { setState((s) => ({ ...s, loading: false, error: true })); }
  }, [tenantId]);
  useEffect(() => { setState({ loading: true, members: [], error: false }); load(); }, [load]);
  useEffect(() => on('member:updated', (m) => m.tenantId === tenantId && load()), [on, tenantId, load]);
  useEffect(() => onResync(load), [onResync, load]);
  return { ...state, reload: load };
}
