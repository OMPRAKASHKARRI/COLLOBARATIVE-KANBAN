const { Server } = require('socket.io');
const env = require('../config/env');
const { setIo } = require('../services/realtime.service');
const { userFromAccessToken } = require('../middleware/auth.middleware');
const { parse } = require('../utils/validate');
const schemas = require('../utils/schemas');
const presence = require('./presence');

const fail = (code, message) => ({ ok: false, error: { code, message } });

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    pingInterval: 10000, // heartbeat: dropped connections are detected within ~pingInterval+pingTimeout
    pingTimeout: 8000,
    maxHttpBufferSize: 1e5,
  });
  setIo(io);

  // Handshake auth: valid, non-revoked access token required. Reconnects re-run this with a fresh token.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('missing');
      const { user, exp } = await userFromAccessToken(token);
      socket.data.user = { id: user.id, name: user.name };
      socket.data.exp = exp;
      next();
    } catch (e) {
      const err = new Error(e.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED');
      err.data = { code: err.message };
      next(err);
    }
  });

  io.on('connection', (socket) => {
    socket.data.tenantId = null;

    // Client asks to join a tenant room; the server decides (membership checked in DB on every join).
    socket.on('tenant:join', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const { tenantId } = parse(schemas.socketJoin, payload);
        const res = await presence.joinTenant(socket, tenantId);
        if (!res) return reply(fail('FORBIDDEN', 'Tenant not found or access denied'));
        reply({ ok: true, tenantId, role: res.role, online: res.online });
      } catch (e) {
        reply(fail(e.code || 'INTERNAL', e.status ? e.message : 'Join failed'));
      }
    });

    socket.on('tenant:leave', (payload, ack) => {
      if (socket.data.tenantId) presence.leaveTenant(socket, socket.data.tenantId);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('presence:get', (_p, ack) => {
      if (typeof ack === 'function') ack({ ok: true, online: socket.data.tenantId ? presence.list(socket.data.tenantId) : [] });
    });

    socket.on('disconnect', () => {
      if (socket.data.tenantId) presence.leaveTenant(socket, socket.data.tenantId);
    });
  });

  // Access tokens are short-lived: tell the client to refresh and reconnect once the token expires.
  const timer = setInterval(() => {
    const now = Date.now() / 1000;
    for (const s of io.sockets.sockets.values()) {
      if (s.data.exp && now > s.data.exp) { s.emit('auth:expired'); s.disconnect(true); }
    }
  }, 15000);
  timer.unref();
  io.on('close', () => clearInterval(timer));
  return io;
}

module.exports = { initSockets };
