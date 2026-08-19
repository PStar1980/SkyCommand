#!/usr/bin/env node

require('dotenv').config({
  path: require('node:path').join(__dirname, '../../../.env'),
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeConnection, Worker } = require('@temporalio/worker');

const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('./config');

const HOST_AGENT_PROFILE_CODE = (
  process.env.SKYCOMMAND_HOST_AGENT_PROFILE ||
  process.env.SKYCOMMAND_CONFIG_PROFILE ||
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL'
)
  .trim()
  .toUpperCase();

// local_repo_sync resolves its repository profile when the module is loaded. Pin the
// host-agent activity implementation to the explicitly selected host profile before
// loading any activity handlers.
process.env.SKYCOMMAND_LOCAL_SYNC_PROFILE = HOST_AGENT_PROFILE_CODE;

const { pool, query } = require('../../db/src/connection');
const { getTemporalConfig } = require('../../temporal/src/config');
const activities = require('./activities');

const HEARTBEAT_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.SKYCOMMAND_HOST_AGENT_HEARTBEAT_INTERVAL_MS || 15000),
);

function getProfileCode() {
  return HOST_AGENT_PROFILE_CODE;
}

function getTaskQueue() {
  return normalizeHostAgentTaskQueue(
    process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
  );
}

function buildIdentity({ namespace, taskQueue }) {
  return [
    'skycommand-host-agent',
    os.hostname(),
    process.pid,
    namespace,
    taskQueue,
  ]
    .filter(Boolean)
    .join(':');
}

async function verifyHostRepositoryProfile(profileCode) {
  if (String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase() === 'docker') {
    throw new Error('SkyCommand Host Agent refuses Docker execution. Start it from the repository host.');
  }

  if (profileCode === 'DOCKER_LOCAL') {
    throw new Error(
      'SkyCommand Host Agent requires a host-owned repository profile such as DEV_LOCAL; DOCKER_LOCAL is not allowed.',
    );
  }

  const result = await query(
    `
      SELECT r.repo_code, rp.root_path
      FROM core.repository_paths rp
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
      ORDER BY r.display_order, r.repo_code
    `,
    [profileCode],
  );

  const repositoryPaths = (result.rows || [])
    .map((row) => ({
      repoCode: String(row.repo_code || '').trim(),
      rootPath: String(row.root_path || '').trim(),
    }))
    .filter((row) => row.repoCode && row.rootPath);
  const usableRepositories = repositoryPaths.filter((repository) => {
    const gitPath = path.join(repository.rootPath, '.git');
    return fs.existsSync(repository.rootPath) && fs.existsSync(gitPath);
  });

  if (usableRepositories.length === 0) {
    throw new Error(
      `SkyCommand Host Agent found no host-owned Git repositories for profile ${profileCode}. Check core.repository_paths and the host filesystem.`,
    );
  }

  return usableRepositories;
}

async function recordHeartbeat({ identity, namespace, taskQueue, status, profileCode, error }) {
  try {
    await query(
      `
        INSERT INTO worker.temporal_worker_heartbeats (
          worker_identity,
          namespace,
          task_queue,
          status,
          process_id,
          hostname,
          app_version,
          temporal_address,
          metadata,
          started_at,
          last_seen_at,
          stopped_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CASE WHEN $4 IN ('STOPPED', 'ERROR') THEN CURRENT_TIMESTAMP ELSE NULL END
        )
        ON CONFLICT (worker_identity)
        DO UPDATE SET
          namespace = EXCLUDED.namespace,
          task_queue = EXCLUDED.task_queue,
          status = EXCLUDED.status,
          process_id = EXCLUDED.process_id,
          hostname = EXCLUDED.hostname,
          app_version = EXCLUDED.app_version,
          temporal_address = EXCLUDED.temporal_address,
          metadata = worker.temporal_worker_heartbeats.metadata || EXCLUDED.metadata,
          last_seen_at = CURRENT_TIMESTAMP,
          stopped_at = CASE
            WHEN EXCLUDED.status IN ('STOPPED', 'ERROR') THEN CURRENT_TIMESTAMP
            ELSE NULL
          END
      `,
      [
        identity,
        namespace,
        taskQueue,
        status,
        process.pid,
        os.hostname(),
        process.env.npm_package_version || 'dev',
        process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        JSON.stringify({
          role: 'HOST_AGENT',
          executionTarget: 'HOST',
          profileCode,
          platform: process.platform,
          nodeVersion: process.version,
          ...(error ? { error: error.message || String(error) } : {}),
        }),
      ],
    );
  } catch (heartbeatError) {
    console.warn(
      '[SkyCommand Host Agent] Failed to record heartbeat:',
      heartbeatError.message || heartbeatError,
    );
  }
}

function startHeartbeatLoop(context) {
  let stopped = false;
  const tick = () => {
    if (!stopped) {
      recordHeartbeat({ ...context, status: 'ONLINE' });
    }
  };
  const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  interval.unref?.();
  tick();

  return async (status = 'STOPPED', error = null) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    await recordHeartbeat({ ...context, status, error });
  };
}

async function main() {
  const temporal = getTemporalConfig();
  const profileCode = getProfileCode();
  const taskQueue = getTaskQueue();
  const identity = buildIdentity({ namespace: temporal.namespace, taskQueue });
  const repositories = await verifyHostRepositoryProfile(profileCode);

  console.log('[SkyCommand Host Agent] Starting host activity worker');
  console.log(`[SkyCommand Host Agent] address=${temporal.address}`);
  console.log(`[SkyCommand Host Agent] namespace=${temporal.namespace}`);
  console.log(`[SkyCommand Host Agent] taskQueue=${taskQueue}`);
  console.log(`[SkyCommand Host Agent] profile=${profileCode}`);
  console.log(`[SkyCommand Host Agent] repositories=${repositories.length}`);
  console.log(`[SkyCommand Host Agent] identity=${identity}`);

  await recordHeartbeat({
    identity,
    namespace: temporal.namespace,
    taskQueue,
    status: 'STARTING',
    profileCode,
  });

  const connection = await NativeConnection.connect({ address: temporal.address });
  const worker = await Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue,
    activities,
    identity,
  });
  const stopHeartbeat = startHeartbeatLoop({
    identity,
    namespace: temporal.namespace,
    taskQueue,
    profileCode,
  });

  const shutdown = async () => {
    await stopHeartbeat('STOPPING');
    worker.shutdown();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await worker.run();
    await stopHeartbeat('STOPPED');
  } catch (error) {
    await stopHeartbeat('ERROR', error);
    throw error;
  } finally {
    await connection.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[SkyCommand Host Agent] Failed to start');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
