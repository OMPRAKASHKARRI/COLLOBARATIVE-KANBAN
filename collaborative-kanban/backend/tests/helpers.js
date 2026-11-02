const http = require('http');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { io: ioc } = require('socket.io-client');
const prisma = require('../src/config/db');
const { createApp } = require('../src/app');
const { initSockets } = require('../src/sockets');
const { signAccess } = require('../src/utils/tokens');

const uid = () => Math.random().toString(36).slice(2, 10);
const hash = bcrypt.hashSync('Password123!', 4);

async function startServer() {
  const server = http.createServer(createApp());
  const io = initSockets(server);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const url = `http://localhost:${port}`;
  return {
    server, io, port, url, api: request(server),
    async stop() { io.close(); await new Promise((r) => server.close(r)); },
  };
}

async function makeUser(name) {
  const user = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/\W/g, '')}.${uid()}@test.dev`, passwordHash: hash } });
  return { ...user, token: signAccess(user) };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

// Builds two isolated organizations:
//  orgA: adminA (org-level), tenants A1 {tadminA1, memA1, memA1b} and A2 {tadminA2}; memX is member of A1 AND A2
//  orgB: adminB, tenant B1 {memB1}
async function makeWorld() {
  const [adminA, tadminA1, memA1, memA1b, tadminA2, memX, adminB, memB1, outsider] = await Promise.all(
    ['AdminA', 'TAdminA1', 'MemA1', 'MemA1b', 'TAdminA2', 'MemX', 'AdminB', 'MemB1', 'Outsider'].map(makeUser));
  const orgA = await prisma.organization.create({ data: { name: `OrgA-${uid()}` } });
  const orgB = await prisma.organization.create({ data: { name: `OrgB-${uid()}` } });
  const A1 = await prisma.tenant.create({ data: { organizationId: orgA.id, name: 'A1' } });
  const A2 = await prisma.tenant.create({ data: { organizationId: orgA.id, name: 'A2' } });
  const B1 = await prisma.tenant.create({ data: { organizationId: orgB.id, name: 'B1' } });
  const m = (user, org, tenant, role) => prisma.membership.create({ data: { userId: user.id, organizationId: org.id, tenantId: tenant?.id ?? null, role } });
  await Promise.all([
    m(adminA, orgA, null, 'ORG_ADMIN'), m(tadminA1, orgA, A1, 'TENANT_ADMIN'), m(memA1, orgA, A1, 'MEMBER'), m(memA1b, orgA, A1, 'MEMBER'),
    m(tadminA2, orgA, A2, 'TENANT_ADMIN'), m(memX, orgA, A1, 'MEMBER'), m(memX, orgA, A2, 'MEMBER'),
    m(adminB, orgB, null, 'ORG_ADMIN'), m(memB1, orgB, B1, 'MEMBER'),
  ]);
  return { adminA, tadminA1, memA1, memA1b, tadminA2, memX, adminB, memB1, outsider, orgA, orgB, A1, A2, B1 };
}

// Creates a board through the real API (4 default columns) + returns column map by name.
async function makeBoard(api, user, tenantId, name = 'Board') {
  const res = await api.post('/api/boards').set(auth(user)).send({ tenantId, name });
  if (res.status !== 201) throw new Error(`makeBoard failed ${res.status} ${JSON.stringify(res.body)}`);
  const cols = Object.fromEntries(res.body.board.columns.map((c) => [c.name, c.id]));
  return { board: res.body.board, cols };
}
async function makeTask(api, user, boardId, columnId, title = 'T', extra = {}) {
  const res = await api.post('/api/tasks').set(auth(user)).send({ boardId, columnId, title, ...extra });
  if (res.status !== 201) throw new Error(`makeTask failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.task;
}

function connectSocket(url, token, opts = {}) {
  return ioc(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
}
const onceEvent = (sock, ev, ms = 3000) =>
  new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms); sock.once(ev, (d) => { clearTimeout(t); res(d); }); });
const emitAck = (sock, ev, payload) => new Promise((res) => sock.emit(ev, payload, res));
const connected = (sock) => new Promise((res, rej) => { sock.once('connect', res); sock.once('connect_error', rej); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Resolves true if the event does NOT arrive within ms
const noEvent = (sock, ev, ms = 600) => new Promise((res) => { const h = () => res(false); sock.once(ev, h); setTimeout(() => { sock.off(ev, h); res(true); }, ms); });

module.exports = { prisma, startServer, makeUser, auth, makeWorld, makeBoard, makeTask, connectSocket, onceEvent, emitAck, connected, wait, noEvent, uid };
