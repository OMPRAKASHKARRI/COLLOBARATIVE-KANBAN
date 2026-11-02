const { startServer, makeWorld, makeBoard, makeTask, auth, prisma, connectSocket, onceEvent, emitAck, connected, wait, noEvent } = require('./helpers');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');

let s, w, B, cols;
const open = [];
async function sock(user, tenantId) {
  const c = connectSocket(s.url, user.token);
  open.push(c);
  await connected(c);
  if (tenantId) { const ack = await emitAck(c, 'tenant:join', { tenantId }); if (!ack.ok) throw new Error('join failed'); }
  return c;
}

beforeAll(async () => {
  s = await startServer();
  w = await makeWorld();
  ({ board: B, cols } = await makeBoard(s.api, w.tadminA1, w.A1.id, 'RT board'));
});
afterEach(() => { while (open.length) open.pop().close(); });
afterAll(async () => { await s.stop(); await prisma.$disconnect(); });

describe('socket authentication & room authorization', () => {
  it('rejects connections without a token, with a garbage token, and with an expired token', async () => {
    const none = connectSocket(s.url, undefined, { auth: {} });
    open.push(none);
    await expect(connected(none)).rejects.toThrow(/UNAUTHORIZED/);
    const bad = connectSocket(s.url, 'garbage'); open.push(bad);
    await expect(connected(bad)).rejects.toThrow(/UNAUTHORIZED/);
    const expired = jwt.sign({ sub: w.memA1.id, tv: 0, typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: -5 });
    const exp = connectSocket(s.url, expired); open.push(exp);
    await expect(connected(exp)).rejects.toThrow(/TOKEN_EXPIRED/);
  });

  it('a refresh token cannot authenticate a socket', async () => {
    const refresh = jwt.sign({ sub: w.memA1.id, tv: 0, typ: 'refresh' }, env.JWT_REFRESH_SECRET);
    const c = connectSocket(s.url, refresh); open.push(c);
    await expect(connected(c)).rejects.toThrow();
  });

  it('authorized members join their tenant room; unauthorized tenants are denied (same org and other org)', async () => {
    const c = connectSocket(s.url, w.memA1.token); open.push(c); await connected(c);
    const ok = await emitAck(c, 'tenant:join', { tenantId: w.A1.id });
    expect(ok).toMatchObject({ ok: true, tenantId: w.A1.id, role: 'MEMBER' });
    expect(ok.online.map((u) => u.id)).toContain(w.memA1.id);
    const sameOrgOtherTenant = await emitAck(c, 'tenant:join', { tenantId: w.A2.id });
    expect(sameOrgOtherTenant.ok).toBe(false);
    expect(sameOrgOtherTenant.error.code).toBe('FORBIDDEN');
    const otherOrg = await emitAck(c, 'tenant:join', { tenantId: w.B1.id });
    expect(otherOrg.ok).toBe(false);
    const garbage = await emitAck(c, 'tenant:join', { tenantId: 'not-a-uuid' });
    expect(garbage.ok).toBe(false);
    const nonexistent = await emitAck(c, 'tenant:join', { tenantId: '00000000-0000-4000-8000-000000000000' });
    expect(nonexistent.ok).toBe(false);
    // identical error for "does not exist" and "not allowed" -> no tenant enumeration
    expect(nonexistent.error.message).toBe(sameOrgOtherTenant.error.message);
  });

  it('org admin can join any tenant of their org, but not tenants of other orgs', async () => {
    const c = await sock(w.adminA);
    expect((await emitAck(c, 'tenant:join', { tenantId: w.A2.id })).role).toBe('ORG_ADMIN');
    expect((await emitAck(c, 'tenant:join', { tenantId: w.B1.id })).ok).toBe(false);
  });

  it('joining a new tenant leaves the previous one (no stale cross-tenant events after switching)', async () => {
    const c = await sock(w.memX, w.A1.id);
    await emitAck(c, 'tenant:join', { tenantId: w.A2.id });
    const { board, cols: c2 } = await makeBoard(s.api, w.tadminA1, w.A1.id, 'switch-test');
    const none = noEvent(c, 'task:created');
    await makeTask(s.api, w.memA1, board.id, c2['To Do'], 'A1 only');
    expect(await none).toBe(true);
  });
});

describe('tenant-scoped real-time broadcasts', () => {
  it('delivers created/updated/moved/deleted + activity events to the same tenant, with a consistent envelope', async () => {
    const watcher = await sock(w.memA1b, w.A1.id);
    const t = await (async () => {
      const p = onceEvent(watcher, 'task:created');
      const created = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'live');
      const ev = await p;
      expect(ev).toMatchObject({ event: 'task:created', tenantId: w.A1.id, boardId: B.id, actor: { id: w.memA1.id }, data: { task: { id: created.id, title: 'live' } } });
      expect(ev.ts).toBeTruthy();
      return created;
    })();
    let p = onceEvent(watcher, 'task:updated');
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'live 2' }).expect(200);
    expect((await p).data.task).toMatchObject({ title: 'live 2', version: 2 });

    p = onceEvent(watcher, 'task:moved');
    await s.api.patch(`/api/tasks/${t.id}/move`).set(auth(w.memA1)).send({ expectedVersion: 2, columnId: cols.Done, position: 0 }).expect(200);
    const moved = await p;
    expect(moved.data.task).toMatchObject({ columnId: cols.Done, version: 3 });
    expect(moved.data.from.columnId).toBe(cols['To Do']);

    const act = onceEvent(watcher, 'activity:created');
    p = onceEvent(watcher, 'task:deleted');
    await s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1)).expect(204);
    expect((await p).data).toMatchObject({ taskId: t.id, columnId: cols.Done });
    expect((await act).data.activity.tenantId).toBe(w.A1.id);
  });

  it('never delivers one tenant\'s events to another tenant (same org) or another org', async () => {
    const a1 = await sock(w.memA1b, w.A1.id);
    const a2 = await sock(w.tadminA2, w.A2.id);
    const b1 = await sock(w.memB1, w.B1.id);
    const events = ['task:created', 'task:updated', 'task:moved', 'task:deleted', 'board:updated', 'activity:created'];
    const leaks = [];
    for (const c of [a2, b1]) events.forEach((e) => c.on(e, (d) => leaks.push([e, d])));
    const got = onceEvent(a1, 'task:created');
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'secret');
    await got;
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'secret 2' });
    await s.api.patch(`/api/tasks/${t.id}/move`).set(auth(w.memA1)).send({ expectedVersion: 2, columnId: cols.Done, position: 0 });
    await s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1));
    await wait(500);
    expect(leaks).toEqual([]);
  });

  it('does not broadcast failed (409/422) operations', async () => {
    const watcher = await sock(w.memA1b, w.A1.id);
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'no-broadcast');
    await wait(100);
    const quiet = noEvent(watcher, 'task:updated', 500);
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 42, title: 'x' }).expect(409);
    expect(await quiet).toBe(true);
  });

  it('broadcasts board/column changes as board:updated', async () => {
    const watcher = await sock(w.memA1b, w.A1.id);
    const p = onceEvent(watcher, 'board:updated');
    await s.api.post('/api/columns').set(auth(w.tadminA1)).send({ boardId: B.id, name: 'Extra' }).expect(201);
    const ev = await p;
    expect(ev.data.action).toBe('columns_changed');
    expect(ev.data.columns.some((c) => c.name === 'Extra')).toBe(true);
  });

  it('echoes the originating X-Operation-Id so clients can de-duplicate their own optimistic updates', async () => {
    const watcher = await sock(w.memA1b, w.A1.id);
    const p = onceEvent(watcher, 'task:created');
    await s.api.post('/api/tasks').set(auth(w.memA1)).set('X-Operation-Id', 'op-echo-1').send({ boardId: B.id, columnId: cols['To Do'], title: 'echo' });
    expect((await p).opId).toBe('op-echo-1');
  });
});

describe('presence', () => {
  it('announces online/offline and keeps a user online until their LAST tab disconnects', async () => {
    const watcher = await sock(w.tadminA1, w.A1.id);
    let p = onceEvent(watcher, 'presence:online');
    const tab1 = await sock(w.memA1, w.A1.id);
    const online = await p;
    expect(online.data.user.id).toBe(w.memA1.id);
    expect(online.data.online.map((u) => u.id)).toEqual(expect.arrayContaining([w.memA1.id, w.tadminA1.id]));

    const tab2 = await sock(w.memA1, w.A1.id); // second tab: not a new "online" event
    const second = await noEvent(watcher, 'presence:online', 400);
    expect(second).toBe(true);
    expect((await s.api.get(`/api/tenants/${w.A1.id}/presence`).set(auth(w.tadminA1))).body.online.filter((u) => u.id === w.memA1.id)).toHaveLength(1);

    const stillOnline = noEvent(watcher, 'presence:offline', 500);
    tab1.close();
    expect(await stillOnline).toBe(true); // tab2 keeps the user online

    p = onceEvent(watcher, 'presence:offline');
    tab2.close();
    const off = await p;
    expect(off.data.user.id).toBe(w.memA1.id);
    expect(off.data.online.map((u) => u.id)).not.toContain(w.memA1.id);
  });

  it('presence is tenant-scoped: other tenants do not see who is online', async () => {
    const other = await sock(w.tadminA2, w.A2.id);
    const leaked = [];
    other.on('presence:online', (d) => leaked.push(d)); other.on('presence:update', (d) => leaked.push(d));
    await sock(w.memA1, w.A1.id);
    await wait(400);
    expect(leaked).toEqual([]);
    await s.api.get(`/api/tenants/${w.A1.id}/presence`).set(auth(w.tadminA2)).expect(404);
  });
});

describe('access revocation & network recovery', () => {
  it('evicts a socket from the room when its membership is removed (no further events)', async () => {
    const victim = await prisma.membership.findFirst({ where: { userId: w.memA1b.id, tenantId: w.A1.id } });
    const c = await sock(w.memA1b, w.A1.id);
    const revoked = onceEvent(c, 'tenant:revoked');
    await s.api.delete(`/api/memberships/${victim.id}`).set(auth(w.tadminA1)).expect(204);
    expect((await revoked).tenantId).toBe(w.A1.id);
    const quiet = noEvent(c, 'task:created', 500);
    await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'after-revoke');
    expect(await quiet).toBe(true);
    expect((await emitAck(c, 'tenant:join', { tenantId: w.A1.id })).ok).toBe(false); // cannot sneak back in
    await prisma.membership.create({ data: { userId: w.memA1b.id, organizationId: w.orgA.id, tenantId: w.A1.id, role: 'MEMBER' } });
  });

  it('reconnect flow: a client that missed events reconciles via the authoritative board snapshot', async () => {
    const c = await sock(w.memA1b, w.A1.id);
    const before = (await s.api.get(`/api/boards/${B.id}`).set(auth(w.memA1b))).body;
    c.close(); // network drops
    const t1 = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'missed 1');
    await s.api.patch(`/api/tasks/${t1.id}/move`).set(auth(w.memA1)).send({ expectedVersion: 1, columnId: cols.Testing, position: 0 }).expect(200);
    await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'missed 2');
    // client reconnects with a (fresh) token, re-joins (server re-validates), refetches snapshot
    const c2 = connectSocket(s.url, w.memA1b.token); open.push(c2); await connected(c2);
    expect((await emitAck(c2, 'tenant:join', { tenantId: w.A1.id })).ok).toBe(true);
    const after = (await s.api.get(`/api/boards/${B.id}`).set(auth(w.memA1b))).body;
    expect(after.tasks.length).toBe(before.tasks.length + 2);
    const moved = after.tasks.find((t) => t.id === t1.id);
    expect(moved).toMatchObject({ columnId: cols.Testing, version: 2 });
    // and live events resume
    const p = onceEvent(c2, 'task:created');
    await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'live again');
    expect((await p).data.task.title).toBe('live again');
  });

  it('a revoked session (logout everywhere) cannot reconnect', async () => {
    const u = w.memA1b;
    const stale = u.token;
    await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } });
    const c = connectSocket(s.url, stale); open.push(c);
    await expect(connected(c)).rejects.toThrow(/UNAUTHORIZED/);
    await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { decrement: 1 } } });
  });
});
