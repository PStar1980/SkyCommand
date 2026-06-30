const temporalService = require('../services/temporalService');

function sendServiceResponse(res, payload = {}) {
  res.json({
    ok: true,
    ...payload,
  });
}

function sendPagedResponse(res, payload = {}) {
  res.json({
    ok: true,
    total: payload.total || 0,
    limit: payload.limit,
    query: payload.query,
    namespace: payload.namespace,
    items: payload.items || [],
  });
}


function parseMaybeJsonQueryPayload(query = {}) {
  const entries = Object.entries(query || {});

  if (entries.length !== 1) {
    return {};
  }

  const [rawKey, rawValue] = entries[0];
  const candidates = [rawKey, rawValue].filter((value) => typeof value === 'string');

  for (const candidate of candidates) {
    const trimmed = candidate.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return {};
      }
    }
  }

  return {};
}

function buildRequestPayload(req) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const query = req.query && typeof req.query === 'object' ? req.query : {};

  return {
    ...parseMaybeJsonQueryPayload(query),
    ...query,
    ...body,
  };
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

  console.error('[SkyServer Temporal API] Request failed:', error);

  res.status(statusCode).json(response);
}

async function getHealth(req, res) {
  try {
    const payload = await temporalService.getHealth();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listWorkflowDefinitions(req, res) {
  try {
    const payload = await temporalService.listWorkflowDefinitions();
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function listWorkflows(req, res) {
  try {
    const payload = await temporalService.listWorkflows(req.query || {});
    sendPagedResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function getWorkflow(req, res) {
  try {
    const payload = await temporalService.getWorkflow({
      workflowId: req.params.workflowId,
      runId: req.query.runId,
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}


async function startWorkflowFromDefinition(req, res) {
  try {
    const payload = await temporalService.startWorkflowFromDefinition({
      workflowCode: req.params.workflowCode,
      body: buildRequestPayload(req),
    });

    res.status(202).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function startFredIngestionWorkflow(req, res) {
  try {
    const payload = await temporalService.startFredIngestionWorkflow(buildRequestPayload(req));

    res.status(202).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function cancelWorkflow(req, res) {
  try {
    const payload = await temporalService.cancelWorkflow({
      workflowId: req.params.workflowId,
      runId: req.body?.runId || req.query.runId,
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

async function terminateWorkflow(req, res) {
  try {
    const payload = await temporalService.terminateWorkflow({
      workflowId: req.params.workflowId,
      runId: req.body?.runId || req.query.runId,
      reason: req.body?.reason,
    });
    sendServiceResponse(res, payload);
  } catch (error) {
    sendServiceError(res, error);
  }
}

module.exports = {
  cancelWorkflow,
  getHealth,
  getWorkflow,
  listWorkflowDefinitions,
  listWorkflows,
  startFredIngestionWorkflow,
  startWorkflowFromDefinition,
  terminateWorkflow,
};
