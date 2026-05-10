import api from './api';

async function listScriptExecutions(filters = {}) {
  return api.get('/api/admin/script-executions', { query: filters });
}

async function listAuditEvents(filters = {}) {
  return api.get('/api/admin/audit-events', { query: filters });
}

async function listLoginEvents(filters = {}) {
  return api.get('/api/admin/login-events', { query: filters });
}

async function listActiveSessions(filters = {}) {
  return api.get('/api/admin/active-sessions', { query: filters });
}

async function listUsers(filters = {}) {
  return api.get('/api/admin/users', { query: filters });
}

async function getUser(userId) {
  return api.get(`/api/admin/users/${userId}`);
}

async function createUser(payload) {
  return api.post('/api/admin/users', payload);
}

async function updateUser(userId, payload) {
  return api.patch(`/api/admin/users/${userId}`, payload);
}

async function updateUserStatus(userId, payload) {
  return api.patch(`/api/admin/users/${userId}/status`, payload);
}

async function resetUserPassword(userId, payload) {
  return api.post(`/api/admin/users/${userId}/reset-password`, payload);
}

async function listUserRoles(filters = {}) {
  return api.get('/api/admin/user-roles', { query: filters });
}

async function getUserRoles(userId) {
  return api.get(`/api/admin/users/${userId}/roles`);
}

async function updateUserRoles(userId, payload) {
  return api.put(`/api/admin/users/${userId}/roles`, payload);
}

async function getUserSessions(userId) {
  return api.get(`/api/admin/users/${userId}/sessions`);
}

async function revokeUserSessions(userId, payload = {}) {
  return api.post(`/api/admin/users/${userId}/revoke-sessions`, payload);
}

async function listRoles(filters = {}) {
  return api.get('/api/admin/roles', { query: filters });
}

async function getRole(roleId) {
  return api.get(`/api/admin/roles/${roleId}`);
}

async function createRole(payload) {
  return api.post('/api/admin/roles', payload);
}

async function updateRole(roleId, payload) {
  return api.patch(`/api/admin/roles/${roleId}`, payload);
}

async function updateRoleStatus(roleId, payload) {
  return api.patch(`/api/admin/roles/${roleId}/status`, payload);
}

async function getRolePermissions(roleId) {
  return api.get(`/api/admin/roles/${roleId}/permissions`);
}

async function updateRolePermissions(roleId, payload) {
  return api.put(`/api/admin/roles/${roleId}/permissions`, payload);
}

async function getRoleUsers(roleId) {
  return api.get(`/api/admin/roles/${roleId}/users`);
}

async function listPermissions(filters = {}) {
  return api.get('/api/admin/permissions', { query: filters });
}

async function getPermission(permissionId) {
  return api.get(`/api/admin/permissions/${permissionId}`);
}

async function createPermission(payload) {
  return api.post('/api/admin/permissions', payload);
}

async function updatePermission(permissionId, payload) {
  return api.patch(`/api/admin/permissions/${permissionId}`, payload);
}

async function updatePermissionStatus(permissionId, payload) {
  return api.patch(`/api/admin/permissions/${permissionId}/status`, payload);
}

async function getPermissionRoles(permissionId) {
  return api.get(`/api/admin/permissions/${permissionId}/roles`);
}

async function listRolePermissions(filters = {}) {
  return api.get('/api/admin/role-permissions', { query: filters });
}

async function getAuthSettings() {
  return api.get('/api/admin/settings/auth');
}

async function getCoreSettings() {
  return api.get('/api/admin/settings/core');
}

const adminService = {
  listScriptExecutions,
  listAuditEvents,
  listLoginEvents,
  listActiveSessions,
  listUsers,
  getUser,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  listUserRoles,
  getUserRoles,
  updateUserRoles,
  getUserSessions,
  revokeUserSessions,
  listRoles,
  getRole,
  createRole,
  updateRole,
  updateRoleStatus,
  getRolePermissions,
  updateRolePermissions,
  getRoleUsers,
  listPermissions,
  getPermission,
  createPermission,
  updatePermission,
  updatePermissionStatus,
  getPermissionRoles,
  listRolePermissions,
  getAuthSettings,
  getCoreSettings,
};

export default adminService;
