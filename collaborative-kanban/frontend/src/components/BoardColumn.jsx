import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Loader2 } from 'lucide-react';
import TaskCard from './TaskCard';

const TONE = ['bg-[#7d8f95]', 'bg-[#2f6fd0]', 'bg-signal', 'bg-ok'];

export default function BoardColumn({ column, index, tasks, onOpen, onCreate, dragDisabled, filtered }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}`, data: { type: 'column', columnId: column.id } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try { await onCreate(column.id, title.trim()); setTitle(''); setAdding(false); } finally { setBusy(false); }
  };

  return (
    <section aria-label={`${column.name}, ${tasks.length} tasks`} className="flex w-[17.5rem] shrink-0 snap-start flex-col sm:w-72">
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-2.5 w-2.5 rounded-full ${TONE[index % TONE.length]}`} aria-hidden />
        <h3 className="text-sm font-bold">{column.name}</h3>
        <span className="rounded-md bg-sunken px-1.5 text-xs font-bold text-mute">{tasks.length}</span>
        <button className="btn-icon ml-auto !h-7 !w-7" aria-label={`Add task to ${column.name}`} onClick={() => setAdding(true)}><Plus className="h-4 w-4" /></button>
      </header>
      <div ref={setNodeRef} className={`flex min-h-[7rem] flex-1 flex-col gap-2 rounded-2xl p-2 transition-colors ${isOver ? 'bg-brand-soft ring-2 ring-brand/40' : 'bg-sunken/70'}`}>
        {adding && (
          <form onSubmit={submit} className="rounded-xl border border-brand/40 bg-surface p-2 shadow-card">
            <label className="sr-only" htmlFor={`new-${column.id}`}>Task title</label>
            <input id={`new-${column.id}`} autoFocus className="field" placeholder="What needs doing?" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" className="btn-ghost !px-2.5 !py-1.5" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn-primary !px-2.5 !py-1.5" disabled={!title.trim() || busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Add task</button>
            </div>
          </form>
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} disabled={dragDisabled} />)}
        </SortableContext>
        {!tasks.length && !adding && <p className="m-auto px-3 py-4 text-center text-xs text-mute">{filtered ? 'No tasks match the filters.' : 'No tasks yet. Add one or drop a card here.'}</p>}
      </div>
    </section>
  );
}
