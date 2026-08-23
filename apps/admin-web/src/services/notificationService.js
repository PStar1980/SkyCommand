import api from './api';

async function listNotifications({ status = 'ALL', limit = 50 } = {}) {
  return api.get('/api/auth/notifications', { query: { status, limit } });
}

async function markRead(notificationId) {
  return api.patch(`/api/auth/notifications/${encodeURIComponent(notificationId)}/read`, {});
}

async function markAllRead() {
  return api.post('/api/auth/notifications/read-all', {});
}

export default { listNotifications, markRead, markAllRead };
