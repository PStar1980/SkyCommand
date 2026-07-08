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
const RUN_RECORD_TABLE_PATTERN = /temporal_workflow_run_records|vw_temporal_workflow_run_records/i;
const RUN_RECORD_STATUS_VALUES = new Set([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'CANCELLED',
  'TERMINATED',
  'CONTINUED_AS_NEW',
  'TIMED_OUT',
  'UNKNOWN',
  'CANCEL_REQUESTED',
  'TERMINATE_REQUESTED',
]);

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

function isMissingRunRecordTableError(error) {
  return error?.code === '42P01' || RUN_RECORD_TABLE_PATTERN.test(error?.message || '');
}

function getActorUserId(actor) {
  return actor?.userId || actor?.user_id || null;
}

function getSafeJson(value, fallback = {}) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function normalizeRequestContext(context = {}) {
  return {
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  };
}

function normalizeRunRecordStatus(value) {
  const normalized = getWorkflowStatusLabel(value).toUpperCase();

  if (RUN_RECORD_STATUS_VALUES.has(normalized)) {
    return normalized;
  }

  return 'UNKNOWN';
}

function normalizeStatusFilter(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (!normalized) {
    return '';
  }

  return RUN_RECORD_STATUS_VALUES.has(normalized) ? normalized : normalized.replace(/[^A-Z_]/g, '');
}

function normalizeRunRecordRow(row) {
  const record = camelizeRow(row);

  return {
    runRecordId: record.runRecordId,
    definitionId: record.definitionId,
    workflowCode: record.workflowCode,
    workflowType: record.workflowType,
    displayName: record.displayName,
    workflowId: record.workflowId,
    runId: record.temporalRunId,
    temporalRunId: record.temporalRunId,
    namespace: record.namespace,
    taskQueue: record.taskQueue,
    runSource: record.runSource,
    status: record.status,
    launchInput: record.launchInput || {},
    requestContext: record.requestContext || {},
    metadata: record.metadata || {},
    historyLength: record.historyLength,
    startTime: record.temporalStartedAt || record.createdAt,
    executionTime: record.temporalExecutionAt,
    closeTime: record.temporalClosedAt,
    lastSeenInTemporalAt: record.lastSeenInTemporalAt,
    startedByUserId: record.startedByUserId,
    startedByEmail: record.startedByEmail,
    startedByDisplayName: record.startedByDisplayName,
    cancelRequestedAt: record.cancelRequestedAt,
    cancelRequestedByUserId: record.cancelRequestedByUserId,
    cancelRequestedByEmail: record.cancelRequestedByEmail,
    cancelRequestedByDisplayName: record.cancelRequestedByDisplayName,
    terminateRequestedAt: record.terminateRequestedAt,
    terminateRequestedByUserId: record.terminateRequestedByUserId,
    terminateRequestedByEmail: record.terminateRequestedByEmail,
    terminateRequestedByDisplayName: record.terminateRequestedByDisplayName,
    terminateReason: record.terminateReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildRunRecordKey({ namespace, workflowId, runId, temporalRunId } = {}) {
  return `${namespace || ''}:${workflowId || ''}:${runId || temporalRunId || ''}`;
}

function runRecordToWorkflowInfo(record, { missingFromTemporal = true } = {}) {
  return {
    workflowId: record.workflowId,
    runId: record.runId || record.temporalRunId,
    workflowCode: record.workflowCode,
    workflowType: record.workflowType,
    taskQueue: record.taskQueue,
    status: record.status || 'UNKNOWN',
    startTime: record.startTime || record.createdAt,
    executionTime: record.executionTime,
    closeTime: record.closeTime,
    historyLength: record.historyLength,
    source: missingFromTemporal ? 'skyserver_db' : 'temporal',
    missingFromTemporal,
    skyserverRecord: record,
    raw: {
      source: 'skyserver_db',
      missingFromTemporal,
      record,
    },
  };
}

function getWorkflowTimestamp(workflow, key) {
  const value = workflow?.[key];

  if (!value) {
    return null;
  }

  return value;
}

function buildRunRecordMetadata({ input = {}, workflow = null, source = 'api' } = {}) {
  return {
    source,
    selectedIndicators: Array.isArray(input.indicators) ? input.indicators : [],
    selectedIndicatorCount: Array.isArray(input.indicators) ? input.indicators.length : 0,
    concurrency: input.concurrency || null,
    timeoutMs: input.timeoutMs || null,
    historyLength: workflow?.historyLength || null,
    schedulerContext: input.schedulerContext || null,
  };
}

async function upsertWorkflowRunRecord({
  definition = {},
  config = {},
  workflow = {},
  input = {},
  taskQueue,
  actor = null,
  context = {},
  status = 'RUNNING',
  metadata = {},
} = {}) {
  if (!workflow.workflowId) {
    return null;
  }

  const normalizedStatus = normalizeRunRecordStatus(status || workflow.status || 'RUNNING');
  const workflowCode = definition.workflowCode || input.workflowCode || workflow.workflowCode || DEFAULT_FRED_WORKFLOW_CODE;
  const workflowType = definition.workflowType || workflow.workflowType;

  if (!workflowType) {
    return null;
  }

  try {
    const result = await dbQuery(
      `
        INSERT INTO worker.temporal_workflow_run_records (
          definition_id,
          workflow_code,
          workflow_type,
          workflow_id,
          temporal_run_id,
          namespace,
          task_queue,
          run_source,
          status,
          launch_input,
          request_context,
          metadata,
          history_length,
          temporal_started_at,
          temporal_execution_at,
          temporal_closed_at,
          last_seen_in_temporal_at,
          started_by_user_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16,
          CURRENT_TIMESTAMP, $17
        )
        ON CONFLICT (namespace, workflow_id, (COALESCE(temporal_run_id, '')))
        DO UPDATE SET
          definition_id = COALESCE(worker.temporal_workflow_run_records.definition_id, EXCLUDED.definition_id),
          workflow_code = EXCLUDED.workflow_code,
          workflow_type = EXCLUDED.workflow_type,
          task_queue = COALESCE(EXCLUDED.task_queue, worker.temporal_workflow_run_records.task_queue),
          run_source = COALESCE(NULLIF(EXCLUDED.run_source, ''), worker.temporal_workflow_run_records.run_source),
          status = EXCLUDED.status,
          launch_input = CASE
            WHEN EXCLUDED.launch_input <> '{}'::jsonb THEN EXCLUDED.launch_input
            ELSE worker.temporal_workflow_run_records.launch_input
          END,
          request_context = CASE
            WHEN EXCLUDED.request_context <> '{}'::jsonb THEN EXCLUDED.request_context
            ELSE worker.temporal_workflow_run_records.request_context
          END,
          metadata = worker.temporal_workflow_run_records.metadata || EXCLUDED.metadata,
          history_length = COALESCE(EXCLUDED.history_length, worker.temporal_workflow_run_records.history_length),
          temporal_started_at = COALESCE(EXCLUDED.temporal_started_at, worker.temporal_workflow_run_records.temporal_started_at),
          temporal_execution_at = COALESCE(EXCLUDED.temporal_execution_at, worker.temporal_workflow_run_records.temporal_execution_at),
          temporal_closed_at = COALESCE(EXCLUDED.temporal_closed_at, worker.temporal_workflow_run_records.temporal_closed_at),
          last_seen_in_temporal_at = CURRENT_TIMESTAMP,
          started_by_user_id = COALESCE(worker.temporal_workflow_run_records.started_by_user_id, EXCLUDED.started_by_user_id)
        RETURNING *
      `,
      [
        definition.definitionId || null,
        workflowCode,
        workflowType,
        workflow.workflowId,
        workflow.runId || workflow.temporalRunId || null,
        workflow.namespace || config.namespace || 'default',
        taskQueue || workflow.taskQueue || definition.taskQueue || config.taskQueue || null,
        input.runSource || definition.runSourceDefault || workflow.runSource || 'api_manual',
        normalizedStatus,
        JSON.stringify(getSafeJson(input)),
        JSON.stringify(normalizeRequestContext(context)),
        JSON.stringify(getSafeJson(metadata)),
        workflow.historyLength || null,
        getWorkflowTimestamp(workflow, 'startTime') || new Date().toISOString(),
        getWorkflowTimestamp(workflow, 'executionTime'),
        getWorkflowTimestamp(workflow, 'closeTime'),
        getActorUserId(actor),
      ],
    );

    return normalizeRunRecordRow(result.rows[0]);
  } catch (error) {
    if (isMissingRunRecordTableError(error)) {
      return null;
    }

    console.warn('[SkyServer Temporal API] Failed to persist workflow run record:', error.message);
    return null;
  }
}

async function listWorkflowRunRecords(query = {}) {
  const limit = getListLimit(query.limit);
  const clauses = [];
  const values = [];
  const workflowCode = String(query.workflowCode || '').trim();
  const workflowType = String(query.workflowType || query.type || '').trim();
  const status = normalizeStatusFilter(query.status);

  if (workflowCode) {
    values.push(workflowCode);
    clauses.push(`workflow_code = $${values.length}`);
  }

  if (workflowType) {
    values.push(workflowType);
    clauses.push(`workflow_type = $${values.length}`);
  }

  if (status) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  try {
    values.push(limit);
    const result = await dbQuery(
      `
        SELECT *
        FROM worker.vw_temporal_workflow_run_records
        ${whereClause}
        ORDER BY COALESCE(temporal_started_at, created_at) DESC, created_at DESC
        LIMIT $${values.length}
      `,
      values,
    );

    const items = result.rows.map(normalizeRunRecordRow);

    return {
      total: items.length,
      limit,
      items,
    };
  } catch (error) {
    if (isMissingRunRecordTableError(error)) {
      return {
        total: 0,
        limit,
        items: [],
      };
    }

    throw error;
  }
}

async function getWorkflowRunRecord({ workflowId, runId } = {}) {
  if (!workflowId) {
    return null;
  }

  try {
    const result = await dbQuery(
      `
        SELECT *
        FROM worker.vw_temporal_workflow_run_records
        WHERE workflow_id = $1
          AND ($2::text IS NULL OR temporal_run_id = $2)
        ORDER BY COALESCE(temporal_started_at, created_at) DESC, created_at DESC
        LIMIT 1
      `,
      [workflowId, runId || null],
    );

    return result.rows[0] ? normalizeRunRecordRow(result.rows[0]) : null;
  } catch (error) {
    if (isMissingRunRecordTableError(error)) {
      return null;
    }

    throw error;
  }
}

function mergeWorkflowItemsWithRunRecords({ items = [], records = [], namespace, limit }) {
  const merged = new Map();
  const recordsByKey = new Map();
  const recordsByWorkflowId = new Map();

  for (const record of records) {
    const key = buildRunRecordKey({
      namespace: record.namespace || namespace,
      workflowId: record.workflowId,
      runId: record.runId || record.temporalRunId,
    });
    recordsByKey.set(key, record);

    if (!recordsByWorkflowId.has(record.workflowId)) {
      recordsByWorkflowId.set(record.workflowId, record);
    }
  }

  for (const item of items) {
    const key = buildRunRecordKey({
      namespace,
      workflowId: item.workflowId,
      runId: item.runId,
    });
    const record = recordsByKey.get(key) || recordsByWorkflowId.get(item.workflowId) || null;

    merged.set(key, {
      ...item,
      workflowCode: item.workflowCode || record?.workflowCode,
      source: 'temporal',
      missingFromTemporal: false,
      skyserverRecord: record,
    });
  }

  for (const record of records) {
    const key = buildRunRecordKey({
      namespace: record.namespace || namespace,
      workflowId: record.workflowId,
      runId: record.runId || record.temporalRunId,
    });

    if (!merged.has(key)) {
      merged.set(key, runRecordToWorkflowInfo(record, { missingFromTemporal: true }));
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftTime = new Date(left.startTime || left.executionTime || left.skyserverRecord?.createdAt || 0).getTime();
      const rightTime = new Date(right.startTime || right.executionTime || right.skyserverRecord?.createdAt || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

async function updateWorkflowRunRecordAction({ workflowId, runId, action, actor = null, reason = null } = {}) {
  if (!workflowId) {
    return null;
  }

  const actionIsTerminate = action === 'terminate';
  const status = actionIsTerminate ? 'TERMINATE_REQUESTED' : 'CANCEL_REQUESTED';
  const timestampColumn = actionIsTerminate ? 'terminate_requested_at' : 'cancel_requested_at';
  const userColumn = actionIsTerminate ? 'terminate_requested_by_user_id' : 'cancel_requested_by_user_id';
  const reasonSql = actionIsTerminate ? ', terminate_reason = $5' : '';
  const values = [workflowId, runId || null, status, getActorUserId(actor)];

  if (actionIsTerminate) {
    values.push(reason || null);
  }

  try {
    const result = await dbQuery(
      `
        UPDATE worker.temporal_workflow_run_records
        SET status = $3,
            ${timestampColumn} = CURRENT_TIMESTAMP,
            ${userColumn} = $4
            ${reasonSql}
        WHERE workflow_id = $1
          AND ($2::text IS NULL OR temporal_run_id = $2)
        RETURNING *
      `,
      values,
    );

    return result.rows[0] ? normalizeRunRecordRow(result.rows[0]) : null;
  } catch (error) {
    if (isMissingRunRecordTableError(error)) {
      return null;
    }

    console.warn('[SkyServer Temporal API] Failed to update workflow action record:', error.message);
    return null;
  }
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

async function startFredIngestionWorkflow(body = {}, providedDefinition = null, actionContext = {}) {
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

  const schedulerContext = getSafeJson(body.schedulerContext, null);
  const input = {
    workflowId,
    workflowCode: definition.workflowCode,
    runSource,
    timeoutMs,
    indicators,
    concurrency,
    ...(schedulerContext ? { schedulerContext } : {}),
  };

  const startedAt = new Date().toISOString();
  const handle = await client.workflow.start(definition.workflowType, {
    taskQueue,
    workflowId,
    args: [input],
  });

  const workflow = {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
    workflowCode: definition.workflowCode,
    workflowType: definition.workflowType,
    taskQueue,
    namespace: config.namespace,
    status: 'RUNNING',
    startTime: startedAt,
    startedAt,
  };

  const runRecord = await upsertWorkflowRunRecord({
    definition,
    config,
    workflow,
    input,
    taskQueue,
    actor: actionContext.actor,
    context: actionContext.context,
    status: 'RUNNING',
    metadata: buildRunRecordMetadata({ input, workflow, source: 'api_start' }),
  });

  return {
    workflow: {
      ...workflow,
      skyserverRecord: runRecord,
      source: 'temporal',
      missingFromTemporal: false,
    },
    definition: {
      workflowCode: definition.workflowCode,
      workflowType: definition.workflowType,
      displayName: definition.displayName,
    },
    input,
    runRecord,
  };
}

async function startSkyserverWorkflowExecutorWorkflow({
  workflowCode,
  workflowRunRecordId,
  input = {},
  actor = null,
  session = null,
  permissions = [],
  context = {},
} = {}) {
  const normalizedWorkflowCode = String(workflowCode || '').trim();

  if (!normalizedWorkflowCode) {
    throw new ServiceError('workflowCode is required.', 400);
  }

  if (!workflowRunRecordId) {
    throw new ServiceError('workflowRunRecordId is required.', 400);
  }

  const { config, client } = await createTemporalClient();
  const workflowId = buildWorkflowId(
    `skyserver-workflow-${normalizedWorkflowCode}`,
    input.workflowId || input.skyserverWorkflowId,
  );
  const startedAt = new Date().toISOString();
  const workflowInput = serializeTemporalValue({
    workflowCode: normalizedWorkflowCode,
    workflowRunRecordId,
    input: getSafeJson(input),
    user: actor || null,
    session: session || null,
    permissions: Array.isArray(permissions) ? permissions : [],
    context: normalizeRequestContext(context),
    taskQueue: config.taskQueue,
  });

  const handle = await client.workflow.start('skyserverWorkflowExecutorWorkflow', {
    taskQueue: config.taskQueue,
    workflowId,
    args: [workflowInput],
  });

  return {
    workflow: {
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      workflowCode: normalizedWorkflowCode,
      workflowType: 'skyserverWorkflowExecutorWorkflow',
      taskQueue: config.taskQueue,
      namespace: config.namespace,
      status: 'RUNNING',
      startTime: startedAt,
      startedAt,
      source: 'temporal',
      missingFromTemporal: false,
    },
    input: workflowInput,
  };
}

async function startWorkflowFromDefinition({ workflowCode, body = {}, actor = null, context = {} } = {}) {
  const definition = await getWorkflowDefinition(workflowCode);

  if (definition.workflowCode === DEFAULT_FRED_WORKFLOW_CODE) {
    return startFredIngestionWorkflow(body, definition, { actor, context });
  }

  throw new ServiceError('Workflow template does not have a start adapter yet.', 501, {
    workflowCode: definition.workflowCode,
    workflowType: definition.workflowType,
  });
}

const TEMPORAL_EVENT_TYPE_MAP = {
  1: 'WORKFLOW_EXECUTION_STARTED',
  2: 'WORKFLOW_EXECUTION_COMPLETED',
  3: 'WORKFLOW_EXECUTION_FAILED',
  4: 'WORKFLOW_EXECUTION_TIMED_OUT',
  5: 'WORKFLOW_TASK_SCHEDULED',
  6: 'WORKFLOW_TASK_STARTED',
  7: 'WORKFLOW_TASK_COMPLETED',
  8: 'WORKFLOW_TASK_TIMED_OUT',
  9: 'WORKFLOW_TASK_FAILED',
  10: 'ACTIVITY_TASK_SCHEDULED',
  11: 'ACTIVITY_TASK_STARTED',
  12: 'ACTIVITY_TASK_COMPLETED',
  13: 'ACTIVITY_TASK_FAILED',
  14: 'ACTIVITY_TASK_TIMED_OUT',
  15: 'ACTIVITY_TASK_CANCEL_REQUESTED',
  16: 'ACTIVITY_TASK_CANCELED',
  17: 'TIMER_STARTED',
  18: 'TIMER_FIRED',
  19: 'TIMER_CANCELED',
  20: 'WORKFLOW_EXECUTION_CANCELED',
  23: 'START_CHILD_WORKFLOW_EXECUTION_INITIATED',
  24: 'START_CHILD_WORKFLOW_EXECUTION_FAILED',
  25: 'CHILD_WORKFLOW_EXECUTION_STARTED',
  26: 'CHILD_WORKFLOW_EXECUTION_COMPLETED',
  27: 'CHILD_WORKFLOW_EXECUTION_FAILED',
  28: 'CHILD_WORKFLOW_EXECUTION_CANCELED',
  29: 'CHILD_WORKFLOW_EXECUTION_TIMED_OUT',
  30: 'CHILD_WORKFLOW_EXECUTION_TERMINATED',
  33: 'MARKER_RECORDED',
  34: 'WORKFLOW_EXECUTION_SIGNALED',
  35: 'WORKFLOW_EXECUTION_TERMINATED',
  36: 'WORKFLOW_EXECUTION_CONTINUED_AS_NEW',
};

function buildTemporalUiWorkflowUrl({ baseUrl, namespace, workflowId, runId } = {}) {
  if (!baseUrl || !workflowId) {
    return null;
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');
  const encodedNamespace = encodeURIComponent(namespace || 'default');
  const encodedWorkflowId = encodeURIComponent(workflowId);
  const encodedRunId = runId ? `/${encodeURIComponent(runId)}` : '';

  return `${normalizedBaseUrl}/namespaces/${encodedNamespace}/workflows/${encodedWorkflowId}${encodedRunId}`;
}

function serializeTemporalTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    if (typeof value.toISOString === 'function') {
      return value.toISOString();
    }

    const seconds = Number(value.seconds || value.secondsLow || 0);
    const nanos = Number(value.nanos || 0);

    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date((seconds * 1000) + Math.floor(nanos / 1000000)).toISOString();
    }
  }

  return null;
}

function normalizeTemporalEventType(event = {}) {
  const rawType = event.eventType || event.event_type;

  if (typeof rawType === 'string') {
    return rawType.replace(/^EVENT_TYPE_/, '');
  }

  if (typeof rawType === 'number') {
    return TEMPORAL_EVENT_TYPE_MAP[rawType] || `EVENT_TYPE_${rawType}`;
  }

  const attributeKey = Object.keys(event).find((key) => key.endsWith('EventAttributes'));

  if (attributeKey) {
    return attributeKey
      .replace(/EventAttributes$/, '')
      .replace(/([A-Z])/g, '_$1')
      .replace(/^_/, '')
      .toUpperCase();
  }

  return 'UNKNOWN';
}

function getTemporalEventAttributes(event = {}) {
  const attributeKey = Object.keys(event).find((key) => key.endsWith('EventAttributes'));
  return attributeKey ? event[attributeKey] || {} : {};
}

function getTemporalFailureMessage(failure = {}) {
  if (!failure || typeof failure !== 'object') {
    return null;
  }

  const messages = [];
  let current = failure;
  let depth = 0;

  while (current && typeof current === 'object' && depth < 4) {
    const message = current.message
      || current.applicationFailureInfo?.type
      || current.timeoutFailureInfo?.timeoutType
      || current.canceledFailureInfo?.details
      || null;

    if (message) {
      messages.push(String(message));
    }

    current = current.cause;
    depth += 1;
  }

  return messages.filter(Boolean).join(' → ') || null;
}

function getTemporalEventCategory(type) {
  if (/FAILED|TIMED_OUT|TERMINATED/.test(type)) {
    return 'danger';
  }

  if (/CANCELED|CANCEL_REQUESTED/.test(type)) {
    return 'warning';
  }

  if (/COMPLETED|FIRED|STARTED|SIGNALED/.test(type)) {
    return 'success';
  }

  return 'info';
}

function getTemporalAttributeText(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value.name) {
    return String(value.name);
  }

  if (value.workflowId || value.runId) {
    return [value.workflowId, value.runId].filter(Boolean).join(' / ');
  }

  return null;
}

function getTemporalEventIdentity(attributes = {}) {
  return attributes.activityId
    || attributes.timerId
    || attributes.signalName
    || attributes.workflowExecution?.workflowId
    || attributes.childWorkflowExecution?.workflowId
    || attributes.initiatedEventId
    || null;
}

function getTemporalEventTarget(attributes = {}) {
  return attributes.activityType?.name
    || attributes.activityType
    || attributes.workflowType?.name
    || attributes.workflowType
    || attributes.taskQueue?.name
    || attributes.taskQueue
    || null;
}

function getTemporalEventSummary(event = {}) {
  const type = normalizeTemporalEventType(event);
  const attributes = getTemporalEventAttributes(event);
  const target = getTemporalEventTarget(attributes);
  const identity = getTemporalEventIdentity(attributes);
  const failureMessage = getTemporalFailureMessage(attributes.failure);
  const reason = attributes.reason || attributes.message || null;
  const retryState = attributes.retryState || attributes.retry_state || null;

  if (failureMessage) {
    return `${type}${target ? ` · ${target}` : ''}${identity ? ` (${identity})` : ''}: ${failureMessage}${retryState ? ` · retry ${retryState}` : ''}`;
  }

  if (type === 'WORKFLOW_EXECUTION_STARTED') {
    return `Workflow started${target ? ` · ${target}` : ''}${attributes.taskQueue?.name || attributes.taskQueue ? ` on ${getTemporalAttributeText(attributes.taskQueue)}` : ''}.`;
  }

  if (type === 'WORKFLOW_EXECUTION_COMPLETED') {
    return 'Workflow completed successfully.';
  }

  if (type === 'WORKFLOW_EXECUTION_FAILED') {
    return reason ? `Workflow failed: ${reason}` : 'Workflow failed.';
  }

  if (type === 'WORKFLOW_EXECUTION_CANCELED') {
    return reason ? `Workflow canceled: ${reason}` : 'Workflow canceled.';
  }

  if (type === 'WORKFLOW_EXECUTION_TERMINATED') {
    return reason ? `Workflow terminated: ${reason}` : 'Workflow terminated.';
  }

  if (type === 'WORKFLOW_EXECUTION_SIGNALED') {
    return `Signal received${attributes.signalName ? ` · ${attributes.signalName}` : ''}.`;
  }

  if (type === 'ACTIVITY_TASK_SCHEDULED') {
    return `Activity scheduled${target ? ` · ${target}` : ''}${identity ? ` (${identity})` : ''}.`;
  }

  if (type === 'ACTIVITY_TASK_STARTED') {
    return `Activity started${identity ? ` · ${identity}` : ''}${attributes.attempt ? ` · attempt ${attributes.attempt}` : ''}.`;
  }

  if (type === 'ACTIVITY_TASK_COMPLETED') {
    return `Activity completed${identity ? ` · ${identity}` : ''}.`;
  }

  if (type === 'ACTIVITY_TASK_FAILED') {
    return `Activity failed${target ? ` · ${target}` : ''}${identity ? ` (${identity})` : ''}.`;
  }

  if (type === 'ACTIVITY_TASK_TIMED_OUT') {
    return `Activity timed out${identity ? ` · ${identity}` : ''}.`;
  }

  if (type === 'TIMER_STARTED') {
    return `Timer started${identity ? ` · ${identity}` : ''}${attributes.startToFireTimeout ? ` for ${attributes.startToFireTimeout}` : ''}.`;
  }

  if (type === 'TIMER_FIRED') {
    return `Timer fired${identity ? ` · ${identity}` : ''}.`;
  }

  if (type.startsWith('CHILD_WORKFLOW_EXECUTION')) {
    return `${type.replace(/_/g, ' ')}${target ? ` · ${target}` : ''}${identity ? ` (${identity})` : ''}.`;
  }

  if (target) {
    return `${type}: ${target}${identity ? ` (${identity})` : ''}`;
  }

  if (reason) {
    return `${type}: ${reason}`;
  }

  return type;
}

function getTemporalEventDiagnostic(event = {}) {
  const type = normalizeTemporalEventType(event);
  const attributes = getTemporalEventAttributes(event);
  const failureMessage = getTemporalFailureMessage(attributes.failure);
  const target = getTemporalEventTarget(attributes);
  const identity = getTemporalEventIdentity(attributes);

  return {
    eventId: event.eventId ? String(event.eventId) : null,
    eventTime: serializeTemporalTimestamp(event.eventTime),
    eventType: type,
    category: getTemporalEventCategory(type),
    summary: getTemporalEventSummary(event),
    target: getTemporalAttributeText(target),
    identity: getTemporalAttributeText(identity),
    failureMessage,
    retryState: attributes.retryState || attributes.retry_state || null,
    rawAttributeKeys: Object.keys(attributes || {}).sort(),
  };
}

function isNotableTemporalEvent(event = {}) {
  const type = normalizeTemporalEventType(event);
  return /FAILED|TIMED_OUT|CANCELED|CANCEL_REQUESTED|TERMINATED|SIGNALED|CHILD_WORKFLOW|TIMER/.test(type);
}

function summarizeTemporalHistoryEvents(events = []) {
  const eventCounts = {};
  const activityCounts = {
    scheduled: 0,
    started: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    canceled: 0,
  };
  const workflowTaskCounts = {
    scheduled: 0,
    started: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
  };
  const signalCounts = {};
  const issueEvents = [];

  for (const event of events) {
    const type = normalizeTemporalEventType(event);
    const attributes = getTemporalEventAttributes(event);
    eventCounts[type] = (eventCounts[type] || 0) + 1;

    if (type === 'ACTIVITY_TASK_SCHEDULED') {
      activityCounts.scheduled += 1;
    } else if (type === 'ACTIVITY_TASK_STARTED') {
      activityCounts.started += 1;
    } else if (type === 'ACTIVITY_TASK_COMPLETED') {
      activityCounts.completed += 1;
    } else if (type === 'ACTIVITY_TASK_FAILED') {
      activityCounts.failed += 1;
    } else if (type === 'ACTIVITY_TASK_TIMED_OUT') {
      activityCounts.timedOut += 1;
    } else if (type === 'ACTIVITY_TASK_CANCELED') {
      activityCounts.canceled += 1;
    } else if (type === 'WORKFLOW_TASK_SCHEDULED') {
      workflowTaskCounts.scheduled += 1;
    } else if (type === 'WORKFLOW_TASK_STARTED') {
      workflowTaskCounts.started += 1;
    } else if (type === 'WORKFLOW_TASK_COMPLETED') {
      workflowTaskCounts.completed += 1;
    } else if (type === 'WORKFLOW_TASK_FAILED') {
      workflowTaskCounts.failed += 1;
    } else if (type === 'WORKFLOW_TASK_TIMED_OUT') {
      workflowTaskCounts.timedOut += 1;
    } else if (type === 'WORKFLOW_EXECUTION_SIGNALED') {
      const signalName = attributes.signalName || 'UNKNOWN_SIGNAL';
      signalCounts[signalName] = (signalCounts[signalName] || 0) + 1;
    }

    if (/FAILED|TIMED_OUT|CANCELED|TERMINATED/.test(type)) {
      issueEvents.push(getTemporalEventDiagnostic(event));
    }
  }

  const eventDiagnostics = events.map(getTemporalEventDiagnostic);
  const latestEvents = eventDiagnostics.slice(-20);
  const notableEvents = eventDiagnostics.filter((event) => isNotableTemporalEvent({
    eventType: event.eventType,
    eventId: event.eventId,
  })).slice(-20);

  return {
    eventCount: events.length,
    eventCounts,
    activityCounts,
    workflowTaskCounts,
    signalCounts,
    issueSummary: {
      failed: issueEvents.filter((event) => /FAILED/.test(event.eventType)).length,
      timedOut: issueEvents.filter((event) => /TIMED_OUT/.test(event.eventType)).length,
      canceled: issueEvents.filter((event) => /CANCELED/.test(event.eventType)).length,
      terminated: issueEvents.filter((event) => /TERMINATED/.test(event.eventType)).length,
      total: issueEvents.length,
    },
    latestEvents,
    notableEvents,
    issueEvents: issueEvents.slice(-20),
  };
}

function buildTemporalCliCommand({ command, address, namespace, workflowId, runId, reason } = {}) {
  const parts = [
    'temporal',
    'workflow',
    command,
    '--address',
    address || DEFAULT_TEMPORAL_ADDRESS,
    '--namespace',
    namespace || 'default',
    '--workflow-id',
    `"${workflowId}"`,
  ];

  if (runId) {
    parts.push('--run-id', `"${runId}"`);
  }

  if (reason) {
    parts.push('--reason', `"${reason}"`);
  }

  return parts.join(' ');
}

function buildTemporalDiagnostics({ config, workflow = {}, workflowId, runId, history = {} } = {}) {
  const effectiveWorkflowId = workflow.workflowId || workflowId || null;
  const effectiveRunId = workflow.runId || runId || null;

  if (!effectiveWorkflowId) {
    return null;
  }

  const workflowUrl = buildTemporalUiWorkflowUrl({
    baseUrl: config.uiBaseUrl,
    namespace: config.namespace,
    workflowId: effectiveWorkflowId,
    runId: effectiveRunId,
  });
  const historyUrl = workflowUrl ? `${workflowUrl}/history` : null;
  const encodedQuery = encodeURIComponent(`WorkflowId="${effectiveWorkflowId}"`);
  const queryUrl = config.uiBaseUrl
    ? `${String(config.uiBaseUrl).replace(/\/+$/, '')}/namespaces/${encodeURIComponent(config.namespace || 'default')}/workflows?query=${encodedQuery}`
    : null;

  return {
    address: config.address,
    namespace: config.namespace,
    taskQueue: workflow.taskQueue || config.taskQueue,
    workflowId: effectiveWorkflowId,
    runId: effectiveRunId,
    workflowType: workflow.workflowType || null,
    status: workflow.status || null,
    workflowUrl,
    historyUrl,
    queryUrl,
    eventCount: history?.eventCount || workflow.historyLength || null,
    cliCommands: {
      describe: buildTemporalCliCommand({
        command: 'describe',
        address: config.address,
        namespace: config.namespace,
        workflowId: effectiveWorkflowId,
        runId: effectiveRunId,
      }),
      showHistory: buildTemporalCliCommand({
        command: 'show',
        address: config.address,
        namespace: config.namespace,
        workflowId: effectiveWorkflowId,
        runId: effectiveRunId,
      }),
      cancel: buildTemporalCliCommand({
        command: 'cancel',
        address: config.address,
        namespace: config.namespace,
        workflowId: effectiveWorkflowId,
        runId: effectiveRunId,
      }),
      terminate: buildTemporalCliCommand({
        command: 'terminate',
        address: config.address,
        namespace: config.namespace,
        workflowId: effectiveWorkflowId,
        runId: effectiveRunId,
        reason: 'Manual diagnostics cleanup from SkyServer Admin',
      }),
    },
  };
}

async function getWorkflowRuntimeDetail({ workflowId, runId, includeHistory = true } = {}) {
  if (!workflowId) {
    return null;
  }

  const { config, client, connection } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);
  let workflow = null;
  let describeError = null;

  try {
    const description = await handle.describe();
    workflow = normalizeWorkflowInfo({
      workflowId,
      runId,
      ...description,
    });
  } catch (error) {
    describeError = error;
  }

  const execution = {
    workflowId,
    ...(runId ? { runId } : {}),
  };
  let history = null;
  let historyError = null;

  if (includeHistory) {
    try {
      const events = [];
      let nextPageToken;
      let pageCount = 0;

      do {
        const response = await connection.workflowService.getWorkflowExecutionHistory({
          namespace: config.namespace,
          execution,
          maximumPageSize: 200,
          nextPageToken,
        });

        events.push(...(response.history?.events || []));
        nextPageToken = response.nextPageToken;
        pageCount += 1;
      } while (nextPageToken && nextPageToken.length > 0 && pageCount < 5);

      history = {
        ...summarizeTemporalHistoryEvents(events),
        truncated: Boolean(nextPageToken && nextPageToken.length > 0),
      };
    } catch (error) {
      historyError = error;
    }
  }

  if (!workflow && describeError && !history) {
    throw describeError;
  }

  const diagnostics = buildTemporalDiagnostics({
    config,
    workflow,
    workflowId,
    runId: workflow?.runId || runId,
    history,
  });

  const runtime = {
    available: Boolean(workflow || history),
    address: config.address,
    namespace: config.namespace,
    taskQueue: workflow?.taskQueue || config.taskQueue,
    workflowId,
    runId: workflow?.runId || runId || null,
    workflowType: workflow?.workflowType || null,
    status: workflow?.status || null,
    startTime: workflow?.startTime || null,
    executionTime: workflow?.executionTime || null,
    closeTime: workflow?.closeTime || null,
    historyLength: workflow?.historyLength || history?.eventCount || null,
    uiUrl: diagnostics?.workflowUrl || buildTemporalUiWorkflowUrl({
      baseUrl: config.uiBaseUrl,
      namespace: config.namespace,
      workflowId,
      runId: workflow?.runId || runId,
    }),
    links: {
      workflow: diagnostics?.workflowUrl || null,
      history: diagnostics?.historyUrl || null,
      query: diagnostics?.queryUrl || null,
    },
    diagnostics,
    history,
    warnings: [
      describeError ? `Temporal describe failed: ${describeError.message || String(describeError)}` : null,
      historyError ? `Temporal history fetch failed: ${historyError.message || String(historyError)}` : null,
    ].filter(Boolean),
  };

  return runtime;
}

async function listWorkflows(query = {}) {
  const { client, config } = await createTemporalClient();
  const limit = getListLimit(query.limit);
  const listQuery = { ...query };
  let selectedDefinition = null;

  if (!listQuery.query && !listQuery.workflowType && !listQuery.type) {
    try {
      selectedDefinition = await getWorkflowDefinition(listQuery.workflowCode || DEFAULT_FRED_WORKFLOW_CODE);
      listQuery.workflowType = selectedDefinition.workflowType;
    } catch (error) {
      listQuery.workflowType = 'fredIngestionWorkflow';
    }
  } else if (listQuery.workflowCode) {
    try {
      selectedDefinition = await getWorkflowDefinition(listQuery.workflowCode);
    } catch (error) {
      selectedDefinition = null;
    }
  }

  const temporalQuery = getWorkflowListQuery(listQuery);
  const temporalItems = [];

  for await (const workflowInfo of client.workflow.list({
    query: temporalQuery,
    pageSize: Math.min(limit, 50),
  })) {
    const normalizedWorkflow = normalizeWorkflowInfo(workflowInfo);
    temporalItems.push(normalizedWorkflow);

    const definition = selectedDefinition || {
      workflowCode: listQuery.workflowCode || DEFAULT_FRED_WORKFLOW_CODE,
      workflowType: normalizedWorkflow.workflowType,
    };

    await upsertWorkflowRunRecord({
      definition,
      config,
      workflow: {
        ...normalizedWorkflow,
        namespace: config.namespace,
      },
      input: {},
      taskQueue: normalizedWorkflow.taskQueue || definition.taskQueue || config.taskQueue,
      status: normalizedWorkflow.status,
      metadata: buildRunRecordMetadata({ workflow: normalizedWorkflow, source: 'temporal_visibility' }),
    });

    if (temporalItems.length >= limit) {
      break;
    }
  }

  const recordFilters = {
    limit,
    status: query.status,
    workflowCode: listQuery.workflowCode || selectedDefinition?.workflowCode,
    workflowType: listQuery.workflowType,
  };
  const recordPayload = await listWorkflowRunRecords(recordFilters);
  const items = mergeWorkflowItemsWithRunRecords({
    items: temporalItems,
    records: recordPayload.items,
    namespace: config.namespace,
    limit,
  });

  return {
    namespace: config.namespace,
    query: temporalQuery,
    total: items.length,
    limit,
    temporalCount: temporalItems.length,
    recordCount: recordPayload.items.length,
    items,
  };
}

async function getWorkflow({ workflowId, runId } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  try {
    const description = await handle.describe();
    const workflow = normalizeWorkflowInfo({
      workflowId,
      runId,
      ...description,
    });

    const runRecord = await upsertWorkflowRunRecord({
      definition: {
        workflowCode: DEFAULT_FRED_WORKFLOW_CODE,
        workflowType: workflow.workflowType,
      },
      config,
      workflow: {
        ...workflow,
        namespace: config.namespace,
      },
      input: {},
      taskQueue: workflow.taskQueue || config.taskQueue,
      status: workflow.status,
      metadata: buildRunRecordMetadata({ workflow, source: 'temporal_describe' }),
    });

    return {
      namespace: config.namespace,
      workflow: {
        ...workflow,
        workflowCode: runRecord?.workflowCode || DEFAULT_FRED_WORKFLOW_CODE,
        source: 'temporal',
        missingFromTemporal: false,
        skyserverRecord: runRecord,
      },
    };
  } catch (error) {
    const runRecord = await getWorkflowRunRecord({ workflowId, runId });

    if (runRecord) {
      return {
        namespace: config.namespace,
        workflow: runRecordToWorkflowInfo(runRecord, { missingFromTemporal: true }),
        warning: 'Workflow was not found in Temporal visibility/history; returned SkyServer run record only.',
      };
    }

    throw error;
  }
}

async function cancelWorkflow({ workflowId, runId, actor = null } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  await handle.cancel();

  const runRecord = await updateWorkflowRunRecordAction({
    workflowId,
    runId,
    action: 'cancel',
    actor,
  });

  return {
    namespace: config.namespace,
    workflowId,
    runId: runId || null,
    requestedAt: new Date().toISOString(),
    action: 'cancel',
    runRecord,
  };
}


async function signalWorkflow({ workflowId, runId, signalName, payload = {} } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  if (!signalName) {
    throw new ServiceError('signalName is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  await handle.signal(signalName, serializeTemporalValue(payload));

  return {
    namespace: config.namespace,
    workflowId,
    runId: runId || null,
    signalName,
    signaledAt: new Date().toISOString(),
  };
}

async function terminateWorkflow({ workflowId, runId, reason, actor = null } = {}) {
  if (!workflowId) {
    throw new ServiceError('workflowId is required.', 400);
  }

  const { client, config } = await createTemporalClient();
  const handle = client.workflow.getHandle(workflowId, runId || undefined);

  const normalizedReason = reason || 'Terminated from SkyServer Temporal API.';

  await handle.terminate(normalizedReason);

  const runRecord = await updateWorkflowRunRecordAction({
    workflowId,
    runId,
    action: 'terminate',
    actor,
    reason: normalizedReason,
  });

  return {
    namespace: config.namespace,
    workflowId,
    runId: runId || null,
    requestedAt: new Date().toISOString(),
    action: 'terminate',
    reason: normalizedReason,
    runRecord,
  };
}

module.exports = {
  cancelWorkflow,
  getHealth,
  getWorkflow,
  getWorkflowRuntimeDetail,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  listWorkflowRunRecords,
  listWorkflows,
  startFredIngestionWorkflow,
  signalWorkflow,
  startSkyserverWorkflowExecutorWorkflow,
  startWorkflowFromDefinition,
  terminateWorkflow,
};
