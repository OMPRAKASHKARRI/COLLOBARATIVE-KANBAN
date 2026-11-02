const prisma = require('../config/db');
const { requireOrgAccess, requireTenantAccess, listTenantUsers } = require('./access.service');
const activity = require('./activity.service');
const { emitToTenant, flush } = require('./realtime.service');

async function list(ctx, { organizationId }) {
  const { role } = await requireOrgAccess(ctx.user.id, organizationId);
  const where = role === 'ORG_ADMIN'
    ? { organizationId }
    : { organizationId, memberships: { some: { userId: ctx.user.id } } };
  const tenants = await prisma.tenant.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { boards: true } } } });
  return { status: 200, body: { tenants: tenants.map(({ _count, ...t }) => ({ ...t, role: role === 'ORG_ADMIN' ? 'ORG_ADMIN' : undefined, boardCount: _count.boards })) } };
}

async function create(ctx, { organizationId, name }) {
  await requireOrgAccess(ctx.user.id, organizationId, 'ORG_ADMIN');
  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({ data: { organizationId, name } });
    await activity.record(tx, { tenantId: t.id, userId: ctx.user.id, entityType: 'tenant', entityId: t.id, action: 'created', details: { name }, opId: ctx.opId });
    return t;
  });
  return { status: 201, body: { tenant } };
}

async function get(ctx, id) {
  const { tenant, role } = await requireTenantAccess(ctx.user.id, id);
  return { status: 200, body: { tenant: { ...tenant, role } } };
}

async function update(ctx, id, { name }) {
  const { role } = await requireTenantAccess(ctx.user.id, id, 'TENANT_ADMIN');
  const events = [];
  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.update({ where: { id }, data: { name } });
    const log = await activity.record(tx, { tenantId: id, userId: ctx.user.id, entityType: 'tenant', entityId: id, action: 'updated', details: { name }, opId: ctx.opId });
    events.push({ event: 'activity:created', data: { activity: log } });
    return t;
  });
  flush(id, ctx, events);
  return { status: 200, body: { tenant: { ...tenant, role } } };
}

async function remove(ctx, id) {
  await requireTenantAccess(ctx.user.id, id, 'ORG_ADMIN');
  emitToTenant(id, 'tenant:deleted', ctx, { tenantId: id });
  await prisma.tenant.delete({ where: { id } });
  require('../sockets/presence').reauthorizeAll([id]);
  return { status: 204 };
}

async function members(ctx, id) {
  const { tenant } = await requireTenantAccess(ctx.user.id, id);
  return { status: 200, body: { members: await listTenantUsers(tenant.id, tenant.organizationId) } };
}

module.exports = { list, create, get, update, remove, members };
