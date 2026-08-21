const { randomUUID } = require('node:crypto');
const { writeSseMessage } = require('./dockerEventStreamService');

const MAX_DOCKER_TELEMETRY_BUFFER = 72;
const DEFAULT_DOCKER_TELEMETRY_REPLAY_COUNT = 60;
const DOCKER_TELEMETRY_SOURCE_STALE_MS = 30000;
const DOCKER_TELEMETRY_STREAM_KEEPALIVE_MS = 15000;
const DOCKER_TELEMETRY_STREAM_INSTANCE_ID = randomUUID();
const MAX_DOCKER_TELEMETRY_CONTAINERS = 200;

let nextSequence = 0;
let recentSamples = [];
let lastHeartbeatAt = null;
let lastSampleAt = null;
let sourceHostname = null;
let sourceTransport = null;
let sourceObserverStatus = 'UNKNOWN';
let totalSamplesReceived = 0;
let sourceSampleIntervalMs = 5000;
const subscribers = new Set();

function normalizeText(value, maxLength = 512) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized.slice(0, maxLength);
}

function normalizeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function normalizeIsoDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildDockerTelemetryStreamId(sequence) {
  return `${DOCKER_TELEMETRY_STREAM_INSTANCE_ID}:${Math.max(0, Number(sequence) || 0)}`;
}

function parseDockerTelemetryStreamSequence(value) {
  const normalized = normalizeText(value, 256);
  if (!normalized) return 0;
  const separatorIndex = normalized.lastIndexOf(':');
  if (separatorIndex < 0) return Math.max(0, Number(normalized) || 0);
  if (normalized.slice(0, separatorIndex) !== DOCKER_TELEMETRY_STREAM_INSTANCE_ID) return 0;
  return Math.max(0, Number(normalized.slice(separatorIndex + 1)) || 0);
}

function normalizeTelemetryContainer(container = {}) {
  const containerId = normalizeText(container.containerId, 128);
  const containerName = normalizeText(container.containerName, 256);
  if (!containerId && !containerName) return null;

  return {
    containerId,
    containerName,
    project: normalizeText(container.project, 256),
    service: normalizeText(container.service, 256),
    image: normalizeText(container.image, 512),
    cpuPercent: normalizeNumber(container.cpuPercent, { max: 100000 }),
    memoryBytes: normalizeNumber(container.memoryBytes),
    memoryLimitBytes: normalizeNumber(container.memoryLimitBytes),
    memoryPercent: normalizeNumber(container.memoryPercent, { max: 100000 }),
    networkRxBytes: normalizeNumber(container.networkRxBytes),
    networkTxBytes: normalizeNumber(container.networkTxBytes),
    blockReadBytes: normalizeNumber(container.blockReadBytes),
    blockWriteBytes: normalizeNumber(container.blockWriteBytes),
    pids: Math.round(normalizeNumber(container.pids, { max: 1000000 })),
  };
}

function normalizeDockerTelemetryPayload(payload = {}) {
  const kind = normalizeText(payload.kind, 64).toUpperCase();
  const source = {
    hostname: normalizeText(payload.source?.hostname, 256),
    transport: normalizeText(payload.source?.transport, 64) || 'HOST_AGENT',
  };

  if (kind === 'DOCKER_TELEMETRY_HEARTBEAT') {
    return {
      kind,
      providerCode: 'DOCKER',
      observerStatus: normalizeText(payload.observerStatus, 64).toUpperCase() || 'UNKNOWN',
      errorCode: normalizeText(payload.errorCode, 128),
      occurredAt: normalizeIsoDate(payload.occurredAt),
      source,
    };
  }

  if (kind !== 'DOCKER_TELEMETRY_SNAPSHOT') {
    const error = new Error(`Unsupported Docker telemetry payload kind '${kind || 'blank'}'.`);
    error.statusCode = 400;
    throw error;
  }

  const containers = (Array.isArray(payload.containers) ? payload.containers : [])
    .slice(0, MAX_DOCKER_TELEMETRY_CONTAINERS)
    .map(normalizeTelemetryContainer)
    .filter(Boolean);

  return {
    kind,
    providerCode: 'DOCKER',
    capturedAt: normalizeIsoDate(payload.capturedAt),
    sampleIntervalMs: normalizeNumber(payload.sampleIntervalMs, { min: 1000, max: 60000 }),
    source,
    containers,
  };
}

function buildRate(current, previous, field, elapsedSeconds) {
  if (!previous || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
  const currentValue = normalizeNumber(current[field]);
  const previousValue = normalizeNumber(previous[field]);
  if (currentValue < previousValue) return 0;
  return (currentValue - previousValue) / elapsedSeconds;
}

function enrichTelemetrySnapshot(snapshot, previousSample = null) {
  const previousById = new Map(
    (previousSample?.containers || [])
      .filter((container) => container.containerId)
      .map((container) => [container.containerId, container]),
  );
  const elapsedSeconds = previousSample
    ? Math.max(
        0,
        (new Date(snapshot.capturedAt).getTime() - new Date(previousSample.capturedAt).getTime()) / 1000,
      )
    : 0;

  const containers = snapshot.containers.map((container) => {
    const previous = previousById.get(container.containerId);
    return {
      ...container,
      networkRxRateBytesPerSec: buildRate(container, previous, 'networkRxBytes', elapsedSeconds),
      networkTxRateBytesPerSec: buildRate(container, previous, 'networkTxBytes', elapsedSeconds),
      blockReadRateBytesPerSec: buildRate(container, previous, 'blockReadBytes', elapsedSeconds),
      blockWriteRateBytesPerSec: buildRate(container, previous, 'blockWriteBytes', elapsedSeconds),
    };
  });

  const totals = containers.reduce(
    (result, container) => ({
      cpuPercent: result.cpuPercent + container.cpuPercent,
      memoryBytes: result.memoryBytes + container.memoryBytes,
      memoryPercent: result.memoryPercent + container.memoryPercent,
      networkRxRateBytesPerSec:
        result.networkRxRateBytesPerSec + container.networkRxRateBytesPerSec,
      networkTxRateBytesPerSec:
        result.networkTxRateBytesPerSec + container.networkTxRateBytesPerSec,
      blockReadRateBytesPerSec:
        result.blockReadRateBytesPerSec + container.blockReadRateBytesPerSec,
      blockWriteRateBytesPerSec:
        result.blockWriteRateBytesPerSec + container.blockWriteRateBytesPerSec,
      pids: result.pids + container.pids,
    }),
    {
      cpuPercent: 0,
      memoryBytes: 0,
      memoryPercent: 0,
      networkRxRateBytesPerSec: 0,
      networkTxRateBytesPerSec: 0,
      blockReadRateBytesPerSec: 0,
      blockWriteRateBytesPerSec: 0,
      pids: 0,
    },
  );

  const projects = [...new Set(containers.map((container) => container.project).filter(Boolean))]
    .map((project) => {
      const members = containers.filter((container) => container.project === project);
      return {
        project,
        containerCount: members.length,
        cpuPercent: members.reduce((sum, container) => sum + container.cpuPercent, 0),
        memoryBytes: members.reduce((sum, container) => sum + container.memoryBytes, 0),
        networkRxRateBytesPerSec: members.reduce(
          (sum, container) => sum + container.networkRxRateBytesPerSec,
          0,
        ),
        networkTxRateBytesPerSec: members.reduce(
          (sum, container) => sum + container.networkTxRateBytesPerSec,
          0,
        ),
      };
    })
    .sort((left, right) => right.cpuPercent - left.cpuPercent || left.project.localeCompare(right.project));

  return {
    ...snapshot,
    containers,
    totals: {
      ...totals,
      containerCount: containers.length,
    },
    projects,
  };
}

function publish(message) {
  for (const subscriber of subscribers) {
    try {
      subscriber(message);
    } catch {
      // One disconnected subscriber must never disrupt telemetry ingestion.
    }
  }
}

function getSourceStatus(now = Date.now()) {
  if (!lastHeartbeatAt) return 'WAITING';
  const ageMs = now - new Date(lastHeartbeatAt).getTime();
  const staleAfterMs = Math.max(
    DOCKER_TELEMETRY_SOURCE_STALE_MS,
    Number(sourceSampleIntervalMs || 0) * 3,
  );
  if (!Number.isFinite(ageMs) || ageMs > staleAfterMs) return 'STALE';
  if (sourceObserverStatus === 'ONLINE') return 'ONLINE';
  if (['STARTING', 'CONNECTING', 'RETRYING'].includes(sourceObserverStatus)) return 'DEGRADED';
  if (sourceObserverStatus === 'ERROR') return 'ERROR';
  return 'WAITING';
}

function getDockerTelemetryStreamStatus() {
  return {
    providerCode: 'DOCKER',
    status: getSourceStatus(),
    sourceHostname,
    sourceTransport,
    sourceObserverStatus,
    lastHeartbeatAt,
    lastSampleAt,
    bufferedSamples: recentSamples.length,
    totalSamplesReceived,
    subscriberCount: subscribers.size,
    sampleIntervalMs: sourceSampleIntervalMs,
  };
}

function ingestDockerTelemetryPayload(payload = {}) {
  const normalized = normalizeDockerTelemetryPayload(payload);
  const receivedAt = new Date().toISOString();
  lastHeartbeatAt = receivedAt;
  sourceHostname = normalized.source.hostname || sourceHostname;
  sourceTransport = normalized.source.transport || sourceTransport;

  if (normalized.kind === 'DOCKER_TELEMETRY_HEARTBEAT') {
    sourceObserverStatus = normalized.observerStatus || 'UNKNOWN';
    const status = getDockerTelemetryStreamStatus();
    publish({ type: 'telemetry-status', data: status });
    return { accepted: true, kind: normalized.kind, status };
  }

  sourceObserverStatus = 'ONLINE';
  sourceSampleIntervalMs = normalized.sampleIntervalMs || sourceSampleIntervalMs;
  nextSequence += 1;
  totalSamplesReceived += 1;
  const sample = {
    ...enrichTelemetrySnapshot(normalized, recentSamples[recentSamples.length - 1] || null),
    sampleId: randomUUID(),
    sequence: nextSequence,
    receivedAt,
  };
  lastSampleAt = receivedAt;
  recentSamples.push(sample);
  if (recentSamples.length > MAX_DOCKER_TELEMETRY_BUFFER) {
    recentSamples = recentSamples.slice(-MAX_DOCKER_TELEMETRY_BUFFER);
  }

  publish({
    type: 'docker-telemetry',
    id: buildDockerTelemetryStreamId(sample.sequence),
    data: sample,
  });

  return {
    accepted: true,
    kind: normalized.kind,
    sequence: sample.sequence,
    sampleId: sample.sampleId,
  };
}

function subscribeDockerTelemetry(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getReplaySamples({ afterSequence = 0, limit = DEFAULT_DOCKER_TELEMETRY_REPLAY_COUNT } = {}) {
  const normalizedAfter = Math.max(0, Number(afterSequence) || 0);
  const normalizedLimit = Math.min(
    MAX_DOCKER_TELEMETRY_BUFFER,
    Math.max(1, Number(limit) || DEFAULT_DOCKER_TELEMETRY_REPLAY_COUNT),
  );
  const candidates = normalizedAfter > 0
    ? recentSamples.filter((sample) => sample.sequence > normalizedAfter)
    : recentSamples.slice(-normalizedLimit);
  return candidates.slice(-normalizedLimit);
}

function streamDockerTelemetry(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const lastEventId = parseDockerTelemetryStreamSequence(
    req.headers?.['last-event-id'] || req.query?.afterSequence || '',
  );
  writeSseMessage(res, { type: 'telemetry-status', data: getDockerTelemetryStreamStatus() });

  for (const sample of getReplaySamples({ afterSequence: lastEventId })) {
    writeSseMessage(res, {
      type: 'docker-telemetry',
      id: buildDockerTelemetryStreamId(sample.sequence),
      data: sample,
    });
  }

  const unsubscribe = subscribeDockerTelemetry((message) => writeSseMessage(res, message));
  const keepalive = setInterval(() => {
    writeSseMessage(res, { type: 'telemetry-status', data: getDockerTelemetryStreamStatus() });
  }, DOCKER_TELEMETRY_STREAM_KEEPALIVE_MS);
  keepalive.unref?.();

  const close = () => {
    clearInterval(keepalive);
    unsubscribe();
  };
  req.once('close', close);
  req.once('aborted', close);
}

function resetDockerTelemetryStreamForTest() {
  nextSequence = 0;
  recentSamples = [];
  lastHeartbeatAt = null;
  lastSampleAt = null;
  sourceHostname = null;
  sourceTransport = null;
  sourceObserverStatus = 'UNKNOWN';
  totalSamplesReceived = 0;
  sourceSampleIntervalMs = 5000;
  subscribers.clear();
}

module.exports = {
  DEFAULT_DOCKER_TELEMETRY_REPLAY_COUNT,
  DOCKER_TELEMETRY_SOURCE_STALE_MS,
  DOCKER_TELEMETRY_STREAM_INSTANCE_ID,
  DOCKER_TELEMETRY_STREAM_KEEPALIVE_MS,
  MAX_DOCKER_TELEMETRY_BUFFER,
  buildDockerTelemetryStreamId,
  enrichTelemetrySnapshot,
  getDockerTelemetryStreamStatus,
  getReplaySamples,
  ingestDockerTelemetryPayload,
  normalizeDockerTelemetryPayload,
  normalizeTelemetryContainer,
  parseDockerTelemetryStreamSequence,
  resetDockerTelemetryStreamForTest,
  streamDockerTelemetry,
  subscribeDockerTelemetry,
};
