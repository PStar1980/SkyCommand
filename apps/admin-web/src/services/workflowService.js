import api from './api';

function listDefinitions() {
  return api.get('/api/workflows/definitions');
}

function getDefinition(workflowCode) {
  return api.get(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}`);
}

function getBuilderCatalog() {
  return api.get('/api/workflows/builder/catalog');
}

function createDefinition(payload = {}) {
  return api.post('/api/workflows/definitions', payload);
}

function startWorkflow(workflowCode, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/start`, payload);
}

function listRuns(filters = {}) {
  return api.get('/api/workflows/runs', { query: filters });
}

function getRun(workflowRunRecordId) {
  return api.get(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}`);
}

const workflowService = {
  createDefinition,
  getBuilderCatalog,
  getDefinition,
  getRun,
  listDefinitions,
  listRuns,
  startWorkflow,
};

export default workflowService;
