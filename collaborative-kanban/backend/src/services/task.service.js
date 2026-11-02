const prisma = require('../config/db');
const { requireTenantAccess, getTenantAccess } = require('./access.service');
const activity = require('./activity.service');
const { flush } = require('./realtime.service');
const { lockBoard, compactColumn } = require('./locks');
const { notFound, forbidden, conflict, unprocessable } = require('../utils/errors');

const taskInclude = { assignee: { select: { id: true, name: true } } };
const serializeTask = (t) => ({
  id: t.id, tenantId: t.tenantId, boardId: t.boardId, columnId: t.columnId, title: t.title,
  description: t.description, assignedTo: t.assignedTo, assignee: t.assignee || null, createdBy: t.createdBy,
  priority: t.priority, dueDate: t.dueDate, position: t.position, version: t.version,
  createdAt: t.createdAt, updatedAt: t.updatedAt,
});

// Loads a task and authorizes against ITS tenant. Unauthorized or missing => 404.
async function loadTask(ctx, id, min = 'MEMBER') {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw notFound('Task');
  const { role } = await requireTenantAccess(ctx.user.id, task.tenantId, min);
  return { task, role };
}

async function loadBoardForTasks(ctx, boardId) {
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board) throw notFound('Board');
  const { role } = await requireTenantAccess(ctx.user.id, board.tenantId);
  return { board, role };
}

// Assignee must be a user with access to the same tenant.
async function assertAssignable(userId, tenantId) {
  if (!userId) return;
  if (!(await getTenantAccess(userId, tenantId))) throw unprocessable('Assignee does not have access to this tenant', { field: 'assignedTo' });
}

const staleConflict = (current) =>
  conflict('This task was modified by someone else. Review the latest version and try again.', { code: 'STALE_VERSION', current: serializeTask(current) });

async function list(ctx, q) {
  const { board } = await loadBoardForTasks(ctx, q.boardId);
  const tasks = await prisma.task.findMany({
    where: {
      boardId: q.boardId, tenantId: board.tenantId,
      ...(q.assigneeId ? { assignedTo: q.assigneeId } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ columnId: 'asc' }, { position: 'asc' }], include: taskInclude,
  });
  return { status: 200, body: { tasks: tasks.map(serializeTask) } };
}

async function get(ctx, id) {
  const { task } = await loadTask(ctx, id);
  return { status: 200, body: { task: serializeTask(task) } };
}

async function create(ctx, input) {
  const { board } = await loadBoardForTasks(ctx, input.boardId);
  const tenantId = board.tenantId;
  await assertAssignable(input.assignedTo, tenantId);
  const events = [];
  const task = await prisma.$transaction(async (tx) => {
    await lockBoard(tx, board.id);
    const column = await tx.column.findFirst({ where: { id: input.columnId, boardId: board.id, tenantId } });
    if (!column) throw unprocessable('Column does not belong to this board', { field: 'columnId' });
    const count = await tx.task.count({ where: { columnId: column.id } });
    const at = Math.min(input.position ?? count, count);
    let shifted = [];
    if (at < count) {
      const below = await tx.task.findMany({ where: { columnId: column.id, position: { gte: at } }, select: { id: true } });
      await tx.task.updateMany({ where: { columnId: column.id, position: { gte: at } }, data: { position: { increment: 1 } } });
      shifted = below.map((b) => b.id);
    }
    const created = await tx.task.create({
      data: {
        tenantId, boardId: board.id, columnId: column.id, title: input.title, description: input.description ?? '',
        assignedTo: input.assignedTo ?? null, priority: input.priority ?? 'MEDIUM', dueDate: input.dueDate ?? null,
        position: at, createdBy: ctx.user.id,
      },
      include: taskInclude,
    });
    const positions = shifted.length
      ? (await tx.task.findMany({ where: { id: { in: shifted } }, select: { id: true, columnId: true, position: true } }))
      : [];
    const log = await activity.record(tx, { tenantId, userId: ctx.user.id, entityType: 'task', entityId: created.id, action: 'created', details: { title: created.title, column: column.name }, opId: ctx.opId });
    events.push({ event: 'task:created', boardId: board.id, data: { task: serializeTask(created), positions } }, { event: 'activity:created', data: { activity: log } });
    return created;
  });
  flush(tenantId, ctx, events);
  return { status: 201, body: { task: serializeTask(task) } };
}

// Optimistic concurrency: the UPDATE only matches when version === expectedVersion.
async function update(ctx, id, input) {
  const { task: before } = await loadTask(ctx, id);
  const { expectedVersion, ...fields } = input;
  if (fields.assignedTo !== undefined) await assertAssignable(fields.assignedTo, before.tenantId);
  const data = {};
  for (const k of ['title', 'description', 'assignedTo', 'priority', 'dueDate']) if (fields[k] !== undefined) data[k] = fields[k];
  const events = [];
  const task = await prisma.$transaction(async (tx) => {
    const res = await tx.task.updateMany({ where: { id, tenantId: before.tenantId, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (res.count === 0) {
      const cur = await tx.task.findFirst({ where: { id, tenantId: before.tenantId }, include: taskInclude });
      if (!cur) throw notFound('Task'); // deleted concurrently
      throw staleConflict(cur);
    }
    const after = await tx.task.findUnique({ where: { id }, include: taskInclude });
    const changes = {};
    for (const k of Object.keys(data)) {
      const b = before[k] instanceof Date ? before[k].toISOString() : before[k];
      const a = after[k] instanceof Date ? after[k].toISOString() : after[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: b, to: a };
    }
    const assignChanged = 'assignedTo' in changes;
    const otherChanged = Object.keys(changes).filter((k) => k !== 'assignedTo').length > 0;
    const logs = [];
    if (otherChanged || !assignChanged) logs.push(await activity.record(tx, { tenantId: before.tenantId, userId: ctx.user.id, entityType: 'task', entityId: id, action: 'updated', details: { title: after.title, changes: { ...changes, assignedTo: undefined } }, opId: ctx.opId }));
    if (assignChanged) logs.push(await activity.record(tx, { tenantId: before.tenantId, userId: ctx.user.id, entityType: 'task', entityId: id, action: 'assigned', details: { title: after.title, from: before.assignee?.name || null, to: after.assignee?.name || null }, opId: ctx.opId }));
    events.push({ event: 'task:updated', boardId: after.boardId, data: { task: serializeTask(after) } });
    logs.forEach((l) => events.push({ event: 'activity:created', data: { activity: l } }));
    return after;
  });
  flush(before.tenantId, ctx, events);
  return { status: 200, body: { task: serializeTask(task) } };
}

async function move(ctx, id, { expectedVersion, columnId, position }) {
  const { task: pre } = await loadTask(ctx, id);
  const events = [];
  const result = await prisma.$transaction(async (tx) => {
    await lockBoard(tx, pre.boardId); // serialize against concurrent moves/creates/deletes on this board
    const cur = await tx.task.findFirst({ where: { id, tenantId: pre.tenantId }, include: taskInclude });
    if (!cur) throw notFound('Task');
    if (cur.version !== expectedVersion) throw staleConflict(cur);
    const dest = await tx.column.findFirst({ where: { id: columnId, boardId: cur.boardId, tenantId: cur.tenantId } });
    if (!dest) throw unprocessable('Destination column does not belong to this task\'s board', { field: 'columnId' });
    const src = await tx.column.findUnique({ where: { id: cur.columnId } });

    const destIds = (await tx.task.findMany({ where: { columnId: dest.id, NOT: { id } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } })).map((t) => t.id);
    const at = Math.min(position, destIds.length);
    if (cur.columnId === dest.id && cur.position === at) {
      return { task: cur, positions: [], noop: true };
    }
    destIds.splice(at, 0, id);
    const positions = [];
    const before = new Map((await tx.task.findMany({ where: { columnId: dest.id }, select: { id: true, position: true } })).map((t) => [t.id, t.position]));
    for (let i = 0; i < destIds.length; i++) {
      if (destIds[i] === id) continue;
      if (before.get(destIds[i]) !== i) {
        await tx.task.update({ where: { id: destIds[i] }, data: { position: i } });
        positions.push({ id: destIds[i], columnId: dest.id, position: i });
      }
    }
    const moved = await tx.task.update({ where: { id }, data: { columnId: dest.id, position: at, version: { increment: 1 } }, include: taskInclude });
    if (cur.columnId !== dest.id) positions.push(...(await compactColumn(tx, cur.columnId)));
    const log = await activity.record(tx, { tenantId: cur.tenantId, userId: ctx.user.id, entityType: 'task', entityId: id, action: 'moved', details: { title: cur.title, from: src.name, to: dest.name, position: at }, opId: ctx.opId });
    events.push({ event: 'task:moved', boardId: cur.boardId, data: { task: serializeTask(moved), from: { columnId: cur.columnId, position: cur.position }, positions } }, { event: 'activity:created', data: { activity: log } });
    return { task: moved, positions };
  });
  flush(pre.tenantId, ctx, events);
  return { status: 200, body: { task: serializeTask(result.task), positions: result.positions } };
}

// Members may delete only tasks they created; tenant/org admins may delete any.
async function remove(ctx, id, { expectedVersion } = {}) {
  const { task: pre, role } = await loadTask(ctx, id);
  if (role === 'MEMBER' && pre.createdBy !== ctx.user.id) throw forbidden('Members can only delete tasks they created');
  const events = [];
  await prisma.$transaction(async (tx) => {
    await lockBoard(tx, pre.boardId);
    const cur = await tx.task.findFirst({ where: { id, tenantId: pre.tenantId }, include: taskInclude });
    if (!cur) throw notFound('Task');
    if (expectedVersion !== undefined && cur.version !== expectedVersion) throw staleConflict(cur);
    await tx.task.delete({ where: { id } });
    const positions = await compactColumn(tx, cur.columnId);
    const log = await activity.record(tx, { tenantId: cur.tenantId, userId: ctx.user.id, entityType: 'task', entityId: id, action: 'deleted', details: { title: cur.title }, opId: ctx.opId });
    events.push({ event: 'task:deleted', boardId: cur.boardId, data: { taskId: id, columnId: cur.columnId, positions } }, { event: 'activity:created', data: { activity: log } });
  });
  flush(pre.tenantId, ctx, events);
  return { status: 204 };
}

module.exports = { list, get, create, update, move, remove, taskInclude, serializeTask };
