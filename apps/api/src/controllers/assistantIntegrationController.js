const assistantIntegrationService = require('../services/assistantIntegrationService');

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
      capabilities: assistantIntegrationService.getCapabilities({
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

async function listAutomations(req, res, next) {
  try {
    const payload = await assistantIntegrationService.listAutomations(req.query || {}, req.permissions || []);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAutomation(req, res, next) {
  try {
    const automation = await assistantIntegrationService.getAutomation(req.params.automationCode, req.permissions || []);
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
    await assistantIntegrationService.recordInvocationAudit({
      req,
      automationCode: req.params.automationCode,
      workflowId: payload.execution?.workflowId || null,
      success: true,
      message: `Assistant started Playwright Automation ${req.params.automationCode}.`,
    }).catch(() => {});
    return res.status(202).json({ ok: true, ...payload });
  } catch (error) {
    await assistantIntegrationService.recordInvocationAudit({
      req,
      automationCode: req.params.automationCode,
      success: false,
      message: error.message || 'Assistant Playwright Automation execution was rejected.',
      error,
    }).catch(() => {});
    return sendError(res, error, next);
  }
}

async function getRun(req, res, next) {
  try {
    const run = await assistantIntegrationService.getRun(req.params.workflowId);
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
    });
    res.type(artifact.contentType || 'application/octet-stream');
    const disposition = String(artifact.kind || '').toUpperCase() === 'SCREENSHOT' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(artifact.name || 'artifact')}`);
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
  getRun,
  listAutomations,
  startAutomation,
};
