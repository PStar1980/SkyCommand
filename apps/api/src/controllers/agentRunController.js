const agentExecutionService = require('../services/agentExecutionService');

function sendError(res, error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const response = {
    ok: false,
    error: statusCode >= 500 ? 'Internal server error.' : error.message,
    code: error?.code || (statusCode >= 500 ? 'AGENT_RUN_INTERNAL_ERROR' : 'AGENT_RUN_REQUEST_INVALID'),
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
  admit: handler((req) => agentExecutionService.admitAgentRun(req, req.body), 202),
  list: handler((req) => agentExecutionService.listAgentRuns(req, req.query)),
  detail: handler((req) => agentExecutionService.getAgentRun(req, req.params.runId)),
  events: handler((req) => agentExecutionService.getAgentRunEvents(req, req.params.runId)),
  result: handler((req) => agentExecutionService.getAgentRunResult(req, req.params.runId)),
  cancel: handler((req) => agentExecutionService.cancelAgentRun(req, req.params.runId)),
  stopScope: handler((req) => agentExecutionService.stopExecutionScope(req, req.params.scopeId)),
};
