# Socket.IO Documentation

## Overview

Socket.IO provides real-time collaboration for the Kanban application. The HTTP API remains responsible for authenticated CRUD operations; Socket.IO distributes real-time events and presence updates to connected clients.

**Deployed backend origin:**

```text
https://collobarative-kanban.onrender.com
```

The frontend uses `VITE_SOCKET_URL` as its Socket.IO origin.

## Connection configuration

The supplied server initializes Socket.IO on the existing HTTP server with:

- CORS origin taken from `CLIENT_ORIGIN`.
- Credentials enabled.
- `pingInterval`: 10,000 ms.
- `pingTimeout`: 8,000 ms.
- `maxHttpBufferSize`: 100,000 bytes.

The supplied frontend client configures WebSocket and polling transports, automatic reconnection, and reconnect delays between 500 ms and 5,000 ms.

## Authentication handshake

A client supplies its access token in the Socket.IO handshake auth object.

Illustrative client configuration:

```javascript
const socket = io(SOCKET_URL, {
  withCredentials: true,
  autoConnect: false,
  transports: ['websocket', 'polling'],
  auth: {
    token: accessToken
  }
});
```

The server middleware:

1. Reads `socket.handshake.auth.token`.
2. Calls `userFromAccessToken(token)`.
3. Stores the authenticated user's `id` and `name` in `socket.data.user`.
4. Stores the token expiry in `socket.data.exp`.
5. Rejects missing, invalid, expired, or revoked tokens.

The server reports handshake errors using `TOKEN_EXPIRED` or `UNAUTHORIZED` codes in the error data.

## Tenant rooms

Room names use this convention:

```text
tenant:<tenantId>
```

A socket starts with `socket.data.tenantId = null`.

### Client → server: `tenant:join`

Payload:

```json
{
  "tenantId": "<tenant-uuid>"
}
```

The server validates the payload with `schemas.socketJoin`, then calls `presence.joinTenant()`. That function checks tenant access through `getTenantAccess()` before joining the room.

Acknowledgement on success:

```json
{
  "ok": true,
  "tenantId": "<tenant-uuid>",
  "role": "<membership-role>",
  "online": []
}
```

If the tenant is missing or access is denied:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Tenant not found or access denied"
  }
}
```

If the payload or join operation fails, the server returns an error acknowledgement. The exact validation error depends on the validation/service layer.

A socket is tracked in one active tenant at a time by `socket.data.tenantId`; joining a different tenant first leaves the previous tenant.

### Client → server: `tenant:leave`

The server leaves the socket's current tenant room, updates presence, and acknowledges:

```json
{
  "ok": true
}
```

The supplied handler uses the socket's current tenant ID; the payload is not used to select a different room.

### Client → server: `presence:get`

The server acknowledges with the current tenant's online users, or an empty list when the socket has not joined a tenant:

```json
{
  "ok": true,
  "online": [
    {
      "id": "<user-uuid>",
      "name": "<display-name>"
    }
  ]
}
```

## Server → client presence events

The presence module emits these events:

| Event | Meaning |
|---|---|
| `presence:online` | A user became online in the tenant |
| `presence:offline` | A user became fully offline in the tenant |
| `presence:update` | Updated online-user list |
| `tenant:revoked` | A connected user lost tenant access |

Presence event payloads emitted by the supplied `emitToTenant()` bridge use this envelope:

```json
{
  "event": "presence:update",
  "tenantId": "<tenant-uuid>",
  "boardId": null,
  "actor": {
    "id": "<user-uuid>",
    "name": "<display-name>"
  },
  "opId": null,
  "ts": "<ISO-8601 timestamp>",
  "data": {
    "online": [],
    "count": 0
  }
}
```

For `presence:online` and `presence:offline`, `data` includes the affected `user`, the full `online` list, and `count`. The presence module also emits `presence:update` with the current `online` list and `count`.

## Presence across multiple tabs/devices

Presence is maintained in an in-memory map:

```text
tenantId
  └── userId
        ├── user
        └── sockets: Set<socketId>
```

A user remains online until their last socket in that tenant disconnects or leaves. This prevents closing one browser tab from marking the user offline while another tab remains connected.

## Membership revocation

The presence module exposes:

- `reauthorizeUser(userId)`
- `reauthorizeAll(tenantIds)`

These functions re-check tenant access for matching connected sockets. If access has been removed, the server removes the socket from the room and emits:

```json
{
  "tenantId": "<tenant-uuid>"
}
```

under the `tenant:revoked` event.

## Token expiry and reconnect

Every 15 seconds, the server checks connected sockets for expired access tokens. When a token expires, the server:

1. Emits `auth:expired`.
2. Disconnects the socket.

The frontend client listens for a server-initiated disconnect and attempts to reconnect. Before each connection attempt, it refreshes the access token when missing or close to expiry, then supplies the fresh token in the handshake.

## Generic real-time event envelope

The supplied `realtime.service.js` exposes `emitToTenant()` and `flush()`. Services can emit an event to all sockets in a tenant room after the database transaction commits.

The envelope is:

```json
{
  "event": "<event-name>",
  "tenantId": "<tenant-uuid>",
  "boardId": "<board-uuid-or-null>",
  "actor": {
    "id": "<user-uuid>",
    "name": "<display-name>"
  },
  "opId": "<operation-id-or-null>",
  "ts": "<ISO-8601 timestamp>",
  "data": {}
}
```

`opId` correlates a real-time event with the originating mutation request. `boardId` is optional and may be null.

### Task/board event names

The supplied bridge accepts event names dynamically; the actual task and board event names are chosen by service callers. Those service files were not included in the supplied source, so this document intentionally does not guess event names or their `data` schemas. Add the exact names and payloads from the service calls to `emitToTenant()` / `flush()`.

## Operational limitation

Presence is stored in process memory and the supplied code explicitly describes it as single-process. If the application is scaled to multiple backend instances, use a shared Socket.IO adapter such as the Redis adapter and shared presence storage so room broadcasts and online status are consistent across instances.
