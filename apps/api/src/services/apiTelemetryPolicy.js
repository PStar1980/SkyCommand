const { randomUUID } = require('crypto');

const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ROUTE_TEMPLATE_LENGTH = 512;
const UUID_SEGMENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_PATTERN = /^\d+$/;
const OPAQUE_SEGMENT_PATTERN = /^(?:[0-9a-f]{24,}|[A-Za-z0-9_-]{32,})$/;

function normalizeOptionalText(value, maxLength = 128) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function parseByteCount(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.trunc(numeric);
}

function normalizeRequestId(value) {
  const incoming = normalizeOptionalText(value, MAX_REQUEST_ID_LENGTH);

  if (!incoming) {
    return randomUUID();
  }

  const safe = incoming.replace(/[^A-Za-z0-9._:-]/g, '-');
  return safe || randomUUID();
}

function normalizeFallbackPath(pathValue) {
  const rawPath = String(pathValue || '/').split('?')[0].split('#')[0] || '/';
  const segments = rawPath
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      let decoded = segment;

      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = segment;
      }

      if (UUID_SEGMENT_PATTERN.test(decoded)) {
        return ':uuid';
      }

      if (NUMERIC_SEGMENT_PATTERN.test(decoded)) {
        return ':id';
      }

      if (OPAQUE_SEGMENT_PATTERN.test(decoded)) {
        return ':token';
      }

      return decoded.slice(0, 96);
    });

  const normalized = `/${segments.join('/')}`;
  return (normalized || '/').slice(0, MAX_ROUTE_TEMPLATE_LENGTH);
}

function normalizeRoutePath(routePath) {
  if (Array.isArray(routePath)) {
    return routePath.map((value) => normalizeRoutePath(value)).join('|');
  }

  if (routePath instanceof RegExp) {
    return String(routePath);
  }

  return String(routePath || '');
}

function deriveBaseUrlFromOriginalPath(originalUrl, routePath) {
  if (!routePath || routePath.includes('|') || routePath.startsWith('/^')) {
    return '';
  }

  const originalSegments = String(originalUrl || '')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean);
  const routeSegments = String(routePath).split('/').filter(Boolean);

  if (routeSegments.length === 0 || originalSegments.length < routeSegments.length) {
    return '';
  }

  const baseSegments = originalSegments.slice(0, originalSegments.length - routeSegments.length);
  return baseSegments.length > 0 ? `/${baseSegments.join('/')}` : '';
}

function buildRouteTemplate(req = {}) {
  const routePath = normalizeRoutePath(req.route?.path);
  const originalUrl = req.originalUrl || req.path || req.url || '/';
  const originalPath = normalizeFallbackPath(originalUrl);
  const explicitBaseUrl = String(req.baseUrl || '').replace(/\/$/, '');
  const derivedBaseUrl = deriveBaseUrlFromOriginalPath(originalUrl, routePath);
  const baseUrl = explicitBaseUrl || derivedBaseUrl;

  if (routePath && (baseUrl || routePath.startsWith('/api/') || routePath.startsWith('/_'))) {
    const combined = `${baseUrl}${routePath.startsWith('/') ? routePath : `/${routePath}`}`;
    return normalizeFallbackPath(combined);
  }

  if (originalPath.startsWith('/api/') || originalPath.startsWith('/_')) {
    return originalPath;
  }

  return routePath ? normalizeFallbackPath(routePath) : originalPath;
}

function shouldTrackApiRequest(req = {}) {
  const requestPath = String(req.path || req.originalUrl || req.url || '').split('?')[0];
  const normalizedPath = requestPath.replace(/\/$/, '');

  // Docker live-observability ingress/stream traffic is intentionally excluded from the
  // durable request telemetry table. Heartbeats/samples arrive frequently and SSE
  // connections can remain open for hours; recording either would distort API
  // latency/activity reporting without adding useful operational evidence.
  if (
    (normalizedPath === '/api/auth/notifications' && String(req.method || 'GET').toUpperCase() === 'GET') ||
    normalizedPath === '/api/infrastructure/providers/docker/events/ingest' ||
    normalizedPath === '/api/infrastructure/providers/docker/events/stream' ||
    normalizedPath === '/api/infrastructure/providers/docker/telemetry/ingest' ||
    normalizedPath === '/api/infrastructure/providers/docker/telemetry/stream'
  ) {
    return false;
  }

  return requestPath.startsWith('/api/') || requestPath === '/_health' || requestPath === '/_db/health';
}

function resolveApplicationCode(req = {}) {
  return (
    normalizeOptionalText(req.session?.appCode, 64) ||
    normalizeOptionalText(req.headers?.['x-skycommand-app-code'], 64) ||
    normalizeOptionalText(req.headers?.['x-skyserver-app-code'], 64) ||
    normalizeOptionalText(req.body?.appCode, 64)
  );
}

function resolveAuthMode(req = {}) {
  const explicitMode = normalizeOptionalText(req.session?.authMode, 64);

  if (explicitMode) {
    return explicitMode.toUpperCase();
  }

  if (
    normalizeOptionalText(req.headers?.['x-skycommand-internal-token'], 32) ||
    normalizeOptionalText(req.headers?.['x-skyserver-internal-token'], 32)
  ) {
    return 'INTERNAL_SERVICE_TOKEN';
  }

  if (req.sessionToken) {
    return 'BEARER_SESSION';
  }

  if (/^Bearer\s+/i.test(String(req.headers?.authorization || ''))) {
    return 'BEARER_TOKEN';
  }

  return 'ANONYMOUS';
}

function buildApiTelemetryRecord({ req = {}, res = {}, durationMs = 0, requestId } = {}) {
  return {
    occurredAt: new Date(),
    method: String(req.method || 'GET').trim().toUpperCase().slice(0, 16),
    routeTemplate: buildRouteTemplate(req),
    statusCode: Number(res.statusCode || 500),
    durationMs: Math.max(0, Number(Number(durationMs || 0).toFixed(3))),
    appCode: resolveApplicationCode(req),
    authMode: resolveAuthMode(req),
    requestBytes: parseByteCount(req.headers?.['content-length']),
    responseBytes: parseByteCount(
      typeof res.getHeader === 'function' ? res.getHeader('content-length') : null,
    ),
    requestId: normalizeRequestId(requestId),
  };
}

module.exports = {
  MAX_REQUEST_ID_LENGTH,
  MAX_ROUTE_TEMPLATE_LENGTH,
  buildApiTelemetryRecord,
  buildRouteTemplate,
  deriveBaseUrlFromOriginalPath,
  normalizeFallbackPath,
  normalizeRequestId,
  parseByteCount,
  resolveApplicationCode,
  resolveAuthMode,
  shouldTrackApiRequest,
};
