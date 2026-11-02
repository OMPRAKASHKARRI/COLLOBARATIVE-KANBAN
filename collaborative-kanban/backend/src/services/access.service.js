// Central authorization. Every tenant-owned operation resolves the caller's EFFECTIVE role
// for the tenant from the database (never from the request). Unknown or unauthorized tenants
// both yield 404 so that other tenants' existence is not leaked.
const prisma = require('../config/db');
const { forbidden, notFound } = require('../utils/errors');

const RANK = { MEMBER: 1, TENANT_ADMIN: 2, ORG_ADMIN: 3 };

async function getTenantAccess(userId, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  const ms = await prisma.membership.findMany({
    where: { userId, organizationId: tenant.organizationId, OR: [{ tenantId: null }, { tenantId }] },
  });
  if (!ms.length) return null;
  const role = ms.some((m) => m.role === 'ORG_ADMIN')
    ? 'ORG_ADMIN'
    : ms.sort((a, b) => RANK[b.role] - RANK[a.role])[0].role;
  return { tenant, role };
}

async function requireTenantAccess(userId, tenantId, min = 'MEMBER') {
  const access = await getTenantAccess(userId, tenantId);
  if (!access) throw notFound('Tenant');
  if (RANK[access.role] < RANK[min]) throw forbidden(`Requires ${min.replace('_', ' ').toLowerCase()} role`);
  return access;
}

// Org role: 'ORG_ADMIN' (org-level membership) or 'MEMBER' (belongs to >=1 tenant of the org).
async function getOrgAccess(userId, organizationId) {
  const ms = await prisma.membership.findMany({ where: { userId, organizationId } });
  if (!ms.length) return null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) return null;
  return { org, role: ms.some((m) => m.role === 'ORG_ADMIN') ? 'ORG_ADMIN' : 'MEMBER' };
}

async function requireOrgAccess(userId, organizationId, min = 'MEMBER') {
  const access = await getOrgAccess(userId, organizationId);
  if (!access) throw notFound('Organization');
  if (min === 'ORG_ADMIN' && access.role !== 'ORG_ADMIN') throw forbidden('Requires organization admin role');
  return access;
}

// Users who can access a tenant: its own members plus organization admins.
async function listTenantUsers(tenantId, organizationId) {
  const ms = await prisma.membership.findMany({
    where: { organizationId, OR: [{ tenantId }, { tenantId: null }] },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const byUser = new Map();
  for (const m of ms) {
    const prev = byUser.get(m.userId);
    const role = m.role === 'ORG_ADMIN' || (prev && prev.role === 'ORG_ADMIN') ? 'ORG_ADMIN' : m.role;
    byUser.set(m.userId, { ...m.user, role, membershipId: m.id, orgLevel: m.tenantId === null });
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { RANK, getTenantAccess, requireTenantAccess, getOrgAccess, requireOrgAccess, listTenantUsers };
