const agentRegistryService = require('../services/agentRegistryService');

function sendError(res, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
  };
  if (statusCode < 500 && error?.details) response.details = error.details;
  res.status(statusCode).json(response);
}

function handler(callback) {
  return async (req, res, next) => {
    try {
      const payload = await callback(req, res);
      if (res.headersSent) return;
      res.json({ ok: true, ...payload });
    } catch (error) {
      if (res.headersSent) return next(error);
      sendError(res, error);
    }
  };
}

module.exports = {
  listProjects: handler((req) => agentRegistryService.listProjects(req, req.query)),
  getProject: handler((req) => agentRegistryService.getProject(req.params.projectId, req)),
  createProject: handler((req) => agentRegistryService.createProject(req, req.body)),
  updateProject: handler((req) => agentRegistryService.updateProject(req.params.projectId, req, req.body)),
  listProjectOptions: handler((req) => agentRegistryService.listProjectOptions(req)),
  listProjectUsers: handler((req) => agentRegistryService.listProjectUsers(req.params.projectId, req)),
  upsertProjectMember: handler((req) => agentRegistryService.upsertProjectMember(req.params.projectId, req, req.body)),
  bindRepository: handler((req) => agentRegistryService.bindRepository(req.params.projectId, req, req.body)),
  bindWorkspace: handler((req) => agentRegistryService.bindWorkspace(req.params.projectId, req, req.body)),
  setProjectAgentAllowRule: handler((req) => agentRegistryService.setProjectAgentAllowRule(req.params.projectId, req, req.body)),
  listAgents: handler((req) => agentRegistryService.listAgents(req, req.query)),
  getAgent: handler((req) => agentRegistryService.getAgent(req.params.definitionId, req, req.query)),
  createAgent: handler((req) => agentRegistryService.createAgent(req, req.body)),
  updateAgent: handler((req) => agentRegistryService.updateAgent(req.params.definitionId, req, req.body)),
  createAgentVersion: handler((req) => agentRegistryService.createAgentVersion(req.params.definitionId, req, req.body)),
  listRuntimes: handler((req) => agentRegistryService.listRuntimes(req)),
  createRuntime: handler((req) => agentRegistryService.createRuntime(req, req.body)),
  createInstallation: handler((req) => agentRegistryService.createInstallation(req.params.runtimeId, req, req.body)),
  createAccount: handler((req) => agentRegistryService.createAccount(req.params.installationId, req, req.body)),
  createCapabilityProfile: handler((req) => agentRegistryService.createCapabilityProfile(req, req.body)),
  previewAuthority: handler((req) => agentRegistryService.previewAuthority(req, req.body)),
};
