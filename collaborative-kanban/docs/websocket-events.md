# WebSocket (Socket.IO) Documentation

Transport: **Socket.IO v4** on the same origin/port as the API (default `http://localhost:5000`, configurable via `VITE_SOCKET_URL`).
All business mutations go through the **REST API**; the socket is used for *server → client* change notifications, presence, and room joins.
This keeps every authorization decision in one place (the services), and means a client can never write data over the socket.

## 1. Connection & authentication

```js
io(SOCKET_URL, { auth: (cb) => cb({ token: accessToken }) })   // function form: re-evaluated on EVERY reconnect attempt
```

| Case | Result |
|---|---|
| No token / malformed / wrong signature | `connect_error` with message `UNAUTHORIZED` |
| Expired access token | `connect_error` with message `TOKEN_EXPIRED` (client refreshes via `POST /api/auth/refresh`, then retries) |
| Refresh token used as access token | rejected (`typ` claim checked) |
| User logged out everywhere / token revoked (`token_version` bump) | rejected |
| Token expires while connected | server emits `auth:expired` then disconnects; client refreshes and reconnects |

A connected socket is **not** in any tenant room until it successfully joins one.

## 2. Client → Server events (all with acknowledgement)

| Event | Payload | Ack | Authorization |
|---|---|---|---|
| `tenant:join` | `{ "tenantId": "<uuid>" }` | `{ ok:true, tenantId, role, online:[{id,name}] }` or `{ ok:false, error:{ code, message } }` | Membership/role is looked up **in the database on every join**. Org admins may join any tenant of their org. Unknown tenant and forbidden tenant return the **same** `FORBIDDEN` error (no enumeration). A socket is in at most one tenant room: joining another tenant first leaves the previous one. |
| `tenant:leave` | — | `{ ok:true }` | — |
| `presence:get` | — | `{ ok:true, online:[…] }` | only for the room the socket already joined |

Invalid payloads (bad UUID, extra types) are rejected by Zod with `{ ok:false, error }`.

## 3. Server → Client events

Every event uses one **envelope**:

```json
{
  "event": "task:moved",
  "tenantId": "uuid",          // room the event belongs to (clients must ignore other tenants)
  "boardId": "uuid | null",
  "actor": { "id": "uuid", "name": "Priya Reddy" },
  "opId": "uuid | null",        // the X-Operation-Id of the originating HTTP request, for de-duplication
  "ts": "2026-11-01T10:15:30.123Z",
  "data": { }
}
```

Events are emitted **only after the database transaction has committed**. Failed (409/422/…) operations emit nothing.

| Event | `data` | Emitted when |
|---|---|---|
| `task:created` | `{ task, positions[] }` | task created (`positions` = tasks shifted by an insert) |
| `task:updated` | `{ task }` | title/description/assignee/priority/due-date changed (version incremented) |
| `task:moved` | `{ task, from:{columnId,position}, positions[] }` | moved or reordered; `positions` = every other task whose column/position changed |
| `task:deleted` | `{ taskId, columnId, positions[] }` | task deleted; `positions` = compacted remainder |
| `board:updated` | `{ action:"created"\|"updated"\|"deleted", board? , boardId? }` or `{ action:"columns_changed", columns[], reloadTasks? }` | board or column CRUD / reorder |
| `activity:created` | `{ activity }` (with `user:{id,name}`) | any logged action — drives the live activity feed |
| `member:updated` | `{ kind:"added"\|"role_changed"\|"removed", userId }` | tenant membership change |
| `presence:online` | `{ user, online[], count }` | a user's **first** socket joined the tenant |
| `presence:offline` | `{ user, online[], count }` | a user's **last** socket left the tenant |
| `presence:update` | `{ online[], count }` | any presence change (idempotent full list) |
| `tenant:revoked` | `{ tenantId }` (to that socket only) | the user lost access; server removed the socket from the room |
| `tenant:deleted` | `{ tenantId }` | tenant deleted (sent to the room just before eviction) |
| `auth:expired` | — | access token expired while connected |

### Example — `task:moved`

```json
{
  "event": "task:moved", "tenantId": "9a5c…", "boardId": "41b0…",
  "actor": { "id": "c62e…", "name": "Priya Reddy" }, "opId": "0d6e…", "ts": "2026-11-01T10:15:30.123Z",
  "data": {
    "task": { "id": "d552…", "columnId": "77aa…", "position": 0, "version": 2, "title": "Create Login Page", "…": "…" },
    "from": { "columnId": "13bc…", "position": 0 },
    "positions": [ { "id": "e1f0…", "columnId": "13bc…", "position": 0 }, { "id": "a77d…", "columnId": "13bc…", "position": 1 } ]
  }
}
```

## 4. Tenant isolation guarantees

* Rooms are named `tenant:<uuid>` and are **only joinable via `tenant:join`**, which the server authorizes; clients cannot `socket.join` themselves.
* Broadcasts use `io.to("tenant:<id>")` with the tenant taken from the committed record, never from client input.
* Presence is per tenant; other tenants cannot see who is online (`GET /api/tenants/:id/presence` → 404 for outsiders).
* On membership removal/role change/tenant or org deletion the server **re-validates connected sockets** and evicts those without access (`tenant:revoked`), so a removed user stops receiving events immediately.

## 5. Presence

In-memory map `tenantId → userId → Set<socketId>` (reference counting). A user with several tabs/devices is online until the **last** socket leaves.
Heartbeat: Socket.IO ping every 10 s, 8 s timeout, so dropped connections (no TCP FIN) are detected in ≈18 s at worst.

## 6. Reconnection & reconciliation protocol (client behaviour)

1. Socket drops → UI shows **Reconnecting…**; Socket.IO retries with exponential back-off (0.5 s → 5 s).
2. Each attempt re-runs the `auth` callback, refreshing the access token first if it expires in < 30 s.
3. On `connect` the client sends `tenant:join`; the server **re-authorizes** (a user removed meanwhile gets `FORBIDDEN` → UI shows *No access*).
4. After a successful *re*-join the client **re-fetches** `GET /api/boards/:id`, the activity feed and the member list. Events missed while offline are never replayed; the REST snapshot is authoritative.
5. Events carry versions: a `task:*` event older than the version a client already holds is ignored (late/out-of-order delivery).
6. When the user switches tenant the client clears board state *before* loading the new tenant and leaves the old room.

Verified by automated tests: `backend/tests/sockets.test.js` and the browser E2E (offline → missed change → reconnect → board converges).
