import api from './api.js';

const agentService = {
  listProjects: (query) => api.get('/api/agent-projects', { query }),
  getProject: (projectId) => api.get(`/api/agent-projects/${projectId}`),
  createProject: (body) => api.post('/api/agent-projects', body),
  updateProject: (projectId, body) => api.patch(`/api/agent-projects/${projectId}`, body),
  getProjectOptions: () => api.get('/api/agent-projects/options'),
  listProjectUsers: (projectId) => api.get(`/api/agent-projects/${projectId}/member-options`),
  upsertProjectMember: (projectId, body) => api.post(`/api/agent-projects/${projectId}/memberships`, body),
  bindRepository: (projectId, body) => api.post(`/api/agent-projects/${projectId}/repositories`, body),
  bindWorkspace: (projectId, body) => api.post(`/api/agent-projects/${projectId}/workspaces`, body),
  setProjectAgentAllowRule: (projectId, body) => api.post(`/api/agent-projects/${projectId}/allow-rules`, body),
  listAgents: (query) => api.get('/api/agents', { query }),
  createAgent: (body) => api.post('/api/agents', body),
  getAgent: (definitionId, query) => api.get(`/api/agents/${definitionId}`, { query }),
  updateAgent: (definitionId, body) => api.patch(`/api/agents/${definitionId}`, body),
  createAgentVersion: (definitionId, body) => api.post(`/api/agents/${definitionId}/versions`, body),
  listRuntimes: () => api.get('/api/agent-runtimes'),
  createRuntime: (body) => api.post('/api/agent-runtimes', body),
  createInstallation: (runtimeId, body) => api.post(`/api/agent-runtimes/${runtimeId}/installations`, body),
  createAccount: (installationId, body) => api.post(`/api/agent-runtimes/installations/${installationId}/accounts`, body),
  createCapabilityProfile: (body) => api.post('/api/agent-runtimes/capability-profiles', body),
  previewAuthority: (body) => api.post('/api/agent-executions/preview', body),
  listAgentRuns: (query) => api.get('/api/agent-runs', { query }),
  getAgentRun: (runId) => api.get(`/api/agent-runs/${runId}`),
  getAgentRunEvents: (runId) => api.get(`/api/agent-runs/${runId}/events`),
  getAgentRunResult: (runId) => api.get(`/api/agent-runs/${runId}/result`),
  cancelAgentRun: (runId) => api.post(`/api/agent-runs/${runId}/cancel`, {}),
  stopExecutionScope: (scopeId) => api.post(`/api/execution-scopes/${scopeId}/stop`, {}),
};

export default agentService;
