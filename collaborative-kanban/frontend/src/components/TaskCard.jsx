import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical } from 'lucide-react';
import { Avatar } from './ui';
import { PRIORITIES, dueState, formatDue } from '../utils/board';

const DUE = { overdue: 'bg-danger-soft text-danger', soon: 'bg-signal/25 text-[#7a5200]', later: 'bg-sunken text-mute' };

export const CardBody = forwardRef(function CardBody({ task, onOpen, dragging, overlay, handleProps, style, disabled }, ref) {
  const p = PRIORITIES[task.priority];
  const due = dueState(task.dueDate);
  return (
    <div ref={ref} style={style}
      className={`group relative rounded-xl border border-line bg-surface p-3 pl-4 shadow-card transition-shadow ${dragging ? 'opacity-35' : ''} ${overlay ? 'rotate-1 shadow-lift' : 'hover:shadow-lift/40'}`}>
      <span className={`absolute inset-y-2 left-0 w-1 rounded-r ${p.bar}`} aria-hidden />
      <div className="flex items-start gap-1.5">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen?.(task)} aria-label={`Open task ${task.title}`}>
          <p className="break-words text-sm font-semibold leading-snug">{task.title}</p>
          {task.description && <p className="mt-1 line-clamp-2 text-xs text-mute">{task.description}</p>}
        </button>
        {!disabled && (
          <button type="button" {...handleProps} aria-label={`Drag ${task.title}`} className="-mr-1 -mt-0.5 cursor-grab touch-none rounded p-1 text-mute/70 hover:bg-sunken hover:text-ink active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <span className={`chip ${p.cls}`}>{p.label}</span>
        {due && <span className={`chip ${DUE[due]}`}><CalendarDays className="h-3 w-3" />{due === 'overdue' ? 'Overdue · ' : ''}{formatDue(task.dueDate)}</span>}
        <span className="ml-auto">{task.assignee ? <Avatar user={task.assignee} size="sm" /> : <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-mute" title="Unassigned">–</span>}</span>
      </div>
    </div>
  );
});

export default function TaskCard({ task, onOpen, disabled }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'task', columnId: task.columnId }, disabled });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return <CardBody ref={setNodeRef} style={style} task={task} onOpen={onOpen} dragging={isDragging} disabled={disabled} handleProps={{ ...attributes, ...listeners }} />;
}
