// In-memory presence with per-user reference counting: a user stays "online" in a tenant
// until their LAST socket (tab/device) leaves. Single-process; see docs for Redis adapter notes.
const { getIo, room, emitToTenant } = require('../services/realtime.service');
const { getTenantAccess } = require('../services/access.service');

const online = new Map(); // tenantId -> Map<userId, { user, sockets:Set<socketId> }>

function add(tenantId, user, socketId) {
  if (!online.has(tenantId)) online.set(tenantId, new Map());
  const m = online.get(tenantId);
  const entry = m.get(user.id) || { user: { id: user.id, name: user.name }, sockets: new Set() };
  const first = entry.sockets.size === 0;
  entry.sockets.add(socketId);
  m.set(user.id, entry);
  return first;
}

function remove(tenantId, userId, socketId) {
  const m = online.get(tenantId);
  const entry = m?.get(userId);
  if (!entry) return false;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    m.delete(userId);
    if (m.size === 0) online.delete(tenantId);
    return true; // user fully offline in tenant
  }
  return false;
}

const list = (tenantId) => [...(online.get(tenantId)?.values() || [])].map((e) => e.user);

function broadcastPresence(tenantId, user, type) {
  const users = list(tenantId);
  emitToTenant(tenantId, type, { user }, { user, online: users, count: users.length });
  emitToTenant(tenantId, 'presence:update', { user }, { online: users, count: users.length });
}

function leaveTenant(socket, tenantId) {
  socket.leave(room(tenantId));
  if (remove(tenantId, socket.data.user.id, socket.id)) broadcastPresence(tenantId, socket.data.user, 'presence:offline');
  if (socket.data.tenantId === tenantId) socket.data.tenantId = null;
}

async function joinTenant(socket, tenantId) {
  const access = await getTenantAccess(socket.data.user.id, tenantId);
  if (!access) return null;
  if (socket.data.tenantId && socket.data.tenantId !== tenantId) leaveTenant(socket, socket.data.tenantId);
  socket.join(room(tenantId));
  socket.data.tenantId = tenantId;
  if (add(tenantId, socket.data.user, socket.id)) broadcastPresence(tenantId, socket.data.user, 'presence:online');
  else emitToTenant(tenantId, 'presence:update', { user: socket.data.user }, { online: list(tenantId), count: list(tenantId).length });
  return { role: access.role, online: list(tenantId) };
}

// Re-validate sockets after membership/tenant changes; evict those that lost access.
async function reauthorize(filter) {
  const io = getIo();
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    const t = socket.data.tenantId;
    if (!t || !filter(socket, t)) continue;
    const ok = await getTenantAccess(socket.data.user.id, t);
    if (!ok) {
      leaveTenant(socket, t);
      socket.emit('tenant:revoked', { tenantId: t });
    }
  }
}
const reauthorizeUser = (userId) => reauthorize((s) => s.data.user.id === userId);
const reauthorizeAll = (tenantIds) => reauthorize((_s, t) => tenantIds.includes(t));

module.exports = { joinTenant, leaveTenant, list, reauthorizeUser, reauthorizeAll, _online: online };
