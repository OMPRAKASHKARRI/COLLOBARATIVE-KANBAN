import { useCallback, useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import api from '../services/api';
import { Avatar, EmptyState } from './ui';
import { describeActivity, timeAgo } from '../utils/board';
import { useRealtime } from '../context/RealtimeContext';

// Tenant activity feed: initial page from REST, live additions via `activity:created`, "load more" pagination.
export default function ActivityPanel({ tenantId, limit = 25 }) {
  const { on, onResync } = useRealtime();
  const [state, setState] = useState({ loading: true, items: [], next: null, error: false });
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/activity', { params: { tenantId, limit } });
      setState({ loading: false, items: data.activity, next: data.nextBefore, error: false });
    } catch { setState((s) => ({ ...s, loading: false, error: true })); }
  }, [tenantId, limit]);

  useEffect(() => { setState({ loading: true, items: [], next: null, error: false }); load(); }, [load]);
  useEffect(() => onResync(load), [onResync, load]);
  useEffect(() => on('activity:created', (m) => {
    if (m.tenantId !== tenantId) return;
    setState((s) => (s.items.some((x) => x.id === m.data.activity.id) ? s : { ...s, items: [m.data.activity, ...s.items] }));
  }), [on, tenantId]);

  const loadMore = async () => {
    setMore(true);
    try {
      const { data } = await api.get('/activity', { params: { tenantId, limit, before: state.next } });
      setState((s) => ({ ...s, items: [...s.items, ...data.activity.filter((a) => !s.items.some((x) => x.id === a.id))], next: data.nextBefore }));
    } finally { setMore(false); }
  };

  if (state.loading) return <div className="space-y-3 p-4" aria-busy="true">{[1, 2, 3, 4].map((i) => <div key={i} className="flex gap-2"><div className="skeleton h-6 w-6 !rounded-full" /><div className="skeleton h-6 flex-1" /></div>)}</div>;
  if (state.error) return <p role="alert" className="p-4 text-sm text-danger">Couldn’t load activity. <button className="underline" onClick={load}>Retry</button></p>;
  if (!state.items.length) return <EmptyState icon={History} title="No activity yet">Changes to tasks, boards and members will show up here.</EmptyState>;
  return (
    <div className="p-4">
      <ol className="space-y-3.5">
        {state.items.map((a) => (
          <li key={a.id} className="flex items-start gap-2.5 text-sm">
            <Avatar user={a.user || { name: '?' }} size="sm" />
            <p className="min-w-0 break-words"><strong>{a.user?.name || 'Someone'}</strong> {describeActivity(a)} <span className="whitespace-nowrap text-xs text-mute">· {timeAgo(a.createdAt)}</span></p>
          </li>
        ))}
      </ol>
      {state.next && <button className="btn-outline mt-4 w-full" onClick={loadMore} disabled={more}>{more && <Loader2 className="h-4 w-4 animate-spin" />}Load older activity</button>}
    </div>
  );
}
