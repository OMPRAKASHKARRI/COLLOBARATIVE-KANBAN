# Database Design

## Overview

The Collaborative Kanban Board uses a multi-organization, multi-tenant data model. An organization can contain multiple tenants (teams/workspaces). Users receive access through membership records, and boards, columns, and tasks are scoped to a tenant.

> Source note: This document is based on the supplied ER diagram. Confirm exact Prisma field names, nullability, indexes, and constraint definitions against the project's Prisma schema and SQL migrations before treating this as a migration specification.

## Entity relationship overview

```text
ORGANIZATIONS
  ├── TENANTS
  └── MEMBERSHIPS
        └── USERS

TENANTS
  ├── MEMBERSHIPS
  ├── BOARDS
  └── ACTIVITY_LOGS

BOARDS
  └── COLUMNS
        └── TASKS

USERS
  ├── MEMBERSHIPS
  ├── ACTIVITY_LOGS
  └── TASKS (assignee / creator relationships)
```

## Entities

### ORGANIZATIONS

Represents a company or top-level workspace.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Organization name |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update time |

An organization can have multiple tenants and memberships.

### TENANTS

Represents a team or workspace inside an organization.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `organization_id` | UUID | Parent organization |
| `name` | VARCHAR | Tenant/team name |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update time |

The diagram specifies uniqueness for `(id, organization_id)` and `(organization_id, name)`.

### USERS

Stores user accounts.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR | Display name |
| `email` | VARCHAR | Unique login email |
| `password_hash` | VARCHAR | bcrypt password hash |
| `token_version` | INT | Session/token revocation version |
| `created_at` | TIMESTAMP | Creation time |

### MEMBERSHIPS

Connects users to an organization and optionally to a tenant.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | User reference |
| `organization_id` | UUID | Organization reference |
| `tenant_id` | UUID, nullable | Tenant reference; NULL denotes organization-level membership |
| `role` | ENUM | `ORG_ADMIN`, `TENANT_ADMIN`, or `MEMBER` |
| `created_at` | TIMESTAMP | Creation time |

The nullable `tenant_id` supports organization-level membership as well as team-level membership. The database should enforce appropriate uniqueness for both NULL and non-NULL tenant memberships; verify the implementation in migrations.

### BOARDS

Stores Kanban boards within a tenant.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `organization_id` | UUID | Organization scope |
| `tenant_id` | UUID | Tenant scope |
| `name` | VARCHAR | Board name |
| `description` | TEXT | Board description |
| `created_by` | UUID | User who created the board |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update time |

### COLUMNS

Stores ordered columns belonging to a board.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `board_id` | UUID | Parent board |
| `tenant_id` | UUID | Tenant scope |
| `name` | VARCHAR | Column name |
| `position` | INT | Column ordering |
| `created_at` | TIMESTAMP | Creation time |

### TASKS

Stores work items within a board column.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `board_id` | UUID | Board reference |
| `column_id` | UUID | Column reference |
| `title` | VARCHAR | Task title |
| `description` | TEXT | Task details |
| `assigned_to` | UUID, nullable | Assigned user |
| `created_by` | UUID | Creator |
| `priority` | ENUM | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `due_date` | TIMESTAMP | Optional due date |
| `position` | INT | Ordering within a column |
| `version` | INT | Optimistic concurrency version |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update time |

### ACTIVITY_LOGS

Stores an audit/activity record for an action.

| Field | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `user_id` | UUID | Actor |
| `entity_type` | VARCHAR | Type of affected entity |
| `entity_id` | UUID | Identifier of affected entity |
| `action` | VARCHAR | Action name |
| `details` | JSONB | Additional action details |
| `created_at` | TIMESTAMP | Event time |

`entity_id` is a polymorphic reference when it can refer to different entity tables. A conventional single foreign key cannot enforce all possible target tables; document and validate this design accordingly.

## Relationships and cardinality

- One organization can have many tenants.
- One organization can have many memberships.
- One user can have many memberships.
- One tenant can have many memberships.
- One tenant can have many boards.
- One board can have many columns.
- One column can contain many tasks.
- A user can be assigned to or create many tasks.
- A tenant can have many activity log entries.
- A user can perform many activity log entries.

## Important integrity and indexing checks

The ER diagram indicates composite tenant-aware foreign keys for boards, columns, and tasks. Verify that the actual database constraints enforce that referenced records belong to the same organization, tenant, and board.

Recommended checks against the actual schema/migrations:

1. Prevent duplicate memberships for a user at the same organization/tenant scope, including the `tenant_id IS NULL` case.
2. Ensure a board's organization and tenant are a valid pair.
3. Ensure each column belongs to the same tenant as its board.
4. Ensure each task's column belongs to the same board and tenant as the task.
5. Index common lookups such as memberships by user/organization/tenant, boards by tenant, columns by board/position, tasks by board/column/position, and activity logs by tenant/created time.
6. Validate that assigned users have the required membership in the task's tenant.

## Optimistic concurrency

The `TASKS.version` field supports optimistic locking. A client submits the version it last read. The server should update only if the stored version still matches, then increment the version. If another user has already changed the task, the stale update should be rejected as a conflict (commonly HTTP `409 Conflict`).

## Multi-tenant isolation

Tenant IDs are carried through boards, columns, tasks, activity records, and memberships. The backend must derive and validate access from the authenticated user's membership; it must not trust a client-provided tenant ID by itself.
