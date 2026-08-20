const { randomUUID } = require('node:crypto');
const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../../../packages/host-agent/src/config');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const { getHostAgentAvailability } = require('./workflowExecutionPreflightService');

const DOCKER_PROVIDER_CODE = 'DOCKER';
const DOCKER_SNAPSHOT_TOOL_CODE = '__docker_snapshot';

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function buildDockerTarget(availability = {}) {
  const status = !availability.enabled
    ? 'DISABLED'
    : availability.online
      ? 'ONLINE'
      : availability.status || 'OFFLINE';

  return {
    targetCode: normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_CODE, 'LOCAL_DOCKER'),
    displayName: normalizeText(process.env.SKYCOMMAND_DOCKER_TARGET_NAME, 'Local Docker'),
    providerCode: DOCKER_PROVIDER_CODE,
    transport: 'HOST_AGENT',
    status,
    taskQueue: availability.taskQueue || normalizeHostAgentTaskQueue(
      process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
    ),
    hostname:
      availability.liveProbe?.hostname || availability.latestHeartbeat?.hostname || null,
    profileCode:
      availability.liveProbe?.profileCode ||
      availability.latestHeartbeat?.metadata?.profileCode ||
      null,
    availabilitySource: availability.availabilitySource || 'NONE',
  };
}

function buildUnavailableDockerOverview(availability = {}, error = null) {
  const target = buildDockerTarget(availability);
  const status = target.status === 'ONLINE' ? 'OFFLINE' : target.status;

  return {
    target: {
      ...target,
      status,
    },
    provider: {
      code: DOCKER_PROVIDER_CODE,
      status,
      engineVersion: '',
      engineName: '',
      operatingSystem: '',
      osType: '',
      architecture: '',
      cpuCount: 0,
      memoryBytes: 0,
      storageDriver: '',
    },
    host: {
      hostname: target.hostname,
      platform: null,
      architecture: null,
    },
    counts: {
      projects: 0,
      containers: 0,
      running: 0,
      stopped: 0,
      healthy: 0,
      unhealthy: 0,
      images: 0,
      volumes: 0,
      networks: 0,
    },
    projects: [],
    containers: [],
    images: [],
    volumes: [],
    networks: [],
    error: error
      ? {
          code: normalizeText(error.code, 'SKYCOMMAND_DOCKER_UNAVAILABLE'),
          message: normalizeText(error.message, 'Docker provider is unavailable.'),
          details: error.details || null,
        }
      : availability.enabled
        ? {
            code: 'SKYCOMMAND_HOST_AGENT_UNAVAILABLE',
            message: 'SkyCommand Host Agent is unavailable for Docker inventory.',
            details: {
              taskQueue: target.taskQueue,
              availabilitySource: target.availabilitySource,
            },
          }
        : {
            code: 'SKYCOMMAND_HOST_AGENT_DISABLED',
            message: 'SkyCommand Host Agent is disabled. Docker inventory requires host execution.',
            details: {
              taskQueue: target.taskQueue,
            },
          },
    capturedAt: new Date().toISOString(),
  };
}

async function dispatchDockerSnapshot({ temporalConfig = getTemporalConfig() } = {}) {
  const { Connection, Client } = require('@temporalio/client');
  const hostTaskQueue = normalizeHostAgentTaskQueue(
    process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
  );
  const connection = await Connection.connect({ address: temporalConfig.address });

  try {
    const client = new Client({
      connection,
      namespace: temporalConfig.namespace,
    });

    return await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporalConfig.taskQueue,
      workflowId: `skycommand-docker-overview-${Date.now()}-${randomUUID().slice(0, 8)}`,
      workflowExecutionTimeout: '25 seconds',
      args: [
        {
          toolCode: DOCKER_SNAPSHOT_TOOL_CODE,
          hostTaskQueue,
        },
      ],
    });
  } finally {
    await connection.close().catch(() => {});
  }
}

async function getDockerOverview({ availabilityLoader = getHostAgentAvailability, dispatcher = dispatchDockerSnapshot } = {}) {
  let availability;

  try {
    availability = await availabilityLoader();
  } catch (error) {
    return buildUnavailableDockerOverview(
      {
        enabled: true,
        online: false,
        status: 'UNKNOWN',
        taskQueue: normalizeHostAgentTaskQueue(
          process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
        ),
      },
      {
        code: 'SKYCOMMAND_HOST_AGENT_STATUS_FAILED',
        message: error?.message || 'Unable to determine Host Agent availability.',
      },
    );
  }

  if (!availability.enabled || !availability.online) {
    return buildUnavailableDockerOverview(availability);
  }

  try {
    const response = await dispatcher();

    if (!response?.ok) {
      return buildUnavailableDockerOverview(availability, response?.error || null);
    }

    const snapshot = response.result || {};
    return {
      ...snapshot,
      target: {
        ...buildDockerTarget(availability),
        status: 'ONLINE',
        hostname: snapshot.host?.hostname || buildDockerTarget(availability).hostname,
      },
      provider: {
        ...(snapshot.provider || {}),
        code: DOCKER_PROVIDER_CODE,
        status: snapshot.provider?.status || 'ONLINE',
      },
      error: null,
    };
  } catch (error) {
    return buildUnavailableDockerOverview(availability, {
      code: 'SKYCOMMAND_DOCKER_DISPATCH_FAILED',
      message: error?.message || 'Docker inventory dispatch failed.',
    });
  }
}

module.exports = {
  DOCKER_PROVIDER_CODE,
  DOCKER_SNAPSHOT_TOOL_CODE,
  buildDockerTarget,
  buildUnavailableDockerOverview,
  dispatchDockerSnapshot,
  getDockerOverview,
};
