// Thin bridge between services and Socket.IO. Services call emitToTenant() only AFTER the
// database transaction has committed. No-op when no Socket.IO server is attached (unit tests).
let io = null;
const setIo = (instance) => { io = instance; };
const getIo = () => io;
const room = (tenantId) => `tenant:${tenantId}`;

function emitToTenant(tenantId, event, ctx, data, boardId = null) {
  if (!io) return;
  io.to(room(tenantId)).emit(event, {
    event,
    tenantId,
    boardId,
    actor: ctx?.user ? { id: ctx.user.id, name: ctx.user.name } : null,
    opId: ctx?.opId || null,
    ts: new Date().toISOString(),
    data,
  });
}

const flush = (tenantId, ctx, events) => events.forEach((e) => emitToTenant(tenantId, e.event, ctx, e.data, e.boardId));

module.exports = { setIo, getIo, room, emitToTenant, flush };
