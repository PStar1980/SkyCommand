const { randomUUID } = require('node:crypto');

const MAX_DOCKER_EVENT_BUFFER = 100;
const DEFAULT_DOCKER_EVENT_REPLAY_COUNT = 25;
const DOCKER_EVENT_SOURCE_STALE_MS = 45000;
const DOCKER_EVENT_STREAM_KEEPALIVE_MS = 15000;
const DOCKER_EVENT_STREAM_INSTANCE_ID = randomUUID();

let nextSequence = 0;
let recentEvents = [];
let lastHeartbeatAt = null;
let sourceHostname = null;
let sourceTransport = null;
let sourceObserverStatus = 'UNKNOWN';
let sourceErrorCode = '';
let totalEventsReceived = 0;
const subscribers = new Set();

function normalizeText(value, maxLength = 512) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized.slice(0, maxLength);
}


function buildDockerEventStreamId(sequence) {
  return `${DOCKER_EVENT_STREAM_INSTANCE_ID}:${Math.max(0, Number(sequence) || 0)}`;
}

function parseDockerEventStreamSequence(value) {
  const normalized = normalizeText(value, 256);
  if (!normalized) return 0;

  const separatorIndex = normalized.lastIndexOf(':');
  if (separatorIndex < 0) {
    return Math.max(0, Number(normalized) || 0);
  }

  const instanceId = normalized.slice(0, separatorIndex);
  if (instanceId !== DOCKER_EVENT_STREAM_INSTANCE_ID) return 0;
  return Math.max(0, Number(normalized.slice(separatorIndex + 1)) || 0);
}

function normalizeIsoDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getSourceStatus(now = Date.now()) {
  if (!lastHeartbeatAt) return 'WAITING';
  const ageMs = now - new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > DOCKER_EVENT_SOURCE_STALE_MS) return 'STALE';
  if (sourceObserverStatus === 'ONLINE') return 'ONLINE';
  if (['CONNECTING', 'RETRYING', 'STARTING'].includes(sourceObserverStatus)) return 'DEGRADED';
  if (sourceObserverStatus === 'ERROR') return 'ERROR';
  if (['OFFLINE', 'STOPPED'].includes(sourceObserverStatus)) return 'OFFLINE';
  return 'WAITING';
}

function getDockerEventStreamStatus() {
  return {
    providerCode: 'DOCKER',
    status: getSourceStatus(),
    sourceHostname,
    sourceTransport,
    sourceObserverStatus,
    sourceErrorCode,
    lastHeartbeatAt,
    lastEventAt: recentEvents[recentEvents.length - 1]?.receivedAt || null,
    bufferedEvents: recentEvents.length,
    totalEventsReceived,
    subscriberCount: subscribers.size,
  };
}

function normalizeDockerEventPayload(payload = {}) {
  const kind = normalizeText(payload.kind, 64).toUpperCase();

  if (kind === 'BRIDGE_HEARTBEAT') {
    return {
      kind,
      providerCode: 'DOCKER',
      occurredAt: normalizeIsoDate(payload.occurredAt),
      source: {
        hostname: normalizeText(payload.source?.hostname, 256),
        transport: normalizeText(payload.source?.transport, 64) || 'HOST_AGENT',
      },
      observerStatus: normalizeText(payload.observerStatus, 64).toUpperCase() || 'UNKNOWN',
      errorCode: normalizeText(payload.errorCode, 128),
    };
  }

  if (kind !== 'DOCKER_EVENT') {
    const error = new Error(`Unsupported Docker event payload kind '${kind || 'blank'}'.`);
    error.statusCode = 400;
    throw error;
  }

  const action = normalizeText(payload.action, 96).toUpperCase();
  const containerId = normalizeText(payload.containerId, 128);
  const containerName = normalizeText(payload.containerName, 256);

  if (!action || (!containerId && !containerName)) {
    const error = new Error('Docker event payload requires an action and container identity.');
    error.statusCode = 400;
    throw error;
  }

  return {
    kind,
    providerCode: 'DOCKER',
    resourceType: 'CONTAINER',
    action,
    containerId,
    containerName,
    project: normalizeText(payload.project, 256),
    service: normalizeText(payload.service, 256),
    image: normalizeText(payload.image, 512),
    exitCode: normalizeText(payload.exitCode, 32),
    scope: normalizeText(payload.scope, 64),
    occurredAt: normalizeIsoDate(payload.occurredAt),
    source: {
      hostname: normalizeText(payload.source?.hostname, 256),
      transport: normalizeText(payload.source?.transport, 64) || 'HOST_AGENT',
    },
  };
}

function publish(message) {
  for (const subscriber of subscribers) {
    try {
      subscriber(message);
    } catch {
      // One disconnected browser must never disrupt the event hub.
    }
  }
}

function ingestDockerEventPayload(payload = {}) {
  const normalized = normalizeDockerEventPayload(payload);

  if (normalized.kind === 'BRIDGE_HEARTBEAT') {
    lastHeartbeatAt = new Date().toISOString();
    sourceHostname = normalized.source.hostname || sourceHostname;
    sourceTransport = normalized.source.transport || sourceTransport;
    sourceObserverStatus = normalized.observerStatus || 'UNKNOWN';
    sourceErrorCode = normalized.errorCode || '';

    const status = getDockerEventStreamStatus();
    publish({ type: 'stream-status', data: status });
    return {
      accepted: true,
      kind: normalized.kind,
      status,
    };
  }

  nextSequence += 1;
  totalEventsReceived += 1;
  const event = {
    ...normalized,
    eventId: randomUUID(),
    sequence: nextSequence,
    receivedAt: new Date().toISOString(),
  };

  sourceHostname = normalized.source.hostname || sourceHostname;
  sourceTransport = normalized.source.transport || sourceTransport;
  recentEvents.push(event);
  if (recentEvents.length > MAX_DOCKER_EVENT_BUFFER) {
    recentEvents = recentEvents.slice(-MAX_DOCKER_EVENT_BUFFER);
  }

  publish({ type: 'docker-event', id: buildDockerEventStreamId(event.sequence), data: event });

  return {
    accepted: true,
    kind: normalized.kind,
    sequence: event.sequence,
    eventId: event.eventId,
  };
}

function subscribeDockerEvents(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getReplayEvents({ afterSequence = 0, limit = DEFAULT_DOCKER_EVENT_REPLAY_COUNT } = {}) {
  const normalizedAfter = Math.max(0, Number(afterSequence) || 0);
  const normalizedLimit = Math.min(
    MAX_DOCKER_EVENT_BUFFER,
    Math.max(1, Number(limit) || DEFAULT_DOCKER_EVENT_REPLAY_COUNT),
  );
  const candidates = normalizedAfter > 0
    ? recentEvents.filter((event) => event.sequence > normalizedAfter)
    : recentEvents.slice(-normalizedLimit);

  return candidates.slice(-normalizedLimit);
}

function writeSseMessage(res, { type = 'message', id = null, data = {} } = {}) {
  if (id !== null && id !== undefined && id !== '') {
    res.write(`id: ${String(id)}\n`);
  }
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function streamDockerEvents(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const lastEventId = parseDockerEventStreamSequence(
    req.headers?.['last-event-id'] || req.query?.afterSequence || '',
  );

  writeSseMessage(res, {
    type: 'stream-status',
    data: getDockerEventStreamStatus(),
  });

  for (const event of getReplayEvents({ afterSequence: lastEventId })) {
    writeSseMessage(res, {
      type: 'docker-event',
      id: buildDockerEventStreamId(event.sequence),
      data: event,
    });
  }

  const unsubscribe = subscribeDockerEvents((message) => {
    writeSseMessage(res, message);
  });

  const keepalive = setInterval(() => {
    writeSseMessage(res, {
      type: 'stream-status',
      data: getDockerEventStreamStatus(),
    });
  }, DOCKER_EVENT_STREAM_KEEPALIVE_MS);
  keepalive.unref?.();

  const close = () => {
    clearInterval(keepalive);
    unsubscribe();
  };

  req.once('close', close);
  req.once('aborted', close);
}

function resetDockerEventStreamForTest() {
  nextSequence = 0;
  recentEvents = [];
  lastHeartbeatAt = null;
  sourceHostname = null;
  sourceTransport = null;
  sourceObserverStatus = 'UNKNOWN';
  sourceErrorCode = '';
  totalEventsReceived = 0;
  subscribers.clear();
}

module.exports = {
  DOCKER_EVENT_STREAM_INSTANCE_ID,
  buildDockerEventStreamId,
  DEFAULT_DOCKER_EVENT_REPLAY_COUNT,
  DOCKER_EVENT_SOURCE_STALE_MS,
  DOCKER_EVENT_STREAM_KEEPALIVE_MS,
  MAX_DOCKER_EVENT_BUFFER,
  getDockerEventStreamStatus,
  getReplayEvents,
  ingestDockerEventPayload,
  normalizeDockerEventPayload,
  parseDockerEventStreamSequence,
  resetDockerEventStreamForTest,
  streamDockerEvents,
  subscribeDockerEvents,
  writeSseMessage,
};
