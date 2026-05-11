const { pool } = require('../../../../packages/db/src/connection');
const { runClaimedSchedule } = require('../jobs/scheduledToolRunner');

const DEFAULT_POLL_INTERVAL_SECONDS = 15;
const DEFAULT_MAX_DUE_PER_TICK = 3;

function getPollIntervalSeconds() {
  const configured = Number(
    process.env.WORKER_SCHEDULE_POLL_SECONDS || DEFAULT_POLL_INTERVAL_SECONDS,
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }

  return Math.max(5, Math.trunc(configured));
}

function getMaxDuePerTick() {
  const configured = Number(
    process.env.WORKER_SCHEDULE_MAX_DUE_PER_TICK || DEFAULT_MAX_DUE_PER_TICK,
  );

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_DUE_PER_TICK;
  }

  return Math.max(1, Math.trunc(configured));
}

function sanitizeScheduleRow(row) {
  return {
    schedule_id: row.schedule_id,
    schedule_code: row.schedule_code,
    schedule_name: row.schedule_name,
    description: row.description,
    tool_id: row.tool_id,
    tool_code: row.tool_code,
    tool_label: row.tool_label,
    profile_id: row.profile_id,
    profile_code: row.profile_code,
    schedule_type: row.schedule_type,
    timezone: row.timezone,
    run_at: row.run_at,
    interval_value: row.interval_value,
    interval_unit: row.interval_unit,
    cron_expression: row.cron_expression,
    parameters: row.parameters || {},
    enabled: row.enabled,
    max_concurrent_runs: row.max_concurrent_runs,
    misfire_policy: row.misfire_policy,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_status: row.last_status,
  };
}

function sanitizeScheduleRunRow(row) {
  return {
    schedule_run_id: row.schedule_run_id,
    schedule_id: row.schedule_id,
    worker_node_id: row.worker_node_id,
    execution_id: row.execution_id,
    status: row.status,
    queued_at: row.queued_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    message: row.message,
    metadata: row.metadata || {},
  };
}

async function claimDueSchedules({ workerNode, limit = getMaxDuePerTick() } = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const dueResult = await client.query(
      `
        SELECT
          s.schedule_id,
          s.schedule_code,
          s.schedule_name,
          s.description,
          s.tool_id,
          t.tool_code,
          t.label AS tool_label,
          s.profile_id,
          cp.profile_code,
          s.schedule_type,
          s.timezone,
          s.run_at,
          s.interval_value,
          s.interval_unit,
          s.cron_expression,
          s.parameters,
          s.enabled,
          s.max_concurrent_runs,
          s.misfire_policy,
          s.next_run_at,
          s.last_run_at,
          s.last_status
        FROM worker.schedules s
        JOIN core.tools t
          ON t.tool_id = s.tool_id
        LEFT JOIN core.config_profiles cp
          ON cp.profile_id = s.profile_id
        WHERE s.enabled = TRUE
          AND s.next_run_at IS NOT NULL
          AND s.next_run_at <= CURRENT_TIMESTAMP
          AND s.schedule_type IN ('ONCE', 'INTERVAL')
          AND EXISTS (
            SELECT 1
            FROM core.tool_visibility tv
            WHERE tv.tool_id = s.tool_id
              AND tv.channel_code = 'worker'
          )
          AND (
            SELECT COUNT(*)::int
            FROM worker.schedule_runs sr
            WHERE sr.schedule_id = s.schedule_id
              AND sr.status IN ('QUEUED', 'STARTED')
          ) < s.max_concurrent_runs
        ORDER BY s.next_run_at ASC, s.schedule_code ASC
        FOR UPDATE OF s SKIP LOCKED
        LIMIT $1
      `,
      [limit],
    );

    const claims = [];

    for (const scheduleRow of dueResult.rows) {
      const runResult = await client.query(
        `
          INSERT INTO worker.schedule_runs (
            schedule_id,
            worker_node_id,
            status,
            queued_at,
            started_at,
            metadata
          )
          VALUES ($1, $2, 'QUEUED', CURRENT_TIMESTAMP, NULL, $3::jsonb)
          RETURNING
            schedule_run_id,
            schedule_id,
            worker_node_id,
            execution_id,
            status,
            queued_at,
            started_at,
            finished_at,
            message,
            metadata
        `,
        [
          scheduleRow.schedule_id,
          workerNode?.workerNodeId || null,
          JSON.stringify({
            claimedByWorkerNodeId: workerNode?.workerNodeId || null,
            claimedByWorkerNodeName: workerNode?.nodeName || null,
            claimedAt: new Date().toISOString(),
          }),
        ],
      );

      await client.query(
        `
          UPDATE worker.schedules
          SET last_status = 'QUEUED',
              updated_at = CURRENT_TIMESTAMP
          WHERE schedule_id = $1
        `,
        [scheduleRow.schedule_id],
      );

      claims.push({
        schedule: sanitizeScheduleRow(scheduleRow),
        scheduleRun: sanitizeScheduleRunRow(runResult.rows[0]),
      });
    }

    await client.query('COMMIT');
    return claims;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runSchedulePollOnce({ workerNode, maxDuePerTick = getMaxDuePerTick() } = {}) {
  const claims = await claimDueSchedules({
    workerNode,
    limit: maxDuePerTick,
  });

  if (claims.length === 0) {
    return {
      claimedCount: 0,
      results: [],
    };
  }

  console.log(`[SkyServer Worker] Claimed ${claims.length} due schedule(s).`);

  const results = [];

  for (const claim of claims) {
    // Intentionally sequential in v1. This keeps output readable and respects per-schedule concurrency.
    // Multi-run parallelism can be added later with a bounded worker pool.

    const result = await runClaimedSchedule(claim, workerNode);
    results.push(result);
  }

  return {
    claimedCount: claims.length,
    results,
  };
}

function startSchedulePoller({ workerNode, pollIntervalSeconds = getPollIntervalSeconds() } = {}) {
  let running = false;
  let stopped = false;

  async function tick() {
    if (stopped || running) {
      return;
    }

    running = true;

    try {
      await runSchedulePollOnce({ workerNode });
    } catch (error) {
      console.error('[SkyServer Worker] Schedule poll failed:', error);
    } finally {
      running = false;
    }
  }

  const intervalMs = Math.max(5, pollIntervalSeconds) * 1000;
  const timer = setInterval(tick, intervalMs);

  tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async runOnce() {
      return runSchedulePollOnce({ workerNode });
    },
  };
}

module.exports = {
  claimDueSchedules,
  runSchedulePollOnce,
  startSchedulePoller,
  getPollIntervalSeconds,
  getMaxDuePerTick,
};
