const { randomUUID } = require('crypto');

const { Connection, Client } = require('@temporalio/client');

const { query: dbQuery } = require('../../../../packages/db/src/connection');
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
const DEFAULT_FRED_WORKFLOW_CODE = 'fred-ingestion';

const FALLBACK_WORKFLOW_DEFINITIONS = [
  {
    workflowType: 'fredIngestionWorkflow',
    workflowCode: DEFAULT_FRED_WORKFLOW_CODE,
    displayName: 'FRED Macro Ingestion',
    description:
      'Runs Temporal-backed FRED macro ingestion at the indicator level with configurable batching/concurrency.',
    taskQueueConfigKey: 'TEMPORAL_TASK_QUEUE',
    workflowIdPrefix: 'skyserver-fred-ingestion',
    runSourceDefault: 'api_manual',
    defaultTimeoutMs: DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: MAX_FRED_ACTIVITY_TIMEOUT_MS,
    defaultConcurrency: DEFAULT_FRED_CONCURRENCY,
    maxConcurrency: MAX_FRED_CONCURRENCY,
    startPermissionCode: 'TEMPORAL_WORKFLOW_START',
    cancelPermissionCode: 'TEMPORAL_WORKFLOW_CANCEL',
    terminatePermissionCode: 'TEMPORAL_WORKFLOW_TERMINATE',
    visibleInAdmin: true,
    enabled: true,
    config: {
      source: 'FRED',
      mode: 'indicator_batch',
    },
    parameters: [
      {
        name: 'indicators',
        label: 'Indicators',
        type: 'STRING_ARRAY',
        required: false,
        defaultValue: [],
        placeholder: 'GDP, UNRATE, DGS10 — leave blank for full FRED set',
        helpText:
          'Comma, space, or newline separated. Blank runs every configured FRED indicator.',
        adminVisible: true,
        startFormField: true,
        displayOrder: 10,
        config: { textareaRows: 4 },
      },
      {
        name: 'concurrency',
        label: 'Concurrency',
        type: 'INTEGER',
        required: false,
        defaultValue: DEFAULT_FRED_CONCURRENCY,
        minValue: 1,
        maxValue: MAX_FRED_CONCURRENCY,
        helpText: 'Worker batches up to this many indicator activities at once.',
        adminVisible: true,
        startFormField: true,
        displayOrder: 20,
        config: {},
      },
      {
        name: 'workflowId',
        label: 'Workflow ID override',
        type: 'STRING',
        required: false,
        placeholder: 'Optional; normally auto-generated',
        helpText: 'Optional manual workflow ID. Leave blank unless you need a stable run identifier.',
        adminVisible: true,
        startFormField: true,
        displayOrder: 30,
        config: {},
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

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
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

function buildWorkflowId(prefix, value) {
  const normalizedPrefix = normalizeWorkflowIdPart(prefix, 'skyserver-workflow');

  if (value) {
    return normalizeWorkflowIdPart(value, `${normalizedPrefix}-manual`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${normalizedPrefix}-${timestamp}-${randomUUID().slice(0, 8)}`;
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
  const workflowType = String(query.workflowType || query.type || '').trim();
  const status = String(query.status || '').trim();

  if (workflowType) {
    clauses.push(`WorkflowType="${workflowType.replace(/"/g, '')}"`);
  }

  if (status) {
    clauses.push(`ExecutionStatus="${status.replace(/"/g, '')}"`);
  }

  return clauses.join(' AND ');
}

function normalizeWorkflowDefinitionRow(row, temporalConfig) {
  const definition = camelizeRow(row);
  const parameters = Array.isArray(definition.parameters) ? definition.parameters : [];
  const taskQueue = definition.taskQueueName || temporalConfig.taskQueue;

  return {
    definitionId: definition.definitionId,
    workflowCode: definition.workflowCode,
    workflowType: definition.workflowType,
    displayName: definition.displayName,
    description: definition.description,
    taskQueue,
    taskQueueName: definition.taskQueueName,
    taskQueueConfigKey: definition.taskQueueConfigKey || 'TEMPORAL_TASK_QUEUE',
    workflowIdPrefix: definition.workflowIdPrefix,
    runSourceDefault: definition.runSourceDefault || 'api_manual',
    defaultTimeoutMs: definition.defaultTimeoutMs || DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
    maxTimeoutMs: definition.maxTimeoutMs || MAX_FRED_ACTIVITY_TIMEOUT_MS,
    defaultConcurrency: definition.defaultConcurrency,
    maxConcurrency: definition.maxConcurrency,
    startPermissionCode: definition.startPermissionCode,
    cancelPermissionCode: definition.cancelPermissionCode,
    terminatePermissionCode: definition.terminatePermissionCode,
    visibleInAdmin: definition.visibleInAdmin,
    enabled: definition.enabled,
    config: definition.config || {},
    parameters,
    // Backward-compatible shape used by early Phase 10.3/10.4 callers/docs.
    allowedParameters: parameters.map((parameter) => ({
      name: parameter.name,
      type: parameter.type,
      required: parameter.required,
      defaultValue: parameter.defaultValue,
      maxValue: parameter.maxValue,
      description: parameter.helpText,
    })),
  };
}

function normalizeFallbackDefinition(definition, temporalConfig) {
  return {
    ...definition,
    taskQueue: definition.taskQueue || temporalConfig.taskQueue,
    parameters: definition.parameters || [],
    allowedParameters: definition.allowedParameters ||
      (definition.parameters || []).map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
        required: parameter.required,
        defaultValue: parameter.defaultValue,
        maxValue: parameter.maxValue,
        description: parameter.helpText,
      })),
  };
}

function isMissingTemplateTableError(error) {
  return error?.code === '42P01' || /temporal_workflow_definitions/i.test(error?.message || '');
}

async function getDatabaseWorkflowDefinitions({ enabledOnly = true, visibleOnly = false } = {}) {
  const temporalConfig = getTemporalConfig();
  const clauses = [];
  const values = [];

  if (enabledOnly) {
    clauses.push('enabled = TRUE');
  }

  if (visibleOnly) {
    clauses.push('visible_in_admin = TRUE');
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    const result = await dbQuery(
      `
        SELECT *
        FROM worker.vw_temporal_workflow_definitions
        ${whereClause}
        ORDER BY display_name, workflow_code
      `,
      values,
    );

    const definitions = result.rows.map((row) => normalizeWorkflowDefinitionRow(row, temporalConfig));

    if (definitions.length > 0) {
      return definitions;
    }
  } catch (error) {
    if (!isMissingTemplateTableError(error)) {
      throw error;
    }
  }

  return FALLBACK_WORKFLOW_DEFINITIONS.map((definition) =>
    normalizeFallbackDefinition(definition, temporalConfig),
  );
}

async function getWorkflowDefinition(workflowCode = DEFAULT_FRED_WORKFLOW_CODE) {
  const normalizedWorkflowCode = String(workflowCode || DEFAULT_FRED_WORKFLOW_CODE).trim();
  const definitions = await getDatabaseWorkflowDefinitions({ enabledOnly: true });
  const definition = definitions.find((item) => item.workflowCode === normalizedWorkflowCode);

  if (!definition) {
    throw new ServiceError('Temporal workflow template is not approved or enabled.', 404, {
      workflowCode: normalizedWorkflowCode,
    });
  }

  return definition;
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
  const items = await getDatabaseWorkflowDefinitions({ enabledOnly: true, visibleOnly: true });

  return {
    address: config.address,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    source: items[0]?.definitionId ? 'database' : 'fallback',
    items,
  };
}

function getFredConcurrency(value, definition) {
  return parsePositiveInteger(
    value,
    definition.defaultConcurrency || DEFAULT_FRED_CONCURRENCY,
    definition.maxConcurrency || MAX_FRED_CONCURRENCY,
  );
}

function getFredTimeoutMs(value, definition) {
  return parsePositiveInteger(
    value || process.env.TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS,
    definition.defaultTimeoutMs || DEFAULT_FRED_ACTIVITY_TIMEOUT_MS,
    definition.maxTimeoutMs || MAX_FRED_ACTIVITY_TIMEOUT_MS,
  );
}

async function startFredIngestionWorkflow(body = {}, providedDefinition = null) {
  const definition = providedDefinition || (await getWorkflowDefinition(DEFAULT_FRED_WORKFLOW_CODE));

  if (definition.workflowType !== 'fredIngestionWorkflow') {
    throw new ServiceError('Workflow template is not backed by fredIngestionWorkflow.', 500, {
      workflowCode: definition.workflowCode,
      workflowType: definition.workflowType,
    });
  }

  const { config, client } = await createTemporalClient();
  const workflowId = buildWorkflowId(definition.workflowIdPrefix || config.fredWorkflowIdPrefix, body.workflowId);
  const indicators = normalizeIndicatorCodes(body.indicators);
  const concurrency = getFredConcurrency(body.concurrency || body.batchSize, definition);
  const timeoutMs = getFredTimeoutMs(body.timeoutMs, definition);
  const runSource =
    String(body.runSource || definition.runSourceDefault || 'api_manual').trim() || 'api_manual';
  const taskQueue = definition.taskQueue || config.taskQueue;

  const input = {
    workflowId,
    workflowCode: definition.workflowCode,
    runSource,
    timeoutMs,
    indicators,
    concurrency,
  };

  const handle = await client.workflow.start(definition.workflowType, {
    taskQueue,
    workflowId,
    args: [input],
  });

  return {
    workflow: {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      workflowCode: definition.workflowCode,
      workflowType: definition.workflowType,
      taskQueue,
      namespace: config.namespace,
      startedAt: new Date().toISOString(),
    },
    definition: {
      workflowCode: definition.workflowCode,
      workflowType: definition.workflowType,
      displayName: definition.displayName,
    },
    input,
  };
}

async function startWorkflowFromDefinition({ workflowCode, body = {} } = {}) {
  const definition = await getWorkflowDefinition(workflowCode);

  if (definition.workflowCode === DEFAULT_FRED_WORKFLOW_CODE) {
    return startFredIngestionWorkflow(body, definition);
  }

  throw new ServiceError('Workflow template does not have a start adapter yet.', 501, {
    workflowCode: definition.workflowCode,
    workflowType: definition.workflowType,
  });
}

async function listWorkflows(query = {}) {
  const { client, config } = await createTemporalClient();
  const limit = getListLimit(query.limit);
  const listQuery = { ...query };

  if (!listQuery.query && !listQuery.workflowType && !listQuery.type) {
    try {
      const definition = await getWorkflowDefinition(listQuery.workflowCode || DEFAULT_FRED_WORKFLOW_CODE);
      listQuery.workflowType = definition.workflowType;
    } catch (error) {
      listQuery.workflowType = 'fredIngestionWorkflow';
    }
  }

  const temporalQuery = getWorkflowListQuery(listQuery);
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
  startWorkflowFromDefinition,
  terminateWorkflow,
};
