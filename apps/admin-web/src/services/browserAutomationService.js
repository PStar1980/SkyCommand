import api from './api';

const LAST_BROWSER_AUTOMATION_RUN_KEY = 'skycommand.browserAutomations.lastRunWorkflowId';

async function listAutomations(filters = {}) {
  return api.get('/api/browser-automations', { query: filters });
}

async function getAutomation(automationCode) {
  return api.get(`/api/browser-automations/${encodeURIComponent(automationCode)}`);
}

async function runAutomation(automationCode, payload = {}) {
  return api.post(`/api/browser-automations/${encodeURIComponent(automationCode)}/run`, payload);
}

async function listRuns(filters = {}) {
  return api.get('/api/browser-automations/runs', { query: filters });
}

async function getRun(workflowId) {
  return api.get(`/api/browser-automations/runs/${encodeURIComponent(workflowId)}`);
}

async function getArtifact(workflowId, artifactId) {
  return api.blob(`/api/browser-automations/runs/${encodeURIComponent(workflowId)}/artifacts/${encodeURIComponent(artifactId)}`);
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

function setLastRunWorkflowId(workflowId) {
  if (!workflowId) {
    window.sessionStorage.removeItem(LAST_BROWSER_AUTOMATION_RUN_KEY);
    return;
  }
  window.sessionStorage.setItem(LAST_BROWSER_AUTOMATION_RUN_KEY, String(workflowId));
}

function getLastRunWorkflowId() {
  return window.sessionStorage.getItem(LAST_BROWSER_AUTOMATION_RUN_KEY) || '';
}

const browserAutomationService = {
  createAdminAutomation,
  getAdminAutomation,
  getAdminOptions,
  getArtifact,
  getAutomation,
  getLastRunWorkflowId,
  getRun,
  listAdminAutomations,
  listAutomations,
  listRuns,
  replaceAdminAutomationEnvironments,
  replaceAdminAutomationParameters,
  runAutomation,
  setLastRunWorkflowId,
  updateAdminAutomation,
  updateAdminAutomationStatus,
};

export default browserAutomationService;
