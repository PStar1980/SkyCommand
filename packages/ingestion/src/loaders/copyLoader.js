const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildMetadataQualityIssues,
  getCheckPolicy,
} = require('../quality/qualityPolicy');

const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024 * 1024;

const assertSafeIdentifier = (value) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe table/indicator name: ${value}`);
  }
};

const quoteIdentifier = (value) => `"${value.replace(/"/g, '""')}"`;

function quoteRelationName(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 2) throw new Error(`Relation must use schema.table form: ${value}`);
  parts.forEach(assertSafeIdentifier);
  return `${quoteIdentifier(parts[0])}.${quoteIdentifier(parts[1])}`;
}

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sqlJsonLiteral(value) {
  return `${sqlLiteral(JSON.stringify(value ?? {}))}::jsonb`;
}

function buildStaticIssueInsert(issueTable, issues = []) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const values = issues.map((issue) => `(${[
    sqlLiteral(issue.checkCode),
    sqlLiteral(issue.severityCode || 'WARNING'),
    issue.blocking ? 'TRUE' : 'FALSE',
    issue.observationKey ? sqlLiteral(issue.observationKey) : 'NULL',
    issue.sourceRowNumber ? Number(issue.sourceRowNumber) : 'NULL',
    sqlLiteral(issue.message || 'Quality-policy finding.'),
    sqlJsonLiteral(issue.evidence || {}),
  ].join(', ')})`);
  return `INSERT INTO ${issueTable} (`
    + 'check_code, severity_code, blocking, observation_key, source_row_number, message, evidence'
    + `) VALUES ${values.join(', ')};`;
}

const getPsqlArgs = (sqlFile) => {
  if (!process.env.PGDATABASE) {
    throw new Error('PGDATABASE is not defined');
  }

  return [
    '-q',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    process.env.PGHOST || 'localhost',
    '-p',
    process.env.PGPORT || '5432',
    '-U',
    process.env.PGUSER || 'postgres',
    '-d',
    process.env.PGDATABASE,
    '-t',
    '-A',
    '-f',
    sqlFile,
  ];
};

const EVIDENCE_METRIC_KEYS = new Set([
  'revision_events_b64',
  'rejection_events_b64',
  'quality_issues_b64',
]);

const BASE64_CONTINUATION_PATTERN = /^[A-Za-z0-9+/=]+$/;

const getCleanOutputLines = (output) => String(output || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

function collectOutputMetrics(output) {
  const metrics = new Map();
  let activeEvidenceKey = null;

  getCleanOutputLines(output).forEach((line) => {
    // Check continuation before the generic key=value parser. A final base64
    // fragment may end in '=' padding and otherwise look like a metric line.
    if (activeEvidenceKey && BASE64_CONTINUATION_PATTERN.test(line)) {
      metrics.set(activeEvidenceKey, `${metrics.get(activeEvidenceKey) || ''}${line}`);
      return;
    }

    const match = line.match(/^([a-z0-9_]+)=(.*)$/i);

    if (match) {
      const key = match[1].toLowerCase();
      metrics.set(key, match[2].trim());
      activeEvidenceKey = EVIDENCE_METRIC_KEYS.has(key) ? key : null;
      return;
    }

    // PostgreSQL encode(..., 'base64') may wrap output at RFC 2045 line widths.
    // Preserve those continuation lines so evidence remains decodable even when
    // an older/generated SQL statement does not strip the line breaks itself.
    activeEvidenceKey = null;
  });

  return metrics;
}

const printCleanOutput = (output) => {
  let suppressEvidenceContinuation = false;

  getCleanOutputLines(output).forEach((line) => {
    if (suppressEvidenceContinuation && BASE64_CONTINUATION_PATTERN.test(line)) return;

    const match = line.match(/^([a-z0-9_]+)=(.*)$/i);
    if (match) {
      const key = match[1].toLowerCase();
      suppressEvidenceContinuation = EVIDENCE_METRIC_KEYS.has(key);
      if (!suppressEvidenceContinuation) console.log(line);
      return;
    }

    suppressEvidenceContinuation = false;
    console.log(line);
  });
};

function parseMetricInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetricDate(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseBase64Json(value, fallback = []) {
  const text = String(value || '').trim();
  if (!text) return fallback;

  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    const wrapped = new Error(`Could not decode ingestion evidence: ${error.message}`);
    wrapped.code = 'INGESTION_EVIDENCE_DECODE_FAILED';
    throw wrapped;
  }
}

function parseCopyOutput(output) {
  const metrics = collectOutputMetrics(output);

  return {
    stagingRows: parseMetricInteger(metrics.get('staging_rows')),
    acceptedRows: parseMetricInteger(metrics.get('accepted_rows')),
    stagingMinDate: parseMetricDate(metrics.get('staging_min')),
    stagingMaxDate: parseMetricDate(metrics.get('staging_max')),
    previousTargetMaxDate: parseMetricDate(metrics.get('previous_target_max')),
    newRowsDetected: parseMetricInteger(metrics.get('new_rows')),
    rowsInserted: parseMetricInteger(metrics.get('inserted_rows')),
    rowsUpdated: parseMetricInteger(metrics.get('updated_rows')),
    rowsUnchanged: parseMetricInteger(metrics.get('unchanged_rows')),
    rowsRejected: parseMetricInteger(metrics.get('rejected_rows')),
    revisionsDetected: parseMetricInteger(metrics.get('revisions_detected')),
    qualityIssueCount: parseMetricInteger(metrics.get('quality_issue_count')),
    qualityStatusCode: String(metrics.get('quality_status') || 'PASS').trim().toUpperCase(),
    currentTargetMaxDate: parseMetricDate(metrics.get('target_max')),
    revisionEvents: parseBase64Json(metrics.get('revision_events_b64'), []),
    rejectionEvents: parseBase64Json(metrics.get('rejection_events_b64'), []),
    qualityIssues: parseBase64Json(metrics.get('quality_issues_b64'), []),
  };
}

function buildRevisionAwareCopySql({ targetTable, tempTable, normalizedPath, qualityContext = null }) {
  const rawTable = `${tempTable}_raw`;
  const parsedTable = `${tempTable}_parsed`;
  const rejectionTable = `${tempTable}_rejections`;
  const issueTable = `${tempTable}_issues`;
  const acceptedTable = `${tempTable}_accepted`;
  const revisionTable = `${tempTable}_revisions`;
  const newRowsTable = `${tempTable}_new_rows`;
  const unchangedTable = `${tempTable}_unchanged`;
  const decisionTable = `${tempTable}_load_decision`;
  const appliedRevisionTable = `${tempTable}_applied_revisions`;
  const appliedNewRowsTable = `${tempTable}_applied_new_rows`;

  const sourceRegression = getCheckPolicy(qualityContext, 'SOURCE_DATE_REGRESSION', {
    enabled: true,
    severityCode: 'WARNING',
    blocking: false,
  });
  const gapPolicy = getCheckPolicy(qualityContext, 'UNEXPECTED_GAP');
  const rowCountPolicy = getCheckPolicy(qualityContext, 'ROW_COUNT_ANOMALY');
  const metadataIssues = buildMetadataQualityIssues(qualityContext);
  const metadataInsert = buildStaticIssueInsert(issueTable, metadataIssues);
  const maxGapDays = optionalNonNegativeInteger(gapPolicy.parameters?.maxGapDays);
  const minRows = optionalNonNegativeInteger(rowCountPolicy.parameters?.minRows);
  const maxRows = optionalNonNegativeInteger(rowCountPolicy.parameters?.maxRows);

  const sql = [
    'SET client_min_messages TO WARNING;',
    'BEGIN;',
    `DROP TABLE IF EXISTS ${rawTable};`,
    `CREATE TEMP TABLE ${rawTable} (`
      + 'source_row_number BIGINT GENERATED ALWAYS AS IDENTITY, '
      + 'edate_text TEXT, value_text TEXT);',
    `\\copy ${rawTable} (edate_text, value_text) FROM ${sqlLiteral(normalizedPath)} WITH CSV HEADER`,
    `CREATE OR REPLACE FUNCTION pg_temp.try_date(input_value TEXT) RETURNS DATE `
      + 'LANGUAGE plpgsql IMMUTABLE AS $fn$ '
      + "BEGIN RETURN NULLIF(BTRIM(input_value), '')::DATE; "
      + 'EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $fn$;',
    `CREATE OR REPLACE FUNCTION pg_temp.try_numeric(input_value TEXT) RETURNS NUMERIC `
      + 'LANGUAGE plpgsql IMMUTABLE AS $fn$ '
      + "BEGIN RETURN NULLIF(BTRIM(input_value), '')::NUMERIC; "
      + 'EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $fn$;',
    `CREATE TEMP TABLE ${parsedTable} AS `
      + 'SELECT source_row_number, edate_text, value_text, '
      + 'pg_temp.try_date(edate_text) AS edate, '
      + 'pg_temp.try_numeric(value_text) AS value '
      + `FROM ${rawTable};`,
    `CREATE TEMP TABLE ${rejectionTable} (`
      + 'source_row_number BIGINT, check_code TEXT, severity_code TEXT, '
      + 'observation_key TEXT, raw_payload JSONB, normalized_payload JSONB, message TEXT);',
    `INSERT INTO ${rejectionTable} `
      + "SELECT source_row_number, 'INVALID_DATE', 'ERROR', NULL, "
      + "jsonb_build_object('edate', edate_text, 'value', value_text), '{}'::jsonb, "
      + "'Observation date is missing or invalid.' "
      + `FROM ${parsedTable} WHERE edate IS NULL;`,
    `INSERT INTO ${rejectionTable} `
      + "SELECT source_row_number, 'INVALID_NUMERIC', 'ERROR', COALESCE(edate::text, NULL), "
      + "jsonb_build_object('edate', edate_text, 'value', value_text), "
      + "jsonb_build_object('edate', edate), "
      + "'Observation value is missing or invalid.' "
      + `FROM ${parsedTable} WHERE edate IS NOT NULL AND value IS NULL;`,
    `CREATE TEMP TABLE ${tempTable} AS `
      + 'SELECT source_row_number, edate, value, '
      + 'ROW_NUMBER() OVER (PARTITION BY edate ORDER BY source_row_number DESC) AS duplicate_rank '
      + `FROM ${parsedTable} WHERE edate IS NOT NULL AND value IS NOT NULL;`,
    `INSERT INTO ${rejectionTable} `
      + "SELECT source_row_number, 'DUPLICATE_KEY', 'WARNING', edate::text, "
      + "jsonb_build_object('edate', edate, 'value', value), "
      + "jsonb_build_object('acceptedSourceRowNumber', "
      + `(SELECT chosen.source_row_number FROM ${tempTable} chosen `
      + 'WHERE chosen.edate = duplicate.edate AND chosen.duplicate_rank = 1)), '
      + "'Duplicate observation key; the last source row was accepted deterministically.' "
      + `FROM ${tempTable} duplicate WHERE duplicate_rank > 1;`,
    `CREATE TEMP TABLE ${acceptedTable} AS `
      + `SELECT edate, value FROM ${tempTable} WHERE duplicate_rank = 1;`,
    `CREATE TEMP TABLE ${revisionTable} AS `
      + 'SELECT accepted.edate, target.value AS old_value, accepted.value AS new_value '
      + `FROM ${acceptedTable} accepted JOIN ${targetTable} target USING (edate) `
      + 'WHERE target.value IS DISTINCT FROM accepted.value;',
    `CREATE TEMP TABLE ${newRowsTable} AS `
      + `SELECT accepted.edate, accepted.value FROM ${acceptedTable} accepted `
      + `WHERE NOT EXISTS (SELECT 1 FROM ${targetTable} target WHERE target.edate = accepted.edate);`,
    `CREATE TEMP TABLE ${unchangedTable} AS `
      + `SELECT accepted.edate FROM ${acceptedTable} accepted `
      + `JOIN ${targetTable} target USING (edate) WHERE target.value IS NOT DISTINCT FROM accepted.value;`,
    `CREATE TEMP TABLE ${issueTable} (`
      + 'check_code TEXT, severity_code TEXT, blocking BOOLEAN, observation_key TEXT, '
      + 'source_row_number BIGINT, message TEXT, evidence JSONB);',
    `INSERT INTO ${issueTable} `
      + "SELECT 'EMPTY_RESPONSE', 'ERROR', TRUE, NULL, NULL, "
      + "'The source file contained no data rows.', jsonb_build_object('rowsReceived', 0) "
      + `WHERE NOT EXISTS (SELECT 1 FROM ${rawTable});`,
    `INSERT INTO ${issueTable} `
      + "SELECT 'NO_VALID_ROWS', 'ERROR', TRUE, NULL, NULL, "
      + "'No source rows passed date, numeric, and duplicate-key validation.', "
      + `(SELECT jsonb_build_object('rowsReceived', COUNT(*)) FROM ${rawTable}) `
      + `WHERE EXISTS (SELECT 1 FROM ${rawTable}) AND NOT EXISTS (SELECT 1 FROM ${acceptedTable});`,
  ];

  if (metadataInsert) sql.push(metadataInsert);

  if (sourceRegression.enabled) {
    sql.push(
      `INSERT INTO ${issueTable} `
        + `SELECT 'SOURCE_DATE_REGRESSION', ${sqlLiteral(sourceRegression.severityCode)}, `
        + `${sourceRegression.blocking ? 'TRUE' : 'FALSE'}, NULL, NULL, `
        + "'The source maximum date is earlier than the existing target maximum date.', "
        + `jsonb_build_object('sourceMaxDate', (SELECT MAX(edate) FROM ${acceptedTable}), `
        + `'targetMaxDate', (SELECT MAX(edate) FROM ${targetTable}), `
        + `'policyOriginCode', ${sqlLiteral(sourceRegression.originCode)}, `
        + `'policyParameters', ${sqlJsonLiteral(sourceRegression.parameters)}) `
        + `WHERE (SELECT MAX(edate) FROM ${acceptedTable}) IS NOT NULL `
        + `AND (SELECT MAX(edate) FROM ${targetTable}) IS NOT NULL `
        + `AND (SELECT MAX(edate) FROM ${acceptedTable}) < (SELECT MAX(edate) FROM ${targetTable});`,
    );
  }

  if (gapPolicy.enabled && maxGapDays !== null) {
    sql.push(
      `WITH ordered AS (`
        + `SELECT edate, LAG(edate) OVER (ORDER BY edate) AS previous_edate FROM ${acceptedTable}`
        + `), gaps AS (`
        + `SELECT previous_edate, edate, (edate - previous_edate)::int AS gap_days `
        + `FROM ordered WHERE previous_edate IS NOT NULL AND (edate - previous_edate)::int > ${maxGapDays}`
        + `) INSERT INTO ${issueTable} `
        + `SELECT 'UNEXPECTED_GAP', ${sqlLiteral(gapPolicy.severityCode)}, `
        + `${gapPolicy.blocking ? 'TRUE' : 'FALSE'}, NULL, NULL, `
        + `'The accepted source series contains one or more gaps beyond the configured tolerance.', `
        + `jsonb_build_object('maxGapDays', ${maxGapDays}, 'gapCount', COUNT(*), `
        + `'largestGapDays', MAX(gap_days), 'firstGapStart', MIN(previous_edate), `
        + `'lastGapEnd', MAX(edate), 'policyOriginCode', ${sqlLiteral(gapPolicy.originCode)}, `
        + `'policyParameters', ${sqlJsonLiteral(gapPolicy.parameters)}) `
        + `FROM gaps HAVING COUNT(*) > 0;`,
    );
  }

  if (rowCountPolicy.enabled && (minRows !== null || maxRows !== null)) {
    const conditions = [];
    if (minRows !== null) conditions.push(`COUNT(*) < ${minRows}`);
    if (maxRows !== null) conditions.push(`COUNT(*) > ${maxRows}`);
    sql.push(
      `INSERT INTO ${issueTable} `
        + `SELECT 'ROW_COUNT_ANOMALY', ${sqlLiteral(rowCountPolicy.severityCode)}, `
        + `${rowCountPolicy.blocking ? 'TRUE' : 'FALSE'}, NULL, NULL, `
        + `'The accepted source row count is outside the configured range.', `
        + `jsonb_build_object('acceptedRows', COUNT(*), `
        + `'minRows', ${minRows === null ? 'NULL' : minRows}, `
        + `'maxRows', ${maxRows === null ? 'NULL' : maxRows}, `
        + `'policyOriginCode', ${sqlLiteral(rowCountPolicy.originCode)}, `
        + `'policyParameters', ${sqlJsonLiteral(rowCountPolicy.parameters)}) `
        + `FROM ${acceptedTable} HAVING ${conditions.join(' OR ')};`,
    );
  }

  sql.push(
    `CREATE TEMP TABLE ${decisionTable} AS `
      + `SELECT NOT EXISTS (SELECT 1 FROM ${issueTable} WHERE blocking = TRUE) AS allowed;`,
    `CREATE TEMP TABLE ${appliedRevisionTable} AS `
      + `SELECT revision.* FROM ${revisionTable} revision, ${decisionTable} decision WHERE decision.allowed;`,
    `CREATE TEMP TABLE ${appliedNewRowsTable} AS `
      + `SELECT new_row.* FROM ${newRowsTable} new_row, ${decisionTable} decision WHERE decision.allowed;`,
    `SELECT 'staging_rows=' || COUNT(*) FROM ${rawTable};`,
    `SELECT 'accepted_rows=' || COUNT(*) FROM ${acceptedTable};`,
    `SELECT 'staging_min=' || COALESCE(MIN(edate)::text, '') FROM ${acceptedTable};`,
    `SELECT 'staging_max=' || COALESCE(MAX(edate)::text, '') FROM ${acceptedTable};`,
    `SELECT 'previous_target_max=' || COALESCE(MAX(edate)::text, '') FROM ${targetTable};`,
    `SELECT 'new_rows=' || COUNT(*) FROM ${newRowsTable};`,
    `SELECT 'updated_rows=' || COUNT(*) FROM ${appliedRevisionTable};`,
    `SELECT 'unchanged_rows=' || COUNT(*) FROM ${unchangedTable};`,
    `SELECT 'rejected_rows=' || COUNT(*) FROM ${rejectionTable};`,
    `SELECT 'revisions_detected=' || COUNT(*) FROM ${appliedRevisionTable};`,
    `SELECT 'quality_issue_count=' || ((SELECT COUNT(*) FROM ${rejectionTable}) + (SELECT COUNT(*) FROM ${issueTable}));`,
    `SELECT 'quality_status=' || CASE `
      + `WHEN EXISTS (SELECT 1 FROM ${issueTable} WHERE blocking = TRUE) THEN 'FAIL' `
      + `WHEN EXISTS (SELECT 1 FROM ${issueTable}) OR EXISTS (SELECT 1 FROM ${rejectionTable}) THEN 'WARN' `
      + `ELSE 'PASS' END;`,
    `UPDATE ${targetTable} target SET value = revision.new_value `
      + `FROM ${appliedRevisionTable} revision WHERE target.edate = revision.edate;`,
    `INSERT INTO ${targetTable} (edate, value) SELECT edate, value FROM ${appliedNewRowsTable};`,
    `SELECT 'inserted_rows=' || COUNT(*) FROM ${appliedNewRowsTable};`,
    `SELECT 'target_max=' || COALESCE(MAX(edate)::text, '') FROM ${targetTable};`,
    `SELECT 'revision_events_b64=' || replace(replace(encode(convert_to(`
      + `COALESCE((SELECT jsonb_agg(jsonb_build_object(`
      + "'observationKey', edate::text, 'observationDate', edate, "
      + "'oldValue', jsonb_build_object('value', old_value), "
      + "'newValue', jsonb_build_object('value', new_value), "
      + "'metadata', jsonb_build_object('loader', 'revision_aware_timeseries_v1')"
      + `) ORDER BY edate) FROM ${appliedRevisionTable}), '[]'::jsonb)::text, 'UTF8'), 'base64'), chr(10), ''), chr(13), '');`,
    `SELECT 'rejection_events_b64=' || replace(replace(encode(convert_to(`
      + `COALESCE((SELECT jsonb_agg(jsonb_build_object(`
      + "'checkCode', check_code, 'severityCode', severity_code, "
      + "'sourceRowNumber', source_row_number, 'observationKey', observation_key, "
      + "'rawPayload', raw_payload, 'normalizedPayload', normalized_payload, "
      + "'message', message, 'metadata', jsonb_build_object('loader', 'revision_aware_timeseries_v1')"
      + `) ORDER BY source_row_number, check_code) FROM ${rejectionTable}), '[]'::jsonb)::text, 'UTF8'), 'base64'), chr(10), ''), chr(13), '');`,
    `SELECT 'quality_issues_b64=' || replace(replace(encode(convert_to(`
      + `COALESCE((SELECT jsonb_agg(jsonb_build_object(`
      + "'checkCode', check_code, 'severityCode', severity_code, 'blocking', blocking, "
      + "'observationKey', observation_key, 'sourceRowNumber', source_row_number, "
      + "'message', message, 'evidence', evidence"
      + `) ORDER BY check_code) FROM ${issueTable}), '[]'::jsonb)::text, 'UTF8'), 'base64'), chr(10), ''), chr(13), '');`,
    'COMMIT;',
  );

  return sql.join('\n');
}

function createQualityFailure(result) {
  const blocking = (result.qualityIssues || []).filter((issue) => issue.blocking);
  const message = blocking.length > 0
    ? blocking.map((issue) => issue.message).join(' ')
    : 'Source data failed portable ingestion quality checks.';
  const error = new Error(message);
  error.code = 'INGESTION_QUALITY_FAILED';
  error.errorCategoryCode = 'VALIDATION';
  error.ingestionEvidence = result;
  return error;
}

const copyIntoRelation = ({ assetCode, relationName, filePath, qualityContext = null }) => {
  const code = String(assetCode || '').trim();
  assertSafeIdentifier(code);
  const normalizedPath = filePath.replace(/\\/g, '/');
  const tempTable = `stg_${code.toLowerCase()}`;
  const targetTable = quoteRelationName(relationName);
  const sqlFile = path.join(
    os.tmpdir(),
    `skycommand_copy_${code.toLowerCase()}_${process.pid}_${Date.now()}.sql`,
  );

  console.log(`🔥 [COPY] ${code}`);

  fs.writeFileSync(
    sqlFile,
    buildRevisionAwareCopySql({ targetTable, tempTable, normalizedPath, qualityContext }),
    'utf-8',
  );

  try {
    const output = execFileSync('psql', getPsqlArgs(sqlFile), {
      encoding: 'utf-8',
      env: process.env,
      maxBuffer: MAX_EVENT_PAYLOAD_BYTES,
    });

    printCleanOutput(output);
    const result = parseCopyOutput(output);
    if (result.qualityStatusCode === 'FAIL') throw createQualityFailure(result);
    return result;
  } finally {
    try {
      fs.unlinkSync(sqlFile);
    } catch {
      // Ignore cleanup failure.
    }
  }
};

const copyIntoTable = (table, filePath, options = {}) => copyIntoRelation({
  assetCode: table,
  relationName: `macro.${table}`,
  filePath,
  qualityContext: options.qualityContext || null,
});

module.exports = {
  buildRevisionAwareCopySql,
  copyIntoRelation,
  copyIntoTable,
  createQualityFailure,
  parseBase64Json,
  parseCopyOutput,
  quoteRelationName,
};
