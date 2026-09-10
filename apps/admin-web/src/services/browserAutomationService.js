import api from './api';

async function listAutomations(filters = {}) {
  return api.get('/api/browser-automations', { query: filters });
}

async function getAutomation(automationCode) {
  return api.get(`/api/browser-automations/${encodeURIComponent(automationCode)}`);
}

async function getAdminOptions() {
  return api.get('/api/admin/browser-automations/options');
}

async function listAdminAutomations(filters = {}) {
  return api.get('/api/admin/browser-automations', { query: filters });
}

async function getAdminAutomation(automationId) {
  return api.get(`/api/admin/browser-automations/${encodeURIComponent(automationId)}`);
}

async function createAdminAutomation(payload) {
  return api.post('/api/admin/browser-automations', payload);
}

async function updateAdminAutomation(automationId, payload) {
  return api.patch(`/api/admin/browser-automations/${encodeURIComponent(automationId)}`, payload);
}

async function updateAdminAutomationStatus(automationId, enabled) {
  return api.patch(`/api/admin/browser-automations/${encodeURIComponent(automationId)}/status`, { enabled });
}

async function replaceAdminAutomationParameters(automationId, parameters) {
  return api.put(`/api/admin/browser-automations/${encodeURIComponent(automationId)}/parameters`, { parameters });
}

async function replaceAdminAutomationEnvironments(automationId, environmentCodes) {
  return api.put(`/api/admin/browser-automations/${encodeURIComponent(automationId)}/environments`, { environmentCodes });
}

const browserAutomationService = {
  createAdminAutomation,
  getAdminAutomation,
  getAdminOptions,
  getAutomation,
  listAdminAutomations,
  listAutomations,
  replaceAdminAutomationEnvironments,
  replaceAdminAutomationParameters,
  updateAdminAutomation,
  updateAdminAutomationStatus,
};

export default browserAutomationService;
