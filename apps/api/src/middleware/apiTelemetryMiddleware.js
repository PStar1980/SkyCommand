const apiTelemetryService = require('../services/apiTelemetryService');
const {
  buildApiTelemetryRecord,
  normalizeRequestId,
  shouldTrackApiRequest,
} = require('../services/apiTelemetryPolicy');

const TELEMETRY_WARNING_INTERVAL_MS = 60_000;
const TELEMETRY_RETRY_DELAY_MS = 60_000;
let lastWarningAt = 0;
let telemetryWritePausedUntil = 0;

function reportTelemetryFailure(error) {
  const now = Date.now();

  if (error?.code === '42P01') {
    telemetryWritePausedUntil = now + TELEMETRY_RETRY_DELAY_MS;
  }

  if (now - lastWarningAt < TELEMETRY_WARNING_INTERVAL_MS) {
    return;
  }

  lastWarningAt = now;

  if (error?.code === '42P01') {
    console.warn(
      '[SkyCommand API] API telemetry table is unavailable. Apply migration 00071 to enable request evidence.',
    );
    return;
  }

  console.warn('[SkyCommand API] Failed to persist API telemetry:', error?.message || error);
}

function apiTelemetryMiddleware(req, res, next) {
  if (!shouldTrackApiRequest(req)) {
    return next();
  }

  const startedAt = process.hrtime.bigint();
  const requestId = normalizeRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const record = buildApiTelemetryRecord({ req, res, durationMs, requestId });

    if (Date.now() < telemetryWritePausedUntil) {
      return;
    }

    setImmediate(() => {
      apiTelemetryService.recordApiRequestTelemetry(record).catch(reportTelemetryFailure);
    });
  });

  return next();
}

module.exports = {
  apiTelemetryMiddleware,
  reportTelemetryFailure,
};
