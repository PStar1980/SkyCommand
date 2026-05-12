const { query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');

const APP_CODE = process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE';
const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 500;

const INTERVAL_UNITS = new Set(['MINUTE', 'HOUR', 'DAY', 'WEEK']);
const SCHEDULE_TYPES = new Set(['ONCE', 'INTERVAL']);
const LISTENER_TYPES = new Set(['FILE_DROP', 'DB_POLL', 'WEBHOOK']);

const UNIT_TO_MILLISECONDS = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
};

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function toBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return fallback;
}

function toPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const numberValue = Number.parseInt(value, 10);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return fallback;
  }

  return Math.min(numberValue, max);
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeCode(value, label) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw createHttpError(400, `${label} is required.`);
  }

  if (!/^[A-Za-z0-9_:-]+$/.test(normalized)) {
    throw createHttpError(
      400,
      `${label} may only contain letters, numbers, underscores, dashes, and colons.`,
    );
  }

  return normalized;
}

function normalizeScheduleType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();

  if (!SCHEDULE_TYPES.has(normalized)) {
    throw createHttpError(400, 'scheduleType must be ONCE or INTERVAL in Phase 8.3.', {
      scheduleType: value,
      supportedScheduleTypes: [...SCHEDULE_TYPES],
      reservedScheduleTypes: ['CRON'],
    });
  }

  return normalized;
}

function normalizeIntervalUnit(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();

  if (!INTERVAL_UNITS.has(normalized)) {
    throw createHttpError(400, 'intervalUnit must be one of MINUTE, HOUR, DAY, or WEEK.', {
      intervalUnit: value,
      supportedIntervalUnits: [...INTERVAL_UNITS],
    });
  }

  return normalized;
}

function assertPlainObject(value, label) {
  if (value === undefined || value === null) {
    return {};
  }

  if (Array.isArray(value) || typeof value !== 'object') {
    throw createHttpError(400, `${label} must be a JSON object.`);
  }

  return value;
}

function toDate(value, label, { required = false } = {}) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    if (required) {
      throw createHttpError(400, `${label} is required.`);
    }

    return null;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${label} must be a valid date/time value.`);
  }

  return date;
}

function addInterval(dateValue, intervalValue, intervalUnit) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const amount = Number(intervalValue);
  const unit = String(intervalUnit || '').toUpperCase();
  const unitMs = UNIT_TO_MILLISECONDS[unit];

  if (Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount <= 0 || !unitMs) {
    return null;
  }

  return new Date(date.getTime() + amount * unitMs);
}

function calculateInitialNextRun(schedule, referenceDate = new Date()) {
  if (!schedule.enabled) {
    return null;
  }

  if (schedule.scheduleType === 'ONCE') {
    return schedule.runAt;
  }

  if (schedule.scheduleType === 'INTERVAL') {
    const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    let candidate = schedule.runAt || now;

    while (candidate && candidate <= now) {
      candidate = addInterval(candidate, schedule.intervalValue, schedule.intervalUnit);
    }

    return candidate;
  }

  return null;
}

function getPagination(filters = {}, options = {}) {
  return {
    limit: toPositiveInteger(
      filters.limit,
      options.defaultLimit || DEFAULT_LIMIT,
      options.maxLimit || MAX_LIMIT,
    ),
    offset: toPositiveInteger(filters.offset, 0),
  };
}

function addSearchFilter({ clauses, values, columns, searchText }) {
  const normalizedSearchText = normalizeOptionalString(searchText);

  if (!normalizedSearchText) {
    return;
  }

  values.push(`%${normalizedSearchText}%`);
  const placeholder = `$${values.length}`;
  clauses.push(
    `(${columns.map((columnName) => `${columnName} ILIKE ${placeholder}`).join(' OR ')})`,
  );
}

function buildWhereClause(clauses) {
  return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function sanitizeSchedule(row) {
  const schedule = camelizeRow(row);

  return {
    scheduleId: schedule.scheduleId,
    scheduleCode: schedule.scheduleCode,
    scheduleName: schedule.scheduleName,
    description: schedule.description,
    scheduleType: schedule.scheduleType,
    timezone: schedule.timezone,
    runAt: schedule.runAt,
    intervalValue: schedule.intervalValue,
    intervalUnit: schedule.intervalUnit,
    cronExpression: schedule.cronExpression,
    parameters: schedule.parameters || {},
    enabled: schedule.enabled,
    maxConcurrentRuns: schedule.maxConcurrentRuns,
    misfirePolicy: schedule.misfirePolicy,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastStatus: schedule.lastStatus,
    queueRequestedAt: schedule.queueRequestedAt,
    queueRequestedByUserId: schedule.queueRequestedByUserId,
    queueRequestedByEmail: schedule.queueRequestedByEmail,
    queueRequestedByDisplayName: schedule.queueRequestedByDisplayName,
    queuedPreviousNextRunAt: schedule.queuedPreviousNextRunAt,
    deletedAt: schedule.deletedAt,
    deletedByUserId: schedule.deletedByUserId,
    deletedByEmail: schedule.deletedByEmail,
    deletedByDisplayName: schedule.deletedByDisplayName,
    deleteReason: schedule.deleteReason,
    isDeleted: Boolean(schedule.deletedAt),
    isQueued: Boolean(schedule.queueRequestedAt),
    isCompletedOnce:
      schedule.scheduleType === 'ONCE' &&
      Boolean(schedule.lastRunAt) &&
      ['SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(
        String(schedule.lastStatus || '').toUpperCase(),
      ),
    toolId: schedule.toolId,
    toolCode: schedule.toolCode,
    toolLabel: schedule.toolLabel,
    riskCode: schedule.riskCode,
    permissionCode: schedule.permissionCode,
    profileId: schedule.profileId,
    profileCode: schedule.profileCode,
    profileName: schedule.profileName,
    createdByUserId: schedule.createdByUserId,
    createdByEmail: schedule.createdByEmail,
    createdByDisplayName: schedule.createdByDisplayName,
    updatedByUserId: schedule.updatedByUserId,
    updatedByEmail: schedule.updatedByEmail,
    updatedByDisplayName: schedule.updatedByDisplayName,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function sanitizeScheduleRun(row) {
  const run = camelizeRow(row);

  return {
    scheduleRunId: run.scheduleRunId,
    scheduleId: run.scheduleId,
    scheduleCode: run.scheduleCode,
    scheduleName: run.scheduleName,
    toolCode: run.toolCode,
    toolLabel: run.toolLabel,
    workerNodeId: run.workerNodeId,
    nodeName: run.nodeName,
    executionId: run.executionId,
    status: run.status,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    message: run.message,
    metadata: run.metadata || {},
    scriptName: run.scriptName,
    scriptFile: run.scriptFile,
    category: run.category,
    executionParameters: run.executionParameters || {},
    executionStatus: run.executionStatus,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    executionSummary: run.executionSummary,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function sanitizeWorkerNode(row) {
  const node = camelizeRow(row);

  return {
    workerNodeId: node.workerNodeId,
    nodeName: node.nodeName,
    processId: node.processId,
    hostname: node.hostname,
    appVersion: node.appVersion,
    status: node.status,
    startedAt: node.startedAt,
    lastHeartbeatAt: node.lastHeartbeatAt,
    secondsSinceHeartbeat: node.secondsSinceHeartbeat,
    metadata: node.metadata || {},
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function sanitizeListener(row) {
  const listener = camelizeRow(row);

  return {
    listenerId: listener.listenerId,
    listenerCode: listener.listenerCode,
    listenerName: listener.listenerName,
    description: listener.description,
    listenerType: listener.listenerType,
    config: listener.config || {},
    parametersTemplate: listener.parametersTemplate || {},
    enabled: listener.enabled,
    pollIntervalSeconds: listener.pollIntervalSeconds,
    lastCheckedAt: listener.lastCheckedAt,
    lastEventAt: listener.lastEventAt,
    lastStatus: listener.lastStatus,
    deletedAt: listener.deletedAt,
    deletedByUserId: listener.deletedByUserId,
    deleteReason: listener.deleteReason,
    isDeleted: Boolean(listener.deletedAt),
    toolId: listener.toolId,
    toolCode: listener.toolCode,
    toolLabel: listener.toolLabel,
    riskCode: listener.riskCode,
    permissionCode: listener.permissionCode,
    profileId: listener.profileId,
    profileCode: listener.profileCode,
    profileName: listener.profileName,
    createdByUserId: listener.createdByUserId,
    updatedByUserId: listener.updatedByUserId,
    createdAt: listener.createdAt,
    updatedAt: listener.updatedAt,
  };
}

function sanitizeListenerEvent(row) {
  const event = camelizeRow(row);

  return {
    listenerEventId: event.listenerEventId,
    listenerId: event.listenerId,
    listenerCode: event.listenerCode,
    listenerName: event.listenerName,
    listenerType: event.listenerType,
    workerNodeId: event.workerNodeId,
    nodeName: event.nodeName,
    executionId: event.executionId,
    eventKey: event.eventKey,
    eventPayload: event.eventPayload || {},
    status: event.status,
    detectedAt: event.detectedAt,
    processedAt: event.processedAt,
    message: event.message,
    metadata: event.metadata || {},
    executionStatus: event.executionStatus,
    exitCode: event.exitCode,
    durationMs: event.durationMs,
    executionSummary: event.executionSummary,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function sanitizeTool(row) {
  const tool = camelizeRow(row);

  return {
    toolId: tool.toolId,
    toolCode: tool.toolCode,
    name: tool.name,
    label: tool.label,
    description: tool.description,
    categoryCode: tool.categoryCode,
    categoryLabel: tool.categoryLabel,
    permissionCode: tool.permissionCode,
    riskCode: tool.riskCode,
    riskRank: tool.riskRank,
    runtimeCode: tool.runtimeCode,
    requiresConfirmation: tool.requiresConfirmation,
    allowParams: tool.allowParams,
    parameters: [],
  };
}

function sanitizeParameter(row) {
  const parameter = camelizeRow(row);

  return {
    parameterId: parameter.parameterId,
    parameterName: parameter.parameterName,
    label: parameter.label,
    paramTypeCode: parameter.paramTypeCode,
    prompt: parameter.prompt,
    required: parameter.required,
    defaultValue: parameter.defaultValue,
    optionSourceCode: parameter.optionSourceCode,
    displayOrder: parameter.displayOrder,
    enabled: parameter.enabled,
  };
}

async function recordWorkerAudit({
  actor,
  context,
  action,
  success,
  message,
  resourceId = null,
  metadata = {},
}) {
  await authService.recordAuditEvent({
    userId: actor?.userId || null,
    eventType: success ? 'WORKER_ADMIN_ACTION' : 'WORKER_ADMIN_ACTION_FAILED',
    resourceType: 'worker',
    resourceId,
    action,
    success,
    message,
    metadata,
    ipAddress: context?.ipAddress || null,
    userAgent: context?.userAgent || null,
  });
}

async function getCurrentProfile() {
  const result = await query(
    `
      SELECT profile_id, profile_code, profile_name
      FROM core.config_profiles
      WHERE profile_code = $1
        AND active = TRUE
      LIMIT 1
    `,
    [PROFILE_CODE],
  );

  if (!result.rows[0]) {
    throw createHttpError(
      500,
      `Configured profile is not active or does not exist: ${PROFILE_CODE}`,
    );
  }

  return result.rows[0];
}

async function getWorkerToolByCodeOrId({ toolCode = null, toolId = null } = {}) {
  const clauses = ['m.app_code = $1'];
  const values = [APP_CODE];

  if (toolId) {
    values.push(toolId);
    clauses.push(`m.tool_id = $${values.length}::uuid`);
  } else {
    values.push(toolCode);
    clauses.push(`m.tool_code = $${values.length}`);
  }

  const result = await query(
    `
      SELECT
        m.app_code,
        m.category_code,
        m.category_label,
        m.tool_id,
        m.tool_code,
        m.name,
        m.label,
        m.description,
        m.runtime_code,
        m.permission_code,
        m.risk_code,
        m.risk_rank,
        m.requires_confirmation,
        m.allow_params,
        m.tool_display_order
      FROM core.vw_tool_manifest m
      WHERE ${clauses.join(' AND ')}
        AND EXISTS (
          SELECT 1
          FROM core.tool_visibility tv
          WHERE tv.tool_id = m.tool_id
            AND tv.channel_code = 'worker'
        )
      LIMIT 1
    `,
    values,
  );

  return result.rows[0] || null;
}

async function listWorkerTools() {
  const toolsResult = await query(
    `
      SELECT
        m.app_code,
        m.category_code,
        m.category_label,
        m.tool_id,
        m.tool_code,
        m.name,
        m.label,
        m.description,
        m.runtime_code,
        m.permission_code,
        m.risk_code,
        m.risk_rank,
        m.requires_confirmation,
        m.allow_params,
        m.tool_display_order
      FROM core.vw_tool_manifest m
      WHERE m.app_code = $1
        AND EXISTS (
          SELECT 1
          FROM core.tool_visibility tv
          WHERE tv.tool_id = m.tool_id
            AND tv.channel_code = 'worker'
        )
      ORDER BY m.category_display_order, m.tool_display_order, m.label
    `,
    [APP_CODE],
  );

  const tools = toolsResult.rows.map(sanitizeTool);
  const toolCodes = tools.map((tool) => tool.toolCode);

  if (toolCodes.length === 0) {
    return { items: [] };
  }

  const parameterResult = await query(
    `
      SELECT
        tool_id,
        tool_code,
        parameter_id,
        parameter_name,
        label,
        param_type_code,
        prompt,
        required,
        default_value,
        option_source_code,
        display_order,
        enabled
      FROM core.vw_tool_parameters
      WHERE tool_code = ANY($1::text[])
      ORDER BY tool_code, display_order, parameter_name
    `,
    [toolCodes],
  );

  const parametersByToolCode = new Map(toolCodes.map((toolCode) => [toolCode, []]));

  for (const parameter of parameterResult.rows) {
    parametersByToolCode.get(parameter.tool_code)?.push(sanitizeParameter(parameter));
  }

  return {
    items: tools.map((tool) => ({
      ...tool,
      parameters: parametersByToolCode.get(tool.toolCode) || [],
    })),
  };
}

async function validateToolParameters({ toolCode, parameters }) {
  const parameterResult = await query(
    `
      SELECT
        tool_code,
        parameter_name,
        label,
        param_type_code,
        prompt,
        required,
        default_value,
        option_source_code
      FROM core.vw_tool_parameters
      WHERE tool_code = $1
      ORDER BY display_order, parameter_name
    `,
    [toolCode],
  );

  const parameterRows = parameterResult.rows;
  const allowedNames = new Set(parameterRows.map((row) => row.parameter_name));
  const unknownNames = Object.keys(parameters || {}).filter((name) => !allowedNames.has(name));

  if (unknownNames.length > 0) {
    throw createHttpError(400, `Unknown parameter(s): ${unknownNames.join(', ')}`);
  }

  for (const parameter of parameterRows) {
    const rawValue = parameters?.[parameter.parameter_name];

    if (
      (rawValue === undefined || rawValue === null || rawValue === '') &&
      toBoolean(parameter.required, false) &&
      (parameter.default_value === undefined || parameter.default_value === null)
    ) {
      throw createHttpError(400, `Missing required parameter: ${parameter.parameter_name}`);
    }

    if (
      rawValue !== undefined &&
      rawValue !== null &&
      typeof rawValue === 'string' &&
      rawValue.includes('\0')
    ) {
      throw createHttpError(400, `${parameter.parameter_name} contains an invalid null byte.`);
    }
  }
}

function buildSchedulePayload(body, existing = null) {
  const scheduleType = normalizeScheduleType(
    body.scheduleType ?? body.schedule_type ?? existing?.scheduleType,
  );
  const enabled = toBoolean(body.enabled, existing?.enabled ?? true);
  const timezone =
    normalizeOptionalString(body.timezone ?? existing?.timezone) || 'America/Toronto';
  const scheduleCode =
    body.scheduleCode === undefined && existing
      ? existing.scheduleCode
      : normalizeCode(body.scheduleCode ?? body.schedule_code, 'scheduleCode');
  const scheduleName = normalizeOptionalString(
    body.scheduleName ?? body.schedule_name ?? existing?.scheduleName,
  );

  if (!scheduleName) {
    throw createHttpError(400, 'scheduleName is required.');
  }

  const parameters = assertPlainObject(body.parameters ?? existing?.parameters ?? {}, 'parameters');
  let runAt = null;
  let intervalValue = null;
  let intervalUnit = null;

  if (scheduleType === 'ONCE') {
    runAt = toDate(body.runAt ?? body.run_at ?? existing?.runAt, 'runAt', { required: true });
  }

  if (scheduleType === 'INTERVAL') {
    runAt = toDate(body.runAt ?? body.run_at ?? existing?.runAt, 'runAt');
    intervalValue = Number.parseInt(
      body.intervalValue ?? body.interval_value ?? existing?.intervalValue,
      10,
    );

    if (!Number.isInteger(intervalValue) || intervalValue <= 0) {
      throw createHttpError(
        400,
        'intervalValue must be a positive integer for INTERVAL schedules.',
      );
    }

    intervalUnit = normalizeIntervalUnit(
      body.intervalUnit ?? body.interval_unit ?? existing?.intervalUnit,
    );
  }

  return {
    scheduleCode,
    scheduleName,
    description: normalizeOptionalString(body.description ?? existing?.description),
    scheduleType,
    timezone,
    runAt,
    intervalValue,
    intervalUnit,
    cronExpression: null,
    parameters,
    enabled,
    maxConcurrentRuns:
      toPositiveInteger(
        body.maxConcurrentRuns ?? body.max_concurrent_runs,
        existing?.maxConcurrentRuns || 1,
        25,
      ) || 1,
    misfirePolicy:
      normalizeOptionalString(
        body.misfirePolicy ?? body.misfire_policy ?? existing?.misfirePolicy,
      ) || 'RUN_ONCE',
  };
}

async function listSchedules(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  const includeCompleted = toBoolean(filters.includeCompleted || filters.include_completed, false);
  const includeDeleted = toBoolean(filters.includeDeleted || filters.include_deleted, false);

  if (!includeDeleted) {
    clauses.push('deleted_at IS NULL');
  }

  if (!includeCompleted) {
    clauses.push(`NOT (
      schedule_type = 'ONCE'
      AND last_run_at IS NOT NULL
      AND last_status IN ('SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED')
    )`);
  }

  const enabled = toBoolean(filters.enabled);
  if (enabled !== null) {
    values.push(enabled);
    clauses.push(`enabled = $${values.length}`);
  }

  const scheduleType = normalizeOptionalString(filters.scheduleType || filters.schedule_type);
  if (scheduleType) {
    values.push(scheduleType.toUpperCase());
    clauses.push(`schedule_type = $${values.length}`);
  }

  const toolCode = normalizeOptionalString(filters.toolCode || filters.tool_code);
  if (toolCode) {
    values.push(toolCode);
    clauses.push(`tool_code = $${values.length}`);
  }

  const status = normalizeOptionalString(filters.status);
  if (status) {
    values.push(status.toUpperCase());
    clauses.push(`last_status = $${values.length}`);
  }

  addSearchFilter({
    clauses,
    values,
    columns: ['schedule_code', 'schedule_name', 'description', 'tool_code', 'tool_label'],
    searchText: filters.q || filters.search,
  });

  const whereClause = buildWhereClause(clauses);

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM worker.vw_schedules ${whereClause}`, values),
    query(
      `
        SELECT *
        FROM worker.vw_schedules
        ${whereClause}
        ORDER BY enabled DESC, next_run_at ASC NULLS LAST, schedule_code ASC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeSchedule),
  };
}

async function getSchedule(scheduleIdOrCode) {
  const normalized = normalizeOptionalString(scheduleIdOrCode);

  if (!normalized) {
    throw createHttpError(400, 'scheduleId is required.');
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_schedules
      WHERE schedule_id::text = $1
         OR schedule_code = $1
      LIMIT 1
    `,
    [normalized],
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Schedule not found.', { scheduleId: normalized });
  }

  return { schedule: sanitizeSchedule(result.rows[0]) };
}

async function createSchedule({ body = {}, actor = null, context = {} } = {}) {
  const toolCode = normalizeOptionalString(body.toolCode || body.tool_code);
  const toolId = normalizeOptionalString(body.toolId || body.tool_id);
  const tool = await getWorkerToolByCodeOrId({ toolCode, toolId });

  if (!tool) {
    throw createHttpError(404, 'Worker-visible tool not found.', { toolCode, toolId });
  }

  const profile = await getCurrentProfile();
  const payload = buildSchedulePayload(body);

  await validateToolParameters({ toolCode: tool.tool_code, parameters: payload.parameters });

  const nextRunAt = calculateInitialNextRun(payload);

  const result = await query(
    `
      INSERT INTO worker.schedules (
        schedule_code,
        schedule_name,
        description,
        tool_id,
        profile_id,
        schedule_type,
        timezone,
        run_at,
        interval_value,
        interval_unit,
        cron_expression,
        parameters,
        enabled,
        max_concurrent_runs,
        misfire_policy,
        next_run_at,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12::jsonb, $13, $14, $15, $16,
        $17, $17
      )
      RETURNING schedule_id
    `,
    [
      payload.scheduleCode,
      payload.scheduleName,
      payload.description,
      tool.tool_id,
      profile.profile_id,
      payload.scheduleType,
      payload.timezone,
      payload.runAt,
      payload.intervalValue,
      payload.intervalUnit,
      payload.cronExpression,
      JSON.stringify(payload.parameters),
      payload.enabled,
      payload.maxConcurrentRuns,
      payload.misfirePolicy,
      nextRunAt,
      actor?.userId || null,
    ],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'create_schedule',
    success: true,
    message: `Created worker schedule ${payload.scheduleCode}.`,
    resourceId: result.rows[0].schedule_id,
    metadata: { scheduleCode: payload.scheduleCode, toolCode: tool.tool_code, nextRunAt },
  });

  return getSchedule(result.rows[0].schedule_id);
}

async function updateSchedule({ scheduleId, body = {}, actor = null, context = {} } = {}) {
  const existing = (await getSchedule(scheduleId)).schedule;

  if (existing.isDeleted) {
    throw createHttpError(409, 'Deleted schedules cannot be updated.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  const toolCode = normalizeOptionalString(body.toolCode || body.tool_code || existing.toolCode);
  const toolId = normalizeOptionalString(body.toolId || body.tool_id || existing.toolId);
  const tool = await getWorkerToolByCodeOrId({ toolCode, toolId });

  if (!tool) {
    throw createHttpError(404, 'Worker-visible tool not found.', { toolCode, toolId });
  }

  const payload = buildSchedulePayload(body, existing);
  await validateToolParameters({ toolCode: tool.tool_code, parameters: payload.parameters });

  const nextRunAt = calculateInitialNextRun({
    ...payload,
    nextRunAt:
      body.resetNextRun === true || body.resetNextRun === 'true' ? null : existing.nextRunAt,
  });

  await query(
    `
      UPDATE worker.schedules
      SET schedule_code = $2,
          schedule_name = $3,
          description = $4,
          tool_id = $5,
          schedule_type = $6,
          timezone = $7,
          run_at = $8,
          interval_value = $9,
          interval_unit = $10,
          cron_expression = $11,
          parameters = $12::jsonb,
          enabled = $13,
          max_concurrent_runs = $14,
          misfire_policy = $15,
          next_run_at = $16,
          queue_requested_at = NULL,
          queue_requested_by_user_id = NULL,
          queued_previous_next_run_at = NULL,
          updated_by_user_id = $17,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [
      existing.scheduleId,
      payload.scheduleCode,
      payload.scheduleName,
      payload.description,
      tool.tool_id,
      payload.scheduleType,
      payload.timezone,
      payload.runAt,
      payload.intervalValue,
      payload.intervalUnit,
      payload.cronExpression,
      JSON.stringify(payload.parameters),
      payload.enabled,
      payload.maxConcurrentRuns,
      payload.misfirePolicy,
      nextRunAt,
      actor?.userId || null,
    ],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'update_schedule',
    success: true,
    message: `Updated worker schedule ${payload.scheduleCode}.`,
    resourceId: existing.scheduleId,
    metadata: { scheduleCode: payload.scheduleCode, toolCode: tool.tool_code, nextRunAt },
  });

  return getSchedule(existing.scheduleId);
}

async function updateScheduleStatus({ scheduleId, body = {}, actor = null, context = {} } = {}) {
  const existing = (await getSchedule(scheduleId)).schedule;

  if (existing.isDeleted) {
    throw createHttpError(409, 'Deleted schedules cannot be enabled or disabled.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  const enabled = toBoolean(body.enabled);

  if (enabled === null) {
    throw createHttpError(400, 'enabled must be true or false.');
  }

  let nextRunAt = null;

  if (enabled) {
    nextRunAt = calculateInitialNextRun({ ...existing, enabled: true, nextRunAt: null });
  }

  await query(
    `
      UPDATE worker.schedules
      SET enabled = $2,
          next_run_at = $3,
          queue_requested_at = NULL,
          queue_requested_by_user_id = NULL,
          queued_previous_next_run_at = NULL,
          updated_by_user_id = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [existing.scheduleId, enabled, nextRunAt, actor?.userId || null],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: enabled ? 'enable_schedule' : 'disable_schedule',
    success: true,
    message: `${enabled ? 'Enabled' : 'Disabled'} worker schedule ${existing.scheduleCode}.`,
    resourceId: existing.scheduleId,
    metadata: { scheduleCode: existing.scheduleCode, nextRunAt },
  });

  return getSchedule(existing.scheduleId);
}

async function queueScheduleNow({ scheduleId, actor = null, context = {} } = {}) {
  const existing = (await getSchedule(scheduleId)).schedule;

  if (existing.isDeleted) {
    throw createHttpError(409, 'Deleted schedules cannot be queued.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  if (!existing.enabled) {
    throw createHttpError(409, 'Schedule is disabled. Enable it before queueing it.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  await query(
    `
      UPDATE worker.schedules
      SET queued_previous_next_run_at = COALESCE(queued_previous_next_run_at, next_run_at),
          queue_requested_at = CURRENT_TIMESTAMP,
          queue_requested_by_user_id = $2,
          next_run_at = CURRENT_TIMESTAMP,
          last_status = 'QUEUED',
          updated_by_user_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [existing.scheduleId, actor?.userId || null],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'queue_schedule_now',
    success: true,
    message: `Queued worker schedule ${existing.scheduleCode} for immediate execution.`,
    resourceId: existing.scheduleId,
    metadata: { scheduleCode: existing.scheduleCode, toolCode: existing.toolCode },
  });

  return getSchedule(existing.scheduleId);
}

async function unqueueSchedule({ scheduleId, actor = null, context = {} } = {}) {
  const existing = (await getSchedule(scheduleId)).schedule;

  if (existing.isDeleted) {
    throw createHttpError(409, 'Deleted schedules cannot be unqueued.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  if (!existing.queueRequestedAt) {
    throw createHttpError(409, 'Schedule does not have a pending queue request.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  const activeRunResult = await query(
    `
      SELECT COUNT(*)::int AS active_run_count
      FROM worker.schedule_runs
      WHERE schedule_id = $1
        AND status IN ('QUEUED', 'STARTED')
    `,
    [existing.scheduleId],
  );

  if (Number(activeRunResult.rows[0]?.active_run_count || 0) > 0) {
    throw createHttpError(
      409,
      'Schedule has already been claimed by the worker and cannot be unqueued.',
      {
        scheduleId: existing.scheduleId,
        scheduleCode: existing.scheduleCode,
      },
    );
  }

  await query(
    `
      UPDATE worker.schedules
      SET next_run_at = queued_previous_next_run_at,
          queue_requested_at = NULL,
          queue_requested_by_user_id = NULL,
          queued_previous_next_run_at = NULL,
          last_status = CASE WHEN last_status = 'QUEUED' THEN 'CANCELLED' ELSE last_status END,
          updated_by_user_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [existing.scheduleId, actor?.userId || null],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'unqueue_schedule',
    success: true,
    message: `Unqueued worker schedule ${existing.scheduleCode}.`,
    resourceId: existing.scheduleId,
    metadata: { scheduleCode: existing.scheduleCode, toolCode: existing.toolCode },
  });

  return getSchedule(existing.scheduleId);
}

async function runScheduleNow(options = {}) {
  return queueScheduleNow(options);
}

async function deleteSchedule({ scheduleId, body = {}, actor = null, context = {} } = {}) {
  const existing = (await getSchedule(scheduleId)).schedule;

  if (existing.isDeleted) {
    return { schedule: existing };
  }

  const activeRunResult = await query(
    `
      SELECT COUNT(*)::int AS active_run_count
      FROM worker.schedule_runs
      WHERE schedule_id = $1
        AND status IN ('QUEUED', 'STARTED')
    `,
    [existing.scheduleId],
  );

  if (Number(activeRunResult.rows[0]?.active_run_count || 0) > 0) {
    throw createHttpError(409, 'Schedule has an active run and cannot be deleted yet.', {
      scheduleId: existing.scheduleId,
      scheduleCode: existing.scheduleCode,
    });
  }

  const deleteReason = normalizeOptionalString(
    body.deleteReason || body.delete_reason || body.reason,
  );

  await query(
    `
      UPDATE worker.schedules
      SET enabled = FALSE,
          next_run_at = NULL,
          queue_requested_at = NULL,
          queue_requested_by_user_id = NULL,
          queued_previous_next_run_at = NULL,
          deleted_at = CURRENT_TIMESTAMP,
          deleted_by_user_id = $2,
          delete_reason = $3,
          updated_by_user_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [existing.scheduleId, actor?.userId || null, deleteReason],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'delete_schedule',
    success: true,
    message: `Deleted worker schedule ${existing.scheduleCode}.`,
    resourceId: existing.scheduleId,
    metadata: { scheduleCode: existing.scheduleCode, toolCode: existing.toolCode, deleteReason },
  });

  return getSchedule(existing.scheduleId);
}

async function listScheduleRuns(filters = {}) {
  const { limit, offset } = getPagination(filters, {
    defaultLimit: DEFAULT_RUN_LIMIT,
    maxLimit: MAX_RUN_LIMIT,
  });
  const clauses = [];
  const values = [];

  const scheduleId = normalizeOptionalString(filters.scheduleId || filters.schedule_id);
  if (scheduleId) {
    values.push(scheduleId);
    clauses.push(`schedule_id::text = $${values.length}`);
  }

  const scheduleCode = normalizeOptionalString(filters.scheduleCode || filters.schedule_code);
  if (scheduleCode) {
    values.push(scheduleCode);
    clauses.push(`schedule_code = $${values.length}`);
  }

  const status = normalizeOptionalString(filters.status);
  if (status) {
    values.push(status.toUpperCase());
    clauses.push(`status = $${values.length}`);
  }

  const toolCode = normalizeOptionalString(filters.toolCode || filters.tool_code);
  if (toolCode) {
    values.push(toolCode);
    clauses.push(`tool_code = $${values.length}`);
  }

  const whereClause = buildWhereClause(clauses);

  const [countResult, rowsResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total FROM worker.vw_schedule_runs_recent ${whereClause}`,
      values,
    ),
    query(
      `
        SELECT *
        FROM worker.vw_schedule_runs_recent
        ${whereClause}
        ORDER BY queued_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeScheduleRun),
  };
}

async function getWorkerHealth() {
  const [nodesResult, schedulesResult, runsResult] = await Promise.all([
    query(
      `
        SELECT
          COUNT(*)::int AS total_nodes,
          COUNT(*) FILTER (WHERE status = 'ONLINE')::int AS online_nodes,
          COUNT(*) FILTER (WHERE status = 'ERROR')::int AS error_nodes,
          MAX(last_heartbeat_at) AS latest_heartbeat_at
        FROM worker.vw_worker_nodes
      `,
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS total_schedules,
          COUNT(*) FILTER (WHERE enabled = TRUE)::int AS enabled_schedules,
          COUNT(*) FILTER (WHERE enabled = TRUE AND next_run_at <= CURRENT_TIMESTAMP)::int AS due_schedules,
          COUNT(*) FILTER (WHERE last_status = 'FAILED')::int AS failed_schedules,
          MIN(next_run_at) FILTER (WHERE enabled = TRUE AND next_run_at IS NOT NULL) AS next_run_at
        FROM worker.vw_schedules
        WHERE deleted_at IS NULL
          AND NOT (
            schedule_type = 'ONCE'
            AND last_run_at IS NOT NULL
            AND last_status IN ('SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED')
          )
      `,
    ),
    query(
      `
        SELECT
          COUNT(*)::int AS recent_runs,
          COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS recent_success,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS recent_failed,
          COUNT(*) FILTER (WHERE status IN ('QUEUED', 'STARTED'))::int AS active_runs
        FROM worker.vw_schedule_runs_recent
        WHERE queued_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
      `,
    ),
  ]);

  const nodes = nodesResult.rows[0] || {};
  const schedules = schedulesResult.rows[0] || {};
  const runs = runsResult.rows[0] || {};
  const overallStatus =
    Number(nodes.error_nodes || 0) > 0 || Number(runs.recent_failed || 0) > 0
      ? 'WARNING'
      : Number(nodes.online_nodes || 0) > 0
        ? 'CURRENT'
        : 'WARNING';

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    nodes: {
      total: nodes.total_nodes || 0,
      online: nodes.online_nodes || 0,
      error: nodes.error_nodes || 0,
      latestHeartbeatAt: nodes.latest_heartbeat_at || null,
    },
    schedules: {
      total: schedules.total_schedules || 0,
      enabled: schedules.enabled_schedules || 0,
      due: schedules.due_schedules || 0,
      failed: schedules.failed_schedules || 0,
      nextRunAt: schedules.next_run_at || null,
    },
    runs24h: {
      total: runs.recent_runs || 0,
      success: runs.recent_success || 0,
      failed: runs.recent_failed || 0,
      active: runs.active_runs || 0,
    },
  };
}

async function listWorkerNodes(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = [];
  const values = [];

  const status = normalizeOptionalString(filters.status);
  if (status) {
    values.push(status.toUpperCase());
    clauses.push(`status = $${values.length}`);
  }

  addSearchFilter({
    clauses,
    values,
    columns: ['node_name', 'hostname', 'app_version'],
    searchText: filters.q || filters.search,
  });

  const whereClause = buildWhereClause(clauses);

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM worker.vw_worker_nodes ${whereClause}`, values),
    query(
      `
        SELECT *
        FROM worker.vw_worker_nodes
        ${whereClause}
        ORDER BY status, last_heartbeat_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeWorkerNode),
  };
}

function buildListenerPayload(body, existing = null) {
  const listenerCode =
    body.listenerCode === undefined && existing
      ? existing.listenerCode
      : normalizeCode(body.listenerCode || body.listener_code, 'listenerCode');
  const listenerName = normalizeOptionalString(
    body.listenerName || body.listener_name || existing?.listenerName,
  );

  if (!listenerName) {
    throw createHttpError(400, 'listenerName is required.');
  }

  const listenerType = String(
    body.listenerType || body.listener_type || existing?.listenerType || '',
  )
    .trim()
    .toUpperCase();

  if (!LISTENER_TYPES.has(listenerType)) {
    throw createHttpError(400, 'listenerType must be FILE_DROP, DB_POLL, or WEBHOOK.', {
      listenerType: body.listenerType || body.listener_type,
      supportedListenerTypes: [...LISTENER_TYPES],
    });
  }

  return {
    listenerCode,
    listenerName,
    description: normalizeOptionalString(body.description ?? existing?.description),
    listenerType,
    config: assertPlainObject(body.config ?? existing?.config ?? {}, 'config'),
    parametersTemplate: assertPlainObject(
      body.parametersTemplate ?? body.parameters_template ?? existing?.parametersTemplate ?? {},
      'parametersTemplate',
    ),
    enabled: toBoolean(body.enabled, existing?.enabled ?? true),
    pollIntervalSeconds:
      toPositiveInteger(
        body.pollIntervalSeconds ?? body.poll_interval_seconds,
        existing?.pollIntervalSeconds || 60,
        86400,
      ) || 60,
  };
}

async function listListeners(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const clauses = ['deleted_at IS NULL'];
  const values = [];

  const enabled = toBoolean(filters.enabled);
  if (enabled !== null) {
    values.push(enabled);
    clauses.push(`enabled = $${values.length}`);
  }

  const listenerType = normalizeOptionalString(filters.listenerType || filters.listener_type);
  if (listenerType) {
    values.push(listenerType.toUpperCase());
    clauses.push(`listener_type = $${values.length}`);
  }

  addSearchFilter({
    clauses,
    values,
    columns: ['listener_code', 'listener_name', 'description', 'tool_code', 'tool_label'],
    searchText: filters.q || filters.search,
  });

  const whereClause = buildWhereClause(clauses);

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM worker.vw_listeners ${whereClause}`, values),
    query(
      `
        SELECT *
        FROM worker.vw_listeners
        ${whereClause}
        ORDER BY enabled DESC, listener_type, listener_code
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeListener),
  };
}

async function getListener(listenerIdOrCode) {
  const normalized = normalizeOptionalString(listenerIdOrCode);

  if (!normalized) {
    throw createHttpError(400, 'listenerId is required.');
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_listeners
      WHERE listener_id::text = $1
         OR listener_code = $1
      LIMIT 1
    `,
    [normalized],
  );

  if (!result.rows[0]) {
    throw createHttpError(404, 'Listener not found.', { listenerId: normalized });
  }

  return { listener: sanitizeListener(result.rows[0]) };
}

async function createListener({ body = {}, actor = null, context = {} } = {}) {
  const toolCode = normalizeOptionalString(body.toolCode || body.tool_code);
  const toolId = normalizeOptionalString(body.toolId || body.tool_id);
  const tool = await getWorkerToolByCodeOrId({ toolCode, toolId });

  if (!tool) {
    throw createHttpError(404, 'Worker-visible tool not found.', { toolCode, toolId });
  }

  const profile = await getCurrentProfile();
  const payload = buildListenerPayload(body);

  await validateToolParameters({
    toolCode: tool.tool_code,
    parameters: payload.parametersTemplate,
  });

  const result = await query(
    `
      INSERT INTO worker.listeners (
        listener_code,
        listener_name,
        description,
        listener_type,
        tool_id,
        profile_id,
        config,
        parameters_template,
        enabled,
        poll_interval_seconds,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $11)
      RETURNING listener_id
    `,
    [
      payload.listenerCode,
      payload.listenerName,
      payload.description,
      payload.listenerType,
      tool.tool_id,
      profile.profile_id,
      JSON.stringify(payload.config),
      JSON.stringify(payload.parametersTemplate),
      payload.enabled,
      payload.pollIntervalSeconds,
      actor?.userId || null,
    ],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'create_listener',
    success: true,
    message: `Created worker listener ${payload.listenerCode}.`,
    resourceId: result.rows[0].listener_id,
    metadata: {
      listenerCode: payload.listenerCode,
      listenerType: payload.listenerType,
      toolCode: tool.tool_code,
    },
  });

  return getListener(result.rows[0].listener_id);
}

async function updateListener({ listenerId, body = {}, actor = null, context = {} } = {}) {
  const existing = (await getListener(listenerId)).listener;
  const toolCode = normalizeOptionalString(body.toolCode || body.tool_code || existing.toolCode);
  const toolId = normalizeOptionalString(body.toolId || body.tool_id || existing.toolId);
  const tool = await getWorkerToolByCodeOrId({ toolCode, toolId });

  if (!tool) {
    throw createHttpError(404, 'Worker-visible tool not found.', { toolCode, toolId });
  }

  const payload = buildListenerPayload(body, existing);

  await validateToolParameters({
    toolCode: tool.tool_code,
    parameters: payload.parametersTemplate,
  });

  await query(
    `
      UPDATE worker.listeners
      SET listener_code = $2,
          listener_name = $3,
          description = $4,
          listener_type = $5,
          tool_id = $6,
          config = $7::jsonb,
          parameters_template = $8::jsonb,
          enabled = $9,
          poll_interval_seconds = $10,
          updated_by_user_id = $11,
          updated_at = CURRENT_TIMESTAMP
      WHERE listener_id = $1
    `,
    [
      existing.listenerId,
      payload.listenerCode,
      payload.listenerName,
      payload.description,
      payload.listenerType,
      tool.tool_id,
      JSON.stringify(payload.config),
      JSON.stringify(payload.parametersTemplate),
      payload.enabled,
      payload.pollIntervalSeconds,
      actor?.userId || null,
    ],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: 'update_listener',
    success: true,
    message: `Updated worker listener ${payload.listenerCode}.`,
    resourceId: existing.listenerId,
    metadata: {
      listenerCode: payload.listenerCode,
      listenerType: payload.listenerType,
      toolCode: tool.tool_code,
    },
  });

  return getListener(existing.listenerId);
}

async function updateListenerStatus({ listenerId, body = {}, actor = null, context = {} } = {}) {
  const existing = (await getListener(listenerId)).listener;
  const enabled = toBoolean(body.enabled);

  if (enabled === null) {
    throw createHttpError(400, 'enabled must be true or false.');
  }

  await query(
    `
      UPDATE worker.listeners
      SET enabled = $2,
          updated_by_user_id = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE listener_id = $1
    `,
    [existing.listenerId, enabled, actor?.userId || null],
  );

  await recordWorkerAudit({
    actor,
    context,
    action: enabled ? 'enable_listener' : 'disable_listener',
    success: true,
    message: `${enabled ? 'Enabled' : 'Disabled'} worker listener ${existing.listenerCode}.`,
    resourceId: existing.listenerId,
    metadata: { listenerCode: existing.listenerCode },
  });

  return getListener(existing.listenerId);
}

async function listListenerEvents(filters = {}) {
  const { limit, offset } = getPagination(filters, {
    defaultLimit: DEFAULT_RUN_LIMIT,
    maxLimit: MAX_RUN_LIMIT,
  });
  const clauses = [];
  const values = [];

  const listenerId = normalizeOptionalString(filters.listenerId || filters.listener_id);
  if (listenerId) {
    values.push(listenerId);
    clauses.push(`listener_id::text = $${values.length}`);
  }

  const listenerCode = normalizeOptionalString(filters.listenerCode || filters.listener_code);
  if (listenerCode) {
    values.push(listenerCode);
    clauses.push(`listener_code = $${values.length}`);
  }

  const status = normalizeOptionalString(filters.status);
  if (status) {
    values.push(status.toUpperCase());
    clauses.push(`status = $${values.length}`);
  }

  const whereClause = buildWhereClause(clauses);

  const [countResult, rowsResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total FROM worker.vw_listener_events_recent ${whereClause}`,
      values,
    ),
    query(
      `
        SELECT *
        FROM worker.vw_listener_events_recent
        ${whereClause}
        ORDER BY detected_at DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeListenerEvent),
  };
}

module.exports = {
  listWorkerTools,
  getWorkerHealth,
  listWorkerNodes,
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  updateScheduleStatus,
  queueScheduleNow,
  unqueueSchedule,
  runScheduleNow,
  deleteSchedule,
  listScheduleRuns,
  listListeners,
  getListener,
  createListener,
  updateListener,
  updateListenerStatus,
  listListenerEvents,
};
