'use strict';

// Diagnostic projection only. A proxy-wide CONNECT window is not proof that any
// particular connection belonged to an Agent Run, nor that no HTTP traffic used
// an already-established tunnel. Never retain raw unknown destination hostnames.
const PROXY_DIAGNOSTICS_URL = 'http://skycommand-codex-egress-proxy:3128/diagnostics';
const SCHEMA_VERSION = 'CODEX_EGRESS_OBSERVATION_V1';
const MAX_RETAINED_EVENTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const KNOWN_SAFE_HOSTS = new Set(['auth.openai.com', 'chatgpt.com', 'api.openai.com']);
const SAFE_REASONS = new Set([
  'INVALID_AUTHORITY', 'DNS_LOOKUP_FAILED', 'PORT_NOT_ALLOWED',
  'HOST_NOT_ALLOWLISTED', 'NON_PUBLIC_DNS_RESULT',
  'UPSTREAM_CONNECT_FAILED', 'PUBLIC_ALLOWLISTED_TLS',
]);

function validCursor(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function sanitizeBoundary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== SCHEMA_VERSION || !UUID.test(String(value.generation || ''))
    || !validCursor(value.cursor) || !validCursor(value.pendingConnects) || !validIso(value.observedAt)) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    generation: value.generation.toLowerCase(),
    cursor: value.cursor,
    pendingConnects: value.pendingConnects,
    observedAt: value.observedAt,
  };
}

function validatedSnapshot(value, observedAt = new Date().toISOString()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !UUID.test(String(value.generation || ''))
    || !validCursor(value.cursor) || !validCursor(value.pendingConnects) || !validCursor(value.earliestRetainedCursor)
    || value.earliestRetainedCursor > value.cursor + 1 || !Array.isArray(value.events)
    || value.events.length > 80 || !validIso(observedAt)) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    generation: value.generation.toLowerCase(),
    cursor: value.cursor,
    pendingConnects: value.pendingConnects,
    earliestRetainedCursor: value.earliestRetainedCursor,
    observedAt,
    events: value.events,
  };
}

async function readEgressSnapshot(fetcher = fetch) {
  try {
    const response = await fetcher(PROXY_DIAGNOSTICS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return validatedSnapshot(await response.json());
  } catch (_error) {
    return null;
  }
}

function initialEgressBoundary(snapshot) {
  if (!snapshot) return null;
  return sanitizeBoundary({
    schemaVersion: SCHEMA_VERSION,
    generation: snapshot.generation,
    cursor: snapshot.cursor,
    pendingConnects: snapshot.pendingConnects,
    observedAt: snapshot.observedAt,
  });
}

function safeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || !Number.isSafeInteger(event.cursor) || event.cursor < 1
    || !Number.isSafeInteger(event.port) || event.port < 1 || event.port > 65535
    || !['ALLOW', 'DENY'].includes(event.decision)
    || !SAFE_REASONS.has(event.reason) || !validIso(event.observedAt)) return null;
  const rawHost = typeof event.host === 'string' && HOST.test(event.host) && event.host.length <= 253
    ? event.host.toLowerCase() : null;
  const authHostProjected = !rawHost && event.destinationClassification === 'APPROVED_AUTH_HOST';
  const fingerprint = DIGEST.test(String(event.destinationFingerprint || ''))
    ? String(event.destinationFingerprint).toUpperCase() : null;
  // Require a proxy-produced keyed fingerprint. Never persist raw arbitrary host
  // values even if the proxy journal provides them for ephemeral diagnosis.
  if (!fingerprint) return null;
  return {
    cursor: event.cursor,
    destinationClassification: rawHost && KNOWN_SAFE_HOSTS.has(rawHost) || authHostProjected
      ? 'KNOWN_PROVIDER_HOST' : 'OTHER_HOST_REDACTED',
    ...(rawHost && KNOWN_SAFE_HOSTS.has(rawHost) ? { destinationHost: rawHost } : {}),
    ...(authHostProjected ? { destinationHost: 'auth.openai.com' } : {}),
    destinationFingerprint: fingerprint,
    port: event.port,
    decision: event.decision,
    reason: event.reason,
    observedAt: event.observedAt,
  };
}

function unavailable(reason) {
  return {
    schemaVersion: SCHEMA_VERSION,
    availability: 'UNAVAILABLE',
    completenessReason: reason,
    scope: 'PROXY_WIDE_CONNECT_WINDOW',
    runAttribution: 'NOT_ESTABLISHED',
    start: null,
    end: null,
    observedCount: null,
    events: [],
  };
}

function egressWindowEvidence(boundaryValue, endSnapshot) {
  const boundary = sanitizeBoundary(boundaryValue);
  if (!boundary) return unavailable('START_BOUNDARY_UNAVAILABLE');
  if (!endSnapshot) return unavailable('END_SNAPSHOT_UNAVAILABLE');
  const end = {
    generation: endSnapshot.generation,
    cursor: endSnapshot.cursor,
    pendingConnects: endSnapshot.pendingConnects,
    observedAt: endSnapshot.observedAt,
  };
  const base = {
    schemaVersion: SCHEMA_VERSION,
    availability: 'INCOMPLETE',
    completenessReason: 'CURSOR_EVIDENCE_INVALID',
    scope: 'PROXY_WIDE_CONNECT_WINDOW',
    runAttribution: 'NOT_ESTABLISHED',
    start: boundary,
    end,
    observedCount: null,
    events: [],
  };
  if (boundary.generation !== endSnapshot.generation) return { ...base, completenessReason: 'PROXY_GENERATION_CHANGED' };
  if (!validCursor(endSnapshot.cursor) || endSnapshot.cursor < boundary.cursor) return base;
  const observedCount = endSnapshot.cursor - boundary.cursor;
  const completeRetention = endSnapshot.earliestRetainedCursor <= boundary.cursor + 1;
  const candidate = endSnapshot.events
    .filter((event) => Number.isSafeInteger(event?.cursor) && event.cursor > boundary.cursor)
    .sort((a, b) => a.cursor - b.cursor);
  const projection = candidate.slice(-MAX_RETAINED_EVENTS).map(safeEvent);
  const completeSequence = candidate.length === observedCount && candidate.every((event, index) => event.cursor === boundary.cursor + index + 1);
  const completeProjection = projection.every(Boolean);
  const complete = boundary.pendingConnects === 0 && endSnapshot.pendingConnects === 0
    && completeRetention && completeSequence && completeProjection && observedCount <= MAX_RETAINED_EVENTS;
  const reason = boundary.pendingConnects > 0 || endSnapshot.pendingConnects > 0 ? 'CONNECTIONS_IN_FLIGHT'
    : !completeRetention ? 'JOURNAL_OVERWRITTEN'
    : !completeSequence ? 'EVENT_SEQUENCE_INCOMPLETE'
      : !completeProjection ? 'EVENT_PROJECTION_INVALID'
        : observedCount > MAX_RETAINED_EVENTS ? 'EVIDENCE_OUTPUT_CAPPED'
          : 'COMPLETE';
  return {
    ...base,
    availability: complete ? 'COMPLETE' : 'INCOMPLETE',
    completenessReason: reason,
    observedCount,
    events: projection.filter(Boolean),
  };
}

module.exports = {
  SCHEMA_VERSION,
  MAX_RETAINED_EVENTS,
  sanitizeBoundary,
  validatedSnapshot,
  readEgressSnapshot,
  initialEgressBoundary,
  egressWindowEvidence,
};
