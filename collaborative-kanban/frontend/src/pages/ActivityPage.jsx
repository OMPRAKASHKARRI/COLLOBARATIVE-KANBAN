import { History } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import ActivityPanel from '../components/ActivityPanel';
import { EmptyState } from '../components/ui';

export default function ActivityPage() {
  const { tenant, tenantId } = useWorkspace();
  if (!tenant) return <div className="p-6"><EmptyState icon={History} title="Select a branch">Activity is recorded per branch.</EmptyState></div>;
  return (
    <div className="h-full overflow-y-auto"><div className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-3xl font-bold">Activity · {tenant.name}</h1>
      <div className="rounded-2xl border border-line bg-surface"><ActivityPanel tenantId={tenantId} limit={40} /></div>
    </div></div>
  );
}
