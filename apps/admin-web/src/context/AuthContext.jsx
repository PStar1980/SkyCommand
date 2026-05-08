import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import authService from '../services/authService';

const AuthContext = createContext(null);

function normalizePermissions(permissions = []) {
  return permissions.map((permission) => ({
    ...permission,
    permissionCode: permission.permissionCode || permission.permission_code,
  }));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setPermissions([]);
  }, []);

  const clearAuthNotice = useCallback(() => {
    setAuthNotice('');
  }, []);

  const handleExpiredSession = useCallback(
    (message = 'Your session expired. Please sign in again.') => {
      api.clearSessionToken();
      clearAuthState();
      setLoading(false);
      setAuthNotice(message);
    },
    [clearAuthState],
  );

  const refreshSession = useCallback(async () => {
    const token = api.getSessionToken();

    if (!token) {
      clearAuthState();
      setLoading(false);
      return null;
    }

    try {
      const result = await authService.getCurrentSession();

      setUser(result.user || null);
      setSession(result.session || null);
      setPermissions(normalizePermissions(result.permissions || []));
      setAuthNotice('');

      return result;
    } catch (error) {
      handleExpiredSession(error.message || 'Your session expired. Please sign in again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearAuthState, handleExpiredSession]);

  useEffect(() => {
    function onAuthExpired(event) {
      handleExpiredSession(event.detail?.message || 'Your session expired. Please sign in again.');
    }

    window.addEventListener(api.AUTH_EXPIRED_EVENT, onAuthExpired);

    return () => {
      window.removeEventListener(api.AUTH_EXPIRED_EVENT, onAuthExpired);
    };
  }, [handleExpiredSession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async ({ email, password }) => {
    const result = await authService.login({ email, password });

    setUser(result.user || null);
    setSession({ expiresAt: result.expiresAt });
    setPermissions(normalizePermissions(result.permissions || []));
    setAuthNotice('');

    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      api.clearSessionToken();
      clearAuthState();
      setAuthNotice('');
    }
  }, [clearAuthState]);

  const permissionCodes = useMemo(
    () => new Set(permissions.map((permission) => permission.permissionCode).filter(Boolean)),
    [permissions],
  );

  const hasPermission = useCallback(
    (permissionCode) => {
      if (!permissionCode) {
        return true;
      }

      return permissionCodes.has(permissionCode);
    },
    [permissionCodes],
  );

  const value = useMemo(
    () => ({
      user,
      session,
      permissions,
      loading,
      authNotice,
      isAuthenticated: Boolean(user),
      login,
      logout,
      refreshSession,
      hasPermission,
      clearAuthNotice,
    }),
    [
      user,
      session,
      permissions,
      loading,
      authNotice,
      login,
      logout,
      refreshSession,
      hasPermission,
      clearAuthNotice,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
