const prisma = require('../config/db');
const activity = require('./activity.service');
const { flush } = require('./realtime.service');
const { loadBoard } = require('./board.service');
const { lockBoard, compactColumn } = require('./locks');
const { notFound, unprocessable, conflict } = require('../utils/errors');

async function loadColumn(ctx, id) {
  const column = await prisma.column.findUnique({ where: { id } });
  if (!column) throw notFound('Column');
  const { board } = await loadBoard(ctx, column.boardId, 'TENANT_ADMIN');
  return { column, board };
}

const snapshot = (tx, boardId) => tx.column.findMany({ where: { boardId }, orderBy: { position: 'asc' } });

async function listForBoard(ctx, boardId) {
  await loadBoard(ctx, boardId);
  return { status: 200, body: { columns: await prisma.column.findMany({ where: { boardId }, orderBy: { position: 'asc' } }) } };
}

async function create(ctx, { boardId, name, position }) {
  const { board } = await loadBoard(ctx, boardId, 'TENANT_ADMIN');
  const events = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const cols = await snapshot(tx, boardId);
    const at = Math.min(position ?? cols.length, cols.length);
    const col = await tx.column.create({ data: { boardId, tenantId: board.tenantId, name, position: cols.length } });
    const order = cols.map((c) => c.id);
    order.splice(at, 0, col.id);
    for (let i = 0; i < order.length; i++) await tx.column.update({ where: { id: order[i] }, data: { position: i } });
    const columns = await snapshot(tx, boardId);
    const log = await activity.record(tx, { tenantId: board.tenantId, userId: ctx.user.id, entityType: 'column', entityId: col.id, action: 'created', details: { name }, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId, data: { action: 'columns_changed', columns } }, { event: 'activity:created', data: { activity: log } });
    return { column: columns.find((c) => c.id === col.id), columns };
  });
  flush(board.tenantId, ctx, events);
  return { status: 201, body: result };
}

async function update(ctx, id, { name, position }) {
  const { column, board } = await loadColumn(ctx, id);
  const events = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockBoard(tx, board.id);
    const cols = await snapshot(tx, board.id);
    if (!cols.some((c) => c.id === id)) throw notFound('Column');
    if (name !== undefined) await tx.column.update({ where: { id }, data: { name } });
    if (position !== undefined) {
      const order = cols.map((c) => c.id).filter((c) => c !== id);
      order.splice(Math.min(position, order.length), 0, id);
      for (let i = 0; i < order.length; i++) await tx.column.update({ where: { id: order[i] }, data: { position: i } });
    }
    const columns = await snapshot(tx, board.id);
    const log = await activity.record(tx, { tenantId: board.tenantId, userId: ctx.user.id, entityType: 'column', entityId: id, action: position !== undefined && name === undefined ? 'reordered' : 'updated', details: { from: column.name, name, position }, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId: board.id, data: { action: 'columns_changed', columns } }, { event: 'activity:created', data: { activity: log } });
    return { column: columns.find((c) => c.id === id), columns };
  });
  flush(board.tenantId, ctx, events);
  return { status: 200, body: result };
}

// A column holding tasks can only be deleted by moving its tasks to another column of the same board.
async function remove(ctx, id, { moveTasksTo }) {
  const { column, board } = await loadColumn(ctx, id);
  const events = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockBoard(tx, board.id);
    const cols = await snapshot(tx, board.id);
    if (cols.length <= 1) throw unprocessable('A board must keep at least one column');
    const tasks = await tx.task.findMany({ where: { columnId: id }, orderBy: { position: 'asc' } });
    let moved = [];
    if (tasks.length) {
      if (!moveTasksTo) throw conflict(`Column "${column.name}" still contains ${tasks.length} task(s). Provide moveTasksTo.`, { code: 'COLUMN_NOT_EMPTY', taskCount: tasks.length });
      const dest = cols.find((c) => c.id === moveTasksTo && c.id !== id);
      if (!dest) throw unprocessable('moveTasksTo must be another column of the same board');
      const base = await tx.task.count({ where: { columnId: dest.id } });
      for (let i = 0; i < tasks.length; i++) {
        await tx.task.update({ where: { id: tasks[i].id }, data: { columnId: dest.id, position: base + i, version: { increment: 1 } } });
      }
      moved = tasks.map((t) => t.id);
    }
    await tx.column.delete({ where: { id } });
    const rest = cols.filter((c) => c.id !== id);
    for (let i = 0; i < rest.length; i++) await tx.column.update({ where: { id: rest[i].id }, data: { position: i } });
    const columns = await snapshot(tx, board.id);
    const log = await activity.record(tx, { tenantId: board.tenantId, userId: ctx.user.id, entityType: 'column', entityId: id, action: 'deleted', details: { name: column.name, movedTasks: moved.length }, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId: board.id, data: { action: 'columns_changed', columns, reloadTasks: moved.length > 0 } }, { event: 'activity:created', data: { activity: log } });
    return { columns };
  });
  flush(board.tenantId, ctx, events);
  return { status: 200, body: result };
}

module.exports = { listForBoard, create, update, remove };
