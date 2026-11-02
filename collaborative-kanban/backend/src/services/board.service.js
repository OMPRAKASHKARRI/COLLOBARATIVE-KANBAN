const prisma = require('../config/db');
const { requireTenantAccess } = require('./access.service');
const activity = require('./activity.service');
const { flush } = require('./realtime.service');
const { notFound } = require('../utils/errors');
const { taskInclude, serializeTask } = require('./task.service');

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Testing', 'Done'];

// Loads a board and verifies the caller's access to ITS tenant (tenant is derived from the
// record, never from the request). Unauthorized => 404.
async function loadBoard(ctx, id, min = 'MEMBER') {
  const board = await prisma.board.findUnique({ where: { id } });
  if (!board) throw notFound('Board');
  const { role } = await requireTenantAccess(ctx.user.id, board.tenantId, min);
  return { board, role };
}

async function list(ctx, { tenantId }) {
  await requireTenantAccess(ctx.user.id, tenantId);
  const boards = await prisma.board.findMany({
    where: { tenantId }, orderBy: { createdAt: 'asc' },
    include: { _count: { select: { tasks: true } } },
  });
  return { status: 200, body: { boards: boards.map(({ _count, ...b }) => ({ ...b, taskCount: _count.tasks })) } };
}

async function create(ctx, { tenantId, name, description = '' }) {
  const { tenant } = await requireTenantAccess(ctx.user.id, tenantId, 'TENANT_ADMIN');
  const events = [];
  const board = await prisma.$transaction(async (tx) => {
    const b = await tx.board.create({
      data: {
        organizationId: tenant.organizationId, tenantId, name, description, createdBy: ctx.user.id,
        columns: { create: DEFAULT_COLUMNS.map((n, i) => ({ name: n, position: i })) },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
    const log = await activity.record(tx, { tenantId, userId: ctx.user.id, entityType: 'board', entityId: b.id, action: 'created', details: { name }, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId: b.id, data: { action: 'created', board: b } }, { event: 'activity:created', data: { activity: log } });
    return b;
  });
  flush(tenantId, ctx, events);
  return { status: 201, body: { board } };
}

async function get(ctx, id) {
  const { board, role } = await loadBoard(ctx, id);
  const [columns, tasks] = await Promise.all([
    prisma.column.findMany({ where: { boardId: id }, orderBy: { position: 'asc' } }),
    prisma.task.findMany({ where: { boardId: id, tenantId: board.tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: taskInclude }),
  ]);
  return { status: 200, body: { board, role, columns, tasks: tasks.map(serializeTask) } };
}

async function update(ctx, id, data) {
  const { board } = await loadBoard(ctx, id, 'TENANT_ADMIN');
  const events = [];
  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.board.update({ where: { id }, data });
    const log = await activity.record(tx, { tenantId: board.tenantId, userId: ctx.user.id, entityType: 'board', entityId: id, action: 'updated', details: data, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId: id, data: { action: 'updated', board: b } }, { event: 'activity:created', data: { activity: log } });
    return b;
  });
  flush(board.tenantId, ctx, events);
  return { status: 200, body: { board: updated } };
}

async function remove(ctx, id) {
  const { board } = await loadBoard(ctx, id, 'TENANT_ADMIN');
  const events = [];
  await prisma.$transaction(async (tx) => {
    await tx.task.deleteMany({ where: { boardId: id } }); // tasks first (RESTRICT on column FK)
    await tx.board.delete({ where: { id } });
    const log = await activity.record(tx, { tenantId: board.tenantId, userId: ctx.user.id, entityType: 'board', entityId: id, action: 'deleted', details: { name: board.name }, opId: ctx.opId });
    events.push({ event: 'board:updated', boardId: id, data: { action: 'deleted', boardId: id } }, { event: 'activity:created', data: { activity: log } });
  });
  flush(board.tenantId, ctx, events);
  return { status: 204 };
}

module.exports = { list, create, get, update, remove, loadBoard };
