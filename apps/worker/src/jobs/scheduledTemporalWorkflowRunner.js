const temporalService = require('../../../api/src/services/temporalService');

const DEFAULT_WORKFLOW_CODE = 'fred-ingestion';

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function parseIndicators(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeOptionalString(item).toUpperCase())
      .filter(Boolean);
  }

  const text = normalizeOptionalString(value);

  if (!text) {
    return [];
  }

  return text
    .split(/[\s,]+/)
    .map((item) => normalizeOptionalString(item).toUpperCase())
    .filter(Boolean);
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (!Array.isArray(value) && typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(String(value));

    if (Array.isArray(parsed) || !parsed || typeof parsed !== 'object') {
      throw new Error(`${label} must be a JSON object.`);
    }

    return parsed;
  } catch (error) {
    throw new Error(`${label} must be valid JSON object text. ${error.message}`);
  }
}

function getParameterValue(parameters, ...names) {
  for (const name of names) {
    if (parameters && Object.prototype.hasOwnProperty.call(parameters, name)) {
      return parameters[name];
    }
  }

  return undefined;
}

function buildScheduledWorkflowStart({ schedule, scheduleRun, workerNode } = {}) {
  const parameters = schedule.parameters || {};
  const workflowCode =
    normalizeOptionalString(getParameterValue(parameters, 'workflowCode', 'workflow_code')) ||
    DEFAULT_WORKFLOW_CODE;
  const workflowId = normalizeOptionalString(getParameterValue(parameters, 'workflowId', 'workflow_id'));
  const indicators = parseIndicators(getParameterValue(parameters, 'indicators', 'indicatorCodes'));
  const concurrency = parseInteger(getParameterValue(parameters, 'concurrency', 'batchSize'));
  const timeoutMs = parseInteger(getParameterValue(parameters, 'timeoutMs', 'timeout_ms'));
  const extraInput = parseJsonObject(getParameterValue(parameters, 'inputJson', 'input_json'), 'inputJson');

  const body = {
    ...extraInput,
    runSource: 'scheduler',
    schedulerContext: {
      scheduleId: schedule.scheduleId,
      scheduleCode: schedule.scheduleCode,
      scheduleName: schedule.scheduleName,
      scheduleRunId: scheduleRun.scheduleRunId,
      workerNodeId: workerNode?.workerNodeId || null,
      workerNodeName: workerNode?.nodeName || null,
      queuedAt: scheduleRun.queuedAt,
      startedAt: scheduleRun.startedAt,
    },
  };

  if (workflowId) {
    body.workflowId = workflowId;
  }

  if (indicators.length > 0) {
    body.indicators = indicators;
  }

  if (concurrency !== null) {
    body.concurrency = concurrency;
  }

  if (timeoutMs !== null) {
    body.timeoutMs = timeoutMs;
  }

  return {
    workflowCode,
    body,
  };
}

async function runScheduledTemporalWorkflow({ schedule, scheduleRun, workerNode } = {}) {
  const startRequest = buildScheduledWorkflowStart({ schedule, scheduleRun, workerNode });

  console.log(
    `[SkyServer Worker] Starting Temporal workflow ${startRequest.workflowCode} from schedule ${schedule.scheduleCode}.`,
  );

  const result = await temporalService.startWorkflowFromDefinition({
    workflowCode: startRequest.workflowCode,
    body: startRequest.body,
    actor: null,
    context: {
      ipAddress: null,
      userAgent: `SkyServer Worker scheduler (${workerNode?.nodeName || 'unknown-node'})`,
    },
  });

  const workflow = result.workflow || {};
  const definition = result.definition || {};

  return {
    status: 'SUCCESS',
    executionId: null,
    exitCode: 0,
    durationMs: null,
    summary: `Started Temporal workflow ${workflow.workflowId || startRequest.workflowCode}.`,
    workflow,
    definition,
    input: result.input || startRequest.body,
    runRecord: result.runRecord || workflow.skyserverRecord || null,
  };
}

module.exports = {
  buildScheduledWorkflowStart,
  runScheduledTemporalWorkflow,
};
