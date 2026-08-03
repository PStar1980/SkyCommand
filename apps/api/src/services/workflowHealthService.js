const os = require('os');

const { query } = require('../../../../packages/db/src/connection');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const temporalService = require('./temporalService');

const RECENT_HEARTBEAT_SECONDS = 60;

function isMissingRelationError(error) {
  return error?.code === '42P01' || /does not exist/i.test(error?.message || '');
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOverallStatus({ temporalReachable, pollerCount, recentHeartbeatCount, activeRuns, staleRunningRuns, failedLast24h }) {
  if (!temporalReachable) {
    return 'OFFLINE';
  }

  if (pollerCount <= 0 || recentHeartbeatCount <= 0) {
    return 'DEGRADED';
  }

  if (staleRunningRuns > 0 || failedLast24h > 0) {
    return 'WARNING';
  }

  if (activeRuns > 0) {
    return 'BUSY';
  }

  return 'ONLINE';
}

function buildOperatorHints({ temporalReachable, pollerCount, recentHeartbeatCount, staleRunningRuns }) {
  const hints = [];

  if (!temporalReachable) {
    hints.push('Temporal is not reachable. Start it with: temporal server start-dev');
  }

  if (temporalReachable && pollerCount <= 0) {
    hints.push('No Temporal pollers were detected for the task queue. Start the worker with: npm run temporal:worker:dev');
  }

  if (temporalReachable && recentHeartbeatCount <= 0) {
    hints.push('No recent SkyCommand worker heartbeat was found. Restart npm run temporal:worker:dev after applying the heartbeat migration.');
  }

  if (staleRunningRuns > 0) {
    hints.push('One or more workflow runs look stale. Review Workflow History before starting more runs.');
  }

  return hints;
}

async function safeQuery(sql, params = [], fallbackRows = []) {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return fallbackRows;
    }

    throw error;
  }
}

async function getLatestHeartbeats({ namespace, taskQueue }) {
  const rows = await safeQuery(
    `
      SELECT *
      FROM worker.vw_temporal_worker_heartbeats
      WHERE namespace = $1
        AND task_queue = $2
      ORDER BY last_seen_at DESC
      LIMIT 12
    `,
    [namespace, taskQueue],
  );

  return rows.map((row) => camelizeRow(row));
}

async function getRunSummary() {
  const rows = await safeQuery(
    `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING'))::int AS active_runs,
        COUNT(*) FILTER (WHERE status = 'RUNNING')::int AS running_runs,
        COUNT(*) FILTER (WHERE status = 'QUEUED')::int AS queued_runs,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND COALESCE(completed_at, updated_at, created_at) >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS completed_last_24h,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND COALESCE(completed_at, updated_at, created_at) >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS failed_last_24h,
        COUNT(*) FILTER (WHERE status = 'TERMINATED' AND COALESCE(completed_at, updated_at, created_at) >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS terminated_last_24h,
        COUNT(*) FILTER (WHERE status = 'CANCELED' AND COALESCE(completed_at, updated_at, created_at) >= CURRENT_TIMESTAMP - INTERVAL '24 hours')::int AS canceled_last_24h,
        COUNT(*) FILTER (WHERE status = 'RUNNING' AND COALESCE(updated_at, started_at, created_at) < CURRENT_TIMESTAMP - INTERVAL '30 minutes')::int AS stale_running_runs,
        ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'))::bigint AS average_duration_ms_24h,
        MAX(created_at) AS latest_run_at
      FROM worker.workflow_run_records
    `,
  );
  const row = camelizeRow(rows[0] || {});

  return {
    active: toInteger(row.activeRuns),
    running: toInteger(row.runningRuns),
    queued: toInteger(row.queuedRuns),
    completedLast24h: toInteger(row.completedLast24h),
    failedLast24h: toInteger(row.failedLast24h),
    terminatedLast24h: toInteger(row.terminatedLast24h),
    canceledLast24h: toInteger(row.canceledLast24h),
    staleRunning: toInteger(row.staleRunningRuns),
    averageDurationMs24h: row.averageDurationMs24h === null ? null : Number(row.averageDurationMs24h),
    latestRunAt: row.latestRunAt || null,
  };
}

async function getPendingApprovalSummary() {
  const rows = await safeQuery(
    `
      SELECT COUNT(*)::int AS pending
      FROM worker.workflow_approval_requests
      WHERE status = 'PENDING'
    `,
  );

  return {
    pending: toInteger(rows[0]?.pending),
  };
}

async function getDefinitionSummary() {
  const rows = await safeQuery(
    `
      SELECT
        COUNT(*)::int AS definitions,
        COUNT(*) FILTER (WHERE d.status = 'ACTIVE' AND d.enabled = TRUE)::int AS active_definitions,
        COUNT(*) FILTER (WHERE published.workflow_version_id IS NOT NULL)::int AS published_definitions
      FROM worker.workflow_definitions d
      LEFT JOIN LATERAL (
        SELECT workflow_version_id
        FROM worker.workflow_versions v
        WHERE v.workflow_definition_id = d.workflow_definition_id
          AND v.status = 'PUBLISHED'
        ORDER BY v.version_number DESC
        LIMIT 1
      ) published ON TRUE
      WHERE d.visible_in_admin = TRUE
    `,
  );
  const row = camelizeRow(rows[0] || {});

  return {
    total: toInteger(row.definitions),
    active: toInteger(row.activeDefinitions),
    published: toInteger(row.publishedDefinitions),
  };
}

async function getScheduledWorkflowSummary() {
  const rows = await safeQuery(
    `
      SELECT
        COUNT(*) FILTER (WHERE s.enabled = TRUE)::int AS active_schedules,
        COUNT(*) FILTER (WHERE s.enabled = TRUE AND s.next_run_at <= CURRENT_TIMESTAMP)::int AS due_schedules,
        MIN(s.next_run_at) FILTER (WHERE s.enabled = TRUE AND s.next_run_at IS NOT NULL) AS next_run_at
      FROM worker.schedules s
      JOIN core.tools t ON t.tool_id = s.tool_id
      WHERE s.enabled = TRUE
        AND t.tool_code = 'skyserver_workflow_start'
    `,
  );
  const row = camelizeRow(rows[0] || {});

  return {
    active: toInteger(row.activeSchedules),
    due: toInteger(row.dueSchedules),
    nextRunAt: row.nextRunAt || null,
  };
}

function buildCliCommands(config) {
  return {
    startTemporal: 'temporal server start-dev',
    startWorker: 'npm run temporal:worker:dev',
    describeTaskQueue: `temporal task-queue describe --address ${config.address} --namespace ${config.namespace} --task-queue ${config.taskQueue}`,
  };
}

async function getWorkflowWorkerHealth() {
  const config = getTemporalConfig();
  const [heartbeats, runs, approvals, definitions, schedules] = await Promise.all([
    getLatestHeartbeats({ namespace: config.namespace, taskQueue: config.taskQueue }),
    getRunSummary(),
    getPendingApprovalSummary(),
    getDefinitionSummary(),
    getScheduledWorkflowSummary(),
  ]);

  let temporal = {
    reachable: false,
    address: config.address,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    error: null,
  };
  let taskQueue = {
    name: config.taskQueue,
    pollerCount: 0,
    workflowPollerCount: 0,
    activityPollerCount: 0,
    pollers: [],
    healthy: false,
    issues: [],
  };

  try {
    const health = await temporalService.getHealth();
    temporal = {
      ...temporal,
      ...health,
      reachable: true,
    };
  } catch (error) {
    temporal = {
      ...temporal,
      reachable: false,
      error: error.message || String(error),
    };
  }

  if (temporal.reachable) {
    try {
      const diagnostics = await temporalService.getTaskQueueDiagnostics(config.taskQueue);
      taskQueue = {
        ...taskQueue,
        ...diagnostics,
        name: diagnostics.taskQueue || config.taskQueue,
        healthy: diagnostics.pollerCount > 0,
      };
    } catch (error) {
      taskQueue = {
        ...taskQueue,
        healthy: false,
        issues: [error.message || String(error)],
      };
    }
  }

  const recentHeartbeats = heartbeats.filter((heartbeat) => heartbeat.isRecent);
  const latestHeartbeat = heartbeats[0] || null;
  const overallStatus = getOverallStatus({
    temporalReachable: temporal.reachable,
    pollerCount: taskQueue.pollerCount || 0,
    recentHeartbeatCount: recentHeartbeats.length,
    activeRuns: runs.active,
    staleRunningRuns: runs.staleRunning,
    failedLast24h: runs.failedLast24h,
  });
  const hints = buildOperatorHints({
    temporalReachable: temporal.reachable,
    pollerCount: taskQueue.pollerCount || 0,
    recentHeartbeatCount: recentHeartbeats.length,
    staleRunningRuns: runs.staleRunning,
  });

  return {
    generatedAt: new Date().toISOString(),
    host: {
      apiHostname: os.hostname(),
      apiProcessId: process.pid,
      nodeVersion: process.version,
    },
    config,
    overallStatus,
    temporal,
    taskQueue,
    worker: {
      status: recentHeartbeats.length > 0 ? 'ONLINE' : heartbeats.length > 0 ? 'STALE' : 'UNKNOWN',
      heartbeatFreshnessSeconds: RECENT_HEARTBEAT_SECONDS,
      recentHeartbeatCount: recentHeartbeats.length,
      totalKnownWorkers: heartbeats.length,
      latestHeartbeat,
      heartbeats,
    },
    runs,
    approvals,
    definitions,
    schedules,
    hints,
    cliCommands: buildCliCommands(config),
  };
}

module.exports = {
  getWorkflowWorkerHealth,
};
