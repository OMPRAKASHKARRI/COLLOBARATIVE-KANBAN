# API Documentation

Interactive Swagger UI is served by the running backend at **`GET /api/docs`**. This file is generated from the same
OpenAPI description (`backend/src/openapi.js`) with `npm run docs:api` — plus the hand-written conventions below.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | `http://localhost:5000/api` (configurable via `VITE_API_URL` on the client) |
| Auth | `Authorization: Bearer <accessToken>` (15 min JWT). Refresh token is an **HttpOnly, SameSite=Strict cookie** scoped to `/api/auth`. |
| Refresh | `POST /api/auth/refresh` requires header `X-Requested-With: kanban` (CSRF defence) and rotates the cookie. |
| Tenant scoping | The tenant is **never trusted from the client**. For `/tasks/:id`, `/boards/:id`, `/columns/:id` it is read from the stored record; for list/create calls the supplied `tenantId`/`boardId` is authorized against the caller's memberships. |
| Hidden resources | A resource in a tenant/org the caller cannot access returns **404** (same as "does not exist") so nothing leaks. **403** is used only when the caller *can* see the tenant but lacks the role. |
| Idempotency | Any mutating request may send `X-Operation-Id: <uuid>`. Replays (retries) within 2 minutes return the original response with header `Idempotent-Replay: true`. The id is echoed as `opId` in the resulting real-time events so clients can recognise their own changes. |
| Optimistic concurrency | Task edits and moves must send `expectedVersion`. A mismatch returns **409** (see below). Deletes accept optional `?expectedVersion=`. |
| Dates | ISO-8601 (`2026-12-31` or full datetime). |
| Rate limits | 600 req/min/IP overall; 50 auth attempts / 15 min / IP on login+register. |

### Status codes

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | Success / created / success without body |
| 400 | Validation failed (`details` lists each field) or malformed JSON |
| 401 | Missing/invalid/expired token (`TOKEN_EXPIRED`, `TOKEN_INVALID`, `INVALID_CREDENTIALS`) |
| 403 | Authenticated and can see the tenant, but role is insufficient |
| 404 | Not found **or** not authorized for that tenant/organization |
| 409 | `VERSION_CONFLICT` (stale task), `COLUMN_NOT_EMPTY`, `EMAIL_TAKEN`, `DUPLICATE` |
| 422 | Well-formed but semantically invalid: column not in board, assignee without tenant access, unknown user email, last org admin |
| 429 | Rate limited |
| 500 / 503 | Unexpected error / database unavailable (no internals are exposed) |

### Error body

```json
{ "error": { "code": "BAD_REQUEST|NOT_FOUND|FORBIDDEN|VERSION_CONFLICT|...", "message": "Human readable", "details": [] } }
```

### Conflict response (409) — stale task edit or move

```http
PATCH /api/tasks/6f1c…/move   { "expectedVersion": 1, "columnId": "…", "position": 0 }

HTTP/1.1 409 Conflict
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This task was modified by someone else. Review the latest version and try again.",
    "details": { "code": "STALE_VERSION", "current": { "id": "6f1c…", "version": 3, "columnId": "…", "title": "…", "position": 1, "…": "…" } }
  }
}
```
`details.current` is the authoritative task; the client adopts it, reloads the board and tells the user.

### Move response (200)

```json
{ "task": { "id": "…", "columnId": "…", "position": 0, "version": 2, "…": "…" },
  "positions": [ { "id": "…", "columnId": "…", "position": 1 } ] }
```
`positions` lists every *other* task whose column/position changed (destination shifts and source compaction).
`position` in the request means "index among the destination column's other tasks"; values beyond the end are clamped.

### Permission matrix (enforced server-side on every endpoint)

| Capability | Member | Tenant Admin | Org Admin |
|---|:--:|:--:|:--:|
| View boards/tasks/activity/members of own tenant | ✅ | ✅ | ✅ (all tenants of the org) |
| Create / edit / assign / move tasks | ✅ | ✅ | ✅ |
| Delete tasks | own only | any | any |
| Create / rename / delete boards, create / rename / reorder / delete columns | ❌ | ✅ | ✅ |
| Rename tenant | ❌ | ✅ | ✅ |
| List tenant memberships | ❌ | ✅ | ✅ |
| Add / remove **Members** | ❌ | ✅ | ✅ |
| Grant / change / remove **Tenant Admins** | ❌ | ❌ | ✅ |
| Create / delete tenants (branches) | ❌ | ❌ | ✅ |
| Rename / delete organization, manage org admins | ❌ | ❌ | ✅ |
| Change own role | ❌ | ❌ | ❌ (prevents lock-out) |

---

## Endpoint reference

### health

#### `GET /api/health` — Health check (DB connectivity)

- **Auth:** Public
- **Role:** —
- **Responses:** 200; 503 DB down

### auth

#### `POST /api/auth/register` — Register

- **Auth:** Public
- **Role:** —
- **Body:** `name`*, `email`*, `password`* (\* = required)
- **Responses:** 201 {user, accessToken}; sets HttpOnly refresh cookie; 400 Validation; 409 Email taken

#### `POST /api/auth/login` — Login

- **Auth:** Public
- **Role:** —
- **Body:** `email`*, `password`* (\* = required)
- **Responses:** 200 {user, accessToken}; sets HttpOnly refresh cookie; 401 Invalid credentials

#### `POST /api/auth/refresh` — Rotate refresh cookie, get new access token (requires header X-Requested-With: kanban)

- **Auth:** Public
- **Role:** —
- **Responses:** 200; 401 Invalid refresh; 403 CSRF header missing

#### `POST /api/auth/logout` — Logout (clears cookie; ?all=true revokes every session)

- **Auth:** Bearer JWT
- **Role:** any authenticated user
- **Params:** `all`(query)
- **Responses:** 204

#### `GET /api/auth/me` — Current user

- **Auth:** Bearer JWT
- **Role:** any authenticated user
- **Responses:** 200; 401 Not authenticated

### organizations

#### `GET /api/organizations` — List my organizations (with my role)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `POST /api/organizations` — Create organization (creator becomes ORG_ADMIN)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Body:** `name`* (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/organizations/{id}` — Get organization

- **Auth:** Bearer JWT
- **Role:** any member of the organization
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `PUT /api/organizations/{id}` — Update organization

- **Auth:** Bearer JWT
- **Role:** ORG_ADMIN
- **Params:** `id`(path, required)
- **Body:** `name`* (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `DELETE /api/organizations/{id}` — Delete organization (cascades)

- **Auth:** Bearer JWT
- **Role:** ORG_ADMIN
- **Params:** `id`(path, required)
- **Responses:** 204; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

### tenants

#### `GET /api/tenants` — List tenants of an organization the caller can access

- **Auth:** Bearer JWT
- **Role:** organization member (admins see all tenants; others only their own)
- **Params:** `organizationId`(query, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `POST /api/tenants` — Create tenant (branch)

- **Auth:** Bearer JWT
- **Role:** ORG_ADMIN
- **Body:** `organizationId`*, `name`* (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/tenants/{id}` — Get tenant (+ my effective role)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `PUT /api/tenants/{id}` — Rename tenant

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN or ORG_ADMIN
- **Params:** `id`(path, required)
- **Body:** `name`* (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `DELETE /api/tenants/{id}` — Delete tenant (cascades; evicts sockets)

- **Auth:** Bearer JWT
- **Role:** ORG_ADMIN
- **Params:** `id`(path, required)
- **Responses:** 204; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/tenants/{id}/members` — Users with access to the tenant (assignable users)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/tenants/{id}/presence` — Currently online users in tenant

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

### memberships

#### `GET /api/memberships` — List memberships by tenantId or organizationId

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN (tenantId) / ORG_ADMIN (organizationId)
- **Params:** `tenantId`(query), `organizationId`(query)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `POST /api/memberships` — Add an existing user to org (ORG_ADMIN, tenantId null) or tenant (TENANT_ADMIN | MEMBER)

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN may add MEMBER; ORG_ADMIN may add anything
- **Body:** `email`*, `organizationId`*, `tenantId`, `role`* (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 409 Duplicate; 422 Unknown user / invalid scope

#### `PUT /api/memberships/{id}` — Change role

- **Auth:** Bearer JWT
- **Role:** same policy as create; cannot change own role
- **Params:** `id`(path, required)
- **Body:** `role`* (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 422 Last org admin

#### `DELETE /api/memberships/{id}` — Remove membership

- **Auth:** Bearer JWT
- **Role:** same policy as create
- **Params:** `id`(path, required)
- **Responses:** 204; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 422 Last org admin

### boards

#### `GET /api/boards` — List boards in a tenant

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `tenantId`(query, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `POST /api/boards` — Create board (4 default columns)

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Body:** `tenantId`*, `name`*, `description` (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/boards/{id}` — Board snapshot: board + columns + tasks (used for reconnect reconciliation)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `PUT /api/boards/{id}` — Update board

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Params:** `id`(path, required)
- **Body:** `name`, `description` (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `DELETE /api/boards/{id}` — Delete board

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Params:** `id`(path, required)
- **Responses:** 204; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `GET /api/boards/{id}/columns` — List columns

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

### columns

#### `POST /api/columns` — Create column

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Body:** `boardId`*, `name`*, `position` (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `PUT /api/columns/{id}` — Rename / reorder column

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Params:** `id`(path, required)
- **Body:** `name`, `position` (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `DELETE /api/columns/{id}` — Delete column (tasks must be moved: ?moveTasksTo=<columnId>)

- **Auth:** Bearer JWT
- **Role:** TENANT_ADMIN
- **Params:** `id`(path, required), `moveTasksTo`(query)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 409 COLUMN_NOT_EMPTY

### tasks

#### `GET /api/tasks` — List/search tasks of a board

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `boardId`(query, required), `q`(query), `assigneeId`(query), `priority`(query)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `POST /api/tasks` — Create task

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Body:** `boardId`*, `columnId`*, `title`*, `description`, `assignedTo`, `priority`, `dueDate`, `position` (\* = required)
- **Responses:** 201; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 422 Column/assignee not in tenant

#### `GET /api/tasks/{id}` — Get task

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)

#### `PUT /api/tasks/{id}` — Edit task (optimistic concurrency)

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Body:** `expectedVersion`*, `title`, `description`, `assignedTo`, `priority`, `dueDate` (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 409 Stale version (VERSION_CONFLICT) — details.current holds the authoritative task

#### `DELETE /api/tasks/{id}` — Delete task (optional ?expectedVersion=)

- **Auth:** Bearer JWT
- **Role:** MEMBER (own tasks) / TENANT_ADMIN / ORG_ADMIN (any)
- **Params:** `id`(path, required), `expectedVersion`(query)
- **Responses:** 204; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 409 Stale version (VERSION_CONFLICT) — details.current holds the authoritative task

#### `PATCH /api/tasks/{id}/move` — Move/reorder task transactionally

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `id`(path, required)
- **Body:** `expectedVersion`*, `columnId`*, `position`* (\* = required)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants); 409 Stale version (VERSION_CONFLICT) — details.current holds the authoritative task

### activity

#### `GET /api/activity` — Tenant activity feed

- **Auth:** Bearer JWT
- **Role:** any authenticated member of the tenant
- **Params:** `tenantId`(query, required), `limit`(query), `before`(query), `entityType`(query), `entityId`(query)
- **Responses:** 200; 400 Validation failed; 401 Not authenticated; 403 Insufficient role; 404 Not found / not authorized (never leaks other tenants)
