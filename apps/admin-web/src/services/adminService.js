import api from './api';

async function listScriptExecutions(filters = {}) {
  return api.get('/api/admin/script-executions', { query: filters });
}

async function getScriptExecutionDetail(executionId) {
  return api.get(`/api/admin/script-executions/${encodeURIComponent(executionId)}`);
}

async function getScriptExecutionOptions() {
  return api.get('/api/admin/script-executions/options');
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

async function getApplicationUserSummary(filters = {}) {
  return api.get('/api/admin/user-summary', { query: filters });
}

async function getApiTelemetrySummary(filters = {}) {
  return api.get('/api/admin/api-telemetry/summary', { query: filters });
}

async function listApplications(filters = {}) {
  return api.get('/api/admin/applications', { query: filters });
}

async function listSessions(filters = {}) {
  return api.get('/api/admin/sessions', { query: filters });
}

async function revokeSession(sessionId, payload = {}) {
  return api.post(`/api/admin/sessions/${sessionId}/revoke`, payload);
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

async function getUserApplications(userId) {
  return api.get(`/api/admin/users/${userId}/applications`);
}

async function updateUserApplications(userId, payload) {
  return api.put(`/api/admin/users/${userId}/applications`, payload);
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

async function listAdminTools(filters = {}) {
  return api.get('/api/admin/tools', { query: filters });
}

async function getAdminToolOptions() {
  return api.get('/api/admin/tools/options');
}

async function getAdminTool(toolId) {
  return api.get(`/api/admin/tools/${toolId}`);
}

async function createAdminTool(payload) {
  return api.post('/api/admin/tools', payload);
}

async function updateAdminTool(toolId, payload) {
  return api.patch(`/api/admin/tools/${toolId}`, payload);
}

async function updateAdminToolStatus(toolId, payload) {
  return api.patch(`/api/admin/tools/${toolId}/status`, payload);
}

async function replaceAdminToolParameters(toolId, payload) {
  return api.put(`/api/admin/tools/${toolId}/parameters`, payload);
}

async function getManagedToolVerification(toolId) {
  return api.get(`/api/admin/tools/${toolId}/verification`);
}

async function checkManagedToolContract(toolId, payload = {}) {
  return api.post(`/api/admin/tools/${toolId}/contract-check`, payload);
}

async function runManagedToolControlledTest(toolId, payload = {}) {
  return api.post(`/api/admin/tools/${toolId}/test-run`, payload);
}

async function getToolOnboardingOptions() {
  return api.get('/api/admin/tool-onboarding/options');
}

async function analyzeToolOnboardingPackage(payload) {
  return api.post('/api/admin/tool-onboarding/analyze', payload);
}

async function previewToolOnboardingRegistration(payload) {
  return api.post('/api/admin/tool-onboarding/preview', payload);
}

async function registerToolOnboardingPackage(payload) {
  return api.post('/api/admin/tool-onboarding/register', payload);
}

async function listRepositories(filters = {}) {
  return api.get('/api/admin/repositories', { query: filters });
}

async function listConfigProfiles() {
  return api.get('/api/admin/repositories/profiles');
}

async function getSkycommandRepositoryReadiness() {
  return api.get('/api/admin/repositories/skycommand-readiness');
}

async function getRepository(repoId) {
  return api.get(`/api/admin/repositories/${repoId}`);
}

async function createRepository(payload) {
  return api.post('/api/admin/repositories', payload);
}

async function updateRepository(repoId, payload) {
  return api.patch(`/api/admin/repositories/${repoId}`, payload);
}

async function updateSkycommandRepositoryDesignation(repoId, payload) {
  return api.patch(`/api/admin/repositories/${repoId}/skycommand-designation`, payload);
}

async function updateRepositoryStatus(repoId, payload) {
  return api.patch(`/api/admin/repositories/${repoId}/status`, payload);
}

async function updateRepositoryPaths(repoId, payload) {
  return api.put(`/api/admin/repositories/${repoId}/paths`, payload);
}

async function deleteRepository(repoId, payload = {}) {
  return api.delete(`/api/admin/repositories/${repoId}`, { body: payload });
}

async function getProductionReadiness() {
  return api.get('/api/admin/production-readiness');
}

async function getAuthSettings() {
  return api.get('/api/admin/settings/auth');
}

async function getCoreSettings() {
  return api.get('/api/admin/settings/core');
}

const adminService = {
  listScriptExecutions,
  getScriptExecutionDetail,
  getScriptExecutionOptions,
  listAuditEvents,
  listLoginEvents,
  listActiveSessions,
  getApplicationUserSummary,
  getApiTelemetrySummary,
  listApplications,
  listSessions,
  revokeSession,
  listUsers,
  getUser,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  listUserRoles,
  getUserRoles,
  updateUserRoles,
  getUserApplications,
  updateUserApplications,
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
  listAdminTools,
  getAdminToolOptions,
  getAdminTool,
  createAdminTool,
  updateAdminTool,
  updateAdminToolStatus,
  replaceAdminToolParameters,
  getManagedToolVerification,
  checkManagedToolContract,
  runManagedToolControlledTest,
  getToolOnboardingOptions,
  analyzeToolOnboardingPackage,
  previewToolOnboardingRegistration,
  registerToolOnboardingPackage,
  listRepositories,
  listConfigProfiles,
  getSkycommandRepositoryReadiness,
  getRepository,
  createRepository,
  updateRepository,
  updateSkycommandRepositoryDesignation,
  updateRepositoryStatus,
  updateRepositoryPaths,
  deleteRepository,
  getAuthSettings,
  getProductionReadiness,
  getCoreSettings,
};

export default adminService;
