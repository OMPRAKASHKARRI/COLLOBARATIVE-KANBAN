# REST API Documentation

## Overview

The backend exposes an HTTP API using Node.js and Express, with Prisma and PostgreSQL for persistence. Authentication uses access tokens and an HttpOnly refresh-token cookie.

**Base URL (deployed):**

```text
https://collobarative-kanban.onrender.com
```

**Swagger UI:**

[https://collobarative-kanban.onrender.com/api/docs](https://collobarative-kanban.onrender.com/api/docs)

**Health check:**

[https://collobarative-kanban.onrender.com/api/health](https://collobarative-kanban.onrender.com/api/health)

> Accuracy note: The route implementation files and generated OpenAPI document were not included in the supplied material. Therefore, this document describes the confirmed route mounting and API domains without inventing individual endpoint paths, request schemas, or response bodies. Use Swagger as the authoritative endpoint-level reference.

## Route mounting confirmed from the supplied Express application

| Route prefix | Router | Purpose |
|---|---|---|
| `/api/auth` | `auth` | Authentication routes |
| `/api` | `api` | Application routes |
| `/api/docs` | Swagger UI | Interactive API documentation |
| `/api/health` | Express health handler | API/database health check |

The `auth` and `api` routers are imported from `./routes`.

## API domains to document in Swagger

The application and ER model indicate these functional areas. Confirm the exact operations and paths in Swagger:

- Authentication: registration, login, refresh, logout/session handling.
- Organizations: organization management.
- Tenants: team/workspace management.
- Memberships: user membership and role management.
- Boards: board management.
- Columns: column management and ordering.
- Tasks: task creation, reading, updating, deletion, assignment, movement, and ordering.
- Activity logs: activity history.

## Authentication model

- Access tokens are held in frontend memory rather than local storage.
- The frontend sends the access token as a Bearer token when available.
- Refresh is performed through `/api/auth/refresh`.
- The refresh request uses `withCredentials: true`, so the browser can send the HttpOnly refresh cookie.
- The backend validates access tokens and supports token revocation through the user's token version, as indicated by the supplied schema and authentication code references.

Example authorization header:

```http
Authorization: Bearer <access-token>
```

Do not put real tokens, passwords, or database credentials in documentation or source control.

## Request behavior

The supplied frontend Axios client:

- Uses `VITE_API_URL` as its API base URL, falling back to `http://localhost:5000/api`.
- Sends requests with credentials enabled.
- Uses a 15-second request timeout.
- Adds an `X-Operation-Id` header to non-GET requests when one is not already present.
- Retries an eligible request once after a successful refresh when the response is a recognized token error, preserving the operation ID.

The server configures JSON request parsing with a `100kb` limit and exposes `Idempotent-Replay` as a CORS-exposed response header.

## Health endpoint

```http
GET /api/health
```

The handler runs `SELECT 1` through Prisma.

Successful response:

```json
{
  "status": "ok",
  "db": "up"
}
```

If the database check fails, the handler returns HTTP `503` with:

```json
{
  "status": "degraded",
  "db": "down"
}
```

## Error/status code reference

These are standard HTTP meanings. Actual endpoint-specific behavior should be checked in Swagger and the route handlers.

| Status | Meaning |
|---|---|
| `200` | Request succeeded |
| `201` | Resource created |
| `400` | Invalid request |
| `401` | Authentication required or invalid |
| `403` | Authenticated but not permitted |
| `404` | Resource not found |
| `409` | Conflict, including stale-version conflicts where implemented |
| `500` | Unexpected server error |
| `503` | Service/database health check unavailable |

## Authorization and tenant isolation

The backend must validate organization/tenant membership and role permissions for protected operations. A tenant identifier supplied by the browser is a requested scope, not proof of authorization.

## Interactive endpoint reference

For exact endpoint paths, HTTP methods, schemas, and response examples, use the deployed Swagger UI:

[Open Collaborative Kanban Swagger](https://collobarative-kanban.onrender.com/api/docs)

When updating this document, copy endpoint details from the OpenAPI specification or route handlers so the documentation remains synchronized with the implementation.
