// OpenAPI 3 description served at /api/docs. Kept as data + a tiny builder to stay in sync with routes.
const bearer = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const q = (name, required = false) => ({ name, in: 'query', required, schema: { type: 'string' } });
const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (d = 'OK') => ({ description: d, content: { 'application/json': { schema: { type: 'object' } } } });
const body = (props, required = []) => ({ required: true, content: { 'application/json': { schema: { type: 'object', properties: props, required } } } });
const s = { type: 'string' }; const u = { type: 'string', format: 'uuid' }; const i = { type: 'integer' };

function op(summary, { role = 'any authenticated member of the tenant', params = [], req, res = '200', desc, extra = {} } = {}) {
  return {
    summary, description: `${desc || ''}\n\n**Required role:** ${role}`.trim(), security: bearer,
    parameters: params, ...(req ? { requestBody: req } : {}),
    responses: { [res]: ok(res === '201' ? 'Created' : res === '204' ? 'No content' : 'OK'), 400: err('Validation failed'), 401: err('Not authenticated'), 403: err('Insufficient role'), 404: err('Not found / not authorized (never leaks other tenants)'), ...extra },
  };
}
const conflict = { 409: err('Stale version (VERSION_CONFLICT) — details.current holds the authoritative task') };

const spec = {
  openapi: '3.0.3',
  info: { title: 'Collaborative Kanban API', version: '1.0.0', description: 'Multi-organization / multi-tenant real-time Kanban. Auth: `Authorization: Bearer <accessToken>`. Optional `X-Operation-Id` header makes mutations idempotent. Real-time events: see docs/websocket-events.md.' },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: s, message: s, details: {} } } } } },
  },
  paths: {
    '/api/health': { get: { summary: 'Health check (DB connectivity)', responses: { 200: ok(), 503: err('DB down') } } },
    '/api/auth/register': { post: { summary: 'Register', requestBody: body({ name: s, email: s, password: s }, ['name', 'email', 'password']), responses: { 201: ok('{user, accessToken}; sets HttpOnly refresh cookie'), 400: err('Validation'), 409: err('Email taken') } } },
    '/api/auth/login': { post: { summary: 'Login', requestBody: body({ email: s, password: s }, ['email', 'password']), responses: { 200: ok('{user, accessToken}; sets HttpOnly refresh cookie'), 401: err('Invalid credentials') } } },
    '/api/auth/refresh': { post: { summary: 'Rotate refresh cookie, get new access token (requires header X-Requested-With: kanban)', responses: { 200: ok(), 401: err('Invalid refresh'), 403: err('CSRF header missing') } } },
    '/api/auth/logout': { post: { summary: 'Logout (clears cookie; ?all=true revokes every session)', security: bearer, parameters: [q('all')], responses: { 204: ok() } } },
    '/api/auth/me': { get: { summary: 'Current user', security: bearer, responses: { 200: ok(), 401: err('Not authenticated') } } },
    '/api/organizations': {
      get: op('List my organizations (with my role)'),
      post: op('Create organization (creator becomes ORG_ADMIN)', { req: body({ name: s }, ['name']), res: '201' }),
    },
    '/api/organizations/{id}': {
      get: op('Get organization', { params: [idParam], role: 'any member of the organization' }),
      put: op('Update organization', { params: [idParam], req: body({ name: s }, ['name']), role: 'ORG_ADMIN' }),
      delete: op('Delete organization (cascades)', { params: [idParam], res: '204', role: 'ORG_ADMIN' }),
    },
    '/api/tenants': {
      get: op('List tenants of an organization the caller can access', { params: [q('organizationId', true)], role: 'organization member (admins see all tenants; others only their own)' }),
      post: op('Create tenant (branch)', { req: body({ organizationId: u, name: s }, ['organizationId', 'name']), res: '201', role: 'ORG_ADMIN' }),
    },
    '/api/tenants/{id}': {
      get: op('Get tenant (+ my effective role)', { params: [idParam] }),
      put: op('Rename tenant', { params: [idParam], req: body({ name: s }, ['name']), role: 'TENANT_ADMIN or ORG_ADMIN' }),
      delete: op('Delete tenant (cascades; evicts sockets)', { params: [idParam], res: '204', role: 'ORG_ADMIN' }),
    },
    '/api/tenants/{id}/members': { get: op('Users with access to the tenant (assignable users)', { params: [idParam] }) },
    '/api/tenants/{id}/presence': { get: op('Currently online users in tenant', { params: [idParam] }) },
    '/api/memberships': {
      get: op('List memberships by tenantId or organizationId', { params: [q('tenantId'), q('organizationId')], role: 'TENANT_ADMIN (tenantId) / ORG_ADMIN (organizationId)' }),
      post: op('Add an existing user to org (ORG_ADMIN, tenantId null) or tenant (TENANT_ADMIN | MEMBER)', { req: body({ email: s, organizationId: u, tenantId: { ...u, nullable: true }, role: { type: 'string', enum: ['ORG_ADMIN', 'TENANT_ADMIN', 'MEMBER'] } }, ['email', 'organizationId', 'role']), res: '201', role: 'TENANT_ADMIN may add MEMBER; ORG_ADMIN may add anything', extra: { 422: err('Unknown user / invalid scope'), 409: err('Duplicate') } }),
    },
    '/api/memberships/{id}': {
      put: op('Change role', { params: [idParam], req: body({ role: s }, ['role']), role: 'same policy as create; cannot change own role', extra: { 422: err('Last org admin') } }),
      delete: op('Remove membership', { params: [idParam], res: '204', role: 'same policy as create', extra: { 422: err('Last org admin') } }),
    },
    '/api/boards': {
      get: op('List boards in a tenant', { params: [q('tenantId', true)] }),
      post: op('Create board (4 default columns)', { req: body({ tenantId: u, name: s, description: s }, ['tenantId', 'name']), res: '201', role: 'TENANT_ADMIN' }),
    },
    '/api/boards/{id}': {
      get: op('Board snapshot: board + columns + tasks (used for reconnect reconciliation)', { params: [idParam] }),
      put: op('Update board', { params: [idParam], req: body({ name: s, description: s }), role: 'TENANT_ADMIN' }),
      delete: op('Delete board', { params: [idParam], res: '204', role: 'TENANT_ADMIN' }),
    },
    '/api/boards/{id}/columns': { get: op('List columns', { params: [idParam] }) },
    '/api/columns': { post: op('Create column', { req: body({ boardId: u, name: s, position: i }, ['boardId', 'name']), res: '201', role: 'TENANT_ADMIN' }) },
    '/api/columns/{id}': {
      put: op('Rename / reorder column', { params: [idParam], req: body({ name: s, position: i }), role: 'TENANT_ADMIN' }),
      delete: op('Delete column (tasks must be moved: ?moveTasksTo=<columnId>)', { params: [idParam, q('moveTasksTo')], role: 'TENANT_ADMIN', extra: { 409: err('COLUMN_NOT_EMPTY') } }),
    },
    '/api/tasks': {
      get: op('List/search tasks of a board', { params: [q('boardId', true), q('q'), q('assigneeId'), q('priority')] }),
      post: op('Create task', { req: body({ boardId: u, columnId: u, title: s, description: s, assignedTo: { ...u, nullable: true }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }, dueDate: s, position: i }, ['boardId', 'columnId', 'title']), res: '201', extra: { 422: err('Column/assignee not in tenant') } }),
    },
    '/api/tasks/{id}': {
      get: op('Get task', { params: [idParam] }),
      put: op('Edit task (optimistic concurrency)', { params: [idParam], req: body({ expectedVersion: i, title: s, description: s, assignedTo: { ...u, nullable: true }, priority: s, dueDate: s }, ['expectedVersion']), extra: conflict }),
      delete: op('Delete task (optional ?expectedVersion=)', { params: [idParam, q('expectedVersion')], res: '204', role: 'MEMBER (own tasks) / TENANT_ADMIN / ORG_ADMIN (any)', extra: conflict }),
    },
    '/api/tasks/{id}/move': { patch: op('Move/reorder task transactionally', { params: [idParam], req: body({ expectedVersion: i, columnId: u, position: i }, ['expectedVersion', 'columnId', 'position']), extra: conflict }) },
    '/api/activity': { get: op('Tenant activity feed', { params: [q('tenantId', true), q('limit'), q('before'), q('entityType'), q('entityId')] }) },
  },
};
module.exports = spec;
