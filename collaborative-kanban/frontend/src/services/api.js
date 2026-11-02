import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

// Access token lives in memory only (never localStorage). The refresh token is an HttpOnly cookie.
let accessToken = null;
export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;

const api = axios.create({ baseURL: API_URL, withCredentials: true, timeout: 15000 });
const newOpId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

api.interceptors.request.use((config) => {
  if (accessToken && !config.skipAuth) config.headers.Authorization = `Bearer ${accessToken}`;
  // Every mutation carries an operation id: the server de-duplicates retries and echoes it in realtime events.
  if (config.method && config.method !== 'get' && !config.headers['X-Operation-Id']) config.headers['X-Operation-Id'] = config.opId || newOpId();
  return config;
});

let refreshing = null;
export function refreshSession() {
  if (!refreshing) {
    refreshing = axios
      .post(`${API_URL}/auth/refresh`, {}, { withCredentials: true, headers: { 'X-Requested-With': 'kanban' } })
      .then((r) => { accessToken = r.data.accessToken; return r.data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// Expired/invalid access token -> refresh once (single-flight) and replay the request with the SAME operation id.
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    const code = response?.data?.error?.code;
    if (response?.status === 401 && config && !config._retried && !config.skipAuth && (code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID')) {
      config._retried = true;
      try { await refreshSession(); } catch { onSessionLost?.(); return Promise.reject(error); }
      config.headers.Authorization = `Bearer ${accessToken}`;
      return api(config);
    }
    return Promise.reject(error);
  },
);

let onSessionLost = null;
export const setSessionLostHandler = (fn) => { onSessionLost = fn; };

export const errorInfo = (e) => ({
  status: e?.response?.status || 0,
  code: e?.response?.data?.error?.code || (e?.code === 'ERR_NETWORK' ? 'NETWORK' : 'UNKNOWN'),
  message: e?.response?.data?.error?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection.' : e?.message || 'Something went wrong'),
  details: e?.response?.data?.error?.details,
});
export const isConflict = (e) => e?.response?.status === 409 && e.response.data?.error?.details?.code === 'STALE_VERSION';

export default api;
