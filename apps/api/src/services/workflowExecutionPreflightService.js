const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../../../packages/host-agent/src/config');
const { WorkflowServiceError } = require('./workflowServiceError');

const HOST_EXECUTION_TARGETS = new Set(['HOST', 'HOST_AGENT']);
const HOST_AGENT_TOOL_CODES = new Set(['local_repo_sync', 'local_dev_pull']);
const HOST_AGENT_RECENT_HEARTBEAT_SECONDS = 60;
const HOST_AGENT_LIVE_PROBE_TIMEOUT = '6 seconds';

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getSafeObject(value) {
  return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function normalizeExecutionTarget(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function getNodeExecutionTarget(node = {}) {
  const config = getSafeObject(node.config);
  const targetConfig = getSafeObject(node.targetConfig);
  const explicitTarget = normalizeExecutionTarget(
    config.executionTarget ||
      config.execution_target ||
      targetConfig.executionTarget ||
      targetConfig.execution_target,
  );

  if (explicitTarget) {
    return explicitTarget;
  }

  // Host-only Git tools route through the Host Agent from their CLI process. Infer
  // that requirement from the stable tool code as a safety backstop because cloned
  // or UI-edited workflow graphs may not preserve legacy target_config metadata.
  const nodeTypeCode = normalizeExecutionTarget(node.nodeTypeCode || node.node_type_code);
  const targetCode = String(node.targetCode || node.target_code || '').trim().toLowerCase();
  if ((!nodeTypeCode || nodeTypeCode === 'TOOL') && HOST_AGENT_TOOL_CODES.has(targetCode)) {
    return 'HOST_AGENT';
  }

  return '';
}

function getHostExecutionNodes(definition = {}) {
  return (Array.isArray(definition.nodes) ? definition.nodes : []).filter((node) =>
    HOST_EXECUTION_TARGETS.has(getNodeExecutionTarget(node)),
  );
}

function isMissingHeartbeatRelation(error) {
  return error?.code === '42P01' || /does not exist/i.test(error?.message || '');
}

function normalizeLiveProbe(liveProbe) {
  const probe = getSafeObject(liveProbe);
  return {
    attempted: Boolean(probe.attempted),
    online: Boolean(probe.online),
    status: String(probe.status || (probe.online ? 'ONLINE' : 'UNKNOWN')).toUpperCase(),
    checkedAt: probe.checkedAt || null,
    hostname: probe.hostname || null,
    processId: probe.processId || null,
    profileCode: probe.profileCode || null,
    taskQueue: probe.taskQueue || null,
    error: probe.error ? String(probe.error) : null,
  };
}

function buildHostAgentState({
  enabled,
  taskQueue,
  namespace,
  heartbeats = [],
  error = null,
  liveProbe = null,
}) {
  const normalizedHeartbeats = (Array.isArray(heartbeats) ? heartbeats : []).map((row) =>
    camelizeRow(row),
  );
  const recentHeartbeats = normalizedHeartbeats.filter(
    (heartbeat) =>
      heartbeat.isRecent &&
      ['STARTING', 'ONLINE'].includes(String(heartbeat.status || '').toUpperCase()),
  );
  const latestHeartbeat = normalizedHeartbeats[0] || null;
  const normalizedLiveProbe = normalizeLiveProbe(liveProbe);
  const heartbeatOnline = recentHeartbeats.length > 0;
  const liveProbeOnline = normalizedLiveProbe.online;
  const online = Boolean(enabled && (heartbeatOnline || liveProbeOnline));
  const status = !enabled
    ? 'DISABLED'
    : online
      ? 'ONLINE'
      : normalizedHeartbeats.length > 0
        ? 'STALE'
        : error
          ? 'UNKNOWN'
          : 'OFFLINE';
  const availabilitySource = heartbeatOnline
    ? 'HEARTBEAT'
    : liveProbeOnline
      ? 'TEMPORAL_PROBE'
      : 'NONE';

  return {
    enabled: Boolean(enabled),
    online,
    status,
    namespace,
    taskQueue,
    availabilitySource,
    heartbeatOnline,
    heartbeatDegraded: Boolean(enabled && liveProbeOnline && !heartbeatOnline),
    heartbeatFreshnessSeconds: HOST_AGENT_RECENT_HEARTBEAT_SECONDS,
    recentHeartbeatCount: recentHeartbeats.length,
    totalKnownAgents: normalizedHeartbeats.length,
    latestHeartbeat,
    heartbeats: normalizedHeartbeats,
    liveProbe: normalizedLiveProbe,
    error: error ? String(error.message || error) : null,
  };
}

async function loadHostAgentHeartbeats({ namespace, taskQueue }) {
  const { query } = require('../../../../packages/db/src/connection');
  const result = await query(
    `
      SELECT *
      FROM worker.vw_temporal_worker_heartbeats
      WHERE namespace = $1
        AND task_queue = $2
        AND (
          metadata ->> 'role' = 'HOST_AGENT'
          OR metadata ->> 'executionTarget' = 'HOST'
        )
      ORDER BY last_seen_at DESC
      LIMIT 12
    `,
    [namespace, taskQueue],
  );

  return result.rows || [];
}

async function probeHostAgentLive({ namespace, taskQueue }) {
  const { randomUUID } = require('node:crypto');
  const { Connection, Client } = require('@temporalio/client');
  const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
  const temporalConfig = getTemporalConfig();
  let connection = null;

  try {
    connection = await Connection.connect({ address: temporalConfig.address });
    const client = new Client({ connection, namespace });
    const result = await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporalConfig.taskQueue,
      workflowId: `skycommand-host-agent-preflight-${Date.now()}-${randomUUID().slice(0, 8)}`,
      workflowExecutionTimeout: HOST_AGENT_LIVE_PROBE_TIMEOUT,
      args: [
        {
          toolCode: '__health',
          hostTaskQueue: taskQueue,
        },
      ],
    });
    const payload = getSafeObject(result?.result);
    const online = Boolean(result?.ok && String(payload.status || '').toUpperCase() === 'ONLINE');

    return {
      attempted: true,
      online,
      status: online ? 'ONLINE' : 'OFFLINE',
      checkedAt: payload.checkedAt || new Date().toISOString(),
      hostname: payload.hostname || null,
      processId: payload.processId || null,
      profileCode: payload.profileCode || null,
      taskQueue: payload.taskQueue || taskQueue,
      error: online ? null : result?.error?.message || 'SkyCommand Host Agent live probe failed.',
    };
  } catch (error) {
    return {
      attempted: true,
      online: false,
      status: 'OFFLINE',
      checkedAt: new Date().toISOString(),
      hostname: null,
      processId: null,
      profileCode: null,
      taskQueue,
      error: error?.message || String(error),
    };
  } finally {
    await connection?.close().catch(() => {});
  }
}

async function getHostAgentAvailability({
  heartbeatLoader = loadHostAgentHeartbeats,
  liveProbeLoader = probeHostAgentLive,
} = {}) {
  const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
  const temporalConfig = getTemporalConfig();
  const namespace = temporalConfig.namespace;
  const taskQueue = normalizeHostAgentTaskQueue(
    process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
  );
  const enabled = toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED);

  if (!enabled) {
    return buildHostAgentState({ enabled, taskQueue, namespace });
  }

  let heartbeats = [];
  let heartbeatError = null;

  try {
    heartbeats = await heartbeatLoader({ namespace, taskQueue });
  } catch (error) {
    heartbeatError = isMissingHeartbeatRelation(error)
      ? new Error('Host Agent heartbeat persistence is unavailable.')
      : error;
  }

  const heartbeatState = buildHostAgentState({
    enabled,
    taskQueue,
    namespace,
    heartbeats,
    error: heartbeatError,
  });

  if (heartbeatState.online) {
    return heartbeatState;
  }

  let liveProbe = null;
  try {
    liveProbe = await liveProbeLoader({ namespace, taskQueue });
  } catch (error) {
    liveProbe = {
      attempted: true,
      online: false,
      status: 'OFFLINE',
      checkedAt: new Date().toISOString(),
      taskQueue,
      error: error?.message || String(error),
    };
  }

  return buildHostAgentState({
    enabled,
    taskQueue,
    namespace,
    heartbeats,
    error: heartbeatError,
    liveProbe,
  });
}

async function assertWorkflowExecutionTargetsAvailable(
  definition = {},
  { availabilityLoader = getHostAgentAvailability } = {},
) {
  const hostNodes = getHostExecutionNodes(definition);

  if (hostNodes.length === 0) {
    return {
      hostAgentRequired: false,
      hostNodeKeys: [],
    };
  }

  const availability = await availabilityLoader();
  const hostNodeKeys = hostNodes.map((node) => node.nodeKey).filter(Boolean);

  if (!availability.enabled) {
    throw new WorkflowServiceError(
      'Workflow requires the SkyCommand Host Agent, but host execution is disabled. Set SKYCOMMAND_HOST_AGENT_ENABLED=true and restart the SkyCommand Docker stack before starting this workflow.',
      409,
      {
        code: 'WORKFLOW_HOST_AGENT_DISABLED',
        workflowCode: definition.workflowCode || null,
        hostNodeKeys,
        taskQueue: availability.taskQueue,
        hostAgentStatus: availability.status,
      },
    );
  }

  if (!availability.online) {
    throw new WorkflowServiceError(
      'Host Agent required but unavailable. Start or restore the SkyCommand Host Agent before starting this workflow.',
      503,
      {
        code: 'WORKFLOW_HOST_AGENT_UNAVAILABLE',
        workflowCode: definition.workflowCode || null,
        hostNodeKeys,
        taskQueue: availability.taskQueue,
        hostAgentStatus: availability.status,
        availabilitySource: availability.availabilitySource || 'NONE',
        recentHeartbeatCount: availability.recentHeartbeatCount,
        latestHeartbeatAt: availability.latestHeartbeat?.lastSeenAt || null,
        liveProbeAttempted: Boolean(availability.liveProbe?.attempted),
        liveProbeError: availability.liveProbe?.error || null,
        operatorCommand: 'npm run host-agent',
        healthCommand: 'npm run host-agent:check',
      },
    );
  }

  return {
    hostAgentRequired: true,
    hostNodeKeys,
    availability,
  };
}

module.exports = {
  HOST_AGENT_LIVE_PROBE_TIMEOUT,
  HOST_AGENT_RECENT_HEARTBEAT_SECONDS,
  assertWorkflowExecutionTargetsAvailable,
  buildHostAgentState,
  getHostAgentAvailability,
  getHostExecutionNodes,
  getNodeExecutionTarget,
  loadHostAgentHeartbeats,
  probeHostAgentLive,
};
