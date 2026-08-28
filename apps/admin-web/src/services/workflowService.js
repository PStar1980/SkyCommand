import api from './api';

function getWorkerHealth() {
  return api.get('/api/workflows/worker-health');
}

function listCategories(filters = {}) {
  return api.get('/api/workflows/categories', { query: filters });
}

function listDefinitions(filters = {}) {
  return api.get('/api/workflows/definitions', { query: filters });
}

function getDefinition(workflowCode) {
  return api.get(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}`);
}

function getManagedDefinition(workflowCode) {
  return api.get(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/manage`);
}

function getBuilderCatalog() {
  return api.get('/api/workflows/builder/catalog');
}

function createDefinition(payload = {}) {
  return api.post('/api/workflows/definitions', payload);
}

function updateDefinition(workflowCode, payload = {}) {
  return api.patch(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}`, payload);
}

function archiveDefinition(workflowCode) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/archive`, {});
}

function deleteDefinition(workflowCode) {
  return api.delete(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}`);
}

function replaceGraph(workflowCode, payload = {}) {
  return api.put(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/graph`, payload);
}

function createDraft(workflowCode, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/drafts`, payload);
}

function saveDraftGraph(workflowCode, workflowVersionId, payload = {}) {
  return api.put(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/versions/${encodeURIComponent(workflowVersionId)}/graph`, payload);
}

function publishDraft(workflowCode, workflowVersionId, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/versions/${encodeURIComponent(workflowVersionId)}/publish`, payload);
}

function discardDraft(workflowCode, workflowVersionId) {
  return api.delete(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/versions/${encodeURIComponent(workflowVersionId)}`);
}

function cloneDefinition(workflowCode, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/clone`, payload);
}

function createVersion(workflowCode, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/versions`, payload);
}

function startWorkflow(workflowCode, payload = {}) {
  return api.post(`/api/workflows/definitions/${encodeURIComponent(workflowCode)}/start`, payload);
}

function listRuns(filters = {}) {
  return api.get('/api/workflows/runs', { query: filters });
}

function listActiveRuns(filters = {}) {
  return api.get('/api/workflows/runs/active', { query: filters });
}


function listApprovals(filters = {}) {
  return api.get('/api/workflows/approvals', { query: filters });
}

function decideApproval(approvalRequestId, payload = {}) {
  return api.post(`/api/workflows/approvals/${encodeURIComponent(approvalRequestId)}/decision`, payload);
}

function getRun(workflowRunRecordId) {
  return api.get(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}`);
}

function getRunTelemetry(workflowRunRecordId) {
  return api.get(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}/telemetry`);
}


function cancelRun(workflowRunRecordId, payload = {}) {
  return api.post(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}/cancel`, payload);
}

function terminateRun(workflowRunRecordId, payload = {}) {
  return api.post(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}/terminate`, payload);
}

function retryRun(workflowRunRecordId, payload = {}) {
  return api.post(`/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}/retry`, payload);
}

function retryNode(workflowRunRecordId, nodeKey, payload = {}) {
  return api.post(
    `/api/workflows/runs/${encodeURIComponent(workflowRunRecordId)}/nodes/${encodeURIComponent(nodeKey)}/retry`,
    payload,
  );
}

const workflowService = {
  cancelRun,
  archiveDefinition,
  createDraft,
  cloneDefinition,
  createDefinition,
  createVersion,
  deleteDefinition,
  getBuilderCatalog,
  getWorkerHealth,
  getDefinition,
  getManagedDefinition,
  getRun,
  getRunTelemetry,
  listActiveRuns,
  listApprovals,
  listCategories,
  decideApproval,
  discardDraft,
  listDefinitions,
  listRuns,
  publishDraft,
  replaceGraph,
  saveDraftGraph,
  startWorkflow,
  terminateRun,
  retryRun,
  retryNode,
  updateDefinition,
};

export default workflowService;
