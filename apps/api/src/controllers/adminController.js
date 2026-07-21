const adminReadService = require('../services/adminReadService');
const adminActionService = require('../services/adminActionService');
const authService = require('../services/authService');
const productionReadinessService = require('../services/productionReadinessService');
const toolAdminService = require('../services/toolAdminService');
const skycommandRepositoryService = require('../services/skycommandRepositoryService');
const toolOnboardingService = require('../services/toolOnboardingService');
const toolVerificationService = require('../services/toolVerificationService');
const { createLiveTelemetryEnvelope } = require('../utils/liveTelemetryEnvelope');

function sendPagedResponse(res, payload, liveTelemetryOptions = null) {
  const liveEnvelope = liveTelemetryOptions
    ? createLiveTelemetryEnvelope(liveTelemetryOptions)
    : {};

  res.json({
    ok: true,
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items,
    ...liveEnvelope,
  });
}

function isActiveToolExecution(execution = {}) {
  return ['STARTED', 'RUNNING', 'QUEUED'].includes(String(execution.status || '').toUpperCase());
}

function buildToolExecutionTelemetry(payload = {}) {
  const items = payload.items || [];
  const activeItems = items.filter(isActiveToolExecution);
  const failedItems = items.filter((item) => String(item.status || '').toUpperCase() === 'FAILED');
  const successItems = items.filter(
    (item) => String(item.status || '').toUpperCase() === 'SUCCESS',
  );

  return {
    active: activeItems.length > 0,
    activeCount: activeItems.length,
    counts: {
      total: payload.total || items.length,
      limit: payload.limit,
      offset: payload.offset,
      returned: items.length,
      active: activeItems.length,
      success: successItems.length,
      failed: failedItems.length,
    },
    records: items,
    resource: 'execution-list',
    scope: 'tool-executions',
    surface: 'tool-history',
  };
}

function buildReadinessTelemetry(payload = {}) {
  const summary = payload.summary || payload.counts || {};
  const warningCount = Number(summary.warning || summary.warnings || payload.warnings?.length || 0);
  const failureCount = Number(summary.fail || summary.failures || payload.failures?.length || 0);

  return createLiveTelemetryEnvelope({
    active: warningCount > 0 || failureCount > 0,
    activeCount: warningCount + failureCount,
    counts: summary,
    records: payload.checks || payload.items || [],
    resource: 'readiness-snapshot',
    scope: 'production-readiness',
    selectedRecord: payload,
    status: failureCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'idle',
    surface: 'readiness-dashboard',
    warnings: payload.warnings || [],
    errors: payload.errors || [],
  });
}

function sendServiceResponse(res, payload = {}) {
  res.json({
    ok: true,
    ...payload,
  });
}

function sendServiceError(res, error) {
  const statusCode = error.statusCode || 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
  };

  if (error.details && Object.keys(error.details).length > 0) {
    response.details = error.details;
  }

  res.status(statusCode).json(response);
}

function getActionContext(req) {
  return {
    actor: req.user,
    permissions: req.permissions || [],
    currentSession: req.session,
    context: authService.getRequestContext(req),
  };
}

async function listAuditEvents(req, res) {
  try {
    const payload = await adminReadService.listAuditEvents(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listLoginEvents(req, res) {
  try {
    const payload = await adminReadService.listLoginEvents(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listScriptExecutions(req, res) {
  try {
    const payload = await adminReadService.listScriptExecutions(req.query || {});
    sendPagedResponse(res, payload, buildToolExecutionTelemetry(payload));
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listActiveSessions(req, res) {
  try {
    const payload = await adminReadService.listActiveSessions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listSessions(req, res) {
  try {
    const payload = await adminReadService.listActiveSessions({
      ...(req.query || {}),
      currentSessionId: req.session?.sessionId,
    });
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function revokeSession(req, res) {
  try {
    const payload = await adminActionService.revokeSession({
      sessionId: req.params.sessionId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getApplicationUserSummary(req, res) {
  try {
    const payload = await adminReadService.getApplicationUserSummary(req.query || {});
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listApplications(req, res) {
  try {
    const payload = await adminReadService.listApplications(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getUserApplications(req, res) {
  try {
    const payload = await adminActionService.getUserApplications(req.params.userId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateUserApplications(req, res) {
  try {
    const payload = await adminActionService.updateUserApplications({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listUsers(req, res) {
  try {
    const payload = await adminReadService.listUsers(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getUser(req, res) {
  try {
    const payload = await adminActionService.getUser(req.params.userId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createUser(req, res) {
  try {
    const payload = await adminActionService.createUser({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateUser(req, res) {
  try {
    const payload = await adminActionService.updateUser({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateUserStatus(req, res) {
  try {
    const payload = await adminActionService.updateUserStatus({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function resetUserPassword(req, res) {
  try {
    const payload = await adminActionService.resetUserPassword({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listUserRoles(req, res) {
  try {
    const payload = await adminReadService.listUserRoles(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getUserRoles(req, res) {
  try {
    const payload = await adminActionService.getUserRoles(req.params.userId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateUserRoles(req, res) {
  try {
    const payload = await adminActionService.updateUserRoles({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getUserSessions(req, res) {
  try {
    const payload = await adminActionService.getUserSessions(req.params.userId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function revokeUserSessions(req, res) {
  try {
    const payload = await adminActionService.revokeUserSessions({
      userId: req.params.userId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listRoles(req, res) {
  try {
    const payload = await adminReadService.listRoles(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getRole(req, res) {
  try {
    const payload = await adminActionService.getRole(req.params.roleId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createRole(req, res) {
  try {
    const payload = await adminActionService.createRole({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRole(req, res) {
  try {
    const payload = await adminActionService.updateRole({
      roleId: req.params.roleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRoleStatus(req, res) {
  try {
    const payload = await adminActionService.updateRoleStatus({
      roleId: req.params.roleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getRolePermissions(req, res) {
  try {
    const payload = await adminActionService.getRolePermissions(req.params.roleId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRolePermissions(req, res) {
  try {
    const payload = await adminActionService.updateRolePermissions({
      roleId: req.params.roleId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getRoleUsers(req, res) {
  try {
    const payload = await adminActionService.getRoleUsers(req.params.roleId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listPermissions(req, res) {
  try {
    const payload = await adminReadService.listPermissions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getPermission(req, res) {
  try {
    const payload = await adminActionService.getPermission(req.params.permissionId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createPermission(req, res) {
  try {
    const payload = await adminActionService.createPermission({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updatePermission(req, res) {
  try {
    const payload = await adminActionService.updatePermission({
      permissionId: req.params.permissionId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updatePermissionStatus(req, res) {
  try {
    const payload = await adminActionService.updatePermissionStatus({
      permissionId: req.params.permissionId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getPermissionRoles(req, res) {
  try {
    const payload = await adminActionService.getPermissionRoles(req.params.permissionId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listRolePermissions(req, res) {
  try {
    const payload = await adminReadService.listRolePermissions(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listAdminTools(req, res) {
  try {
    const payload = await toolAdminService.listTools(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getAdminToolOptions(req, res) {
  try {
    const payload = await toolAdminService.getOptions();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getAdminTool(req, res) {
  try {
    const payload = await toolAdminService.getTool(req.params.toolId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createAdminTool(req, res) {
  try {
    const payload = await toolAdminService.createTool({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateAdminTool(req, res) {
  try {
    const payload = await toolAdminService.updateTool({
      toolId: req.params.toolId,
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateAdminToolStatus(req, res) {
  try {
    const payload = await toolAdminService.updateToolStatus({
      toolId: req.params.toolId,
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function replaceAdminToolParameters(req, res) {
  try {
    const payload = await toolAdminService.replaceToolParameters({
      toolId: req.params.toolId,
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getToolOnboardingOptions(req, res) {
  void req;

  try {
    const payload = await toolOnboardingService.getOptions();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function analyzeToolOnboardingPackage(req, res) {
  try {
    const payload = await toolOnboardingService.analyzeToolPackage({
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function previewToolOnboardingRegistration(req, res) {
  try {
    const payload = await toolOnboardingService.previewToolRegistration({
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function registerToolOnboardingPackage(req, res) {
  try {
    const payload = await toolOnboardingService.registerToolPackage({
      body: req.body || {},
      ...getActionContext(req),
    });
    res.status(201).json({ ok: true, ...payload });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getManagedToolVerification(req, res) {
  try {
    const payload = await toolVerificationService.getVerification(req.params.toolId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function checkManagedToolContract(req, res) {
  try {
    const payload = await toolVerificationService.contractCheck({
      toolId: req.params.toolId,
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function runManagedToolControlledTest(req, res) {
  try {
    const payload = await toolVerificationService.runControlledTest({
      toolId: req.params.toolId,
      body: req.body || {},
      ...getActionContext(req),
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listRepositories(req, res) {
  try {
    const payload = await adminActionService.listRepositories(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listConfigProfiles(req, res) {
  try {
    const payload = await adminActionService.listConfigProfiles();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getSkycommandRepositoryReadiness(req, res) {
  void req;

  try {
    const readiness = await skycommandRepositoryService.getSkycommandRepositoryReadiness();
    sendServiceResponse(res, { readiness });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getRepository(req, res) {
  try {
    const payload = await adminActionService.getRepository(req.params.repoId);
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function createRepository(req, res) {
  try {
    const payload = await adminActionService.createRepository({
      body: req.body || {},
      ...getActionContext(req),
    });

    res.status(201).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRepository(req, res) {
  try {
    const payload = await adminActionService.updateRepository({
      repoId: req.params.repoId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateSkycommandRepositoryDesignation(req, res) {
  try {
    const payload = await adminActionService.setSkycommandRepositoryDesignation({
      repoId: req.params.repoId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRepositoryStatus(req, res) {
  try {
    const payload = await adminActionService.updateRepositoryStatus({
      repoId: req.params.repoId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function updateRepositoryPaths(req, res) {
  try {
    const payload = await adminActionService.updateRepositoryPaths({
      repoId: req.params.repoId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function deleteRepository(req, res) {
  try {
    const payload = await adminActionService.deleteRepository({
      repoId: req.params.repoId,
      body: req.body || {},
      ...getActionContext(req),
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getProductionReadiness(req, res) {
  try {
    const payload = await productionReadinessService.getProductionReadiness({
      user: req.user,
      permissions: req.permissions || [],
    });
    const liveEnvelope = buildReadinessTelemetry(payload);

    sendServiceResponse(res, {
      ...payload,
      ...liveEnvelope,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getAuthSettings(req, res) {
  try {
    const payload = adminActionService.getAuthSettings();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getCoreSettings(req, res) {
  try {
    const payload = await adminActionService.getCoreSettings();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

module.exports = {
  listAuditEvents,
  listLoginEvents,
  listScriptExecutions,
  listActiveSessions,
  getApplicationUserSummary,
  listSessions,
  revokeSession,
  listApplications,
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
  getToolOnboardingOptions,
  analyzeToolOnboardingPackage,
  previewToolOnboardingRegistration,
  registerToolOnboardingPackage,
  getManagedToolVerification,
  checkManagedToolContract,
  runManagedToolControlledTest,
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
