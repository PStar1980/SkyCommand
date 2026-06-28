const { randomUUID } = require('crypto');

const { Connection, Client } = require('@temporalio/client');

const {
  getTemporalConfig,
  parsePositiveInteger,
} = require('../../../../packages/temporal/src/config');

const DEFAULT_FRED_ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_FRED_ACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FRED_CONCURRENCY = 3;
const MAX_FRED_CONCURRENCY = 10;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

const WORKFLOW_DEFINITIONS = [
  {
    workflowType: 'fredIngestionWorkflow',
    workflowCode: 'fred-ingestion',
    displayName: 'FRED Macro Ingestion',
    description:
      'Runs Temporal-backed FRED macro ingestion at the indicator level with configurable batching/concurrency.',
    taskQueueConfigKey: 'TEMPORAL_TASK_QUEUE',
    defaultConcurrency: DEFAULT_FRED_CONCURRENCY,
    maxConcurrency: MAX_FRED_CONCURRENCY,
    allowedParameters: [
      {
        name: 'indicators',
        type: 'string[]',
        required: false,
        description:
          'Optional list of FRED indicator codes. Leave blank to run the full configured FRED indicator set.',
      },
      {
        name: 'concurrency',
        type: 'number',
        required: false,
        defaultValue: DEFAULT_FRED_CONCURRENCY,
        maxValue: MAX_FRED_CONCURRENCY,
        description: 'Maximum number of indicator activities to run in each workflow batch.',
      },
      {
        name: 'timeoutMs',
        type: 'number',
        required: false,
        defaultValue: DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
        maxValue: MAX_FRED_ACTIVITY_TIMEOUT_MS,
        description: 'Activity timeout in milliseconds for legacy compatibility and future long-running jobs.',
      },
      {
        name: 'runSource',
        type: 'string',
        required: false,
        defaultValue: 'api_manual',
        description: 'Source tag written into the workflow input for auditing and future run attribution.',
      },
    ],
  },
];

class ServiceError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function normalizeIndicatorCode(value) {
  const code = String(value || '').trim().toUpperCase();

  if (!code) {
    return null;
  }

  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new ServiceError('Invalid FRED indicator code.', 400, {
      indicator: value,
      expectedPattern: 'A-Z, 0-9, underscore only',
    });
  }

  return code;
}

function normalizeIndicatorCodes(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim());
  const seen = new Set();
  const indicators = [];

  for (const rawValue of rawValues) {
    const code = normalizeIndicatorCode(rawValue);

    if (code && !seen.has(code)) {
      seen.add(code);
      indicators.push(code);
    }
  }

  return indicators;
}

function getFredConcurrency(value) {
  return parsePositiveInteger(value, DEFAULT_FRED_CONCURRENCY, MAX_FRED_CONCURRENCY);
}

function getFredTimeoutMs(value) {
  return parsePositiveInteger(
    value || process.env.TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS,
    DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
    MAX_FRED_ACTIVITY_TIMEOUT_MS,
  );
}

function getListLimit(value) {
  return parsePositiveInteger(value, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
}

function normalizeWorkflowIdPart(value, fallback = 'workflow') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180);

  return normalized || fallback;
}

function buildFredWorkflowId(config, value) {
  if (value) {
    return normalizeWorkflowIdPart(value, `${config.fredWorkflowIdPrefix}-manual`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${config.fredWorkflowIdPrefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function serializeTemporalValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeTemporalValue(item));
  }

  if (value && typeof value === 'object') {
    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue !== 'function') {
        output[key] = serializeTemporalValue(nestedValue);
      }
    }

    return output;
  }

  return value;
}

function getWorkflowStatusLabel(status) {
  if (typeof status === 'string') {
    return status;
  }

  if (status && typeof status === 'object' && status.name) {
    return String(status.name);
  }

  const statusMap = {
    1: 'RUNNING',
    2: 'COMPLETED',
    3: 'FAILED',
    4: 'CANCELED',
    5: 'TERMINATED',
    6: 'CONTINUED_AS_NEW',
    7: 'TIMED_OUT',
  };

  return statusMap[status] || String(status || 'UNKNOWN');
}

function normalizeWorkflowInfo(info) {
  const serialized = serializeTemporalValue(info || {});
  const workflowId = serialized.workflowId || serialized.execution?.workflowId;
  const runId = serialized.runId || serialized.execution?.runId;

  const workflowType =
    serialized.type?.name || serialized.workflowType?.name || serialized.type || serialized.workflowType || serialized.workflowTypeName;

  return {
    workflowId,
    runId,
    workflowType,
    taskQueue: serialized.taskQueue,
    status: getWorkflowStatusLabel(serialized.status),
    startTime: serialized.startTime,
    executionTime: serialized.executionTime,
    closeTime: serialized.closeTime,
    historyLength: serialized.historyLength,
    raw: serialized,
  };
}

function getWorkflowListQuery(query = {}) {
  if (query.query) {
    return String(query.query).trim();
  }

  const clauses = [];
  const workflowType = String(query.workflowType || query.type || 'fredIngestionWorkflow').trim();
  const status = String(query.status || '').trim();

  if (workflowType) {
    clauses.push(`WorkflowType="${workflowType.replace(/"/g, '')}"`);
  }

  if (status) {
    clauses.push(`ExecutionStatus="${status.replace(/"/g, '')}"`);
  }

  return clauses.join(' AND ');
}

async function createTemporalClient() {
  const config = getTemporalConfig();
  const connection = await Connection.connect({
    address: config.address,
  });
  const client = new Client({
    connection,
    namespace: config.namespace,
  });

  return {
    config,
    connection,
    client,
  };
}

async function getHealth() {
  const { config, connection } = await createTemporalClient();

  await connection.workflowService.getSystemInfo({});

  return {
    service: 'Temporal',
    address: config.address,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    timestamp: new Date().toISOString(),
  };
}

async function listWorkflowDefinitions() {
  const config = getTemporalConfig();

  return {
    address: config.address,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    items: WORKFLOW_DEFINITIONS,
  };
}

async function startFredIngestionWorkflow(body = {}) {
  const { config, client } = await createTemporalClient();
  const workflowId = buildFredWorkflowId(config, body.workflowId);
  const indicators = normalizeIndicatorCodes(body.indicators);
  const concurrency = getFredConcurrency(body.concurrency || body.batchSize);
  const timeoutMs = getFredTimeoutMs(body.timeoutMs);
  const runSource = String(body.runSource || 'api_manual').trim() || 'api_manual';

  const input = {
    workflowId,
    runSource,
    timeoutMs,
    indicators,
    concurrency,
  };

  const handle = await client.workflow.start('fredIngestionWorkflow', {
    taskQueue: config.taskQueue,
    workflowId,
    args: [input],
  });

  return {
    workflow: {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      workflowType: 'fredIngestionWorkflow',
      taskQueue: config.taskQueue,
      namespace: config.namespace,
      startedAt: new Date().toISOString(),
    },
    input,
  };
}

async function listWorkflows(query = {}) {
  const { client, config } = await createTemporalClient();
  const limit = getListLimit(query.limit);
  const temporalQuery = getWorkflowListQuery(query);
  const items = [];

  for await (const workflowInfo of client.workflow.list({
    query: temporalQuery,
    pageSize: Math.min(limit, 50),
  })) {
    items.push(normalizeWorkflowInfo(workflowInfo));

    if (items.length >= limit) {
      break;
    }
  }

  return {
    namespace: config.namespace,
    query: temporalQuery,
    total: items.length,
    limit,
    items,
  };
}

async function getWorkflow({ workflowId, runId } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);
  const description = await handle.describe();

  return {
    namespace: config.namespace,
    workflow: normalizeWorkflowInfo({
      workflowId,
      runId,
      ...description,
    }),
  };
}

async function cancelWorkflow({ workflowId, runId } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  await handle.cancel();

  return {
    namespace: config.namespace,
    workflowId,
    runId: runId || null,
    requestedAt: new Date().toISOString(),
    action: 'cancel',
  };
}

async function terminateWorkflow({ workflowId, runId, reason } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  await handle.terminate(reason || 'Terminated from SkyServer Temporal API.');

  return {
    namespace: config.namespace,
    workflowId,
    runId: runId || null,
    requestedAt: new Date().toISOString(),
    action: 'terminate',
    reason: reason || 'Terminated from SkyServer Temporal API.',
  };
}

module.exports = {
  cancelWorkflow,
  getHealth,
  getWorkflow,
  listWorkflowDefinitions,
  listWorkflows,
  startFredIngestionWorkflow,
  terminateWorkflow,
};
