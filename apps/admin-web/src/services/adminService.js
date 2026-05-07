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

async function listRoles(filters = {}) {
  return api.get('/api/admin/roles', { query: filters });
}

async function listPermissions(filters = {}) {
  return api.get('/api/admin/permissions', { query: filters });
}

async function listRolePermissions(filters = {}) {
  return api.get('/api/admin/role-permissions', { query: filters });
}

const adminService = {
  listScriptExecutions,
  listAuditEvents,
  listLoginEvents,
  listActiveSessions,
  listRoles,
  listPermissions,
  listRolePermissions,
};

export default adminService;
