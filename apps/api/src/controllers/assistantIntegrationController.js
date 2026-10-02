const assistantIntegrationService = require('../services/assistantIntegrationService');
const orchestratorRefreshService = require('../services/orchestratorRefreshService');
const devRuntimeRefreshService = require('../services/devRuntimeRefreshService');
const authService = require('../services/authService');

function sendError(res, error, next) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
      details: error.details || undefined,
    });
  }
  return next(error);
}

async function getCapabilities(req, res, next) {
  try {
    return res.json({
      ok: true,
      capabilities: await assistantIntegrationService.getCapabilitiesWithRuntimeReadiness({
        permissionCodes: req.assistantIntegration?.permissionCodes || [],
        agentId: req.assistantIntegration?.agentId || 'assistant-http',
      }),
    });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getOpenApi(req, res, next) {
  try {
    return res.json(assistantIntegrationService.getOpenApiDocument());
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getManagedCodexStatus(req, res, next) {
  try {
    const status = await assistantIntegrationService.getManagedCodexStatus({
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...status });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getManagedCodexDiagnostics(req, res, next) {
  try {
    const diagnostics = await assistantIntegrationService.getManagedCodexDiagnostics({
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...diagnostics });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startManagedCodexEnrollment(req, res, next) {
  try {
    const result = await assistantIntegrationService.startManagedCodexEnrollment({
      body: req.body || {},
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.status(result.reused ? 200 : 202).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function reconcileManagedCodexEnrollment(req, res, next) {
  try {
    const result = await assistantIntegrationService.reconcileManagedCodexEnrollment({
      enrollmentId: req.params.enrollmentId,
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function refreshManagedCodexAccount(req, res, next) {
  try {
    const result = await assistantIntegrationService.refreshManagedCodexAccount({
      body: req.body || {},
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function logoutManagedCodexAccount(req, res, next) {
  try {
    const result = await assistantIntegrationService.logoutManagedCodexAccount({
      body: req.body || {},
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startManagedCodexLifecycle(req, res, next) {
  try {
    const result = await assistantIntegrationService.startManagedCodexLifecycle({
      body: req.body || {},
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.status(result.reused ? 200 : 202).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getManagedCodexLifecycle(req, res, next) {
  try {
    const result = await assistantIntegrationService.getManagedCodexLifecycle({
      operationId: req.params.operationId,
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId,
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function listAutomations(req, res, next) {
  try {
    const payload = await assistantIntegrationService.listAutomations(
      req.query || {},
      req.permissions || [],
    );
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAutomation(req, res, next) {
  try {
    const automation = await assistantIntegrationService.getAutomation(
      req.params.automationCode,
      req.permissions || [],
    );
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startAutomation(req, res, next) {
  try {
    const payload = await assistantIntegrationService.startAutomation({
      automationCode: req.params.automationCode,
      body: req.body || {},
      permissions: req.permissions || [],
      actor: req.user,
    });
    await assistantIntegrationService
      .recordInvocationAudit({
        req,
        automationCode: req.params.automationCode,
        workflowId: payload.execution?.workflowId || null,
        success: true,
        message: `Assistant started Playwright Automation ${req.params.automationCode}.`,
      })
      .catch(() => {});
    return res.status(202).json({ ok: true, ...payload });
  } catch (error) {
    await assistantIntegrationService
      .recordInvocationAudit({
        req,
        automationCode: req.params.automationCode,
        success: false,
        message: error.message || 'Assistant Playwright Automation execution was rejected.',
        error,
      })
      .catch(() => {});
    return sendError(res, error, next);
  }
}

async function startDevelopmentPromotion(req, res, next) {
  try {
    const context = authService.getRequestContext(req);
    const promotion = await assistantIntegrationService.startDevelopmentPromotion({
      body: req.body || {},
      permissions: req.permissions || [],
      actor: req.user,
      session: req.session,
      context,
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
    });
    await assistantIntegrationService
      .recordDevelopmentPromotionAudit({
        req,
        result: promotion,
        success: true,
      })
      .catch(() => {});
    return res.status(202).json({ ok: true, promotion });
  } catch (error) {
    await assistantIntegrationService
      .recordDevelopmentPromotionAudit({
        req,
        success: false,
        error,
      })
      .catch(() => {});
    return sendError(res, error, next);
  }
}

async function startWorkflowExecution(req, res, next) {
  try {
    const result = await assistantIntegrationService.startWorkflowExecution({
      request: req.body || {},
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
      authMode: req.session?.authMode || 'ASSISTANT_SERVICE_TOKEN',
      actor: req.user,
      session: req.session,
      context: authService.getRequestContext(req),
    });
    return res.status(result.reused ? 200 : 202).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getWorkflowExecutionRun(req, res, next) {
  try {
    const result = await assistantIntegrationService.getWorkflowExecutionRun({
      workflowRunRecordId: req.params.workflowRunRecordId,
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
      authMode: req.session?.authMode || 'ASSISTANT_SERVICE_TOKEN',
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startOrchestratorRefresh(req, res, next) {
  try {
    const result = await orchestratorRefreshService.startTemporalWorkerRefresh({
      request: req.body || {},
      permissions: req.permissions || [],
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
      actor: req.user,
      session: req.session,
      requestContext: authService.getRequestContext(req),
    });
    return res.status(result.reused ? 200 : 202).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getOrchestratorRefresh(req, res, next) {
  try {
    const result = await orchestratorRefreshService.getTemporalWorkerRefresh({
      operationId: req.params.operationId,
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startDevRuntimeRefresh(req, res, next) {
  try {
    const result = await devRuntimeRefreshService.startDevRuntimeRefresh({
      request: req.body || {},
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
      actor: req.user,
      session: req.session,
      requestContext: authService.getRequestContext(req),
    });
    return res.status(result.reused ? 200 : 202).json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getDevRuntimeRefresh(req, res, next) {
  try {
    const result = await devRuntimeRefreshService.getDevRuntimeRefresh({
      operationId: req.params.operationId,
      principalCode: req.assistantIntegration?.principalCode || 'assistant-http',
      permissions: req.permissions || [],
      agentId: req.assistantIntegration?.agentId || 'assistant-http',
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getRun(req, res, next) {
  try {
    const run = await assistantIntegrationService.getRun(req.params.workflowId, { actor: req.user });
    return res.json({ ok: true, run });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getArtifact(req, res, next) {
  try {
    const artifact = await assistantIntegrationService.getArtifact({
      workflowId: req.params.workflowId,
      artifactId: req.params.artifactId,
      actor: req.user,
    });
    res.type(artifact.contentType || 'application/octet-stream');
    const disposition =
      String(artifact.kind || '').toUpperCase() === 'SCREENSHOT' ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(artifact.name || 'artifact')}`,
    );
    return res.sendFile(artifact.absolutePath);
  } catch (error) {
    return sendError(res, error, next);
  }
}

module.exports = {
  getArtifact,
  getAutomation,
  getCapabilities,
  getOpenApi,
  getManagedCodexStatus,
  getManagedCodexDiagnostics,
  startManagedCodexLifecycle,
  getManagedCodexLifecycle,
  startManagedCodexEnrollment,
  reconcileManagedCodexEnrollment,
  refreshManagedCodexAccount,
  logoutManagedCodexAccount,
  getRun,
  getWorkflowExecutionRun,
  getOrchestratorRefresh,
  getDevRuntimeRefresh,
  listAutomations,
  startDevelopmentPromotion,
  startWorkflowExecution,
  startOrchestratorRefresh,
  startDevRuntimeRefresh,
  startAutomation,
};
