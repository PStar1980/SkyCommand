const { query } = require('../../../../packages/db/src/connection');
const macroReadService = require('./macroReadService');

const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_EVENT_LIMIT = 100;
const MAX_NOTIFICATION_LIMIT = 100;

const ALLOWED_TARGET_TYPES = new Set(['indicator', 'view_metric']);
const ALLOWED_CONDITIONS = new Set([
  'above',
  'below',
  'crosses_above',
  'crosses_below',
  'changes_by',
  'percent_changes_by',
]);
const ALLOWED_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_NOTIFICATION_STATUSES = new Set(['open', 'acknowledged', 'dismissed', 'all']);
const NUMERIC_DATA_TYPES = new Set([
  'bigint',
  'decimal',
  'double precision',
  'integer',
  'numeric',
  'real',
  'smallint',
]);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeOptionalString(value, options = {}) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return null;
  }

  if (options.maxLength && trimmedValue.length > options.maxLength) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is too long.`, {
      fieldName: options.fieldName,
      maxLength: options.maxLength,
    });
  }

  return trimmedValue;
}

function normalizeRequiredString(value, options = {}) {
  const normalizedValue = normalizeOptionalString(value, options);

  if (!normalizedValue) {
    throw createHttpError(400, `${options.fieldName || 'Value'} is required.`, {
      fieldName: options.fieldName,
    });
  }

  return normalizedValue;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function normalizeAlertKey(value) {
  const normalizedValue = normalizeRequiredString(value, { fieldName: 'alertKey' })
    .replace(/_/g, '-')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(normalizedValue)) {
    throw createHttpError(400, 'alertKey contains invalid characters.', {
      fieldName: 'alertKey',
      value,
    });
  }

  return normalizedValue;
}

function normalizeTargetType(value) {
  const normalizedValue = String(value || 'indicator')
    .trim()
    .toLowerCase();

  if (!ALLOWED_TARGET_TYPES.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid alert target type.', {
      fieldName: 'targetType',
      value,
      allowedValues: Array.from(ALLOWED_TARGET_TYPES),
    });
  }

  return normalizedValue;
}

function normalizeConditionType(value) {
  const normalizedValue = String(value || '')
    .trim()
    .toLowerCase();

  if (!ALLOWED_CONDITIONS.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid alert condition type.', {
      fieldName: 'conditionType',
      value,
      allowedValues: Array.from(ALLOWED_CONDITIONS),
    });
  }

  return normalizedValue;
}

function normalizeSeverity(value, fallback = 'medium') {
  const normalizedValue = String(value || fallback)
    .trim()
    .toLowerCase();

  if (!ALLOWED_SEVERITIES.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid alert severity.', {
      fieldName: 'severity',
      value,
      allowedValues: Array.from(ALLOWED_SEVERITIES),
    });
  }

  return normalizedValue;
}

function normalizeNotificationStatus(value, fallback = 'open') {
  const normalizedValue = String(value || fallback)
    .trim()
    .toLowerCase();

  if (!ALLOWED_NOTIFICATION_STATUSES.has(normalizedValue)) {
    throw createHttpError(400, 'Invalid alert notification status.', {
      fieldName: 'status',
      value,
      allowedValues: Array.from(ALLOWED_NOTIFICATION_STATUSES),
    });
  }

  return normalizedValue;
}

function normalizeUuid(value, fieldName = 'id') {
  const normalizedValue = normalizeRequiredString(value, { fieldName });

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalizedValue,
    )
  ) {
    throw createHttpError(400, `${fieldName} must be a valid UUID.`, {
      fieldName,
      value,
    });
  }

  return normalizedValue;
}

function normalizeBoolean(value, fallback = true) {
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

function normalizeThresholdValue(value) {
  if (value === undefined || value === null || value === '') {
    throw createHttpError(400, 'thresholdValue is required.', { fieldName: 'thresholdValue' });
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw createHttpError(400, 'thresholdValue must be numeric.', {
      fieldName: 'thresholdValue',
      value,
    });
  }

  return numberValue;
}

function normalizeIndicatorCode(value) {
  const normalizedValue = normalizeRequiredString(value, {
    fieldName: 'indicatorCode',
  }).toUpperCase();

  if (!/^[A-Z0-9_]+$/.test(normalizedValue)) {
    throw createHttpError(400, 'indicatorCode contains invalid characters.', {
      fieldName: 'indicatorCode',
      value,
    });
  }

  return normalizedValue;
}

function normalizeViewKey(value) {
  const normalizedValue = normalizeRequiredString(value, { fieldName: 'viewKey' })
    .replace(/^macro\.vw_/i, '')
    .replace(/^vw_/i, '')
    .replace(/_/g, '-')
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(normalizedValue)) {
    throw createHttpError(400, 'viewKey contains invalid characters.', {
      fieldName: 'viewKey',
      value,
    });
  }

  return normalizedValue;
}

function normalizeMetricKey(value) {
  const normalizedValue = normalizeRequiredString(value, { fieldName: 'metricKey' });
  const camelizedValue = toCamelCase(normalizedValue);

  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(camelizedValue)) {
    throw createHttpError(400, 'metricKey contains invalid characters.', {
      fieldName: 'metricKey',
      value,
    });
  }

  return camelizedValue;
}

function isNumericColumn(column) {
  return NUMERIC_DATA_TYPES.has(String(column.dataType || '').toLowerCase());
}

async function assertIndicatorExists(indicatorCode) {
  try {
    return await macroReadService.getMacroIndicator(indicatorCode);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    throw createHttpError(404, 'Macro indicator not found.', { indicatorCode });
  }
}

async function assertViewMetricExists(viewKey, metricKey) {
  const payload = await macroReadService.getMacroViewColumns(viewKey);
  const column = (payload.columns || []).find(
    (candidate) =>
      candidate.fieldName === metricKey || toCamelCase(candidate.columnName) === metricKey,
  );

  if (!column) {
    throw createHttpError(404, 'View metric not found.', { viewKey, metricKey });
  }

  if (!isNumericColumn(column)) {
    throw createHttpError(400, 'View metric must be numeric for alerts.', {
      viewKey,
      metricKey,
      dataType: column.dataType,
    });
  }

  return { view: payload.view, column };
}

function normalizeAlertBody(body = {}) {
  const targetType = normalizeTargetType(body.targetType || body.target_type);
  const indicatorCode =
    targetType === 'indicator'
      ? normalizeIndicatorCode(body.indicatorCode || body.indicator_code)
      : null;
  const viewKey =
    targetType === 'view_metric' ? normalizeViewKey(body.viewKey || body.view_key) : null;
  const metricKey =
    targetType === 'view_metric' ? normalizeMetricKey(body.metricKey || body.metric_key) : null;

  return {
    alertKey: body.alertKey || body.alert_key || null,
    title: normalizeRequiredString(body.title, {
      fieldName: 'title',
      maxLength: MAX_TITLE_LENGTH,
    }),
    description: normalizeOptionalString(body.description, {
      fieldName: 'description',
      maxLength: MAX_DESCRIPTION_LENGTH,
    }),
    targetType,
    indicatorCode,
    viewKey,
    metricKey,
    conditionType: normalizeConditionType(body.conditionType || body.condition_type),
    thresholdValue: normalizeThresholdValue(body.thresholdValue ?? body.threshold_value),
    severity: normalizeSeverity(body.severity),
    active: normalizeBoolean(body.active, true),
  };
}

function normalizeAlertPatchBody(body = {}) {
  const patch = {};

  if (body.title !== undefined) {
    patch.title = normalizeRequiredString(body.title, {
      fieldName: 'title',
      maxLength: MAX_TITLE_LENGTH,
    });
  }

  if (body.description !== undefined) {
    patch.description = normalizeOptionalString(body.description, {
      fieldName: 'description',
      maxLength: MAX_DESCRIPTION_LENGTH,
    });
  }

  if (body.conditionType !== undefined || body.condition_type !== undefined) {
    patch.conditionType = normalizeConditionType(body.conditionType || body.condition_type);
  }

  if (body.thresholdValue !== undefined || body.threshold_value !== undefined) {
    patch.thresholdValue = normalizeThresholdValue(body.thresholdValue ?? body.threshold_value);
  }

  if (body.severity !== undefined) {
    patch.severity = normalizeSeverity(body.severity);
  }

  if (body.active !== undefined) {
    patch.active = normalizeBoolean(body.active, true);
  }

  const targetWasProvided =
    body.targetType !== undefined ||
    body.target_type !== undefined ||
    body.indicatorCode !== undefined ||
    body.indicator_code !== undefined ||
    body.viewKey !== undefined ||
    body.view_key !== undefined ||
    body.metricKey !== undefined ||
    body.metric_key !== undefined;

  if (targetWasProvided) {
    const targetType = normalizeTargetType(body.targetType || body.target_type);
    patch.targetType = targetType;
    patch.indicatorCode =
      targetType === 'indicator'
        ? normalizeIndicatorCode(body.indicatorCode || body.indicator_code)
        : null;
    patch.viewKey =
      targetType === 'view_metric' ? normalizeViewKey(body.viewKey || body.view_key) : null;
    patch.metricKey =
      targetType === 'view_metric' ? normalizeMetricKey(body.metricKey || body.metric_key) : null;
  }

  return patch;
}

function sanitizeAlertRule(row, events = []) {
  if (!row) {
    return null;
  }

  return {
    alertId: row.alert_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    alertKey: row.alert_key,
    title: row.title,
    description: row.description,
    targetType: row.target_type,
    indicatorCode: row.indicator_code,
    viewKey: row.view_key,
    metricKey: row.metric_key,
    conditionType: row.condition_type,
    thresholdValue: row.threshold_value === null ? null : Number(row.threshold_value),
    severity: row.severity,
    active: row.active,
    evaluationMetadata: row.evaluation_metadata || {},
    lastStatus: row.last_status,
    lastMessage: row.last_message,
    lastObservedValue: row.last_observed_value === null ? null : Number(row.last_observed_value),
    lastPreviousValue: row.last_previous_value === null ? null : Number(row.last_previous_value),
    lastEvaluatedAt: row.last_evaluated_at,
    lastTriggeredAt: row.last_triggered_at,
    eventCount: Number(row.event_count || 0),
    triggeredEventCount: Number(row.triggered_event_count || 0),
    latestEventAt: row.latest_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events,
  };
}

function sanitizeAlertEvent(row) {
  if (!row) {
    return null;
  }

  return {
    eventId: row.event_id,
    alertId: row.alert_id,
    userId: row.user_id,
    alertKey: row.alert_key,
    alertTitle: row.alert_title,
    targetType: row.target_type,
    indicatorCode: row.indicator_code,
    viewKey: row.view_key,
    metricKey: row.metric_key,
    conditionType: row.condition_type,
    eventStatus: row.event_status,
    observedValue: row.observed_value === null ? null : Number(row.observed_value),
    previousValue: row.previous_value === null ? null : Number(row.previous_value),
    thresholdValue: row.threshold_value === null ? null : Number(row.threshold_value),
    observedAt: row.observed_at,
    previousObservedAt: row.previous_observed_at,
    message: row.message,
    eventMetadata: row.event_metadata || {},
    evaluatedAt: row.evaluated_at,
  };
}

function sanitizeAlertNotification(row) {
  if (!row) {
    return null;
  }

  return {
    notificationId: row.notification_id,
    userId: row.user_id,
    alertId: row.alert_id,
    alertKey: row.alert_key,
    eventId: row.event_id,
    notificationStatus: row.notification_status,
    title: row.title,
    message: row.message,
    severity: row.severity,
    targetType: row.target_type,
    indicatorCode: row.indicator_code,
    viewKey: row.view_key,
    metricKey: row.metric_key,
    observedValue: row.observed_value === null ? null : Number(row.observed_value),
    previousValue: row.previous_value === null ? null : Number(row.previous_value),
    thresholdValue: row.threshold_value === null ? null : Number(row.threshold_value),
    observedAt: row.observed_at,
    evaluatedAt: row.evaluated_at,
    eventMetadata: row.event_metadata || {},
    acknowledgedAt: row.acknowledged_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createUniqueAlertKey(userId, title, requestedKey = null) {
  const baseKey = requestedKey ? normalizeAlertKey(requestedKey) : slugify(title) || 'alert';
  let candidateKey = baseKey;
  let suffix = 2;

  while (suffix < 1000) {
    const result = await query(
      `
        SELECT alert_key
        FROM skyweb.alert_rules
        WHERE user_id = $1
          AND alert_key = $2
        LIMIT 1
      `,
      [userId, candidateKey],
    );

    if (result.rowCount === 0) {
      return candidateKey;
    }

    candidateKey = `${baseKey.slice(0, 120)}-${suffix}`;
    suffix += 1;
  }

  throw createHttpError(409, 'Unable to create a unique alert key.', { title });
}

async function validateAlertTarget(alert) {
  if (alert.targetType === 'indicator') {
    await assertIndicatorExists(alert.indicatorCode);
    return;
  }

  await assertViewMetricExists(alert.viewKey, alert.metricKey);
}

async function getAlertRow(userId, alertKey) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_alert_rules
      WHERE user_id = $1
        AND alert_key = $2
      LIMIT 1
    `,
    [userId, normalizedAlertKey],
  );

  return result.rows[0] || null;
}

async function listAlertEvents(userId, alertKey, options = {}) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const limit = Math.min(Number.parseInt(options.limit, 10) || 25, MAX_EVENT_LIMIT);
  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_alert_rule_events
      WHERE user_id = $1
        AND alert_key = $2
      ORDER BY evaluated_at DESC
      LIMIT $3
    `,
    [userId, normalizedAlertKey, limit],
  );

  return result.rows.map(sanitizeAlertEvent);
}

async function listAlertRules(userId, filters = {}) {
  const clauses = ['user_id = $1'];
  const values = [userId];

  if (filters.active !== undefined && filters.active !== null && filters.active !== '') {
    values.push(normalizeBoolean(filters.active, true));
    clauses.push(`active = $${values.length}`);
  }

  if (filters.targetType || filters.target_type) {
    values.push(normalizeTargetType(filters.targetType || filters.target_type));
    clauses.push(`target_type = $${values.length}`);
  }

  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_alert_rules
      WHERE ${clauses.join(' AND ')}
      ORDER BY active DESC, severity DESC, updated_at DESC, alert_key ASC
    `,
    values,
  );

  return result.rows.map((row) => sanitizeAlertRule(row));
}

async function getAlertRule(userId, alertKey) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const [row, events] = await Promise.all([
    getAlertRow(userId, normalizedAlertKey),
    listAlertEvents(userId, normalizedAlertKey, { limit: 50 }),
  ]);

  if (!row) {
    return null;
  }

  return sanitizeAlertRule(row, events);
}

async function createAlertRule(userId, body = {}) {
  const alert = normalizeAlertBody(body);
  await validateAlertTarget(alert);
  const alertKey = await createUniqueAlertKey(userId, alert.title, alert.alertKey);

  const result = await query(
    `
      INSERT INTO skyweb.alert_rules (
        user_id,
        alert_key,
        title,
        description,
        target_type,
        indicator_code,
        view_key,
        metric_key,
        condition_type,
        threshold_value,
        severity,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING alert_key
    `,
    [
      userId,
      alertKey,
      alert.title,
      alert.description,
      alert.targetType,
      alert.indicatorCode,
      alert.viewKey,
      alert.metricKey,
      alert.conditionType,
      alert.thresholdValue,
      alert.severity,
      alert.active,
    ],
  );

  return getAlertRule(userId, result.rows[0].alert_key);
}

async function updateAlertRule(userId, alertKey, body = {}) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const patch = normalizeAlertPatchBody(body);

  if (Object.keys(patch).length === 0) {
    const existing = await getAlertRule(userId, normalizedAlertKey);

    if (!existing) {
      throw createHttpError(404, 'Alert rule not found.', { alertKey: normalizedAlertKey });
    }

    return existing;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'targetType')) {
    await validateAlertTarget(patch);
  }

  const assignments = [];
  const values = [userId, normalizedAlertKey];

  const addAssignment = (columnName, value) => {
    values.push(value);
    assignments.push(`${columnName} = $${values.length}`);
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    addAssignment('title', patch.title);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    addAssignment('description', patch.description);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'targetType')) {
    addAssignment('target_type', patch.targetType);
    addAssignment('indicator_code', patch.indicatorCode);
    addAssignment('view_key', patch.viewKey);
    addAssignment('metric_key', patch.metricKey);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'conditionType')) {
    addAssignment('condition_type', patch.conditionType);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'thresholdValue')) {
    addAssignment('threshold_value', patch.thresholdValue);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'severity')) {
    addAssignment('severity', patch.severity);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
    addAssignment('active', patch.active);
  }

  const result = await query(
    `
      UPDATE skyweb.alert_rules
      SET ${assignments.join(', ')},
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND alert_key = $2
      RETURNING alert_key
    `,
    values,
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Alert rule not found.', { alertKey: normalizedAlertKey });
  }

  return getAlertRule(userId, normalizedAlertKey);
}

async function removeAlertRule(userId, alertKey) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const result = await query(
    `
      DELETE FROM skyweb.alert_rules
      WHERE user_id = $1
        AND alert_key = $2
      RETURNING alert_key
    `,
    [userId, normalizedAlertKey],
  );

  return {
    alertKey: normalizedAlertKey,
    removed: result.rowCount > 0,
  };
}

function toNumericPoint(point, valueKey = 'value') {
  if (!point) {
    return null;
  }

  const value = Number(point[valueKey]);

  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    date: point.date || point.edate || null,
    value,
  };
}

async function getObservedPoints(alert) {
  if (alert.targetType === 'indicator') {
    const payload = await macroReadService.listMacroIndicatorSeries(alert.indicatorCode, {
      limit: 2,
      sort: 'desc',
    });
    const [latestRaw, previousRaw] = payload.items || [];

    return {
      latest: toNumericPoint(latestRaw),
      previous: toNumericPoint(previousRaw),
      targetLabel: payload.indicator?.description || alert.indicatorCode,
    };
  }

  const payload = await macroReadService.listMacroViewRows(alert.viewKey, {
    limit: 2,
    sort: 'desc',
  });
  const [latestRaw, previousRaw] = payload.items || [];

  return {
    latest: toNumericPoint(latestRaw, alert.metricKey),
    previous: toNumericPoint(previousRaw, alert.metricKey),
    targetLabel: `${payload.view?.label || alert.viewKey} · ${alert.metricKey}`,
  };
}

function evaluateCondition({ conditionType, thresholdValue, latest, previous }) {
  const value = latest?.value;
  const previousValue = previous?.value;

  if (!Number.isFinite(value)) {
    return {
      triggered: false,
      status: 'error',
      message: 'No numeric latest value was available for this alert target.',
    };
  }

  switch (conditionType) {
    case 'above':
      return {
        triggered: value > thresholdValue,
        status: value > thresholdValue ? 'triggered' : 'ok',
        message: `${value} is ${value > thresholdValue ? 'above' : 'not above'} ${thresholdValue}.`,
      };
    case 'below':
      return {
        triggered: value < thresholdValue,
        status: value < thresholdValue ? 'triggered' : 'ok',
        message: `${value} is ${value < thresholdValue ? 'below' : 'not below'} ${thresholdValue}.`,
      };
    case 'crosses_above':
      if (!Number.isFinite(previousValue)) {
        return {
          triggered: false,
          status: 'ok',
          message: 'Crossing check requires a previous value.',
        };
      }

      return {
        triggered: previousValue <= thresholdValue && value > thresholdValue,
        status: previousValue <= thresholdValue && value > thresholdValue ? 'triggered' : 'ok',
        message: `${previousValue} → ${value} ${
          previousValue <= thresholdValue && value > thresholdValue
            ? 'crossed above'
            : 'did not cross above'
        } ${thresholdValue}.`,
      };
    case 'crosses_below':
      if (!Number.isFinite(previousValue)) {
        return {
          triggered: false,
          status: 'ok',
          message: 'Crossing check requires a previous value.',
        };
      }

      return {
        triggered: previousValue >= thresholdValue && value < thresholdValue,
        status: previousValue >= thresholdValue && value < thresholdValue ? 'triggered' : 'ok',
        message: `${previousValue} → ${value} ${
          previousValue >= thresholdValue && value < thresholdValue
            ? 'crossed below'
            : 'did not cross below'
        } ${thresholdValue}.`,
      };
    case 'changes_by':
      if (!Number.isFinite(previousValue)) {
        return {
          triggered: false,
          status: 'ok',
          message: 'Change check requires a previous value.',
        };
      }

      return {
        triggered: Math.abs(value - previousValue) >= thresholdValue,
        status: Math.abs(value - previousValue) >= thresholdValue ? 'triggered' : 'ok',
        message: `Absolute change is ${Math.abs(value - previousValue)} versus threshold ${thresholdValue}.`,
      };
    case 'percent_changes_by':
      if (!Number.isFinite(previousValue) || previousValue === 0) {
        return {
          triggered: false,
          status: 'ok',
          message: 'Percent change check requires a non-zero previous value.',
        };
      }

      {
        const percentChange = Math.abs(((value - previousValue) / Math.abs(previousValue)) * 100);
        return {
          triggered: percentChange >= thresholdValue,
          status: percentChange >= thresholdValue ? 'triggered' : 'ok',
          message: `Percent change is ${percentChange.toFixed(4)}% versus threshold ${thresholdValue}%.`,
        };
      }
    default:
      return {
        triggered: false,
        status: 'error',
        message: `Unsupported condition type: ${conditionType}.`,
      };
  }
}

async function getAlertRuleForEvaluation(userId, alertKey) {
  const normalizedAlertKey = normalizeAlertKey(alertKey);
  const result = await query(
    `
      SELECT *
      FROM skyweb.alert_rules
      WHERE user_id = $1
        AND alert_key = $2
      LIMIT 1
    `,
    [userId, normalizedAlertKey],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Alert rule not found.', { alertKey: normalizedAlertKey });
  }

  return result.rows[0];
}

async function writeEvaluationEvent(alertRow, evaluation, context = {}) {
  const latest = evaluation.latest || null;
  const previous = evaluation.previous || null;
  const eventStatus = evaluation.status || 'ok';
  const isTriggered = eventStatus === 'triggered';
  const evaluationSource = normalizeOptionalString(context.evaluationSource) || 'manual';
  const eventMetadata = {
    targetLabel: evaluation.targetLabel || null,
    evaluationSource,
    ...(context.eventMetadata &&
    typeof context.eventMetadata === 'object' &&
    !Array.isArray(context.eventMetadata)
      ? context.eventMetadata
      : {}),
  };

  const eventResult = await query(
    `
      INSERT INTO skyweb.alert_rule_events (
        alert_id,
        event_status,
        observed_value,
        previous_value,
        threshold_value,
        observed_at,
        previous_observed_at,
        message,
        event_metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING event_id, evaluated_at
    `,
    [
      alertRow.alert_id,
      eventStatus,
      latest?.value ?? null,
      previous?.value ?? null,
      alertRow.threshold_value,
      latest?.date ?? null,
      previous?.date ?? null,
      evaluation.message || null,
      JSON.stringify(eventMetadata),
    ],
  );
  const eventId = eventResult.rows[0]?.event_id || null;
  const evaluatedAt = eventResult.rows[0]?.evaluated_at || null;

  if (isTriggered && eventId) {
    await query(
      `
        INSERT INTO skyweb.alert_notifications (
          user_id,
          alert_id,
          event_id,
          notification_status,
          title,
          message,
          severity,
          target_type,
          indicator_code,
          view_key,
          metric_key,
          observed_value,
          previous_value,
          threshold_value,
          observed_at,
          evaluated_at
        )
        VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15, CURRENT_TIMESTAMP))
        ON CONFLICT (event_id) DO NOTHING
      `,
      [
        alertRow.user_id,
        alertRow.alert_id,
        eventId,
        alertRow.title,
        evaluation.message || null,
        alertRow.severity,
        alertRow.target_type,
        alertRow.indicator_code,
        alertRow.view_key,
        alertRow.metric_key,
        latest?.value ?? null,
        previous?.value ?? null,
        alertRow.threshold_value,
        latest?.date ?? null,
        evaluatedAt,
      ],
    );
  }

  await query(
    `
      UPDATE skyweb.alert_rules
      SET last_status = $2,
          last_message = $3,
          last_observed_value = $4,
          last_previous_value = $5,
          last_evaluated_at = CURRENT_TIMESTAMP,
          last_triggered_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE last_triggered_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE alert_id = $1
    `,
    [
      alertRow.alert_id,
      eventStatus,
      evaluation.message || null,
      latest?.value ?? null,
      previous?.value ?? null,
      isTriggered,
    ],
  );

  return eventId;
}

async function evaluateAlertRule(userId, alertKey, options = {}) {
  const alertRow = await getAlertRuleForEvaluation(userId, alertKey);
  let evaluation;

  try {
    const observed = await getObservedPoints({
      targetType: alertRow.target_type,
      indicatorCode: alertRow.indicator_code,
      viewKey: alertRow.view_key,
      metricKey: alertRow.metric_key,
    });
    const condition = evaluateCondition({
      conditionType: alertRow.condition_type,
      thresholdValue: Number(alertRow.threshold_value),
      latest: observed.latest,
      previous: observed.previous,
    });

    evaluation = {
      ...observed,
      ...condition,
    };
  } catch (error) {
    evaluation = {
      latest: null,
      previous: null,
      status: 'error',
      triggered: false,
      message: error.message || 'Alert evaluation failed.',
      targetLabel: null,
    };
  }

  const eventId = await writeEvaluationEvent(alertRow, evaluation, {
    evaluationSource: options.evaluationSource || options.source || 'manual',
    eventMetadata: options.eventMetadata || {},
  });
  const [eventResult, alert] = await Promise.all([
    query('SELECT * FROM skyweb.vw_alert_rule_events WHERE event_id = $1 LIMIT 1', [eventId]),
    getAlertRule(userId, alertRow.alert_key),
  ]);

  return {
    alert,
    event: sanitizeAlertEvent(eventResult.rows[0]),
  };
}

async function evaluateAlertRules(userId, filters = {}) {
  const alertRules = await listAlertRules(userId, { active: filters.active ?? true });
  const results = [];

  for (const alert of alertRules) {
    if (filters.active === true && !alert.active) {
      continue;
    }

    // Evaluate serially so DB writes are deterministic and easier to debug.
    // This is a foundation endpoint, not the future high-throughput scheduler.

    results.push(
      await evaluateAlertRule(userId, alert.alertKey, {
        evaluationSource: filters.evaluationSource || filters.source || 'manual',
        eventMetadata: filters.eventMetadata || {},
      }),
    );
  }

  return results;
}

async function listAlertRowsForScheduledEvaluation({ activeOnly = true, limit = 500 } = {}) {
  const values = [];
  const clauses = [];

  if (activeOnly) {
    clauses.push('active = TRUE');
  }

  values.push(Math.max(1, Math.min(Number.parseInt(limit, 10) || 500, 5000)));

  const result = await query(
    `
      SELECT user_id, alert_key
      FROM skyweb.alert_rules
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY last_evaluated_at ASC NULLS FIRST, updated_at ASC, alert_key ASC
      LIMIT $${values.length}
    `,
    values,
  );

  return result.rows;
}

function summarizeEvaluationResults(results = []) {
  const summary = {
    evaluatedCount: results.length,
    triggeredCount: 0,
    okCount: 0,
    errorCount: 0,
    failedCount: 0,
  };

  for (const result of results) {
    const status = result?.event?.eventStatus || result?.status;

    if (status === 'triggered') {
      summary.triggeredCount += 1;
    } else if (status === 'ok') {
      summary.okCount += 1;
    } else if (status === 'error') {
      summary.errorCount += 1;
    } else if (status === 'failed') {
      summary.failedCount += 1;
    }
  }

  return summary;
}

async function evaluateActiveAlertRulesForAllUsers(options = {}) {
  const batchId = options.batchId || `skyweb-alert-batch-${Date.now()}`;
  const alertRows = await listAlertRowsForScheduledEvaluation({
    activeOnly: options.activeOnly !== false,
    limit: options.limit || options.maxRules || 500,
  });
  const results = [];

  for (const row of alertRows) {
    try {
      // Keep scheduled evaluation serial in v1. Alerts are stateful audit events, and serial
      // writes make troubleshooting far cleaner than a noisy parallel batch.

      results.push(
        await evaluateAlertRule(row.user_id, row.alert_key, {
          evaluationSource: options.evaluationSource || 'worker_schedule',
          eventMetadata: {
            batchId,
            scheduleCode: options.scheduleCode || null,
            scheduleRunId: options.scheduleRunId || null,
            workerNodeId: options.workerNodeId || null,
            workerNodeName: options.workerNodeName || null,
          },
        }),
      );
    } catch (error) {
      results.push({
        status: 'failed',
        alertKey: row.alert_key,
        userId: row.user_id,
        error: error.message || String(error),
      });
    }
  }

  return {
    batchId,
    activeOnly: options.activeOnly !== false,
    limit: options.limit || options.maxRules || 500,
    ...summarizeEvaluationResults(results),
    results,
  };
}

function summarizeNotifications(rows = []) {
  return rows.reduce(
    (summary, notification) => {
      summary.total += 1;
      summary.byStatus[notification.notificationStatus] =
        (summary.byStatus[notification.notificationStatus] || 0) + 1;
      summary.bySeverity[notification.severity] =
        (summary.bySeverity[notification.severity] || 0) + 1;
      return summary;
    },
    {
      total: 0,
      byStatus: {},
      bySeverity: {},
    },
  );
}

async function listAlertNotifications(userId, filters = {}) {
  const clauses = ['user_id = $1'];
  const values = [userId];
  const status = normalizeNotificationStatus(filters.status, 'open');
  const limit = Math.min(Number.parseInt(filters.limit, 10) || 25, MAX_NOTIFICATION_LIMIT);

  if (status !== 'all') {
    values.push(status);
    clauses.push(`notification_status = $${values.length}`);
  }

  if (filters.alertKey || filters.alert_key) {
    values.push(normalizeAlertKey(filters.alertKey || filters.alert_key));
    clauses.push(`alert_key = $${values.length}`);
  }

  if (filters.severity) {
    values.push(normalizeSeverity(filters.severity));
    clauses.push(`severity = $${values.length}`);
  }

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total_count
      FROM skyweb.vw_alert_notifications
      WHERE ${clauses.join(' AND ')}
    `,
    values,
  );

  values.push(limit);

  const result = await query(
    `
      SELECT *
      FROM skyweb.vw_alert_notifications
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE notification_status
          WHEN 'open' THEN 0
          WHEN 'acknowledged' THEN 1
          WHEN 'dismissed' THEN 2
          ELSE 3
        END,
        evaluated_at DESC,
        created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );

  const items = result.rows.map(sanitizeAlertNotification);

  return {
    total: Number(countResult.rows[0]?.total_count || 0),
    items,
    summary: summarizeNotifications(items),
  };
}

async function updateAlertNotificationStatus(userId, notificationId, status) {
  const normalizedNotificationId = normalizeUuid(notificationId, 'notificationId');
  const normalizedStatus = normalizeNotificationStatus(status, 'acknowledged');

  if (normalizedStatus === 'all') {
    throw createHttpError(400, 'Notification status cannot be all for update.', {
      fieldName: 'status',
      status,
    });
  }

  const result = await query(
    `
      UPDATE skyweb.alert_notifications
      SET notification_status = $3,
          acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN CURRENT_TIMESTAMP ELSE acknowledged_at END,
          dismissed_at = CASE WHEN $3 = 'dismissed' THEN CURRENT_TIMESTAMP ELSE dismissed_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
        AND notification_id = $2
      RETURNING notification_id
    `,
    [userId, normalizedNotificationId, normalizedStatus],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Alert notification not found.', {
      notificationId: normalizedNotificationId,
    });
  }

  const notification = await query(
    `
      SELECT *
      FROM skyweb.vw_alert_notifications
      WHERE user_id = $1
        AND notification_id = $2
      LIMIT 1
    `,
    [userId, normalizedNotificationId],
  );

  return sanitizeAlertNotification(notification.rows[0]);
}

async function acknowledgeAlertNotification(userId, notificationId) {
  return updateAlertNotificationStatus(userId, notificationId, 'acknowledged');
}

async function dismissAlertNotification(userId, notificationId) {
  return updateAlertNotificationStatus(userId, notificationId, 'dismissed');
}

async function acknowledgeAllAlertNotifications(userId, filters = {}) {
  const values = [userId];
  const clauses = ['user_id = $1', "notification_status = 'open'"];

  if (filters.alertKey || filters.alert_key) {
    values.push(normalizeAlertKey(filters.alertKey || filters.alert_key));
    clauses.push(
      `alert_id IN (SELECT alert_id FROM skyweb.alert_rules WHERE user_id = $1 AND alert_key = $${values.length})`,
    );
  }

  const result = await query(
    `
      UPDATE skyweb.alert_notifications
      SET notification_status = 'acknowledged',
          acknowledged_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE ${clauses.join(' AND ')}
      RETURNING notification_id
    `,
    values,
  );

  return {
    acknowledgedCount: result.rowCount,
  };
}

module.exports = {
  acknowledgeAllAlertNotifications,
  acknowledgeAlertNotification,
  createAlertRule,
  evaluateActiveAlertRulesForAllUsers,
  evaluateAlertRule,
  evaluateAlertRules,
  getAlertRule,
  dismissAlertNotification,
  listAlertEvents,
  listAlertNotifications,
  listAlertRules,
  removeAlertRule,
  updateAlertRule,
};
