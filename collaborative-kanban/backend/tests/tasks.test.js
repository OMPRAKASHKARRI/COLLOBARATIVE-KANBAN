const { startServer, makeWorld, makeBoard, makeTask, auth, prisma } = require('./helpers');

let s, w, B, cols;
beforeAll(async () => {
  s = await startServer();
  w = await makeWorld();
  ({ board: B, cols } = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Tasks board'));
});
afterAll(async () => { await s.stop(); await prisma.$disconnect(); });

const positions = async (columnId) => (await prisma.task.findMany({ where: { columnId }, orderBy: { position: 'asc' } })).map((t) => [t.title, t.position]);
const mv = (u, t, columnId, position, v = t.version) => s.api.patch(`/api/tasks/${t.id}/move`).set(auth(u)).send({ expectedVersion: v, columnId, position });
const fresh = async (id) => (await s.api.get(`/api/tasks/${id}`).set(auth(w.memA1))).body.task;

describe('board & column CRUD', () => {
  it('creates a board with the four default columns in order', async () => {
    const r = await s.api.get(`/api/boards/${B.id}/columns`).set(auth(w.memA1));
    expect(r.body.columns.map((c) => [c.name, c.position])).toEqual([['To Do', 0], ['In Progress', 1], ['Testing', 2], ['Done', 3]]);
  });

  it('adds, renames, reorders columns with persisted contiguous positions', async () => {
    const add = await s.api.post('/api/columns').set(auth(w.tadminA1)).send({ boardId: B.id, name: 'Review', position: 2 });
    expect(add.body.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Review', 'Testing', 'Done']);
    const ren = await s.api.put(`/api/columns/${add.body.column.id}`).set(auth(w.tadminA1)).send({ name: 'Code Review', position: 0 });
    expect(ren.body.columns.map((c) => [c.name, c.position])).toEqual([['Code Review', 0], ['To Do', 1], ['In Progress', 2], ['Testing', 3], ['Done', 4]]);
    const del = await s.api.delete(`/api/columns/${add.body.column.id}`).set(auth(w.tadminA1));
    expect(del.status).toBe(200);
    expect(del.body.columns.map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });

  it('refuses to delete a non-empty column unless tasks are moved to a column of the same board', async () => {
    const col = (await s.api.post('/api/columns').set(auth(w.tadminA1)).send({ boardId: B.id, name: 'Temp' })).body.column;
    const t = await makeTask(s.api, w.memA1, B.id, col.id, 'in temp');
    const refuse = await s.api.delete(`/api/columns/${col.id}`).set(auth(w.tadminA1));
    expect(refuse.status).toBe(409);
    expect(refuse.body.error.details.code).toBe('COLUMN_NOT_EMPTY');
    const other = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Other');
    await s.api.delete(`/api/columns/${col.id}?moveTasksTo=${other.cols['To Do']}`).set(auth(w.tadminA1)).expect(422);
    const ok = await s.api.delete(`/api/columns/${col.id}?moveTasksTo=${cols['To Do']}`).set(auth(w.tadminA1));
    expect(ok.status).toBe(200);
    const moved = await fresh(t.id);
    expect(moved.columnId).toBe(cols['To Do']);
    expect(moved.version).toBe(2);
  });
});

describe('task CRUD', () => {
  it('creates, reads, edits (version++) and deletes a task', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'CRUD task', { description: 'd', priority: 'HIGH', dueDate: '2026-12-31', assignedTo: w.memA1b.id });
    expect(t).toMatchObject({ title: 'CRUD task', priority: 'HIGH', version: 1, position: expect.any(Number) });
    expect(new Date(t.dueDate).toISOString().slice(0, 10)).toBe('2026-12-31');
    const upd = await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'Renamed', priority: 'LOW', dueDate: null });
    expect(upd.status).toBe(200);
    expect(upd.body.task).toMatchObject({ title: 'Renamed', priority: 'LOW', dueDate: null, version: 2 });
    await s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1)).expect(204);
    await s.api.get(`/api/tasks/${t.id}`).set(auth(w.memA1)).expect(404);
  });

  it('validates inputs (empty title, bad date, bad priority, bad version, deleted record)', async () => {
    const base = { boardId: B.id, columnId: cols['To Do'] };
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ ...base, title: '  ' }).expect(400);
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ ...base, title: 'x', dueDate: '2026-13-45' }).expect(400);
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ ...base, title: 'x', dueDate: 'tomorrow' }).expect(400);
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ ...base, title: 'x', priority: 'CRITICAL' }).expect(400);
    await s.api.post('/api/tasks').set(auth(w.memA1)).send({ ...base, title: 'x'.repeat(201) }).expect(400);
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'v');
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ title: 'no version' }).expect(400);
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 0, title: 'x' }).expect(400);
    await s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1));
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'x' }).expect(404);
    await s.api.patch(`/api/tasks/${t.id}/move`).set(auth(w.memA1)).send({ expectedVersion: 1, columnId: cols.Done, position: 0 }).expect(404);
  });

  it('searches and filters tasks', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Search');
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'Fix login bug', { priority: 'URGENT', assignedTo: w.memA1.id });
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'Write docs', { description: 'about LOGIN' });
    const q = await s.api.get(`/api/tasks?boardId=${b.board.id}&q=login`).set(auth(w.memA1));
    expect(q.body.tasks.map((t) => t.title).sort()).toEqual(['Fix login bug', 'Write docs']);
    const p = await s.api.get(`/api/tasks?boardId=${b.board.id}&priority=URGENT`).set(auth(w.memA1));
    expect(p.body.tasks).toHaveLength(1);
    const a = await s.api.get(`/api/tasks?boardId=${b.board.id}&assigneeId=${w.memA1.id}`).set(auth(w.memA1));
    expect(a.body.tasks).toHaveLength(1);
  });
});

describe('ordering & movement', () => {
  it('reorders within a column and moves across columns keeping contiguous positions', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Order');
    const mk = (t) => makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], t);
    const A = await mk('A'); const Bt = await mk('B'); const C = await mk('C'); const D = await mk('D');
    expect(await positions(b.cols['To Do'])).toEqual([['A', 0], ['B', 1], ['C', 2], ['D', 3]]);

    // same-column: move D to top
    let r = await mv(w.memA1, D, b.cols['To Do'], 0);
    expect(r.status).toBe(200);
    expect(await positions(b.cols['To Do'])).toEqual([['D', 0], ['A', 1], ['B', 2], ['C', 3]]);
    expect(r.body.task.version).toBe(2);

    // cross-column: move A into In Progress at 0, source compacts
    r = await mv(w.memA1, A, b.cols['In Progress'], 0);
    expect(await positions(b.cols['To Do'])).toEqual([['D', 0], ['B', 1], ['C', 2]]);
    expect(await positions(b.cols['In Progress'])).toEqual([['A', 0]]);
    expect(r.body.positions.length).toBeGreaterThan(0);

    // insert into the middle of another column; position beyond end clamps
    r = await mv(w.memA1, C, b.cols['In Progress'], 99);
    expect(await positions(b.cols['In Progress'])).toEqual([['A', 0], ['C', 1]]);
    r = await mv(w.memA1, await fresh(D.id), b.cols['In Progress'], 1);
    expect(await positions(b.cols['In Progress'])).toEqual([['A', 0], ['D', 1], ['C', 2]]);
    expect(await positions(b.cols['To Do'])).toEqual([['B', 0]]);
  });

  it('a no-op move changes nothing (no version bump)', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Noop');
    const t = await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'only');
    const r = await mv(w.memA1, t, b.cols['To Do'], 0);
    expect(r.status).toBe(200);
    expect(r.body.task.version).toBe(1);
  });

  it('deleting a task compacts the remaining positions', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Compact');
    const t1 = await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], '1');
    const t2 = await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], '2', {});
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], '3');
    await s.api.delete(`/api/tasks/${t1.id}`).set(auth(w.memA1)).expect(204);
    expect(await positions(b.cols['To Do'])).toEqual([['2', 0], ['3', 1]]);
    expect(t2.id).toBeTruthy();
  });

  it('inserting a task at a position shifts the tasks below it', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Insert');
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'x');
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'y');
    await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'top', { position: 0 });
    expect(await positions(b.cols['To Do'])).toEqual([['top', 0], ['x', 1], ['y', 2]]);
  });
});

describe('concurrency control', () => {
  it('stale edit -> 409 with authoritative state; nothing silently overwritten', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'conflict me');
    const first = await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'Rahul title' });
    expect(first.status).toBe(200);
    const stale = await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1b)).send({ expectedVersion: 1, description: 'Priya description' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.code).toBe('STALE_VERSION');
    expect(stale.body.error.details.current).toMatchObject({ title: 'Rahul title', version: 2 });
    expect((await fresh(t.id)).description).toBe('');
  });

  it('stale move -> 409; edit then move with old version -> 409', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'stale move');
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'bumped' }).expect(200);
    const r = await mv(w.memA1b, t, cols.Done, 0, 1);
    expect(r.status).toBe(409);
    expect(r.body.error.details.current.version).toBe(2);
    expect((await fresh(t.id)).columnId).toBe(cols['To Do']);
  });

  it('two simultaneous moves of the SAME task: exactly one wins, the other gets 409', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'race');
    const [r1, r2] = await Promise.all([mv(w.memA1, t, cols['In Progress'], 0), mv(w.memA1b, t, cols.Done, 0)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const final = await fresh(t.id);
    const winner = r1.status === 200 ? cols['In Progress'] : cols.Done;
    expect(final.columnId).toBe(winner);
    expect(final.version).toBe(2);
  });

  it('simultaneous edit vs delete: either order yields a consistent outcome (no resurrected rows)', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'edit vs delete');
    const [e, d] = await Promise.all([
      s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'late edit' }),
      s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1)),
    ]);
    expect(d.status).toBe(204);
    expect([200, 404]).toContain(e.status);
    expect(await prisma.task.findUnique({ where: { id: t.id } })).toBeNull();
  });

  it('many simultaneous moves of DIFFERENT tasks converge on dense, duplicate-free positions', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Stress');
    const tasks = [];
    for (let i = 0; i < 8; i++) tasks.push(await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], `t${i}`));
    const dests = [b.cols['In Progress'], b.cols['Testing'], b.cols['Done'], b.cols['To Do']];
    const results = await Promise.all(tasks.map((t, i) => mv(w.memA1, t, dests[i % 4], i % 3)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const all = await prisma.task.findMany({ where: { boardId: b.board.id } });
    expect(all).toHaveLength(8);
    for (const colId of dests) {
      const inCol = all.filter((t) => t.columnId === colId).map((t) => t.position).sort((x, y) => x - y);
      expect(inCol).toEqual(inCol.map((_, i) => i)); // 0..n-1 with no gaps or duplicates
    }
  });

  it('concurrent creates in one column get unique, contiguous positions', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'CreateRace');
    await Promise.all(Array.from({ length: 6 }, (_, i) => makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], `c${i}`)));
    const pos = (await prisma.task.findMany({ where: { columnId: b.cols['To Do'] } })).map((t) => t.position).sort((x, y) => x - y);
    expect(pos).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('idempotency: replaying a request with the same X-Operation-Id does not execute twice', async () => {
    const body = { boardId: B.id, columnId: cols['To Do'], title: 'idem' };
    const r1 = await s.api.post('/api/tasks').set(auth(w.memA1)).set('X-Operation-Id', 'op-123').send(body);
    const r2 = await s.api.post('/api/tasks').set(auth(w.memA1)).set('X-Operation-Id', 'op-123').send(body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers['idempotent-replay']).toBe('true');
    expect(r2.body.task.id).toBe(r1.body.task.id);
    expect(await prisma.task.count({ where: { boardId: B.id, title: 'idem' } })).toBe(1);
  });
});

describe('activity logs', () => {
  it('records create/update/assign/move/delete with actor, tenant, entity and details', async () => {
    const b = await makeBoard(s.api, w.tadminA1, w.A1.id, 'Audit');
    const t = await makeTask(s.api, w.memA1, b.board.id, b.cols['To Do'], 'audited');
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 1, title: 'audited 2' }).expect(200);
    await s.api.put(`/api/tasks/${t.id}`).set(auth(w.memA1)).send({ expectedVersion: 2, assignedTo: w.memA1b.id }).expect(200);
    await mv(w.memA1, { ...t, version: 3 }, b.cols['Done'], 0);
    await s.api.delete(`/api/tasks/${t.id}`).set(auth(w.memA1)).expect(204);
    const r = await s.api.get(`/api/activity?tenantId=${w.A1.id}&entityType=task&entityId=${t.id}`).set(auth(w.memA1));
    expect(r.body.activity.map((a) => a.action).reverse()).toEqual(['created', 'updated', 'assigned', 'moved', 'deleted']);
    const moved = r.body.activity.find((a) => a.action === 'moved');
    expect(moved).toMatchObject({ tenantId: w.A1.id, entityType: 'task', entityId: t.id, user: { id: w.memA1.id } });
    expect(moved.details).toMatchObject({ from: 'To Do', to: 'Done' });
    const boardLog = await prisma.activityLog.findFirst({ where: { entityType: 'board', entityId: b.board.id, action: 'created' } });
    expect(boardLog.tenantId).toBe(w.A1.id);
  });

  it('a failed (rolled back) operation leaves no activity row', async () => {
    const t = await makeTask(s.api, w.memA1, B.id, cols['To Do'], 'rollback');
    const before = await prisma.activityLog.count({ where: { entityId: t.id } });
    await mv(w.memA1, t, cols.Done, 0, 99).expect(409);
    expect(await prisma.activityLog.count({ where: { entityId: t.id } })).toBe(before);
  });

  it('paginates with `before` and never returns another tenant\'s rows', async () => {
    const p1 = await s.api.get(`/api/activity?tenantId=${w.A1.id}&limit=5`).set(auth(w.memA1));
    expect(p1.body.activity).toHaveLength(5);
    expect(p1.body.activity.every((a) => a.tenantId === w.A1.id)).toBe(true);
    const p2 = await s.api.get(`/api/activity?tenantId=${w.A1.id}&limit=5&before=${encodeURIComponent(p1.body.nextBefore)}`).set(auth(w.memA1));
    const ids1 = new Set(p1.body.activity.map((a) => a.id));
    expect(p2.body.activity.every((a) => !ids1.has(a.id))).toBe(true);
  });
});
