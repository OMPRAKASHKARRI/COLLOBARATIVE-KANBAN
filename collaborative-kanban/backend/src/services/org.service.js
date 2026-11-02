const prisma = require('../config/db');
const { requireOrgAccess } = require('./access.service');

async function list(ctx) {
  const ms = await prisma.membership.findMany({ where: { userId: ctx.user.id }, include: { organization: true } });
  const map = new Map();
  for (const m of ms) {
    const cur = map.get(m.organizationId);
    const role = m.role === 'ORG_ADMIN' || cur?.role === 'ORG_ADMIN' ? 'ORG_ADMIN' : 'MEMBER';
    map.set(m.organizationId, { ...m.organization, role });
  }
  return { status: 200, body: { organizations: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)) } };
}

async function create(ctx, { name }) {
  const org = await prisma.$transaction(async (tx) => {
    const o = await tx.organization.create({ data: { name } });
    await tx.membership.create({ data: { userId: ctx.user.id, organizationId: o.id, tenantId: null, role: 'ORG_ADMIN' } });
    return o;
  });
  return { status: 201, body: { organization: { ...org, role: 'ORG_ADMIN' } } };
}

async function get(ctx, id) {
  const { org, role } = await requireOrgAccess(ctx.user.id, id);
  return { status: 200, body: { organization: { ...org, role } } };
}

async function update(ctx, id, { name }) {
  await requireOrgAccess(ctx.user.id, id, 'ORG_ADMIN');
  const org = await prisma.organization.update({ where: { id }, data: { name } });
  return { status: 200, body: { organization: { ...org, role: 'ORG_ADMIN' } } };
}

async function remove(ctx, id) {
  await requireOrgAccess(ctx.user.id, id, 'ORG_ADMIN');
  const tenants = await prisma.tenant.findMany({ where: { organizationId: id }, select: { id: true } });
  await prisma.organization.delete({ where: { id } }); // cascades to tenants/boards/columns/tasks/logs/memberships
  const { reauthorizeAll } = require('../sockets/presence');
  reauthorizeAll(tenants.map((t) => t.id));
  return { status: 204 };
}

module.exports = { list, create, get, update, remove };
