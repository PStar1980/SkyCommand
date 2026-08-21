const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { postDockerEventPayload } = require('./dockerEventBridge');

const execFileAsync = promisify(execFile);
const DEFAULT_DOCKER_TELEMETRY_INTERVAL_MS = 5000;
const DEFAULT_DOCKER_TELEMETRY_POST_TIMEOUT_MS = 5000;
const DEFAULT_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS = 10000;
const DEFAULT_DOCKER_TELEMETRY_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DEFAULT_DOCKER_TELEMETRY_METADATA_REFRESH_MS = 60000;

function normalizeText(value, maxLength = 512) {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized.slice(0, maxLength);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseJsonLines(value) {
  return normalizeText(value, DEFAULT_DOCKER_TELEMETRY_MAX_BUFFER_BYTES)
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((record) => record && typeof record === 'object');
}

function parsePercent(value) {
  const number = Number(normalizeText(value, 64).replace('%', ''));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function parseByteValue(value) {
  const source = normalizeText(value, 64);
  if (!source || source === '--') return 0;

  const match = source.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtpe]?i?b)?$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return 0;

  const unit = String(match[2] || 'B').toUpperCase();
  const unitPrefix = unit.replace('IB', '').replace('B', '');
  const powers = { '': 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6 };
  const power = powers[unitPrefix];
  if (power === undefined) return 0;

  const base = unit.includes('IB') ? 1024 : 1000;
  return Math.round(amount * (base ** power));
}

function parseBytePair(value) {
  const [left = '', right = ''] = normalizeText(value, 160).split('/');
  return {
    first: parseByteValue(left.trim()),
    second: parseByteValue(right.trim()),
  };
}

function normalizeInspectMetadata(record = {}) {
  const labels = record?.Config?.Labels && typeof record.Config.Labels === 'object'
    ? record.Config.Labels
    : {};

  return {
    containerId: normalizeText(record.Id || record.ID, 128),
    containerName: normalizeText(record.Name, 256).replace(/^\/+/, ''),
    project: normalizeText(labels['com.docker.compose.project'], 256),
    service: normalizeText(labels['com.docker.compose.service'], 256),
    image: normalizeText(record?.Config?.Image, 512),
  };
}

function buildMetadataMap(inspectRecords = []) {
  const metadata = new Map();

  for (const record of inspectRecords) {
    const normalized = normalizeInspectMetadata(record);
    if (!normalized.containerId) continue;
    metadata.set(normalized.containerId, normalized);
    metadata.set(normalized.containerId.slice(0, 12), normalized);
  }

  return metadata;
}

function normalizeDockerTelemetryStat(record = {}, metadataMap = new Map()) {
  const containerId = normalizeText(record.Container || record.ID || record.Id, 128);
  const metadata = metadataMap.get(containerId) || metadataMap.get(containerId.slice(0, 12)) || {};
  const memory = parseBytePair(record.MemUsage);
  const network = parseBytePair(record.NetIO);
  const block = parseBytePair(record.BlockIO);

  return {
    containerId: metadata.containerId || containerId,
    containerName: metadata.containerName || normalizeText(record.Name, 256),
    project: metadata.project || '',
    service: metadata.service || '',
    image: metadata.image || '',
    cpuPercent: parsePercent(record.CPUPerc),
    memoryBytes: memory.first,
    memoryLimitBytes: memory.second,
    memoryPercent: parsePercent(record.MemPerc),
    networkRxBytes: network.first,
    networkTxBytes: network.second,
    blockReadBytes: block.first,
    blockWriteBytes: block.second,
    pids: Math.max(0, Number.parseInt(record.PIDs, 10) || 0),
  };
}

function getDockerTelemetryIngressUrl() {
  const configured = normalizeText(process.env.SKYCOMMAND_DOCKER_TELEMETRY_INGEST_URL, 2048);
  if (configured) return configured;

  const port = Number(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 7171;
  return `http://127.0.0.1:${safePort}/api/infrastructure/providers/docker/telemetry/ingest`;
}

function getDockerTelemetryConfig() {
  const intervalMs = Number(process.env.SKYCOMMAND_DOCKER_TELEMETRY_INTERVAL_MS);
  const postTimeoutMs = Number(process.env.SKYCOMMAND_DOCKER_TELEMETRY_POST_TIMEOUT_MS);
  const commandTimeoutMs = Number(process.env.SKYCOMMAND_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS);

  return {
    enabled: parseBoolean(process.env.SKYCOMMAND_DOCKER_TELEMETRY_ENABLED, true),
    ingressUrl: getDockerTelemetryIngressUrl(),
    internalToken: normalizeText(
      process.env.SKYCOMMAND_INTERNAL_API_TOKEN || process.env.SKYSERVER_INTERNAL_API_TOKEN,
      4096,
    ),
    intervalMs:
      Number.isFinite(intervalMs) && intervalMs >= 2000
        ? intervalMs
        : DEFAULT_DOCKER_TELEMETRY_INTERVAL_MS,
    postTimeoutMs:
      Number.isFinite(postTimeoutMs) && postTimeoutMs >= 1000
        ? postTimeoutMs
        : DEFAULT_DOCKER_TELEMETRY_POST_TIMEOUT_MS,
    commandTimeoutMs:
      Number.isFinite(commandTimeoutMs) && commandTimeoutMs >= 1000
        ? commandTimeoutMs
        : DEFAULT_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS,
  };
}

async function runDockerTelemetryCommand(args, {
  executor = execFileAsync,
  timeoutMs = DEFAULT_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS,
} = {}) {
  const result = await executor('docker', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: DEFAULT_DOCKER_TELEMETRY_MAX_BUFFER_BYTES,
    windowsHide: true,
  });
  return normalizeText(result?.stdout, DEFAULT_DOCKER_TELEMETRY_MAX_BUFFER_BYTES);
}

async function captureDockerTelemetrySnapshot({
  executor = execFileAsync,
  hostname = os.hostname(),
  intervalMs = DEFAULT_DOCKER_TELEMETRY_INTERVAL_MS,
  commandTimeoutMs = DEFAULT_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS,
  metadataCache = null,
  metadataRefreshMs = DEFAULT_DOCKER_TELEMETRY_METADATA_REFRESH_MS,
  now = Date.now,
} = {}) {
  const statsOutput = await runDockerTelemetryCommand(
    ['stats', '--no-stream', '--format', '{{json .}}'],
    { executor, timeoutMs: commandTimeoutMs },
  );
  const statsRecords = parseJsonLines(statsOutput);
  const containerIds = statsRecords
    .map((record) => normalizeText(record.Container || record.ID || record.Id, 128))
    .filter(Boolean);

  const containerSignature = [...containerIds].sort().join('|');
  const cacheAgeMs = metadataCache?.lastRefreshedAt
    ? Math.max(0, now() - Number(metadataCache.lastRefreshedAt || 0))
    : Number.POSITIVE_INFINITY;
  const shouldRefreshMetadata =
    containerIds.length > 0 &&
    (!metadataCache ||
      metadataCache.signature !== containerSignature ||
      !(metadataCache.map instanceof Map) ||
      cacheAgeMs >= metadataRefreshMs);

  let metadataMap = metadataCache?.map instanceof Map ? metadataCache.map : new Map();
  if (shouldRefreshMetadata) {
    const inspectOutput = await runDockerTelemetryCommand(
      ['inspect', '--format', '{{json .}}', ...containerIds],
      { executor, timeoutMs: commandTimeoutMs },
    );
    metadataMap = buildMetadataMap(parseJsonLines(inspectOutput));
    if (metadataCache) {
      metadataCache.signature = containerSignature;
      metadataCache.lastRefreshedAt = now();
      metadataCache.map = metadataMap;
    }
  } else if (containerIds.length === 0 && metadataCache) {
    metadataCache.signature = '';
    metadataCache.lastRefreshedAt = now();
    metadataCache.map = new Map();
    metadataMap = metadataCache.map;
  }
  const containers = statsRecords
    .map((record) => normalizeDockerTelemetryStat(record, metadataMap))
    .filter((container) => container.containerId || container.containerName);

  return {
    kind: 'DOCKER_TELEMETRY_SNAPSHOT',
    providerCode: 'DOCKER',
    sampleIntervalMs: intervalMs,
    capturedAt: new Date().toISOString(),
    source: {
      hostname: normalizeText(hostname, 256),
      transport: 'HOST_AGENT',
    },
    containers,
  };
}

function buildTelemetryHeartbeat({ hostname = os.hostname(), observerStatus = 'UNKNOWN', errorCode = '' } = {}) {
  return {
    kind: 'DOCKER_TELEMETRY_HEARTBEAT',
    providerCode: 'DOCKER',
    observerStatus: normalizeText(observerStatus, 64).toUpperCase() || 'UNKNOWN',
    errorCode: normalizeText(errorCode, 128),
    occurredAt: new Date().toISOString(),
    source: {
      hostname: normalizeText(hostname, 256),
      transport: 'HOST_AGENT',
    },
  };
}

function startDockerTelemetryBridge({
  executor = execFileAsync,
  fetchImpl = globalThis.fetch,
  logger = console,
  hostname = os.hostname(),
  config = getDockerTelemetryConfig(),
} = {}) {
  let stopped = false;
  let sampleTimer = null;
  let relayState = 'UNKNOWN';
  let sourceState = 'STARTING';
  let lastWarningAt = 0;
  let activeCapture = Promise.resolve();
  const metadataCache = { signature: '', lastRefreshedAt: 0, map: new Map() };

  if (!config.enabled) {
    logger.log?.('[SkyCommand Host Agent] Docker telemetry bridge disabled.');
    return { started: false, stop: async () => {} };
  }

  if (!config.internalToken) {
    logger.warn?.(
      '[SkyCommand Host Agent] Docker telemetry bridge disabled because SKYCOMMAND_INTERNAL_API_TOKEN is not configured.',
    );
    return { started: false, stop: async () => {} };
  }

  async function relay(payload) {
    try {
      await postDockerEventPayload(payload, {
        fetchImpl,
        ingressUrl: config.ingressUrl,
        internalToken: config.internalToken,
        timeoutMs: config.postTimeoutMs,
      });
      if (relayState === 'OFFLINE') {
        logger.log?.('[SkyCommand Host Agent] Docker telemetry relay recovered.');
      }
      relayState = 'ONLINE';
    } catch (error) {
      if (relayState !== 'OFFLINE') {
        logger.warn?.(
          '[SkyCommand Host Agent] Docker telemetry relay unavailable; samples will retry automatically:',
          error?.message || error,
        );
      }
      relayState = 'OFFLINE';
    }
  }

  async function captureAndRelay() {
    if (stopped) return;

    try {
      const snapshot = await captureDockerTelemetrySnapshot({
        executor,
        hostname,
        intervalMs: config.intervalMs,
        commandTimeoutMs: config.commandTimeoutMs,
        metadataCache,
      });
      sourceState = 'ONLINE';
      await relay(snapshot);
    } catch (error) {
      sourceState = 'ERROR';
      const now = Date.now();
      if (now - lastWarningAt >= 60000) {
        lastWarningAt = now;
        logger.warn?.(
          '[SkyCommand Host Agent] Docker telemetry sampling failed; retrying automatically:',
          error?.message || error,
        );
      }
      await relay(buildTelemetryHeartbeat({
        hostname,
        observerStatus: sourceState,
        errorCode: error?.code || 'SKYCOMMAND_DOCKER_TELEMETRY_CAPTURE_FAILED',
      }));
    } finally {
      if (!stopped) {
        sampleTimer = setTimeout(() => {
          activeCapture = captureAndRelay();
        }, config.intervalMs);
        sampleTimer.unref?.();
      }
    }
  }

  logger.log?.(
    `[SkyCommand Host Agent] Docker telemetry bridge -> ${config.ingressUrl} (${config.intervalMs} ms)`,
  );
  activeCapture = captureAndRelay();

  return {
    started: true,
    async stop() {
      if (stopped) return;
      stopped = true;
      sourceState = 'STOPPED';
      if (sampleTimer) clearTimeout(sampleTimer);
      sampleTimer = null;
      await activeCapture.catch(() => {});
      await relay(buildTelemetryHeartbeat({ hostname, observerStatus: sourceState }));
    },
  };
}

module.exports = {
  DEFAULT_DOCKER_TELEMETRY_COMMAND_TIMEOUT_MS,
  DEFAULT_DOCKER_TELEMETRY_INTERVAL_MS,
  DEFAULT_DOCKER_TELEMETRY_METADATA_REFRESH_MS,
  DEFAULT_DOCKER_TELEMETRY_POST_TIMEOUT_MS,
  buildMetadataMap,
  buildTelemetryHeartbeat,
  captureDockerTelemetrySnapshot,
  getDockerTelemetryConfig,
  getDockerTelemetryIngressUrl,
  normalizeDockerTelemetryStat,
  normalizeInspectMetadata,
  parseBytePair,
  parseByteValue,
  parseJsonLines,
  parsePercent,
  runDockerTelemetryCommand,
  startDockerTelemetryBridge,
};
