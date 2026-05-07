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

  const refreshSession = useCallback(async () => {
    const token = api.getSessionToken();

    if (!token) {
      setUser(null);
      setSession(null);
      setPermissions([]);
      setLoading(false);
      return null;
    }

    try {
      const result = await authService.getCurrentSession();

      setUser(result.user || null);
      setSession(result.session || null);
      setPermissions(normalizePermissions(result.permissions || []));

      return result;
    } catch (error) {
      api.clearSessionToken();
      setUser(null);
      setSession(null);
      setPermissions([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async ({ email, password }) => {
    const result = await authService.login({ email, password });

    setUser(result.user || null);
    setSession({ expiresAt: result.expiresAt });
    setPermissions(normalizePermissions(result.permissions || []));

    return result;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setSession(null);
    setPermissions([]);
  }, []);

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
      isAuthenticated: Boolean(user),
      login,
      logout,
      refreshSession,
      hasPermission,
    }),
    [user, session, permissions, loading, login, logout, refreshSession, hasPermission],
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
