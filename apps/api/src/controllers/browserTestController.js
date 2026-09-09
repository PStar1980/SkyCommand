const browserTestRegistryService = require('../services/browserTestRegistryService');

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

async function listTests(req, res, next) {
  try {
    const payload = await browserTestRegistryService.listBrowserTests(req.query || {});
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getTest(req, res, next) {
  try {
    const test = await browserTestRegistryService.getBrowserTestByCode(req.params.testCode, {
      includeDisabled: false,
    });
    if (!test) return res.status(404).json({ ok: false, error: 'Browser Test not found.' });
    test.parameters = (test.parameters || []).filter((parameter) => parameter.enabled);
    test.environments = (test.environments || []).filter((environment) => environment.enabled);
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function startTest(req, res, next) {
  try {
    const payload = await browserTestRegistryService.startRegisteredBrowserTest({
      testCode: req.params.testCode,
      body: req.body || {},
      permissions: req.permissions || [],
      actor: req.user,
      triggerSource: 'MANUAL',
    });
    return res.status(202).json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function listRuns(req, res, next) {
  try {
    const payload = await browserTestRegistryService.listBrowserTestRuns(req.query || {});
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getRun(req, res, next) {
  try {
    const run = await browserTestRegistryService.getBrowserTestRun(req.params.workflowId);
    return res.json({ ok: true, run });
  } catch (error) {
    return sendError(res, error, next);
  }
}


async function getArtifact(req, res, next) {
  try {
    const artifact = await browserTestRegistryService.getBrowserTestArtifact({
      workflowId: req.params.workflowId,
      artifactId: req.params.artifactId,
    });
    res.type(artifact.contentType || 'application/octet-stream');
    const disposition = ['SCREENSHOT', 'VIDEO'].includes(artifact.kind) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${String(artifact.name || 'artifact').replace(/"/g, '')}"`);
    return res.sendFile(artifact.absolutePath);
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAdminOptions(req, res, next) {
  try {
    const options = await browserTestRegistryService.getAdminOptions();
    return res.json({ ok: true, options });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function listAdminTests(req, res, next) {
  try {
    const payload = await browserTestRegistryService.listBrowserTests(req.query || {}, { admin: true });
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function getAdminTest(req, res, next) {
  try {
    const test = await browserTestRegistryService.getBrowserTestById(req.params.testId);
    if (!test) return res.status(404).json({ ok: false, error: 'Browser Test not found.' });
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function createAdminTest(req, res, next) {
  try {
    const test = await browserTestRegistryService.createBrowserTest({
      body: req.body || {},
      actor: req.user,
    });
    return res.status(201).json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function updateAdminTest(req, res, next) {
  try {
    const test = await browserTestRegistryService.updateBrowserTest({
      testId: req.params.testId,
      body: req.body || {},
    });
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function updateAdminTestStatus(req, res, next) {
  try {
    const test = await browserTestRegistryService.updateBrowserTestStatus({
      testId: req.params.testId,
      enabled: req.body?.enabled,
    });
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function replaceAdminTestParameters(req, res, next) {
  try {
    const test = await browserTestRegistryService.replaceBrowserTestParameters({
      testId: req.params.testId,
      parameters: req.body?.parameters,
    });
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

async function replaceAdminTestEnvironments(req, res, next) {
  try {
    const test = await browserTestRegistryService.replaceBrowserTestEnvironments({
      testId: req.params.testId,
      environmentCodes: req.body?.environmentCodes,
    });
    return res.json({ ok: true, test });
  } catch (error) {
    return sendError(res, error, next);
  }
}

module.exports = {
  createAdminTest,
  getAdminOptions,
  getArtifact,
  getAdminTest,
  getRun,
  getTest,
  listAdminTests,
  listRuns,
  listTests,
  replaceAdminTestEnvironments,
  replaceAdminTestParameters,
  startTest,
  updateAdminTest,
  updateAdminTestStatus,
};
