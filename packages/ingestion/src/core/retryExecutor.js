const AUTH_HTTP_STATUSES = new Set([401, 403]);
const TIMEOUT_ERROR_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ERR_NETWORK',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHttpStatus(error) {
  const value = error?.response?.status ?? error?.status ?? error?.statusCode;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getErrorCode(error) {
  const value = error?.code || error?.cause?.code;
  return value ? String(value).trim().toUpperCase() : null;
}

function getResponseHeaders(error) {
  return error?.response?.headers || error?.headers || {};
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const wanted = String(name).toLowerCase();
  const match = Object.entries(headers).find(([key]) => String(key).toLowerCase() === wanted);
  return match ? match[1] : null;
}

function parseRetryAfterMs(headers, nowMs = Date.now()) {
  const raw = getHeader(headers, 'retry-after');
  if (raw === undefined || raw === null || raw === '') return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const dateMs = Date.parse(String(raw));
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function classifyRequestError(error, policy = {}) {
  const httpStatus = getHttpStatus(error);
  const errorCode = getErrorCode(error);
  const retryableStatuses = new Set(policy.retryableHttpStatuses || []);
  const retryableCodes = new Set((policy.retryableErrorCodes || []).map((value) => String(value).toUpperCase()));

  if (AUTH_HTTP_STATUSES.has(httpStatus)) {
    return { categoryCode: 'AUTH', retryable: false, httpStatus, errorCode };
  }

  if (httpStatus !== null) {
    return {
      categoryCode: 'HTTP',
      retryable: retryableStatuses.has(httpStatus),
      httpStatus,
      errorCode,
    };
  }

  if (TIMEOUT_ERROR_CODES.has(errorCode)) {
    return {
      categoryCode: 'TIMEOUT',
      retryable: retryableCodes.has(errorCode) || TIMEOUT_ERROR_CODES.has(errorCode),
      httpStatus: null,
      errorCode,
    };
  }

  if (NETWORK_ERROR_CODES.has(errorCode)) {
    return {
      categoryCode: 'NETWORK',
      retryable: retryableCodes.has(errorCode) || NETWORK_ERROR_CODES.has(errorCode),
      httpStatus: null,
      errorCode,
    };
  }

  return {
    categoryCode: 'UNKNOWN',
    retryable: errorCode ? retryableCodes.has(errorCode) : false,
    httpStatus: null,
    errorCode,
  };
}

function computeBackoffDelayMs({ attemptNumber, policy, retryAfterMs, random = Math.random }) {
  const base = Math.max(0, Number(policy.baseDelayMs || 0));
  const maxDelay = Math.max(base, Number(policy.maxDelayMs ?? base));
  const exponent = Math.max(0, Number(attemptNumber || 1) - 1);
  const rawDelay = Math.min(maxDelay, base * (2 ** exponent));
  const jitterRatio = Math.min(Math.max(Number(policy.jitterRatio || 0), 0), 1);
  const jitterFactor = 1 + ((Number(random()) * 2 - 1) * jitterRatio);
  let delay = Math.max(0, Math.round(rawDelay * jitterFactor));

  if (policy.respectRetryAfter && Number.isFinite(retryAfterMs)) {
    delay = Math.max(delay, retryAfterMs);
  }

  return delay;
}

function boundedMessage(error) {
  return String(error?.message || error || 'Request failed.').slice(0, 2000);
}

async function executeWithRetry({
  operation,
  policy,
  sleepFn = sleep,
  random = Math.random,
  now = () => Date.now(),
  onAttempt,
} = {}) {
  if (typeof operation !== 'function') throw new TypeError('executeWithRetry requires operation.');
  if (!policy) throw new TypeError('executeWithRetry requires a policy.');

  const startedMs = now();
  const attempts = [];
  let lastError = null;

  for (let attemptNumber = 1; attemptNumber <= policy.maxAttempts; attemptNumber += 1) {
    const attemptStartedMs = now();
    const attemptStartedAt = new Date(attemptStartedMs).toISOString();

    try {
      const value = await operation({ attemptNumber, policy });
      const completedMs = now();
      const attempt = {
        attemptNumber,
        outcome: 'SUCCESS',
        retryable: null,
        httpStatus: null,
        errorCategoryCode: null,
        errorCode: null,
        errorMessage: null,
        startedAt: attemptStartedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - attemptStartedMs),
        waitBeforeNextMs: 0,
        retryAfterMs: null,
      };
      attempts.push(attempt);
      if (typeof onAttempt === 'function') await onAttempt(attempt);
      return { value, attempts };
    } catch (error) {
      lastError = error;
      const completedMs = now();
      const classification = classifyRequestError(error, policy);
      const retryAfterMs = parseRetryAfterMs(getResponseHeaders(error), completedMs);
      let waitBeforeNextMs = computeBackoffDelayMs({
        attemptNumber,
        policy,
        retryAfterMs,
        random,
      });
      const elapsedMs = Math.max(0, completedMs - startedMs);
      const remainingMs = Math.max(0, policy.maxElapsedMs - elapsedMs);
      const hasAttemptRemaining = attemptNumber < policy.maxAttempts;
      const canFitWait = waitBeforeNextMs < remainingMs;
      const willRetry = classification.retryable && hasAttemptRemaining && canFitWait;

      if (!willRetry) waitBeforeNextMs = 0;

      const attempt = {
        attemptNumber,
        outcome: 'FAILED',
        retryable: classification.retryable,
        willRetry,
        httpStatus: classification.httpStatus,
        errorCategoryCode: classification.categoryCode,
        errorCode: classification.errorCode,
        errorMessage: boundedMessage(error),
        startedAt: attemptStartedAt,
        completedAt: new Date(completedMs).toISOString(),
        durationMs: Math.max(0, completedMs - attemptStartedMs),
        waitBeforeNextMs,
        retryAfterMs,
      };
      attempts.push(attempt);
      if (typeof onAttempt === 'function') await onAttempt(attempt);

      if (!willRetry) break;
      await sleepFn(waitBeforeNextMs);
    }
  }

  if (!lastError) lastError = new Error('Request failed without an error object.');
  lastError.retryAttempts = attempts;
  throw lastError;
}

module.exports = {
  classifyRequestError,
  computeBackoffDelayMs,
  executeWithRetry,
  getErrorCode,
  getHttpStatus,
  parseRetryAfterMs,
};
