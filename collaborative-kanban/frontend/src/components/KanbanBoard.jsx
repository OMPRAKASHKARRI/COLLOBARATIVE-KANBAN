import { useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import BoardColumn from './BoardColumn';
import { CardBody } from './TaskCard';

// Drag semantics: the server `position` is "index among the destination's other tasks", which is exactly
// what dnd-kit's arrayMove / insert-before-over gives us. Dragging is disabled while filters are active
// because indexes among a filtered subset would not match the real column.
// Pointer drags resolve to whatever is under the cursor (a card, else the column body); keyboard drags have no
// pointer, so they fall back to nearest-corners.
const collision = (args) => { const hits = pointerWithin(args); return hits.length ? hits : closestCorners(args); };

export default function KanbanBoard({ columns, groups, visibleGroups, onMove, onOpen, onCreate, filtersActive }) {
  const [active, setActive] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findTask = (id) => Object.values(groups).flat().find((t) => t.id === id);

  const onDragEnd = ({ active: a, over }) => {
    setActive(null);
    if (!over) return;
    const task = findTask(a.id);
    if (!task) return;
    let columnId; let index;
    if (String(over.id).startsWith('col:')) {
      columnId = over.data.current.columnId;
      index = (groups[columnId] || []).filter((t) => t.id !== task.id).length; // dropped on the column body -> bottom
    } else {
      const overTask = findTask(over.id);
      if (!overTask) return;
      columnId = overTask.columnId;
      const list = groups[columnId];
      const overIndex = list.findIndex((t) => t.id === overTask.id);
      if (columnId === task.columnId) index = overIndex; // arrayMove semantics
      else {
        const t = a.rect.current.translated;
        const below = t && t.top + t.height / 2 > over.rect.top + over.rect.height / 2;
        index = overIndex + (below ? 1 : 0);
      }
    }
    if (columnId === task.columnId && index === task.position) return;
    onMove(task.id, columnId, index);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={(e) => setActive(findTask(e.active.id))} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      <div className="scroll-thin flex h-full snap-x gap-4 overflow-x-auto px-4 pb-4 pt-1 sm:px-6">
        {columns.map((c, i) => (
          <BoardColumn key={c.id} column={c} index={i} tasks={visibleGroups[c.id] || []} onOpen={onOpen} onCreate={onCreate} dragDisabled={filtersActive} filtered={filtersActive} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160 }}>{active ? <CardBody task={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
