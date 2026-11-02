import { io } from 'socket.io-client';
import { SOCKET_URL, getAccessToken, refreshSession } from './api';

let socket = null;

// Decode exp without verifying (server verifies); used only to refresh a token that is about to expire.
const expiresInMs = (t) => { try { return JSON.parse(atob(t.split('.')[1])).exp * 1000 - Date.now(); } catch { return 0; } };

export function getSocket() {
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    withCredentials: true,
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    // Called on every (re)connect attempt: always authenticate with a fresh access token.
    auth: async (cb) => {
      try {
        if (!getAccessToken() || expiresInMs(getAccessToken()) < 30000) await refreshSession();
      } catch { /* server will reject; reconnect loop continues */ }
      cb({ token: getAccessToken() });
    },
  });
  // The server closes sockets whose token expired; socket.io does not auto-reconnect after a server-initiated disconnect.
  socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 300); });
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
}
