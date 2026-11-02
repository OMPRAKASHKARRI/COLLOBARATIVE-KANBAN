# Tenancy & Security Model

## Hierarchy

```
Organization ──< Tenant (branch) ──< Board ──< Column ──< Task
      │               │                                      
      └──< Membership >── User        Tenant ──< ActivityLog
```

* **Organization** = the company (ABC Technologies). **Tenant** = a branch/workspace (Hyderabad). They are separate tables because
  an organization has *cross-branch* concerns (organization admins, branch lifecycle) that must not live inside any one branch's data,
  while *all business data* (boards, columns, tasks, activity) belongs to exactly one tenant and is isolated there.
* **Membership** (`user_id`, `organization_id`, `tenant_id?`, `role`) is the only source of permissions:
  * `tenant_id IS NULL` ⇒ organization-level membership, role must be `ORG_ADMIN` (DB CHECK).
  * `tenant_id` set ⇒ `TENANT_ADMIN` or `MEMBER` in that branch; the pair `(tenant_id, organization_id)` is a composite FK so a membership can never point at a tenant of a different organization.
* A user may have many memberships (several tenants, several organizations). The UI lets them switch; every request is re-authorized.

## Where `tenant_id` comes from and how it is validated

1. The browser **never** supplies an authoritative tenant. For `GET/PUT/DELETE /tasks/:id` (and boards/columns) the server loads the record and uses **its stored** `tenant_id`.
2. For list/create calls (`?tenantId=`, `{boardId}`) the supplied id is resolved to a tenant and **authorized against the caller's memberships** (`access.service.js → requireTenantAccess`). Unauthorized and nonexistent are indistinguishable (404).
3. Cross-references are validated: a task's column must belong to the same board, an assignee must have access to the same tenant, a destination column must belong to the task's board — otherwise 422.
4. All tenant-owned queries filter by the authorized `tenant_id` (e.g. `findFirst({ where: { id, tenantId } })`), never by id alone.

## Defence in depth: database-level isolation

Application checks can have bugs, so the schema makes inconsistent states impossible:

| Constraint | Prevents |
|---|---|
| `boards (tenant_id, organization_id) → tenants (id, organization_id)` | a board attached to a tenant of another org |
| `columns (board_id, tenant_id) → boards (id, tenant_id)` | a column whose tenant differs from its board's |
| `tasks (board_id, tenant_id) → boards (id, tenant_id)` | a task in a different tenant than its board |
| `tasks (column_id, board_id) → columns (id, board_id)` | a task in a column of another board |
| `memberships (tenant_id, organization_id) → tenants (id, organization_id)` | membership across organizations |
| `CHECK` role/scope, partial unique index for org-level rows | invalid role scopes / duplicate org admins |

These are exercised by tests that bypass the API and attempt cross-tenant inserts directly (`tests/tenancy.test.js`).
*Not implemented:* PostgreSQL Row-Level Security (recommended in the brief as optional). It would add a third layer; see "Future improvements" in the README.

## Authentication

* Passwords: **bcrypt** (cost 12), never logged or returned. Login does a constant-shape check (dummy hash for unknown users, identical error message).
* Access token: JWT (HS256), **15 min**, kept **in memory only** in the browser (not localStorage ⇒ not readable by injected scripts after reload).
* Refresh token: JWT in an **HttpOnly, SameSite=Strict cookie**, `Path=/api/auth`, `Secure` in production, 7 days, rotated on every refresh.
  CSRF: SameSite + mandatory custom header `X-Requested-With` on the only cookie-authenticated endpoint; all other endpoints use the Bearer header (not sent automatically by browsers).
* Revocation: `users.token_version` is embedded in both tokens; `POST /auth/logout?all=true` increments it, instantly invalidating all sessions (REST and sockets).
* Secrets come from environment variables; the server refuses to start in production without them.

## Authorization

Role-based, enforced in services (not middleware-only), for every endpoint and socket join — see the permission matrix in `api-documentation.md`.
Effective role = highest of (org-level `ORG_ADMIN`, tenant membership). Hidden buttons in the UI are convenience only.

## Other protections

* Input validation with **Zod** on every body/query/param (UUIDs, lengths, enums, dates); socket payloads validated too.
* **Helmet** headers, **CORS** restricted to `CLIENT_ORIGIN`, JSON body limit 100 kB, rate limiting (stricter on auth).
* All DB access via Prisma (parameterized). Raw SQL uses tagged-template parameters only.
* Errors are normalized; stack traces, SQL and driver messages are never sent to clients.
* Transactions wrap every multi-row change (task move/delete/create + activity log; column reorder; board creation with default columns; membership change + task unassignment).

## Known limitations (security-relevant)

* Idempotency cache and presence are **per process memory** (single instance). Horizontal scaling needs Redis (Socket.IO adapter + shared idempotency/presence).
* No email verification, password reset or MFA.
* Adding a member by email reveals whether an email is registered (to admins only).
* Access tokens remain valid up to 15 min after a plain logout (use `logout?all=true` for immediate revocation).
* No RLS; no audit-log immutability guarantees (activity rows are append-only by convention).
