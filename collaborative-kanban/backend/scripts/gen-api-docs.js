// Generates docs/api-documentation.md from src/openapi.js so the reference cannot drift from the code.
const fs = require('fs');
const path = require('path');
const spec = require('../src/openapi');

const head = `# API Documentation

Interactive Swagger UI is served by the running backend at **\`GET /api/docs\`**. This file is generated from the same
OpenAPI description (\`backend/src/openapi.js\`) with \`npm run docs:api\` — plus the hand-written conventions below.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | \`http://localhost:5000/api\` (configurable via \`VITE_API_URL\` on the client) |
| Auth | \`Authorization: Bearer <accessToken>\` (15 min JWT). Refresh token is an **HttpOnly, SameSite=Strict cookie** scoped to \`/api/auth\`. |
| Refresh | \`POST /api/auth/refresh\` requires header \`X-Requested-With: kanban\` (CSRF defence) and rotates the cookie. |
| Tenant scoping | The tenant is **never trusted from the client**. For \`/tasks/:id\`, \`/boards/:id\`, \`/columns/:id\` it is read from the stored record; for list/create calls the supplied \`tenantId\`/\`boardId\` is authorized against the caller's memberships. |
| Hidden resources | A resource in a tenant/org the caller cannot access returns **404** (same as "does not exist") so nothing leaks. **403** is used only when the caller *can* see the tenant but lacks the role. |
| Idempotency | Any mutating request may send \`X-Operation-Id: <uuid>\`. Replays (retries) within 2 minutes return the original response with header \`Idempotent-Replay: true\`. The id is echoed as \`opId\` in the resulting real-time events so clients can recognise their own changes. |
| Optimistic concurrency | Task edits and moves must send \`expectedVersion\`. A mismatch returns **409** (see below). Deletes accept optional \`?expectedVersion=\`. |
| Dates | ISO-8601 (\`2026-12-31\` or full datetime). |
| Rate limits | 600 req/min/IP overall; 50 auth attempts / 15 min / IP on login+register. |

### Status codes

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | Success / created / success without body |
| 400 | Validation failed (\`details\` lists each field) or malformed JSON |
| 401 | Missing/invalid/expired token (\`TOKEN_EXPIRED\`, \`TOKEN_INVALID\`, \`INVALID_CREDENTIALS\`) |
| 403 | Authenticated and can see the tenant, but role is insufficient |
| 404 | Not found **or** not authorized for that tenant/organization |
| 409 | \`VERSION_CONFLICT\` (stale task), \`COLUMN_NOT_EMPTY\`, \`EMAIL_TAKEN\`, \`DUPLICATE\` |
| 422 | Well-formed but semantically invalid: column not in board, assignee without tenant access, unknown user email, last org admin |
| 429 | Rate limited |
| 500 / 503 | Unexpected error / database unavailable (no internals are exposed) |

### Error body

\`\`\`json
{ "error": { "code": "BAD_REQUEST|NOT_FOUND|FORBIDDEN|VERSION_CONFLICT|...", "message": "Human readable", "details": [] } }
\`\`\`

### Conflict response (409) — stale task edit or move

\`\`\`http
PATCH /api/tasks/6f1c…/move   { "expectedVersion": 1, "columnId": "…", "position": 0 }

HTTP/1.1 409 Conflict
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This task was modified by someone else. Review the latest version and try again.",
    "details": { "code": "STALE_VERSION", "current": { "id": "6f1c…", "version": 3, "columnId": "…", "title": "…", "position": 1, "…": "…" } }
  }
}
\`\`\`
\`details.current\` is the authoritative task; the client adopts it, reloads the board and tells the user.

### Move response (200)

\`\`\`json
{ "task": { "id": "…", "columnId": "…", "position": 0, "version": 2, "…": "…" },
  "positions": [ { "id": "…", "columnId": "…", "position": 1 } ] }
\`\`\`
\`positions\` lists every *other* task whose column/position changed (destination shifts and source compaction).
\`position\` in the request means "index among the destination column's other tasks"; values beyond the end are clamped.

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
`;

const rows = [];
for (const [p, methods] of Object.entries(spec.paths)) {
  for (const [m, op] of Object.entries(methods)) {
    const auth = op.security ? 'Bearer JWT' : 'Public';
    const role = /\*\*Required role:\*\* (.*)$/s.exec(op.description || '')?.[1]?.trim() || (op.security ? 'any authenticated user' : '—');
    const params = (op.parameters || []).map((x) => `\`${x.name}\`(${x.in}${x.required ? ', required' : ''})`).join(', ');
    const bodyProps = op.requestBody?.content?.['application/json']?.schema;
    const body = bodyProps ? Object.keys(bodyProps.properties || {}).map((k) => `\`${k}\`${(bodyProps.required || []).includes(k) ? '*' : ''}`).join(', ') : '';
    const responses = Object.entries(op.responses).map(([c, r]) => `${c}${r.description && !['OK', 'Created', 'No content'].includes(r.description) ? ` ${r.description}` : ''}`).join('; ');
    rows.push({ m: m.toUpperCase(), p, op, auth, role, params, body, responses });
  }
}
const sections = {};
for (const r of rows) {
  const key = r.p.split('/')[2] || 'health';
  (sections[key] ||= []).push(r);
}
let out = head;
for (const [key, list] of Object.entries(sections)) {
  out += `\n### ${key}\n`;
  for (const r of list) {
    out += `\n#### \`${r.m} ${r.p}\` — ${r.op.summary}\n\n- **Auth:** ${r.auth}\n- **Role:** ${r.role}\n`;
    if (r.params) out += `- **Params:** ${r.params}\n`;
    if (r.body) out += `- **Body:** ${r.body} (\\* = required)\n`;
    out += `- **Responses:** ${r.responses}\n`;
  }
}
const target = path.join(__dirname, '..', '..', 'docs', 'api-documentation.md');
fs.writeFileSync(target, out);
console.log('wrote', target, `(${rows.length} operations)`);
