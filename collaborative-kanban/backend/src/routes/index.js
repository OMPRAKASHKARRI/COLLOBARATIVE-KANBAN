const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { authenticate } = require('../middleware/auth.middleware');
const { route } = require('../utils/route');
const { parse } = require('../utils/validate');
const S = require('../utils/schemas');
const authSvc = require('../services/auth.service');
const orgSvc = require('../services/org.service');
const tenantSvc = require('../services/tenant.service');
const memSvc = require('../services/membership.service');
const boardSvc = require('../services/board.service');
const colSvc = require('../services/column.service');
const taskSvc = require('../services/task.service');
const actSvc = require('../services/activity.service');
const presence = require('../sockets/presence');
const { requireTenantAccess } = require('../services/access.service');

const ctx = (req) => ({ user: req.user, opId: req.get('x-operation-id') || null });
const id = (req) => parse(S.idParam, req.params).id;

// ---- auth (public) ----
const COOKIE = 'kb_refresh';
const cookieOpts = () => ({
  httpOnly: true, secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SAMESITE, path: '/api/auth', maxAge: 7 * 24 * 3600 * 1000,
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false, skip: () => !env.RATE_LIMIT_ENABLED, message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } } });

const auth = express.Router();
const session = (res, r, status = 200) => {
  res.cookie(COOKIE, r.refreshToken, cookieOpts());
  return res.status(status).json({ user: authSvc.publicUser(r.user), accessToken: r.accessToken });
};
auth.post('/register', authLimiter, (req, res, next) => authSvc.register(parse(S.register, req.body)).then((r) => session(res, r, 201)).catch(next));
auth.post('/login', authLimiter, (req, res, next) => authSvc.login(parse(S.login, req.body)).then((r) => session(res, r)).catch(next));
// CSRF defence for the cookie-authenticated endpoint: SameSite cookie + mandatory custom header
// (cross-site forms cannot set it, and CORS only allows our configured origins).
auth.post('/refresh', (req, res, next) => {
  if (req.get('x-requested-with') !== 'kanban') return res.status(403).json({ error: { code: 'CSRF', message: 'Missing X-Requested-With header' } });
  authSvc.refresh(req.cookies?.[COOKIE]).then((r) => session(res, r)).catch((e) => { res.clearCookie(COOKIE, { path: '/api/auth' }); next(e); });
});
auth.post('/logout', authenticate, (req, res, next) => {
  res.clearCookie(COOKIE, { path: '/api/auth' });
  (req.query.all === 'true' ? authSvc.logoutEverywhere(req.user.id) : Promise.resolve()).then(() => res.status(204).end()).catch(next);
});
auth.get('/me', authenticate, (req, res) => res.json({ user: req.user && { id: req.user.id, name: req.user.name, email: req.user.email } }));

// ---- protected API ----
const api = express.Router();
api.use(authenticate);

const orgs = express.Router();
orgs.get('/', route((r) => orgSvc.list(ctx(r))));
orgs.post('/', route((r) => orgSvc.create(ctx(r), parse(S.orgCreate, r.body))));
orgs.get('/:id', route((r) => orgSvc.get(ctx(r), id(r))));
orgs.put('/:id', route((r) => orgSvc.update(ctx(r), id(r), parse(S.orgUpdate, r.body))));
orgs.delete('/:id', route((r) => orgSvc.remove(ctx(r), id(r))));

const tenants = express.Router();
tenants.get('/', route((r) => tenantSvc.list(ctx(r), parse(S.tenantList, r.query))));
tenants.post('/', route((r) => tenantSvc.create(ctx(r), parse(S.tenantCreate, r.body))));
tenants.get('/:id', route((r) => tenantSvc.get(ctx(r), id(r))));
tenants.put('/:id', route((r) => tenantSvc.update(ctx(r), id(r), parse(S.tenantUpdate, r.body))));
tenants.delete('/:id', route((r) => tenantSvc.remove(ctx(r), id(r))));
tenants.get('/:id/members', route((r) => tenantSvc.members(ctx(r), id(r))));
tenants.get('/:id/presence', route(async (r) => {
  await requireTenantAccess(r.user.id, id(r));
  return { body: { online: presence.list(id(r)) } };
}));

const memberships = express.Router();
memberships.get('/', route((r) => memSvc.list(ctx(r), parse(S.membershipList, r.query))));
memberships.post('/', route((r) => memSvc.create(ctx(r), parse(S.membershipCreate, r.body))));
memberships.put('/:id', route((r) => memSvc.update(ctx(r), id(r), parse(S.membershipUpdate, r.body))));
memberships.delete('/:id', route((r) => memSvc.remove(ctx(r), id(r))));

const boards = express.Router();
boards.get('/', route((r) => boardSvc.list(ctx(r), parse(S.boardList, r.query))));
boards.post('/', route((r) => boardSvc.create(ctx(r), parse(S.boardCreate, r.body))));
boards.get('/:id', route((r) => boardSvc.get(ctx(r), id(r))));
boards.put('/:id', route((r) => boardSvc.update(ctx(r), id(r), parse(S.boardUpdate, r.body))));
boards.delete('/:id', route((r) => boardSvc.remove(ctx(r), id(r))));
boards.get('/:id/columns', route((r) => colSvc.listForBoard(ctx(r), id(r))));

const columns = express.Router();
columns.post('/', route((r) => colSvc.create(ctx(r), parse(S.columnCreate, r.body))));
columns.put('/:id', route((r) => colSvc.update(ctx(r), id(r), parse(S.columnUpdate, r.body))));
columns.delete('/:id', route((r) => colSvc.remove(ctx(r), id(r), parse(S.columnDelete, r.query))));

const tasks = express.Router();
tasks.get('/', route((r) => taskSvc.list(ctx(r), parse(S.taskList, r.query))));
tasks.post('/', route((r) => taskSvc.create(ctx(r), parse(S.taskCreate, r.body))));
tasks.get('/:id', route((r) => taskSvc.get(ctx(r), id(r))));
tasks.put('/:id', route((r) => taskSvc.update(ctx(r), id(r), parse(S.taskUpdate, r.body))));
tasks.patch('/:id/move', route((r) => taskSvc.move(ctx(r), id(r), parse(S.taskMove, r.body))));
tasks.delete('/:id', route((r) => taskSvc.remove(ctx(r), id(r), parse(S.taskDelete, r.query.expectedVersion ? { expectedVersion: Number(r.query.expectedVersion) } : {}))));

api.use('/organizations', orgs);
api.use('/tenants', tenants);
api.use('/memberships', memberships);
api.use('/boards', boards);
api.use('/columns', columns);
api.use('/tasks', tasks);
api.get('/activity', route((r) => actSvc.list(ctx(r), parse(S.activityList, r.query))));

module.exports = { auth, api };
