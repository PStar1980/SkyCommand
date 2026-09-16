const authService = require('../services/authService');
const databaseUpgradeApplyRequestService = require('../services/databaseUpgradeApplyRequestService');

function sendServiceError(res, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
  };
  if (statusCode < 500 && error?.details) response.details = error.details;
  return res.status(statusCode).json(response);
}

async function listRequests(req, res) {
  try {
    const result = await databaseUpgradeApplyRequestService.listApplyRequests({
      status: req.query?.status,
      user: req.user,
      session: req.session,
      permissions: req.permissions || [],
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

async function decideRequest(req, res) {
  try {
    const result = await databaseUpgradeApplyRequestService.decideApplyRequest({
      requestId: req.params.requestId,
      body: req.body || {},
      user: req.user,
      session: req.session,
      permissions: req.permissions || [],
      context: authService.getRequestContext(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

module.exports = {
  decideRequest,
  listRequests,
};
