const prisma = require('../config/db');
const { requireTenantAccess } = require('./access.service');

const withUser = { user: { select: { id: true, name: true } } };

// Writes an activity row inside the caller's transaction and returns it (with actor) so the
// caller can broadcast `activity:created` after commit.
async function record(tx, { tenantId, userId, entityType, entityId, action, details = {}, opId }) {
  return tx.activityLog.create({
    data: { tenantId, userId, entityType, entityId, action, details: opId ? { ...details, opId } : details },
    include: withUser,
  });
}

async function list(ctx, q) {
  await requireTenantAccess(ctx.user.id, q.tenantId);
  const rows = await prisma.activityLog.findMany({
    where: {
      tenantId: q.tenantId,
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit,
    include: withUser,
  });
  return { status: 200, body: { activity: rows, nextBefore: rows.length === q.limit ? rows[rows.length - 1].createdAt : null } };
}

module.exports = { record, list };
