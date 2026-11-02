const prisma = require('../config/db');
const { RANK, requireOrgAccess, requireTenantAccess } = require('./access.service');
const activity = require('./activity.service');
const { flush } = require('./realtime.service');
const { forbidden, notFound, unprocessable, AppError } = require('../utils/errors');

const include = { user: { select: { id: true, name: true, email: true } }, tenant: { select: { id: true, name: true } } };

async function list(ctx, q) {
  if (q.tenantId) {
    await requireTenantAccess(ctx.user.id, q.tenantId, 'TENANT_ADMIN');
    const rows = await prisma.membership.findMany({ where: { tenantId: q.tenantId }, include, orderBy: { createdAt: 'asc' } });
    return { status: 200, body: { memberships: rows } };
  }
  await requireOrgAccess(ctx.user.id, q.organizationId, 'ORG_ADMIN');
  const rows = await prisma.membership.findMany({ where: { organizationId: q.organizationId }, include, orderBy: { createdAt: 'asc' } });
  return { status: 200, body: { memberships: rows } };
}

// Policy: org admins manage everything in the org; tenant admins manage MEMBER rows in their tenant.
// Granting/removing TENANT_ADMIN or ORG_ADMIN requires organization admin.
async function authorizeChange(ctx, { organizationId, tenantId, role }) {
  if (tenantId) {
    const { tenant, role: actorRole } = await requireTenantAccess(ctx.user.id, tenantId, 'TENANT_ADMIN');
    if (tenant.organizationId !== organizationId) throw unprocessable('Tenant does not belong to this organization');
    if (role !== 'MEMBER' && RANK[actorRole] < RANK.ORG_ADMIN) throw forbidden('Only organization admins can manage tenant administrators');
    return tenant;
  }
  await requireOrgAccess(ctx.user.id, organizationId, 'ORG_ADMIN');
  return null;
}

async function afterChange(ctx, tenantId, userId, log, kind) {
  const { reauthorizeUser } = require('../sockets/presence');
  if (tenantId) flush(tenantId, ctx, [{ event: 'member:updated', data: { kind, userId } }, { event: 'activity:created', data: { activity: log } }]);
  await reauthorizeUser(userId);
}

async function create(ctx, { email, organizationId, tenantId = null, role }) {
  if ((tenantId === null) !== (role === 'ORG_ADMIN')) throw unprocessable('ORG_ADMIN is organization-level (no tenant); tenant memberships must be TENANT_ADMIN or MEMBER');
  await authorizeChange(ctx, { organizationId, tenantId, role });
  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) throw unprocessable('No registered user with that email. Ask them to register first.');
  const existing = await prisma.membership.findFirst({ where: { userId: target.id, organizationId, tenantId } });
  if (existing) throw new AppError(409, 'DUPLICATE', 'User already has this membership');
  let log = null;
  const m = await prisma.$transaction(async (tx) => {
    const row = await tx.membership.create({ data: { userId: target.id, organizationId, tenantId, role }, include });
    if (tenantId) log = await activity.record(tx, { tenantId, userId: ctx.user.id, entityType: 'membership', entityId: row.id, action: 'added', details: { user: target.name, role }, opId: ctx.opId });
    return row;
  });
  await afterChange(ctx, tenantId, target.id, log, 'added');
  return { status: 201, body: { membership: m } };
}

async function loadMembership(id) {
  const m = await prisma.membership.findUnique({ where: { id }, include });
  if (!m) throw notFound('Membership');
  return m;
}

async function guardLastOrgAdmin(m) {
  if (m.tenantId === null && m.role === 'ORG_ADMIN') {
    const n = await prisma.membership.count({ where: { organizationId: m.organizationId, tenantId: null, role: 'ORG_ADMIN' } });
    if (n <= 1) throw unprocessable('Cannot remove or demote the last organization admin');
  }
}

async function update(ctx, id, { role }) {
  const m = await loadMembership(id);
  // hide memberships of orgs the caller cannot see
  await requireOrgAccess(ctx.user.id, m.organizationId);
  if (m.userId === ctx.user.id) throw forbidden('You cannot change your own role');
  if ((m.tenantId === null) !== (role === 'ORG_ADMIN')) throw unprocessable('Role is not valid for this membership scope');
  await authorizeChange(ctx, { organizationId: m.organizationId, tenantId: m.tenantId, role: m.role });
  await authorizeChange(ctx, { organizationId: m.organizationId, tenantId: m.tenantId, role });
  await guardLastOrgAdmin(m);
  let log = null;
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.membership.update({ where: { id }, data: { role }, include });
    if (m.tenantId) log = await activity.record(tx, { tenantId: m.tenantId, userId: ctx.user.id, entityType: 'membership', entityId: id, action: 'role_changed', details: { user: m.user.name, from: m.role, to: role }, opId: ctx.opId });
    return r;
  });
  await afterChange(ctx, m.tenantId, m.userId, log, 'role_changed');
  return { status: 200, body: { membership: row } };
}

async function remove(ctx, id) {
  const m = await loadMembership(id);
  await requireOrgAccess(ctx.user.id, m.organizationId);
  await authorizeChange(ctx, { organizationId: m.organizationId, tenantId: m.tenantId, role: m.role });
  await guardLastOrgAdmin(m);
  let log = null;
  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id } });
    // tasks assigned to a user who lost access to the tenant become unassigned
    if (m.tenantId) {
      await tx.task.updateMany({ where: { tenantId: m.tenantId, assignedTo: m.userId }, data: { assignedTo: null } });
      log = await activity.record(tx, { tenantId: m.tenantId, userId: ctx.user.id, entityType: 'membership', entityId: id, action: 'removed', details: { user: m.user.name, role: m.role }, opId: ctx.opId });
    }
  });
  await afterChange(ctx, m.tenantId, m.userId, log, 'removed');
  return { status: 204 };
}

module.exports = { list, create, update, remove };
