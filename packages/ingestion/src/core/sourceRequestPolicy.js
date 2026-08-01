let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }
  return databaseQuery;
}

const DEFAULT_RETRYABLE_HTTP_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const DEFAULT_RETRYABLE_ERROR_CODES = [
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_NETWORK',
  'ETIMEDOUT',
];

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return code || null;
}

function positiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function nonNegativeInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function normalizeNumberArray(value, fallback = []) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values.map((item) => Number.parseInt(item, 10)).filter(Number.isFinite))];
}

function normalizeCodeArray(value, fallback = []) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values.map(normalizeCode).filter(Boolean))];
}

function normalizeSourceRequestPolicy(row = {}) {
  const baseDelayMs = nonNegativeInteger(row.baseDelayMs ?? row.base_delay_ms, 750, 60000);
  const maxDelayMs = Math.max(
    baseDelayMs,
    nonNegativeInteger(row.maxDelayMs ?? row.max_delay_ms, 10000, 300000),
  );
  const jitter = Number(row.jitterRatio ?? row.jitter_ratio);

  return {
    domainCode: normalizeCode(row.domainCode ?? row.domain_code),
    sourceCode: normalizeCode(row.sourceCode ?? row.source_code),
    requestTimeoutMs: positiveInteger(
      row.requestTimeoutMs ?? row.request_timeout_ms,
      60000,
      900000,
    ),
    maxAttempts: positiveInteger(row.maxAttempts ?? row.max_attempts, 4, 20),
    baseDelayMs,
    maxDelayMs,
    maxElapsedMs: positiveInteger(row.maxElapsedMs ?? row.max_elapsed_ms, 180000, 3600000),
    jitterRatio: Number.isFinite(jitter) ? Math.min(Math.max(jitter, 0), 1) : 0.2,
    respectRetryAfter: row.respectRetryAfter ?? row.respect_retry_after ?? true,
    retryableHttpStatuses: normalizeNumberArray(
      row.retryableHttpStatuses ?? row.retryable_http_statuses,
      DEFAULT_RETRYABLE_HTTP_STATUSES,
    ),
    retryableErrorCodes: normalizeCodeArray(
      row.retryableErrorCodes ?? row.retryable_error_codes,
      DEFAULT_RETRYABLE_ERROR_CODES,
    ),
    configuration:
      row.configuration && typeof row.configuration === 'object' ? row.configuration : {},
    active: row.active !== false,
  };
}

async function getSourceRequestPolicy(sourceCode, options = {}) {
  if (options.policy) {
    return normalizeSourceRequestPolicy({
      ...options.policy,
      sourceCode: options.policy.sourceCode || sourceCode,
      domainCode: options.policy.domainCode || options.domainCode || 'MACRO',
    });
  }

  const normalizedSource = normalizeCode(sourceCode);
  const normalizedDomain = normalizeCode(options.domainCode || 'MACRO');

  if (!normalizedSource) {
    throw new Error('sourceCode is required to resolve a request policy.');
  }

  const query = options.query || getDatabaseQuery();
  const result = await query(
    `
      SELECT
        domain.domain_code,
        source.source_code,
        policy.request_timeout_ms,
        policy.max_attempts,
        policy.base_delay_ms,
        policy.max_delay_ms,
        policy.max_elapsed_ms,
        policy.jitter_ratio,
        policy.respect_retry_after,
        policy.retryable_http_statuses,
        policy.retryable_error_codes,
        policy.configuration,
        policy.active
      FROM data.source_request_policies policy
      JOIN data.sources source ON source.source_id = policy.source_id
      JOIN data.domains domain ON domain.domain_id = source.domain_id
      WHERE domain.domain_code = $1
        AND source.source_code = $2
        AND domain.active = TRUE
        AND source.active = TRUE
        AND policy.active = TRUE
      LIMIT 1
    `,
    [normalizedDomain, normalizedSource],
  );

  if (!result.rows[0]) {
    const error = new Error(
      `No active source request policy is registered for ${normalizedDomain}/${normalizedSource}.`,
    );
    error.code = 'SOURCE_REQUEST_POLICY_MISSING';
    throw error;
  }

  return normalizeSourceRequestPolicy(result.rows[0]);
}

module.exports = {
  DEFAULT_RETRYABLE_ERROR_CODES,
  DEFAULT_RETRYABLE_HTTP_STATUSES,
  getSourceRequestPolicy,
  normalizeSourceRequestPolicy,
};
