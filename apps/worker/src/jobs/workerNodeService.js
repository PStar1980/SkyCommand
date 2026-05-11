const os = require('os');
const { query } = require('../../../../packages/db/src/connection');

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;

function getDefaultNodeName() {
  return `${os.hostname()}:${process.pid}`;
}

function getWorkerNodeName() {
  return String(process.env.WORKER_NODE_NAME || getDefaultNodeName()).trim();
}

function getWorkerAppVersion() {
  return process.env.WORKER_APP_VERSION || process.env.npm_package_version || null;
}

function getHeartbeatIntervalSeconds() {
  const configured = Number(
    process.env.WORKER_HEARTBEAT_SECONDS || DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_HEARTBEAT_INTERVAL_SECONDS;
  }

  return Math.max(5, Math.trunc(configured));
}

async function registerWorkerNode(metadata = {}) {
  const nodeName = getWorkerNodeName();
  const result = await query(
    `
      INSERT INTO worker.worker_nodes (
        node_name,
        process_id,
        hostname,
        app_version,
        status,
        started_at,
        last_heartbeat_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'ONLINE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $5::jsonb)
      ON CONFLICT (node_name) DO UPDATE
      SET process_id = EXCLUDED.process_id,
          hostname = EXCLUDED.hostname,
          app_version = EXCLUDED.app_version,
          status = 'ONLINE',
          started_at = CURRENT_TIMESTAMP,
          last_heartbeat_at = CURRENT_TIMESTAMP,
          metadata = EXCLUDED.metadata,
          updated_at = CURRENT_TIMESTAMP
      RETURNING
        worker_node_id,
        node_name,
        process_id,
        hostname,
        app_version,
        status,
        started_at,
        last_heartbeat_at,
        metadata
    `,
    [
      nodeName,
      process.pid,
      os.hostname(),
      getWorkerAppVersion(),
      JSON.stringify({
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        ...metadata,
      }),
    ],
  );

  return sanitizeWorkerNode(result.rows[0]);
}

async function heartbeatWorkerNode(workerNodeId, metadata = {}) {
  const result = await query(
    `
      UPDATE worker.worker_nodes
      SET status = 'ONLINE',
          last_heartbeat_at = CURRENT_TIMESTAMP,
          metadata = metadata || $2::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE worker_node_id = $1
      RETURNING
        worker_node_id,
        node_name,
        process_id,
        hostname,
        app_version,
        status,
        started_at,
        last_heartbeat_at,
        metadata
    `,
    [workerNodeId, JSON.stringify(metadata || {})],
  );

  return result.rows[0] ? sanitizeWorkerNode(result.rows[0]) : null;
}

async function markWorkerNodeStopping(workerNodeId) {
  await updateWorkerNodeStatus(workerNodeId, 'STOPPING');
}

async function markWorkerNodeOffline(workerNodeId, metadata = {}) {
  await updateWorkerNodeStatus(workerNodeId, 'OFFLINE', metadata);
}

async function markWorkerNodeError(workerNodeId, error, metadata = {}) {
  await updateWorkerNodeStatus(workerNodeId, 'ERROR', {
    ...metadata,
    errorMessage: error?.message || String(error),
    errorAt: new Date().toISOString(),
  });
}

async function updateWorkerNodeStatus(workerNodeId, status, metadata = {}) {
  await query(
    `
      UPDATE worker.worker_nodes
      SET status = $2,
          last_heartbeat_at = CURRENT_TIMESTAMP,
          metadata = metadata || $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE worker_node_id = $1
    `,
    [workerNodeId, status, JSON.stringify(metadata || {})],
  );
}

function sanitizeWorkerNode(row) {
  if (!row) {
    return null;
  }

  return {
    workerNodeId: row.worker_node_id,
    nodeName: row.node_name,
    processId: row.process_id,
    hostname: row.hostname,
    appVersion: row.app_version,
    status: row.status,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    metadata: row.metadata || {},
  };
}

function startHeartbeat(workerNode, options = {}) {
  const intervalSeconds = Number(options.intervalSeconds || getHeartbeatIntervalSeconds());
  const intervalMs = Math.max(5, intervalSeconds) * 1000;

  const timer = setInterval(() => {
    heartbeatWorkerNode(workerNode.workerNodeId, {
      heartbeatSource: 'timer',
      heartbeatAt: new Date().toISOString(),
    }).catch((error) => {
      console.error('[SkyServer Worker] Heartbeat failed:', error.message);
    });
  }, intervalMs);

  timer.unref?.();

  return timer;
}

module.exports = {
  getHeartbeatIntervalSeconds,
  getWorkerNodeName,
  registerWorkerNode,
  heartbeatWorkerNode,
  markWorkerNodeStopping,
  markWorkerNodeOffline,
  markWorkerNodeError,
  startHeartbeat,
};
