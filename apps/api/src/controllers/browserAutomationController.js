const browserAutomationRegistryService = require('../services/browserAutomationRegistryService');

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

async function listAutomations(req, res, next) {
  try {
    const payload = await browserAutomationRegistryService.listBrowserAutomations(req.query || {});
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAutomation(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.getBrowserAutomationByCode(
      req.params.automationCode,
      { includeDisabled: false },
    );
    if (!automation) return res.status(404).json({ ok: false, error: 'Playwright Automation not found.' });
    automation.parameters = (automation.parameters || []).filter((parameter) => parameter.enabled);
    automation.environments = (automation.environments || []).filter((environment) => environment.enabled);
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAdminOptions(req, res, next) {
  try {
    const options = await browserAutomationRegistryService.getAdminOptions();
    return res.json({ ok: true, options });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function listAdminAutomations(req, res, next) {
  try {
    const payload = await browserAutomationRegistryService.listBrowserAutomations(req.query || {}, { admin: true });
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAdminAutomation(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.getBrowserAutomationById(req.params.automationId);
    if (!automation) return res.status(404).json({ ok: false, error: 'Playwright Automation not found.' });
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function createAdminAutomation(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.createBrowserAutomation({
      body: req.body || {},
      actor: req.user,
    });
    return res.status(201).json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function updateAdminAutomation(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.updateBrowserAutomation({
      automationId: req.params.automationId,
      body: req.body || {},
    });
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function updateAdminAutomationStatus(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.updateBrowserAutomationStatus({
      automationId: req.params.automationId,
      enabled: req.body?.enabled,
    });
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function replaceAdminAutomationParameters(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.replaceBrowserAutomationParameters({
      automationId: req.params.automationId,
      parameters: req.body?.parameters,
    });
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function replaceAdminAutomationEnvironments(req, res, next) {
  try {
    const automation = await browserAutomationRegistryService.replaceBrowserAutomationEnvironments({
      automationId: req.params.automationId,
      environmentCodes: req.body?.environmentCodes,
    });
    return res.json({ ok: true, automation });
  } catch (error) {
    return sendError(res, error, next);
  }
}

module.exports = {
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
