const { startServer, makeWorld, makeBoard, makeTask, auth, prisma, uid } = require('./helpers');

let s, w, boardA1, boardA2, boardB1, taskA1, taskB1;
beforeAll(async () => {
  s = await startServer();
  w = await makeWorld();
  boardA1 = await makeBoard(s.api, w.tadminA1, w.A1.id, 'A1 board');
  boardA2 = await makeBoard(s.api, w.tadminA2, w.A2.id, 'A2 board');
  boardB1 = await makeBoard(s.api, w.adminB, w.B1.id, 'B1 board');
  taskA1 = await makeTask(s.api, w.memA1, boardA1.board.id, boardA1.cols['To Do'], 'secret A1 task');
  taskB1 = await makeTask(s.api, w.memB1, boardB1.board.id, boardB1.cols['To Do'], 'secret B1 task');
});
afterAll(async () => { await s.stop(); await prisma.$disconnect(); });

describe('organization & tenant access', () => {
  it('lists only organizations the caller belongs to', async () => {
    const a = await s.api.get('/api/organizations').set(auth(w.memA1));
    expect(a.body.organizations.map((o) => o.id)).toEqual([w.orgA.id]);
    expect(a.body.organizations[0].role).toBe('MEMBER');
    const none = await s.api.get('/api/organizations').set(auth(w.outsider));
    expect(none.body.organizations).toEqual([]);
  });

  it('org admin sees all tenants; tenant members see only their own', async () => {
    const admin = await s.api.get(`/api/tenants?organizationId=${w.orgA.id}`).set(auth(w.adminA));
    expect(admin.body.tenants.map((t) => t.name).sort()).toEqual(['A1', 'A2']);
    const mem = await s.api.get(`/api/tenants?organizationId=${w.orgA.id}`).set(auth(w.memA1));
    expect(mem.body.tenants.map((t) => t.name)).toEqual(['A1']);
  });

  it('a multi-tenant member can switch between both tenants', async () => {
    const r = await s.api.get(`/api/tenants?organizationId=${w.orgA.id}`).set(auth(w.memX));
    expect(r.body.tenants.map((t) => t.name).sort()).toEqual(['A1', 'A2']);
  });

  it('cross-organization: org B users cannot read org A organization / tenants / members', async () => {
    await s.api.get(`/api/organizations/${w.orgA.id}`).set(auth(w.adminB)).expect(404);
    await s.api.get(`/api/tenants?organizationId=${w.orgA.id}`).set(auth(w.adminB)).expect(404);
    await s.api.get(`/api/tenants/${w.A1.id}`).set(auth(w.adminB)).expect(404);
    await s.api.get(`/api/tenants/${w.A1.id}/members`).set(auth(w.adminB)).expect(404);
    await s.api.put(`/api/organizations/${w.orgA.id}`).set(auth(w.adminB)).send({ name: 'pwned' }).expect(404);
    await s.api.delete(`/api/organizations/${w.orgA.id}`).set(auth(w.adminB)).expect(404);
  });

  it('a user can create an organization and becomes its ORG_ADMIN', async () => {
    const res = await s.api.post('/api/organizations').set(auth(w.outsider)).send({ name: `Outsider Org ${uid()}` });
    expect(res.status).toBe(201);
    expect(res.body.organization.role).toBe('ORG_ADMIN');
    const t = await s.api.post('/api/tenants').set(auth(w.outsider)).send({ organizationId: res.body.organization.id, name: 'HQ' });
    expect(t.status).toBe(201);
  });
});

describe('cross-tenant isolation (same org and cross org)', () => {
  it('cannot read another tenant\'s board, columns, tasks or activity — even with a valid ID', async () => {
    // tadminA1 -> A2 (same organization, different tenant)
    await s.api.get(`/api/boards/${boardA2.board.id}`).set(auth(w.tadminA1)).expect(404);
    await s.api.get(`/api/boards/${boardA2.board.id}/columns`).set(auth(w.tadminA1)).expect(404);
    await s.api.get(`/api/boards?tenantId=${w.A2.id}`).set(auth(w.tadminA1)).expect(404);
    await s.api.get(`/api/tasks?boardId=${boardA2.board.id}`).set(auth(w.memA1)).expect(404);
    await s.api.get(`/api/activity?tenantId=${w.A2.id}`).set(auth(w.memA1)).expect(404);
    // memA1 -> B1 (other organization)
    await s.api.get(`/api/tasks/${taskB1.id}`).set(auth(w.memA1)).expect(404);
    await s.api.get(`/api/activity?tenantId=${w.B1.id}`).set(auth(w.memA1)).expect(404);
  });

  it('cannot update / move / delete another tenant\'s task by ID', async () => {
    await s.api.put(`/api/tasks/${taskB1.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'hacked' }).expect(404);
    await s.api.patch(`/api/tasks/${taskB1.id}/move`).set(auth(w.memA1)).send({ expectedVersion: 1, columnId: boardA1.cols.Done, position: 0 }).expect(404);
    await s.api.delete(`/api/tasks/${taskB1.id}`).set(auth(w.memA1)).expect(404);
    const row = await prisma.task.findUnique({ where: { id: taskB1.id } });
    expect(row.title).toBe('secret B1 task');
  });

  it('a spoofed tenantId / boardId / columnId in the body cannot cross tenants', async () => {
    // create task in A1's board but using a column from A2's board
    const r1 = await s.api.post('/api/tasks').set(auth(w.memA1)).send({ boardId: boardA1.board.id, columnId: boardA2.cols['To Do'], title: 'x' });
    expect(r1.status).toBe(422);
    // create task directly on another tenant's board
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ boardId: boardA2.board.id, columnId: boardA2.cols['To Do'], title: 'x' }).expect(404);
    // extra tenantId in body is ignored (strict derivation from the board)
    const r3 = await s.api.post('/api/tasks').set(auth(w.memA1)).send({ boardId: boardA1.board.id, columnId: boardA1.cols['To Do'], title: 'ok', tenantId: w.B1.id });
    expect(r3.status).toBe(201);
    expect(r3.body.task.tenantId).toBe(w.A1.id);
    // moving a task into another board's column is rejected
    const r4 = await s.api.patch(`/api/tasks/${taskA1.id}/move`).set(auth(w.memA1)).send({ expectedVersion: taskA1.version, columnId: boardA2.cols.Done, position: 0 });
    expect(r4.status).toBe(422);
  });

  it('assignees must have access to the task\'s tenant', async () => {
    const bad = await s.api.put(`/api/tasks/${taskA1.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, assignedTo: w.memB1.id });
    expect(bad.status).toBe(422);
    const badNonA1 = await s.api.put(`/api/tasks/${taskA1.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, assignedTo: w.tadminA2.id });
    expect(badNonA1.status).toBe(422);
    const ok = await s.api.put(`/api/tasks/${taskA1.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, assignedTo: w.memA1b.id });
    expect(ok.status).toBe(200);
    expect(ok.body.task.assignee.id).toBe(w.memA1b.id);
    taskA1 = ok.body.task;
  });

  it('org admin implicitly accesses every tenant of their own org, but nothing in other orgs', async () => {
    await s.api.get(`/api/boards/${boardA1.board.id}`).set(auth(w.adminA)).expect(200);
    await s.api.get(`/api/boards/${boardA2.board.id}`).set(auth(w.adminA)).expect(200);
    await s.api.get(`/api/boards/${boardB1.board.id}`).set(auth(w.adminA)).expect(404);
  });

  it('database composite foreign keys reject cross-tenant rows even if app code were bypassed', async () => {
    await expect(prisma.task.create({ data: { tenantId: w.A2.id, boardId: boardA1.board.id, columnId: boardA1.cols['To Do'], title: 'bad', position: 99 } })).rejects.toBeTruthy();
    await expect(prisma.task.create({ data: { tenantId: w.A1.id, boardId: boardA1.board.id, columnId: boardA2.cols['To Do'], title: 'bad', position: 99 } })).rejects.toBeTruthy();
    await expect(prisma.membership.create({ data: { userId: w.outsider.id, organizationId: w.orgB.id, tenantId: w.A1.id, role: 'MEMBER' } })).rejects.toBeTruthy();
    await expect(prisma.membership.create({ data: { userId: w.outsider.id, organizationId: w.orgA.id, tenantId: null, role: 'MEMBER' } })).rejects.toBeTruthy(); // role/scope CHECK
  });
});

describe('role-based access control', () => {
  it('MEMBER cannot create/modify/delete boards or columns, tenants, or memberships', async () => {
    await s.api.post('/api/boards').set(auth(w.memA1)).send({ tenantId: w.A1.id, name: 'nope' }).expect(403);
    await s.api.put(`/api/boards/${boardA1.board.id}`).set(auth(w.memA1)).send({ name: 'nope' }).expect(403);
    await s.api.delete(`/api/boards/${boardA1.board.id}`).set(auth(w.memA1)).expect(403);
    await s.api.post('/api/columns').set(auth(w.memA1)).send({ boardId: boardA1.board.id, name: 'nope' }).expect(403);
    await s.api.put(`/api/columns/${boardA1.cols['To Do']}`).set(auth(w.memA1)).send({ name: 'nope' }).expect(403);
    await s.api.post('/api/tenants').set(auth(w.memA1)).send({ organizationId: w.orgA.id, name: 'nope' }).expect(403);
    await s.api.put(`/api/tenants/${w.A1.id}`).set(auth(w.memA1)).send({ name: 'nope' }).expect(403);
    await s.api.post('/api/memberships').set(auth(w.memA1)).send({ email: w.outsider.email, organizationId: w.orgA.id, tenantId: w.A1.id, role: 'MEMBER' }).expect(403);
    await s.api.get(`/api/memberships?tenantId=${w.A1.id}`).set(auth(w.memA1)).expect(403);
  });

  it('MEMBER can create, edit, assign and move tasks, but delete only their own', async () => {
    const mine = await makeTask(s.api, w.memA1, boardA1.board.id, boardA1.cols['To Do'], 'mine');
    const theirs = await makeTask(s.api, w.memA1b, boardA1.board.id, boardA1.cols['To Do'], 'theirs');
    await s.api.put(`/api/tasks/${theirs.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'edited by peer' }).expect(200);
    await s.api.delete(`/api/tasks/${theirs.id}`).set(auth(w.memA1)).expect(403);
    await s.api.delete(`/api/tasks/${mine.id}`).set(auth(w.memA1)).expect(204);
  });

  it('TENANT_ADMIN manages own tenant (boards, columns, members) but not other tenants or tenant admins', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'tmp');
    await s.api.post('/api/columns').set(auth(w.tadminA1)).send({ boardId: b.board.id, name: 'Blocked' }).expect(201);
    await s.api.delete(`/api/boards/${b.board.id}`).set(auth(w.tadminA1)).expect(204);
    await s.api.post('/api/boards').set(auth(w.tadminA1)).send({ tenantId: w.A2.id, name: 'nope' }).expect(404);
    await s.api.post('/api/tenants').set(auth(w.tadminA1)).send({ organizationId: w.orgA.id, name: 'nope' }).expect(403);
    await s.api.delete(`/api/tenants/${w.A1.id}`).set(auth(w.tadminA1)).expect(403);
    const addMember = await s.api.post('/api/memberships').set(auth(w.tadminA1)).send({ email: w.outsider.email, organizationId: w.orgA.id, tenantId: w.A1.id, role: 'MEMBER' });
    expect(addMember.status).toBe(201);
    const promote = await s.api.put(`/api/memberships/${addMember.body.membership.id}`).set(auth(w.tadminA1)).send({ role: 'TENANT_ADMIN' });
    expect(promote.status).toBe(403); // only org admins manage tenant administrators
    const orgPromote = await s.api.put(`/api/memberships/${addMember.body.membership.id}`).set(auth(w.adminA)).send({ role: 'TENANT_ADMIN' });
    expect(orgPromote.status).toBe(200);
    await s.api.delete(`/api/memberships/${addMember.body.membership.id}`).set(auth(w.tadminA1)).expect(403);
    await s.api.delete(`/api/memberships/${addMember.body.membership.id}`).set(auth(w.adminA)).expect(204);
  });

  it('ORG_ADMIN creates / updates / deletes tenants and guards the last org admin', async () => {
    const created = await s.api.post('/api/tenants').set(auth(w.adminA)).send({ organizationId: w.orgA.id, name: `New-${uid()}` });
    expect(created.status).toBe(201);
    await s.api.put(`/api/tenants/${created.body.tenant.id}`).set(auth(w.adminA)).send({ name: 'Renamed' }).expect(200);
    await s.api.delete(`/api/tenants/${created.body.tenant.id}`).set(auth(w.adminA)).expect(204);
    const adminMembership = await prisma.membership.findFirst({ where: { userId: w.adminA.id, tenantId: null } });
    // other admin needed to act; adminA cannot demote self, and nobody else is admin -> still protected
    await s.api.put(`/api/memberships/${adminMembership.id}`).set(auth(w.adminA)).send({ role: 'ORG_ADMIN' }).expect(403);
    await s.api.delete(`/api/memberships/${adminMembership.id}`).set(auth(w.adminB)).expect(404);
  });

  it('validates input shape: bad UUIDs -> 400, unknown role -> 400, empty names -> 400', async () => {
    await s.api.get('/api/tasks/not-a-uuid').set(auth(w.memA1)).expect(400);
    await s.api.post('/api/boards').set(auth(w.tadminA1)).send({ tenantId: w.A1.id, name: '   ' }).expect(400);
    await s.api.post('/api/memberships').set(auth(w.adminA)).send({ email: w.outsider.email, organizationId: w.orgA.id, tenantId: w.A1.id, role: 'GOD' }).expect(400);
    await s.api.get('/api/boards').set(auth(w.memA1)).expect(400);
  });

  it('rejects unauthenticated access to every protected resource family', async () => {
    for (const p of ['/api/organizations', `/api/tenants?organizationId=${w.orgA.id}`, `/api/boards?tenantId=${w.A1.id}`, `/api/tasks?boardId=${boardA1.board.id}`, `/api/activity?tenantId=${w.A1.id}`]) {
      await s.api.get(p).expect(401);
    }
  });

  it('errors are consistent JSON and never leak internals', async () => {
    const r = await s.api.get('/api/does-not-exist').set(auth(w.memA1));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    const m = await s.api.post('/api/tasks').set(auth(w.memA1)).set('Content-Type', 'application/json').send('{bad json');
    expect(m.status).toBe(400);
    expect(JSON.stringify(m.body)).not.toMatch(/stack|prisma|node_modules/i);
  });
});
