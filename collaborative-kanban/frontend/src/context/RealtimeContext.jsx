import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { useToast } from './ToastContext';

const Ctx = createContext(null);
export const useRealtime = () => useContext(Ctx);

// status: idle | connecting | connected | reconnecting | denied
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const { tenantId, reload } = useWorkspace();
  const toast = useToast();
  const [status, setStatus] = useState('idle');
  const [online, setOnline] = useState([]);
  const resyncs = useRef(new Set());
  const joinedOnce = useRef(false);

  // Components register a callback that re-fetches authoritative state after (re)joining the room.
  const onResync = useCallback((fn) => { resyncs.current.add(fn); return () => resyncs.current.delete(fn); }, []);
  // Components subscribe to tenant events (returns unsubscribe).
  const on = useCallback((event, fn) => { const s = getSocket(); s.on(event, fn); return () => s.off(event, fn); }, []);

  useEffect(() => {
    if (!user || !tenantId) { setStatus('idle'); setOnline([]); return undefined; }
    const s = getSocket();
    joinedOnce.current = false;
    setOnline([]); setStatus(s.connected ? 'connecting' : 'connecting');

    const join = () => s.emit('tenant:join', { tenantId }, (ack) => {
      if (!ack?.ok) { setStatus('denied'); return; }
      setOnline(ack.online); setStatus('connected');
      if (joinedOnce.current) resyncs.current.forEach((fn) => fn()); // we may have missed events while away
      joinedOnce.current = true;
    });
    const onConnect = () => { setStatus('connecting'); join(); };
    const onDown = () => setStatus('reconnecting');
    const onPresence = (m) => { if (m.tenantId === tenantId) setOnline(m.data.online); };
    const onRevoked = (m) => { if (m.tenantId === tenantId) { toast.error('Your access to this branch changed.'); reload(); } };
    const onTenantDeleted = (m) => { if (m.tenantId === tenantId) { toast.info('This branch was deleted.'); reload(); } };

    s.on('connect', onConnect); s.on('disconnect', onDown); s.on('connect_error', onDown);
    s.on('presence:update', onPresence); s.on('tenant:revoked', onRevoked); s.on('tenant:deleted', onTenantDeleted);
    if (s.connected) join(); else s.connect();

    return () => {
      s.off('connect', onConnect); s.off('disconnect', onDown); s.off('connect_error', onDown);
      s.off('presence:update', onPresence); s.off('tenant:revoked', onRevoked); s.off('tenant:deleted', onTenantDeleted);
      if (s.connected) s.emit('tenant:leave');
    };
  }, [user, tenantId, reload, toast]);

  const value = useMemo(() => ({ status, online, on, onResync }), [status, online, on, onResync]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
