const service = require('../services/browserTestSuiteService');

function sendError(res, error, next) {
  if (error?.statusCode) return res.status(error.statusCode).json({ ok: false, error: error.message, details: error.details || undefined });
  return next(error);
}

async function listSuites(req, res, next) {
  try { return res.json({ ok: true, ...(await service.listSuites(req.query || {})) }); }
  catch (error) { return sendError(res, error, next); }
}
async function getSuite(req, res, next) {
  try {
    const suite = await service.getSuiteByCode(req.params.suiteCode);
    if (!suite) return res.status(404).json({ ok: false, error: 'Playwright Test Suite not found.' });
    return res.json({ ok: true, suite });
  } catch (error) { return sendError(res, error, next); }
}
async function startSuite(req, res, next) {
  try {
    const payload = await service.startSuite({ suiteCode: req.params.suiteCode, body: req.body || {}, permissions: req.permissions || [], actor: req.user, triggerSource: 'MANUAL' });
    return res.status(202).json({ ok: true, ...payload });
  } catch (error) { return sendError(res, error, next); }
}
async function listRuns(req, res, next) {
  try { return res.json({ ok: true, ...(await service.listSuiteRuns(req.query || {})) }); }
  catch (error) { return sendError(res, error, next); }
}
async function getRun(req, res, next) {
  try { return res.json({ ok: true, run: await service.getSuiteRun(req.params.workflowId) }); }
  catch (error) { return sendError(res, error, next); }
}

module.exports = { getRun, getSuite, listRuns, listSuites, startSuite };
