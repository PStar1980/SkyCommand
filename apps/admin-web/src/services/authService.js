import api from './api';

async function login({ email, password }) {
  const result = await api.post(
    '/api/auth/login',
    { email, password, appCode: 'SKYSERVER_ADMIN' },
    { token: null },
  );

  api.setSessionToken(result.sessionToken);

  return result;
}

async function logout() {
  try {
    await api.post('/api/auth/logout', {});
  } finally {
    api.clearSessionToken();
  }
}

async function changePassword(payload) {
  return api.post('/api/auth/change-password', payload);
}

async function getCurrentSession() {
  return api.get('/api/auth/me');
}

async function getPermissions() {
  return api.get('/api/auth/permissions');
}

const authService = {
  login,
  logout,
  changePassword,
  getCurrentSession,
  getPermissions,
};

export default authService;
