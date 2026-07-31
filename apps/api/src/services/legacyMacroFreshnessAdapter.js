let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../../packages/db/src/connection'));
  }
  return databaseQuery;
}

function getDaysSince(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function mapSnapshotStatus(row) {
  if (row.active !== true) {
    return {
      status: 'INACTIVE',
      severity: 'info',
      message: 'Indicator is inactive.',
    };
  }

  if (!row.refreshed_at) {
    return {
      status: 'ERROR',
      severity: 'error',
      message: 'Explainable freshness has not been refreshed for this active indicator.',
    };
  }

  const reason = String(row.freshness_reason_code || 'UNKNOWN').toUpperCase();
  const status = String(row.freshness_status_code || 'UNKNOWN').toUpperCase();

  if (reason === 'NO_DATA') {
    return { status: 'NO_DATA', severity: 'warning', message: row.message };
  }

  if (reason === 'CONFIGURATION_ERROR' && row.target_relation_exists === false) {
    return { status: 'MISSING_TABLE', severity: 'error', message: row.message };
  }

  if (status === 'CURRENT') {
    return { status: 'CURRENT', severity: 'ok', message: row.message };
  }

  if (status === 'ERROR') {
    return { status: 'ERROR', severity: 'error', message: row.message };
  }

  if (status === 'INACTIVE') {
    return { status: 'INACTIVE', severity: 'info', message: row.message };
  }

  // Legacy macro consumers only understand CURRENT/STALE for healthy-but-watchable
  // freshness. Keep the existing contract while exposing the precise reason below.
  return { status: 'STALE', severity: 'warning', message: row.message };
}

function sanitizeRow(row) {
  const evaluation = mapSnapshotStatus(row);
  const targetLatestDate = row.target_latest_date || null;

  return {
    indicatorCode: row.indicator_code,
    source: row.source,
    description: row.description,
    frequency: row.frequency,
    createdAt: row.created_at,
    active: row.active === true,
    status: evaluation.status,
    severity: evaluation.severity,
    message: evaluation.message,
    freshnessThresholdDays: null,
    daysSinceLatestData: getDaysSince(targetLatestDate),
    stats: {
      tableExists: row.target_relation_exists === true,
      totalRows: Number(row.target_row_count || 0),
      minDate: row.target_min_date || null,
      maxDate: targetLatestDate,
    },
    freshness: {
      contractVersion: 'asset_freshness.v1',
      refreshedAt: row.refreshed_at || null,
      statusCode: row.freshness_status_code || 'UNKNOWN',
      reasonCode: row.freshness_reason_code || 'UNKNOWN',
      reasonName: row.freshness_reason_name || 'Unknown',
      severityCode: row.freshness_severity_code || 'UNKNOWN',
      expectedLatestDate: row.expected_latest_date || null,
      sourceLatestDate: row.source_latest_date || null,
      sourceTargetGapDays:
        row.source_target_gap_days === null || row.source_target_gap_days === undefined
          ? null
          : Number(row.source_target_gap_days),
      policyOriginCode: row.policy_origin_code || null,
      releaseLagDays:
        row.release_lag_days === null || row.release_lag_days === undefined
          ? null
          : Number(row.release_lag_days),
      freshnessToleranceDays:
        row.freshness_tolerance_days === null || row.freshness_tolerance_days === undefined
          ? null
          : Number(row.freshness_tolerance_days),
      lastAttemptAt: row.last_attempt_at || null,
      lastAttemptStatus: row.last_attempt_status || null,
      lastSuccessAt: row.last_success_at || null,
    },
  };
}

async function loadStatuses(indicators = []) {
  if (!Array.isArray(indicators) || indicators.length === 0) return [];

  const codes = indicators.map((indicator) => indicator.indicatorCode);
  const query = getDatabaseQuery();
  const result = await query(
    `
      SELECT
        indicator.indicator_code,
        indicator.source,
        indicator.description,
        indicator.frequency,
        indicator.created_at,
        indicator.active,
        freshness.refreshed_at,
        freshness.policy_origin_code,
        freshness.release_lag_days,
        freshness.freshness_tolerance_days,
        freshness.expected_latest_date,
        freshness.source_latest_date,
        freshness.target_relation_exists,
        freshness.target_row_count,
        freshness.target_min_date,
        freshness.target_latest_date,
        freshness.source_target_gap_days,
        freshness.last_attempt_at,
        freshness.last_attempt_status,
        freshness.last_success_at,
        freshness.freshness_status_code,
        freshness.severity_code AS freshness_severity_code,
        freshness.freshness_reason_code,
        freshness.freshness_reason_name,
        freshness.message
      FROM macro.indicators indicator
      LEFT JOIN data.vw_asset_freshness freshness
        ON freshness.domain_code = 'MACRO'
       AND freshness.asset_code = indicator.indicator_code
      WHERE indicator.indicator_code = ANY($1::text[])
      ORDER BY indicator.source, indicator.indicator_code
    `,
    [codes],
  );

  const byCode = new Map(result.rows.map((row) => [row.indicator_code, sanitizeRow(row)]));
  return indicators.map((indicator) => byCode.get(indicator.indicatorCode)).filter(Boolean);
}

async function loadStatus(indicator) {
  const rows = await loadStatuses([indicator]);
  return rows[0] || null;
}

module.exports = {
  loadStatus,
  loadStatuses,
  mapSnapshotStatus,
  sanitizeRow,
};
