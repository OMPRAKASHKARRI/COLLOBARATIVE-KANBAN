// Pure helpers for board state. All functions return new arrays/objects (no mutation).

export const byPosition = (a, b) => a.position - b.position;

export function groupByColumn(columns, tasks) {
  const groups = Object.fromEntries(columns.map((c) => [c.id, []]));
  for (const t of tasks) (groups[t.columnId] ||= []).push(t);
  for (const id of Object.keys(groups)) groups[id].sort(byPosition);
  return groups;
}

// Apply server-authoritative [{id, columnId, position}] to local tasks.
export function applyPositions(tasks, positions = []) {
  if (!positions.length) return tasks;
  const map = new Map(positions.map((p) => [p.id, p]));
  return tasks.map((t) => (map.has(t.id) ? { ...t, columnId: map.get(t.id).columnId, position: map.get(t.id).position } : t));
}

// Insert or replace a task; an incoming copy older than what we already hold is ignored (events can arrive late).
export function upsertTask(tasks, incoming) {
  const i = tasks.findIndex((t) => t.id === incoming.id);
  if (i === -1) return [...tasks, incoming];
  if (tasks[i].version > incoming.version) return tasks;
  const next = tasks.slice();
  next[i] = incoming;
  return next;
}

export const isStaleEvent = (tasks, incoming) => tasks.some((t) => t.id === incoming.id && t.version > incoming.version);

export function removeTask(tasks, id, positions = []) {
  return applyPositions(tasks.filter((t) => t.id !== id), positions);
}

// Optimistic move: take `id` out, insert at `index` (index among the destination's OTHER tasks, same
// meaning as the server's `position`), and renumber the affected columns densely.
export function moveLocal(tasks, id, columnId, index) {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return tasks;
  const srcId = moving.columnId;
  const lists = {};
  const colsTouched = new Set([srcId, columnId]);
  for (const c of colsTouched) lists[c] = tasks.filter((t) => t.columnId === c && t.id !== id).sort(byPosition);
  const dest = lists[columnId];
  dest.splice(Math.max(0, Math.min(index, dest.length)), 0, { ...moving, columnId });
  const renumbered = new Map();
  for (const c of colsTouched) lists[c].forEach((t, i) => renumbered.set(t.id, { ...t, position: i }));
  return tasks.map((t) => renumbered.get(t.id) || t);
}

export const PRIORITIES = {
  URGENT: { label: 'Urgent', rank: 4, cls: 'bg-signal/25 text-[#7a5200]', bar: 'bg-signal' },
  HIGH: { label: 'High', rank: 3, cls: 'bg-danger-soft text-danger', bar: 'bg-danger' },
  MEDIUM: { label: 'Medium', rank: 2, cls: 'bg-brand-soft text-brand', bar: 'bg-brand' },
  LOW: { label: 'Low', rank: 1, cls: 'bg-sunken text-mute', bar: 'bg-line' },
};

// 'overdue' | 'soon' (<= 2 days) | 'later' | null
export function dueState(dueDate, now = new Date()) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const days = Math.floor((d.setHours(23, 59, 59, 999) - now.getTime()) / 86400000);
  if (days < 0) return 'overdue';
  return days <= 2 ? 'soon' : 'later';
}

export const formatDue = (dueDate) => (dueDate ? new Date(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
export const toDateInput = (dueDate) => (dueDate ? new Date(dueDate).toISOString().slice(0, 10) : '');
export const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export function filterTasks(tasks, { q = '', assigneeId = '', priority = '' }) {
  const needle = q.trim().toLowerCase();
  return tasks.filter((t) =>
    (!needle || t.title.toLowerCase().includes(needle) || (t.description || '').toLowerCase().includes(needle)) &&
    (!assigneeId || (assigneeId === '__none' ? !t.assignedTo : t.assignedTo === assigneeId)) &&
    (!priority || t.priority === priority));
}

export const describeActivity = (a) => {
  const d = a.details || {};
  const t = d.title ? `“${d.title}”` : a.entityType;
  switch (`${a.entityType}.${a.action}`) {
    case 'task.created': return `created ${t}${d.column ? ` in ${d.column}` : ''}`;
    case 'task.updated': return `edited ${t}`;
    case 'task.assigned': return `assigned ${t} ${d.to ? `to ${d.to}` : '(unassigned)'}`;
    case 'task.moved': return d.from === d.to ? `reordered ${t} in ${d.to}` : `moved ${t} from ${d.from} to ${d.to}`;
    case 'task.deleted': return `deleted ${t}`;
    case 'board.created': return `created board “${d.name}”`;
    case 'board.updated': return 'updated the board';
    case 'board.deleted': return `deleted board “${d.name}”`;
    case 'column.created': return `added column “${d.name}”`;
    case 'column.updated': return `renamed column “${d.from}”`;
    case 'column.reordered': return `reordered column “${d.from}”`;
    case 'column.deleted': return `removed column “${d.name}”`;
    case 'membership.added': return `added ${d.user} as ${String(d.role).toLowerCase().replace('_', ' ')}`;
    case 'membership.role_changed': return `changed ${d.user} from ${d.from} to ${d.to}`;
    case 'membership.removed': return `removed ${d.user}`;
    case 'tenant.created': return `created branch “${d.name}”`;
    case 'tenant.updated': return `renamed branch to “${d.name}”`;
    default: return `${a.action} ${a.entityType}`;
  }
};

export const timeAgo = (iso, now = Date.now()) => {
  const s = Math.max(1, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
