const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const DEFAULT_DOCKER_EVENT_HEARTBEAT_MS = 15000;
const DEFAULT_DOCKER_EVENT_RESTART_MS = 5000;
const DEFAULT_DOCKER_EVENT_POST_TIMEOUT_MS = 5000;
const ALLOWED_DOCKER_CONTAINER_EVENT_ACTIONS = new Set([
  'CREATE',
  'START',
  'STOP',
  'DIE',
  'RESTART',
  'PAUSE',
  'UNPAUSE',
  'KILL',
  'OOM',
  'DESTROY',
  'RENAME',
  'UPDATE',
  'HEALTH_STATUS_HEALTHY',
  'HEALTH_STATUS_UNHEALTHY',
  'HEALTH_STATUS_STARTING',
]);

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

function normalizeAction(value) {
  return normalizeText(value, 96)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getDockerEventIngressUrl() {
  const configured = normalizeText(process.env.SKYCOMMAND_DOCKER_EVENT_INGEST_URL, 2048);
  if (configured) return configured;

  const port = Number(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 7171;
  return `http://127.0.0.1:${safePort}/api/infrastructure/providers/docker/events/ingest`;
}

function getDockerEventStreamConfig() {
  const heartbeatMs = Number(process.env.SKYCOMMAND_DOCKER_EVENT_HEARTBEAT_MS);
  const restartMs = Number(process.env.SKYCOMMAND_DOCKER_EVENT_RESTART_MS);
  const postTimeoutMs = Number(process.env.SKYCOMMAND_DOCKER_EVENT_POST_TIMEOUT_MS);

  return {
    enabled: parseBoolean(process.env.SKYCOMMAND_DOCKER_EVENT_STREAM_ENABLED, true),
    ingressUrl: getDockerEventIngressUrl(),
    internalToken: normalizeText(
      process.env.SKYCOMMAND_INTERNAL_API_TOKEN || process.env.SKYSERVER_INTERNAL_API_TOKEN,
      4096,
    ),
    heartbeatMs:
      Number.isFinite(heartbeatMs) && heartbeatMs >= 5000
        ? heartbeatMs
        : DEFAULT_DOCKER_EVENT_HEARTBEAT_MS,
    restartMs:
      Number.isFinite(restartMs) && restartMs >= 1000
        ? restartMs
        : DEFAULT_DOCKER_EVENT_RESTART_MS,
    postTimeoutMs:
      Number.isFinite(postTimeoutMs) && postTimeoutMs >= 1000
        ? postTimeoutMs
        : DEFAULT_DOCKER_EVENT_POST_TIMEOUT_MS,
  };
}

function normalizeOccurredAt(rawEvent = {}) {
  const timeNano = Number(rawEvent.timeNano || rawEvent.TimeNano || 0);
  if (Number.isFinite(timeNano) && timeNano > 0) {
    return new Date(Math.floor(timeNano / 1_000_000)).toISOString();
  }

  const timeSeconds = Number(rawEvent.time || rawEvent.Time || 0);
  if (Number.isFinite(timeSeconds) && timeSeconds > 0) {
    return new Date(timeSeconds * 1000).toISOString();
  }

  return new Date().toISOString();
}

function normalizeDockerEvent(rawEvent = {}, { hostname = os.hostname() } = {}) {
  const actor = rawEvent.Actor && typeof rawEvent.Actor === 'object' ? rawEvent.Actor : {};
  const attributes =
    actor.Attributes && typeof actor.Attributes === 'object' ? actor.Attributes : {};
  const type = normalizeText(rawEvent.Type || rawEvent.type, 64).toUpperCase();

  if (type && type !== 'CONTAINER') return null;

  const action = normalizeAction(rawEvent.Action || rawEvent.status || rawEvent.Status);
  const containerId = normalizeText(rawEvent.id || rawEvent.ID || actor.ID, 128);
  const containerName = normalizeText(attributes.name, 256);

  if (!action || !ALLOWED_DOCKER_CONTAINER_EVENT_ACTIONS.has(action)) return null;
  if (!containerId && !containerName) return null;

  return {
    kind: 'DOCKER_EVENT',
    providerCode: 'DOCKER',
    resourceType: 'CONTAINER',
    action,
    containerId,
    containerName,
    project: normalizeText(attributes['com.docker.compose.project'], 256),
    service: normalizeText(attributes['com.docker.compose.service'], 256),
    image: normalizeText(attributes.image || rawEvent.from || rawEvent.From, 512),
    exitCode: normalizeText(attributes.exitCode, 32),
    scope: normalizeText(rawEvent.scope || rawEvent.Scope, 64),
    occurredAt: normalizeOccurredAt(rawEvent),
    source: {
      hostname: normalizeText(hostname, 256),
      transport: 'HOST_AGENT',
    },
  };
}

function getDockerEventObserverErrorCode(error = null, stderr = '') {
  const message = normalizeText(`${error?.message || ''} ${error?.stderr || ''} ${stderr}`, 2048);
  if (error?.code === 'ENOENT' || /not recognized|not found/i.test(message)) {
    return 'SKYCOMMAND_DOCKER_CLI_UNAVAILABLE';
  }
  if (/daemon|docker desktop|pipe|connection refused|cannot connect/i.test(message)) {
    return 'SKYCOMMAND_DOCKER_ENGINE_UNAVAILABLE';
  }
  return 'SKYCOMMAND_DOCKER_EVENT_OBSERVER_UNAVAILABLE';
}

function buildBridgeHeartbeat({
  hostname = os.hostname(),
  observerStatus = 'UNKNOWN',
  errorCode = '',
} = {}) {
  return {
    kind: 'BRIDGE_HEARTBEAT',
    providerCode: 'DOCKER',
    source: {
      hostname: normalizeText(hostname, 256),
      transport: 'HOST_AGENT',
    },
    observerStatus: normalizeText(observerStatus, 64).toUpperCase() || 'UNKNOWN',
    errorCode: normalizeText(errorCode, 128),
    occurredAt: new Date().toISOString(),
  };
}

async function postDockerEventPayload(
  payload,
  {
    fetchImpl = globalThis.fetch,
    ingressUrl = getDockerEventIngressUrl(),
    internalToken = normalizeText(
      process.env.SKYCOMMAND_INTERNAL_API_TOKEN || process.env.SKYSERVER_INTERNAL_API_TOKEN,
      4096,
    ),
    timeoutMs = DEFAULT_DOCKER_EVENT_POST_TIMEOUT_MS,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('SkyCommand Host Agent requires a fetch-capable Node.js runtime for Docker live-observability relay.');
  }

  if (!internalToken) {
    const error = new Error(
      'SKYCOMMAND_INTERNAL_API_TOKEN is required for Host Agent Docker live-observability relay.',
    );
    error.code = 'SKYCOMMAND_DOCKER_EVENT_TOKEN_MISSING';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(ingressUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-SkyCommand-Internal-Token': internalToken,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = normalizeText(await response.text().catch(() => ''), 512);
      const error = new Error(
        `Docker live-observability relay endpoint returned HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
      );
      error.code = 'SKYCOMMAND_DOCKER_EVENT_RELAY_REJECTED';
      error.status = response.status;
      throw error;
    }

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

function startDockerEventBridge({
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  logger = console,
  hostname = os.hostname(),
  config = getDockerEventStreamConfig(),
} = {}) {
  let child = null;
  let stopped = false;
  let restartTimer = null;
  let heartbeatTimer = null;
  let relayState = 'UNKNOWN';
  let postChain = Promise.resolve();
  let lastStderr = '';
  let lastObserverWarningAt = 0;
  let observerStatus = 'STARTING';

  if (!config.enabled) {
    logger.log?.('[SkyCommand Host Agent] Docker event bridge disabled.');
    return {
      started: false,
      stop: async () => {},
    };
  }

  if (!config.internalToken) {
    logger.warn?.(
      '[SkyCommand Host Agent] Docker event bridge disabled because SKYCOMMAND_INTERNAL_API_TOKEN is not configured.',
    );
    return {
      started: false,
      stop: async () => {},
    };
  }

  function reportRelaySuccess() {
    if (relayState === 'OFFLINE') {
      logger.log?.('[SkyCommand Host Agent] Docker event relay recovered.');
    }
    relayState = 'ONLINE';
  }

  function reportRelayFailure(error) {
    if (relayState !== 'OFFLINE') {
      logger.warn?.(
        '[SkyCommand Host Agent] Docker event relay unavailable; Docker events will continue to be observed and future events/heartbeats will retry automatically:',
        error?.message || error,
      );
    }
    relayState = 'OFFLINE';
  }

  function enqueuePayload(payload) {
    postChain = postChain
      .catch(() => {})
      .then(() =>
        postDockerEventPayload(payload, {
          fetchImpl,
          ingressUrl: config.ingressUrl,
          internalToken: config.internalToken,
          timeoutMs: config.postTimeoutMs,
        }),
      )
      .then(reportRelaySuccess)
      .catch(reportRelayFailure);
  }

  function scheduleRestart() {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startStreamProcess();
    }, config.restartMs);
    restartTimer.unref?.();
  }

  function startStreamProcess() {
    if (stopped || child) return;

    observerStatus = 'CONNECTING';
    lastStderr = '';
    const nextChild = spawnImpl(
      'docker',
      ['events', '--format', '{{json .}}', '--filter', 'type=container'],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child = nextChild;

    nextChild.once('spawn', () => {
      if (!stopped && child === nextChild) {
        observerStatus = 'ONLINE';
        enqueuePayload(buildBridgeHeartbeat({ hostname, observerStatus }));
      }
    });

    const lines = readline.createInterface({ input: nextChild.stdout });
    lines.on('line', (line) => {
      let rawEvent;
      try {
        rawEvent = JSON.parse(line);
      } catch {
        return;
      }

      const normalizedEvent = normalizeDockerEvent(rawEvent, { hostname });
      if (normalizedEvent) enqueuePayload(normalizedEvent);
    });

    nextChild.stderr?.on('data', (chunk) => {
      lastStderr = normalizeText(`${lastStderr}${chunk}`, 1024);
    });

    nextChild.once('error', (error) => {
      if (child === nextChild) child = null;
      observerStatus = stopped ? 'STOPPED' : 'RETRYING';
      if (!stopped) {
        enqueuePayload(buildBridgeHeartbeat({
          hostname,
          observerStatus,
          errorCode: getDockerEventObserverErrorCode(error, lastStderr),
        }));
      }
      lines.close();
      if (!stopped) {
        const now = Date.now();
        if (now - lastObserverWarningAt >= 60000) {
          lastObserverWarningAt = now;
          logger.warn?.(
            '[SkyCommand Host Agent] Docker event observer failed to start; retrying automatically:',
            error?.message || error,
          );
        }
        scheduleRestart();
      }
    });

    nextChild.once('close', (code) => {
      if (child === nextChild) child = null;
      observerStatus = stopped ? 'STOPPED' : 'RETRYING';
      if (!stopped) {
        enqueuePayload(buildBridgeHeartbeat({
          hostname,
          observerStatus,
          errorCode: getDockerEventObserverErrorCode(null, lastStderr),
        }));
      }
      lines.close();
      if (!stopped) {
        const now = Date.now();
        if (now - lastObserverWarningAt >= 60000) {
          lastObserverWarningAt = now;
          logger.warn?.(
            `[SkyCommand Host Agent] Docker event observer stopped${Number.isInteger(code) ? ` (exit ${code})` : ''}${lastStderr ? `: ${lastStderr}` : ''}; retrying automatically.`,
          );
        }
        scheduleRestart();
      }
    });
  }

  logger.log?.(`[SkyCommand Host Agent] Docker event bridge -> ${config.ingressUrl}`);
  startStreamProcess();
  enqueuePayload(buildBridgeHeartbeat({ hostname, observerStatus }));

  heartbeatTimer = setInterval(() => {
    enqueuePayload(buildBridgeHeartbeat({ hostname, observerStatus }));
  }, config.heartbeatMs);
  heartbeatTimer.unref?.();

  return {
    started: true,
    async stop() {
      if (stopped) return;
      stopped = true;
      observerStatus = 'STOPPED';
      if (restartTimer) clearTimeout(restartTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      restartTimer = null;
      heartbeatTimer = null;

      if (child) {
        const activeChild = child;
        child = null;
        activeChild.kill();
      }

      enqueuePayload(buildBridgeHeartbeat({ hostname, observerStatus }));
      await postChain.catch(() => {});
    },
  };
}

module.exports = {
  ALLOWED_DOCKER_CONTAINER_EVENT_ACTIONS,
  DEFAULT_DOCKER_EVENT_HEARTBEAT_MS,
  DEFAULT_DOCKER_EVENT_POST_TIMEOUT_MS,
  DEFAULT_DOCKER_EVENT_RESTART_MS,
  buildBridgeHeartbeat,
  getDockerEventIngressUrl,
  getDockerEventObserverErrorCode,
  getDockerEventStreamConfig,
  normalizeAction,
  normalizeDockerEvent,
  postDockerEventPayload,
  startDockerEventBridge,
};
