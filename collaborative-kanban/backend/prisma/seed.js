// Development seed. Idempotent: uses find-or-create everywhere, so repeated runs do not duplicate rows.
// ALL demo accounts share a DEV-ONLY password. Never run this against production.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed production'); process.exit(1); }

const DEMO_PASSWORD = 'Password123!';
const COLS = ['To Do', 'In Progress', 'Testing', 'Done'];
const daysFromNow = (d) => new Date(Date.now() + d * 86400000);

async function user(name, email) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { name, email, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) } });
}
async function org(name) {
  return (await prisma.organization.findFirst({ where: { name } })) || prisma.organization.create({ data: { name } });
}
async function tenant(organizationId, name) {
  return prisma.tenant.upsert({ where: { organizationId_name: { organizationId, name } }, update: {}, create: { organizationId, name } });
}
async function member(userId, organizationId, tenantId, role) {
  const found = await prisma.membership.findFirst({ where: { userId, organizationId, tenantId } });
  return found || prisma.membership.create({ data: { userId, organizationId, tenantId, role } });
}
async function board(t, name, description, createdBy, tasks) {
  let b = await prisma.board.findFirst({ where: { tenantId: t.id, name }, include: { columns: true } });
  if (!b) {
    b = await prisma.board.create({
      data: { organizationId: t.organizationId, tenantId: t.id, name, description, createdBy, columns: { create: COLS.map((n, i) => ({ name: n, position: i })) } },
      include: { columns: true },
    });
    await prisma.activityLog.create({ data: { tenantId: t.id, userId: createdBy, entityType: 'board', entityId: b.id, action: 'created', details: { name } } });
  }
  if ((await prisma.task.count({ where: { boardId: b.id } })) > 0) return b;
  const perCol = {};
  for (const [title, col, assignee, priority, due, desc] of tasks) {
    const c = b.columns.find((x) => x.name === col);
    perCol[c.id] = perCol[c.id] ?? 0;
    const task = await prisma.task.create({
      data: { tenantId: t.id, boardId: b.id, columnId: c.id, title, description: desc || '', assignedTo: assignee?.id ?? null, createdBy, priority, dueDate: due == null ? null : daysFromNow(due), position: perCol[c.id]++ },
    });
    await prisma.activityLog.create({ data: { tenantId: t.id, userId: createdBy, entityType: 'task', entityId: task.id, action: 'created', details: { title, column: col } } });
  }
  return b;
}

(async () => {
  const [rahul, priya, arjun, sneha, meera, ravi, kiran, anita] = await Promise.all([
    user('Rahul Sharma', 'rahul@abc.test'), user('Priya Reddy', 'priya@abc.test'), user('Arjun Rao', 'arjun@abc.test'),
    user('Sneha Iyer', 'sneha@abc.test'), user('Meera Nair', 'meera@abc.test'), user('Ravi Kumar', 'ravi@abc.test'),
    user('Kiran Patel', 'kiran@xyz.test'), user('Anita Desai', 'anita@xyz.test'),
  ]);

  const abc = await org('ABC Technologies');
  const [hyd, blr, chn] = [await tenant(abc.id, 'Hyderabad'), await tenant(abc.id, 'Bangalore'), await tenant(abc.id, 'Chennai')];
  const xyz = await org('XYZ Solutions');
  const [mum, pune] = [await tenant(xyz.id, 'Mumbai'), await tenant(xyz.id, 'Pune')];

  await member(rahul.id, abc.id, null, 'ORG_ADMIN');
  await member(priya.id, abc.id, hyd.id, 'TENANT_ADMIN');
  await member(arjun.id, abc.id, hyd.id, 'MEMBER');
  await member(meera.id, abc.id, hyd.id, 'MEMBER');
  await member(meera.id, abc.id, blr.id, 'MEMBER'); // multi-tenant user
  await member(sneha.id, abc.id, blr.id, 'TENANT_ADMIN');
  await member(ravi.id, abc.id, chn.id, 'TENANT_ADMIN');
  await member(anita.id, xyz.id, null, 'ORG_ADMIN');
  await member(kiran.id, xyz.id, mum.id, 'MEMBER');

  await board(hyd, 'Website Development', 'Customer-facing website rebuild', priya.id, [
    ['Create Login Page', 'To Do', rahul, 'HIGH', 5, 'Design and implement the login screen with validation.'],
    ['Fix API Validation', 'To Do', arjun, 'MEDIUM', 3, 'Return 422 for semantic validation errors.'],
    ['Design Dashboard', 'To Do', null, 'LOW', 10],
    ['Develop Registration API', 'In Progress', arjun, 'HIGH', 2, 'POST /api/auth/register with bcrypt hashing.'],
    ['Set up CI pipeline', 'In Progress', meera, 'MEDIUM', 4],
    ['Test Authentication', 'Testing', priya, 'URGENT', -1, 'Cover expired and revoked tokens.'],
    ['Deploy Dashboard', 'Done', rahul, 'MEDIUM', -3],
    ['Write project README', 'Done', priya, 'LOW', -6],
  ]);
  await board(hyd, 'Mobile Application Development', 'iOS & Android companion app', priya.id, [
    ['Wireframes', 'Done', meera, 'MEDIUM', -8],
    ['Push notifications', 'To Do', arjun, 'HIGH', 14],
    ['Offline sync spike', 'In Progress', meera, 'MEDIUM', 7],
  ]);
  await board(blr, 'CRM Development', 'Internal CRM', sneha.id, [
    ['Import customer CSV', 'To Do', meera, 'MEDIUM', 6],
    ['Lead scoring model', 'In Progress', sneha, 'HIGH', 9],
    ['Pipeline report', 'Testing', meera, 'LOW', 2],
    ['Audit log export', 'Done', sneha, 'LOW', -2],
  ]);
  await board(blr, 'AI Automation', 'Workflow automation experiments', sneha.id, [
    ['Ticket triage prototype', 'In Progress', sneha, 'HIGH', 5],
    ['Prompt evaluation set', 'To Do', null, 'MEDIUM', 12],
  ]);
  await board(chn, 'Branch Operations', 'Chennai operations tracker', ravi.id, [['Vendor onboarding', 'To Do', ravi, 'MEDIUM', 8], ['Office move checklist', 'In Progress', ravi, 'LOW', 20]]);
  await board(mum, 'Customer Support Platform', 'Ticketing and SLAs', anita.id, [
    ['SLA dashboard', 'To Do', kiran, 'HIGH', 4],
    ['Escalation rules', 'In Progress', kiran, 'URGENT', 1],
    ['Macro library', 'Done', kiran, 'LOW', -5],
  ]);
  await board(pune, 'Pune Pilot', 'Pilot rollout', anita.id, [['Kickoff', 'Done', anita, 'LOW', -10]]);

  console.log('Seed complete.');
  console.log('Demo password for ALL accounts (dev only):', DEMO_PASSWORD);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
