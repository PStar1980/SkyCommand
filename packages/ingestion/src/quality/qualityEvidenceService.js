let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }
  return databaseQuery;
}

const QUALITY_EVIDENCE_CONTRACT_VERSION = 'ingestion_quality_evidence.v1';
const CODE_FIELDS = new Set(['domainCode', 'sourceCode', 'assetCode', 'checkCode', 'severityCode']);

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCode(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if ([true, 'true', 't', '1', 1].includes(value)) return true;
  if ([false, 'false', 'f', '0', 0].includes(value)) return false;
  const error = new Error(`Invalid boolean value: ${value}`);
  error.statusCode = 400;
  throw error;
}

function normalizePagination(filters = {}) {
  const requestedLimit = Number.parseInt(filters.limit, 10);
  const requestedOffset = Number.parseInt(filters.offset, 10);
  return {
    limit: Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 250) : 50,
    offset: Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0,
  };
}

function buildFilters(filters, mappings) {
  const values = [];
  const clauses = [];
  for (const [key, column] of mappings) {
    const raw = normalizeText(filters[key]);
    if (!raw) continue;
    values.push(CODE_FIELDS.has(key) ? normalizeCode(raw) : raw);
    clauses.push(`${column} = $${values.length}`);
  }
  return { values, clauses };
}

async function listView(viewName, filters, mappings, sanitizer, options = {}) {
  const query = options.query || getDatabaseQuery();
  const { limit, offset } = normalizePagination(filters);
  const { values, clauses } = buildFilters(filters, mappings);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countValues = [...values];
  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(offset);
  const offsetParam = `$${values.length}`;

  const [countResult, rowsResult] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM ${viewName} ${where}`, countValues),
    query(
      `SELECT * FROM ${viewName} ${where} ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    ),
  ]);

  return {
    contractVersion: QUALITY_EVIDENCE_CONTRACT_VERSION,
    total: Number(countResult.rows[0]?.total || 0),
    limit,
    offset,
    items: rowsResult.rows.map(sanitizer),
  };
}

function sanitizeQualityEvent(row) {
  return {
    eventType: 'QUALITY',
    qualityEventId: row.quality_event_id,
    ingestionRunId: row.ingestion_run_id,
    ingestionRunItemId: row.ingestion_run_item_id,
    domainCode: row.domain_code,
    sourceCode: row.source_code,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    checkCode: row.check_code,
    checkName: row.check_name,
    severityCode: row.severity_code,
    blocking: row.blocking === true,
    observationKey: row.observation_key || null,
    sourceRowNumber: row.source_row_number === null ? null : Number(row.source_row_number),
    message: row.message,
    evidence: row.evidence || {},
    createdAt: row.created_at,
  };
}

function sanitizeRevisionEvent(row) {
  return {
    eventType: 'REVISION',
    revisionEventId: row.revision_event_id,
    ingestionRunId: row.ingestion_run_id,
    ingestionRunItemId: row.ingestion_run_item_id,
    domainCode: row.domain_code,
    sourceCode: row.source_code,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    observationKey: row.observation_key,
    observationDate: row.observation_date || null,
    oldValue: row.old_value,
    newValue: row.new_value,
    detectedAt: row.detected_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function sanitizeRejectionEvent(row) {
  return {
    eventType: 'REJECTION',
    rejectionEventId: row.rejection_event_id,
    ingestionRunId: row.ingestion_run_id,
    ingestionRunItemId: row.ingestion_run_item_id,
    domainCode: row.domain_code,
    sourceCode: row.source_code,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    checkCode: row.check_code,
    checkName: row.check_name,
    severityCode: row.severity_code,
    sourceRowNumber: row.source_row_number === null ? null : Number(row.source_row_number),
    observationKey: row.observation_key || null,
    rawPayload: row.raw_payload || {},
    normalizedPayload: row.normalized_payload || {},
    message: row.message,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}

function listQualityEvents(filters = {}, options = {}) {
  const blocking = normalizeBoolean(filters.blocking);
  const normalized = { ...filters };
  const mappings = [
    ['domainCode', 'domain_code'],
    ['sourceCode', 'source_code'],
    ['assetCode', 'asset_code'],
    ['ingestionRunId', 'ingestion_run_id'],
    ['checkCode', 'check_code'],
    ['severityCode', 'severity_code'],
  ];
  if (blocking !== null) {
    normalized.blockingFilter = String(blocking);
    mappings.push(['blockingFilter', 'blocking']);
  }
  return listView('data.vw_ingestion_quality_events', normalized, mappings, sanitizeQualityEvent, options);
}

function listRevisionEvents(filters = {}, options = {}) {
  return listView(
    'data.vw_ingestion_revision_events',
    filters,
    [
      ['domainCode', 'domain_code'],
      ['sourceCode', 'source_code'],
      ['assetCode', 'asset_code'],
      ['ingestionRunId', 'ingestion_run_id'],
    ],
    sanitizeRevisionEvent,
    options,
  );
}

function listRejectionEvents(filters = {}, options = {}) {
  return listView(
    'data.vw_ingestion_rejection_events',
    filters,
    [
      ['domainCode', 'domain_code'],
      ['sourceCode', 'source_code'],
      ['assetCode', 'asset_code'],
      ['ingestionRunId', 'ingestion_run_id'],
      ['checkCode', 'check_code'],
      ['severityCode', 'severity_code'],
    ],
    sanitizeRejectionEvent,
    options,
  );
}

module.exports = {
  QUALITY_EVIDENCE_CONTRACT_VERSION,
  listQualityEvents,
  listRejectionEvents,
  listRevisionEvents,
  normalizeBoolean,
  normalizePagination,
};
