import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { refreshSession, setAccessToken, setSessionLostHandler } from '../services/api';
import { disconnectSocket } from '../services/socket';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const clear = useCallback(() => { setAccessToken(null); disconnectSocket(); setUser(null); localStorage.removeItem('kb.ws'); }, []);

  // Restore the session from the HttpOnly refresh cookie on first load.
  useEffect(() => {
    setSessionLostHandler(clear);
    refreshSession().then((d) => setUser(d.user)).catch(() => {}).finally(() => setBooting(false));
  }, [clear]);

  const start = (d) => { setAccessToken(d.accessToken); setUser(d.user); return d.user; };
  const value = useMemo(() => ({
    user, booting,
    login: async (email, password) => start((await api.post('/auth/login', { email, password }, { skipAuth: true })).data),
    register: async (name, email, password) => start((await api.post('/auth/register', { name, email, password }, { skipAuth: true })).data),
    logout: async (all = false) => { try { await api.post(`/auth/logout${all ? '?all=true' : ''}`); } catch { /* clear locally regardless */ } clear(); },
  }), [user, booting, clear]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
