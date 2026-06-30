import api from './api';

function getHealth() {
  return api.get('/api/temporal/health');
}

function listWorkflowDefinitions() {
  return api.get('/api/temporal/workflow-definitions');
}

function listWorkflows(filters = {}) {
  return api.get('/api/temporal/workflows', { query: filters });
}

function listWorkflowRunRecords(filters = {}) {
  return api.get('/api/temporal/workflow-run-records', { query: filters });
}

function getWorkflow(workflowId, options = {}) {
  return api.get(`/api/temporal/workflows/${encodeURIComponent(workflowId)}`, {
    query: options,
  });
}

function startFredIngestionWorkflow(payload = {}) {
  return api.post('/api/temporal/workflows/fred-ingestion/start', payload);
}

function startWorkflowFromDefinition(workflowCode, payload = {}) {
  return api.post(
    `/api/temporal/workflow-definitions/${encodeURIComponent(workflowCode)}/start`,
    payload,
  );
}

function cancelWorkflow(workflowId, payload = {}) {
  return api.post(`/api/temporal/workflows/${encodeURIComponent(workflowId)}/cancel`, payload);
}

function terminateWorkflow(workflowId, payload = {}) {
  return api.post(`/api/temporal/workflows/${encodeURIComponent(workflowId)}/terminate`, payload);
}

const temporalService = {
  getHealth,
  listWorkflowDefinitions,
  listWorkflowRunRecords,
  listWorkflows,
  getWorkflow,
  startFredIngestionWorkflow,
  startWorkflowFromDefinition,
  cancelWorkflow,
  terminateWorkflow,
};

export default temporalService;
