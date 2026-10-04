const service = require('../services/agentSessionService');

function handler(callback, status = 200) {
  return async (req, res) => {
    try { res.status(status).json({ ok: true, ...await callback(req) }); }
    catch (error) {
      const statusCode = error.statusCode || 500;
      const details = { retriable: statusCode >= 500, outcomeCertainty: statusCode >= 500 && !error.statusCode ? 'UNKNOWN' : 'NOT_ACCEPTED' };
      for (const key of ['retriable', 'outcomeCertainty', 'sessionId', 'agentRunId', 'admissionRequestId', 'readiness', 'readinessReason', 'denials', 'deniedSurface', 'maxDurationMs']) if (error.details?.[key] !== undefined) details[key] = error.details[key];
      res.status(statusCode).json({ ok: false, error: statusCode >= 500 ? 'The Session operation is unavailable.' : error.message, code: error.code || 'SESSION_INTERNAL_ERROR', details });
    }
  };
}

module.exports = {
  list: handler((req) => service.listAgentSessions(req, req.query)),
  detail: handler((req) => service.getAgentSession(req, req.params.sessionId, req.query)),
  continue: handler((req) => service.continueAgentSession(req, req.params.sessionId, req.body), 202),
  archive: handler((req) => service.archiveAgentSession(req, req.params.sessionId)),
};
