const temporalService = require('../services/temporalService');
const authService = require('../services/authService');

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

function getActionContext(req) {
  return {
    actor: req.user,
    context: authService.getRequestContext(req),
  };
}

function getAuditErrorMessage(error) {
  return String(error?.message || 'Temporal action failed.').slice(0, 1000);
}

async function recordTemporalAudit(
  req,
  { eventType, action, success, message, resourceId = null, metadata = {} } = {},
) {
  const context = authService.getRequestContext(req);

  try {
    await authService.recordAuditEvent({
      appCode: req.session?.appCode,
      userId: req.user?.userId || null,
      eventType,
      resourceType: 'temporal_workflow',
      resourceId,
      action,
      success,
      message,
      metadata: {
        route: req.originalUrl,
        method: req.method,
        ...metadata,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch (auditError) {
    console.error(
      `[SkyCommand Temporal API] Failed to record ${eventType || action || 'Temporal'} audit event:`,
      auditError,
    );
  }
}

function getStartedWorkflowAuditDetails(payload = {}, fallbackWorkflowCode = null) {
  const workflow = payload.workflow || {};
  const definition = payload.definition || {};

  return {
    resourceId: workflow.workflowId || fallbackWorkflowCode || null,
    metadata: {
      workflowCode:
        definition.workflowCode || workflow.workflowCode || fallbackWorkflowCode || null,
      workflowType: definition.workflowType || workflow.workflowType || null,
      workflowId: workflow.workflowId || null,
      runId: workflow.runId || null,
      namespace: workflow.namespace || null,
      taskQueue: workflow.taskQueue || null,
    },
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

  console.error('[SkyCommand Temporal API] Request failed:', error);

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

async function listWorkflowRunRecords(req, res) {
  try {
    const payload = await temporalService.listWorkflowRunRecords(req.query || {});
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
  const workflowCode = req.params.workflowCode;

  try {
    const payload = await temporalService.startWorkflowFromDefinition({
      workflowCode,
      body: buildRequestPayload(req),
      ...getActionContext(req),
    });
    const auditDetails = getStartedWorkflowAuditDetails(payload, workflowCode);

    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_STARTED',
      action: 'start_temporal_workflow',
      success: true,
      message: `Started Temporal workflow ${auditDetails.metadata.workflowCode || workflowCode}.`,
      ...auditDetails,
    });

    res.status(202).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_START_FAILED',
      action: 'start_temporal_workflow',
      success: false,
      message: `Failed to start Temporal workflow ${workflowCode}: ${getAuditErrorMessage(error)}`,
      resourceId: workflowCode,
      metadata: { workflowCode, statusCode: error.statusCode || 500 },
    });
    sendServiceError(res, error);
  }
}

async function startFredIngestionWorkflow(req, res) {
  const workflowCode = 'fred-ingestion';

  try {
    const payload = await temporalService.startFredIngestionWorkflow(
      buildRequestPayload(req),
      null,
      getActionContext(req),
    );
    const auditDetails = getStartedWorkflowAuditDetails(payload, workflowCode);

    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_STARTED',
      action: 'start_temporal_workflow',
      success: true,
      message: `Started Temporal workflow ${auditDetails.metadata.workflowCode || workflowCode}.`,
      ...auditDetails,
    });

    res.status(202).json({
      ok: true,
      ...payload,
    });
  } catch (error) {
    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_START_FAILED',
      action: 'start_temporal_workflow',
      success: false,
      message: `Failed to start Temporal workflow ${workflowCode}: ${getAuditErrorMessage(error)}`,
      resourceId: workflowCode,
      metadata: { workflowCode, statusCode: error.statusCode || 500 },
    });
    sendServiceError(res, error);
  }
}

async function cancelWorkflow(req, res) {
  const workflowId = req.params.workflowId;
  const runId = req.body?.runId || req.query.runId || null;

  try {
    const payload = await temporalService.cancelWorkflow({
      workflowId,
      runId,
      actor: req.user,
    });

    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_CANCEL_REQUESTED',
      action: 'cancel_temporal_workflow',
      success: true,
      message: `Requested cancellation of Temporal workflow ${workflowId}.`,
      resourceId: workflowId,
      metadata: { workflowId, runId, namespace: payload.namespace || null },
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_CANCEL_FAILED',
      action: 'cancel_temporal_workflow',
      success: false,
      message: `Failed to cancel Temporal workflow ${workflowId}: ${getAuditErrorMessage(error)}`,
      resourceId: workflowId,
      metadata: { workflowId, runId, statusCode: error.statusCode || 500 },
    });
    sendServiceError(res, error);
  }
}

async function terminateWorkflow(req, res) {
  const workflowId = req.params.workflowId;
  const runId = req.body?.runId || req.query.runId || null;
  const reason = req.body?.reason;

  try {
    const payload = await temporalService.terminateWorkflow({
      workflowId,
      runId,
      reason,
      actor: req.user,
    });

    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_TERMINATE_REQUESTED',
      action: 'terminate_temporal_workflow',
      success: true,
      message: `Requested termination of Temporal workflow ${workflowId}.`,
      resourceId: workflowId,
      metadata: {
        workflowId,
        runId,
        namespace: payload.namespace || null,
        reason: payload.reason || reason || null,
      },
    });

    sendServiceResponse(res, payload);
  } catch (error) {
    await recordTemporalAudit(req, {
      eventType: 'TEMPORAL_WORKFLOW_TERMINATE_FAILED',
      action: 'terminate_temporal_workflow',
      success: false,
      message: `Failed to terminate Temporal workflow ${workflowId}: ${getAuditErrorMessage(error)}`,
      resourceId: workflowId,
      metadata: { workflowId, runId, statusCode: error.statusCode || 500 },
    });
    sendServiceError(res, error);
  }
}

module.exports = {
  cancelWorkflow,
  getHealth,
  getWorkflow,
  listWorkflowDefinitions,
  listWorkflowRunRecords,
  listWorkflows,
  startFredIngestionWorkflow,
  startWorkflowFromDefinition,
  terminateWorkflow,
};
