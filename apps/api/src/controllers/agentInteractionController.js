const agentInteractionService = require('../services/agentInteractionService');

function sendError(res, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
    code: error?.code || (statusCode >= 500 ? 'AGENT_INTERACTION_INTERNAL_ERROR' : 'AGENT_INTERACTION_REQUEST_INVALID'),
  };
  if (statusCode < 500 && error?.details) response.details = error.details;
  res.status(statusCode).json(response);
}

function handler(callback, statusCode = 200) {
  return async (req, res, next) => {
    try {
      const payload = await callback(req, res);
      if (res.headersSent) return;
      res.status(statusCode).json({ ok: true, ...payload });
    } catch (error) {
      if (res.headersSent) return next(error);
      sendError(res, error);
    }
  };
}

module.exports = {
  list: handler((req) => agentInteractionService.listAgentInteractions(req, req.query)),
  detail: handler((req) => agentInteractionService.getInteractionForRequest(req, req.params.interactionId, false).then((interaction) => ({ interaction }))),
  decide: handler((req) => agentInteractionService.submitAgentInteractionDecision(req, req.params.interactionId, req.body)),
};
