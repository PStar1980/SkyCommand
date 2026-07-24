const { query } = require('../../../../packages/db/src/connection');

const DEFAULT_DAYS = 7;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_DAYS = 90;
const MAX_RETENTION_DAYS = 3650;

function normalizePositiveInteger(value, fallback, maximum) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallback;
  }

  return Math.min(numeric, maximum);
}

function normalizeDays(value) {
  return normalizePositiveInteger(value, DEFAULT_DAYS, MAX_DAYS);
}

function getRetentionDays() {
  return normalizePositiveInteger(
    process.env.API_TELEMETRY_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
  );
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 1) {
  const numeric = toNumber(value, 0);
  const multiplier = 10 ** digits;
  return Math.round(numeric * multiplier) / multiplier;
}

async function recordApiRequestTelemetry(record = {}) {
  await query(
    `
      INSERT INTO core.api_request_telemetry (
        occurred_at,
        method,
        route_template,
        status_code,
        duration_ms,
        app_code,
        auth_mode,
        request_bytes,
        response_bytes,
        request_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      record.occurredAt || new Date(),
      record.method,
      record.routeTemplate,
      record.statusCode,
      record.durationMs,
      record.appCode,
      record.authMode,
      record.requestBytes,
      record.responseBytes,
      record.requestId,
    ],
  );
}

async function getApiTelemetrySummary(filters = {}) {
  const days = normalizeDays(filters.days);
  const values = [days];
  const windowClause = `occurred_at >= NOW() - ($1::int * INTERVAL '1 day')`;

  const [summaryResult, dailyResult, routeResult, applicationResult] = await Promise.all([
    query(
      `
        SELECT
          COUNT(*)::bigint AS total_requests,
          COUNT(*) FILTER (WHERE status_code < 400)::bigint AS successful_requests,
          COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499)::bigint AS client_errors,
          COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS server_errors,
          COALESCE(AVG(duration_ms), 0)::numeric AS average_duration_ms,
          COALESCE(CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS numeric), 0) AS p95_duration_ms,
          COALESCE(CAST(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS numeric), 0) AS p99_duration_ms,
          COALESCE(SUM(request_bytes), 0)::bigint AS request_bytes,
          COALESCE(SUM(response_bytes), 0)::bigint AS response_bytes,
          MIN(occurred_at) AS first_observed_at,
          MAX(occurred_at) AS last_observed_at
        FROM core.api_request_telemetry
        WHERE ${windowClause}
      `,
      values,
    ),
    query(
      `
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'),
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS bucket_date
        ), daily AS (
          SELECT
            occurred_at::date AS bucket_date,
            COUNT(*)::bigint AS total_requests,
            COUNT(*) FILTER (WHERE status_code < 400)::bigint AS successful_requests,
            COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499)::bigint AS client_errors,
            COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS server_errors,
            AVG(duration_ms)::numeric AS average_duration_ms,
            CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS numeric) AS p95_duration_ms
          FROM core.api_request_telemetry
          WHERE ${windowClause}
          GROUP BY occurred_at::date
        )
        SELECT
          days.bucket_date,
          COALESCE(daily.total_requests, 0)::bigint AS total_requests,
          COALESCE(daily.successful_requests, 0)::bigint AS successful_requests,
          COALESCE(daily.client_errors, 0)::bigint AS client_errors,
          COALESCE(daily.server_errors, 0)::bigint AS server_errors,
          COALESCE(daily.average_duration_ms, 0)::numeric AS average_duration_ms,
          COALESCE(daily.p95_duration_ms, 0)::numeric AS p95_duration_ms
        FROM days
        LEFT JOIN daily USING (bucket_date)
        ORDER BY days.bucket_date
      `,
      values,
    ),
    query(
      `
        SELECT
          method,
          route_template,
          COUNT(*)::bigint AS request_count,
          COUNT(*) FILTER (WHERE status_code >= 400)::bigint AS error_count,
          COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS server_error_count,
          AVG(duration_ms)::numeric AS average_duration_ms,
          CAST(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS numeric) AS p95_duration_ms,
          MAX(occurred_at) AS last_observed_at
        FROM core.api_request_telemetry
        WHERE ${windowClause}
        GROUP BY method, route_template
        ORDER BY request_count DESC, p95_duration_ms DESC, route_template
        LIMIT 10
      `,
      values,
    ),
    query(
      `
        SELECT
          COALESCE(app_code, 'UNSCOPED') AS app_code,
          COUNT(*)::bigint AS request_count,
          COUNT(*) FILTER (WHERE status_code >= 400)::bigint AS error_count,
          AVG(duration_ms)::numeric AS average_duration_ms
        FROM core.api_request_telemetry
        WHERE ${windowClause}
        GROUP BY COALESCE(app_code, 'UNSCOPED')
        ORDER BY request_count DESC, app_code
      `,
      values,
    ),
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const totalRequests = toNumber(summaryRow.total_requests);
  const successfulRequests = toNumber(summaryRow.successful_requests);

  return {
    generatedAt: new Date().toISOString(),
    window: {
      days,
      firstObservedAt: summaryRow.first_observed_at || null,
      lastObservedAt: summaryRow.last_observed_at || null,
    },
    summary: {
      totalRequests,
      successfulRequests,
      clientErrors: toNumber(summaryRow.client_errors),
      serverErrors: toNumber(summaryRow.server_errors),
      successRate: totalRequests > 0 ? round((successfulRequests / totalRequests) * 100, 1) : 100,
      averageDurationMs: round(summaryRow.average_duration_ms, 1),
      p95DurationMs: round(summaryRow.p95_duration_ms, 1),
      p99DurationMs: round(summaryRow.p99_duration_ms, 1),
      requestBytes: toNumber(summaryRow.request_bytes),
      responseBytes: toNumber(summaryRow.response_bytes),
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.bucket_date,
      totalRequests: toNumber(row.total_requests),
      successfulRequests: toNumber(row.successful_requests),
      clientErrors: toNumber(row.client_errors),
      serverErrors: toNumber(row.server_errors),
      averageDurationMs: round(row.average_duration_ms, 1),
      p95DurationMs: round(row.p95_duration_ms, 1),
    })),
    topRoutes: routeResult.rows.map((row) => ({
      method: row.method,
      routeTemplate: row.route_template,
      requestCount: toNumber(row.request_count),
      errorCount: toNumber(row.error_count),
      serverErrorCount: toNumber(row.server_error_count),
      averageDurationMs: round(row.average_duration_ms, 1),
      p95DurationMs: round(row.p95_duration_ms, 1),
      lastObservedAt: row.last_observed_at,
    })),
    applications: applicationResult.rows.map((row) => ({
      appCode: row.app_code,
      requestCount: toNumber(row.request_count),
      errorCount: toNumber(row.error_count),
      averageDurationMs: round(row.average_duration_ms, 1),
    })),
  };
}

async function pruneApiRequestTelemetry({ retentionDays = getRetentionDays() } = {}) {
  const normalizedRetentionDays = normalizePositiveInteger(
    retentionDays,
    DEFAULT_RETENTION_DAYS,
    MAX_RETENTION_DAYS,
  );
  const result = await query(
    `
      DELETE FROM core.api_request_telemetry
      WHERE occurred_at < NOW() - ($1::int * INTERVAL '1 day')
    `,
    [normalizedRetentionDays],
  );

  return {
    retentionDays: normalizedRetentionDays,
    deletedCount: Number(result.rowCount || 0),
  };
}

module.exports = {
  DEFAULT_DAYS,
  DEFAULT_RETENTION_DAYS,
  MAX_DAYS,
  getApiTelemetrySummary,
  getRetentionDays,
  normalizeDays,
  pruneApiRequestTelemetry,
  recordApiRequestTelemetry,
};
