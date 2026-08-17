require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const fs = require('fs');
const os = require('os');
const { NativeConnection, Worker } = require('@temporalio/worker');

const { query } = require('../../db/src/connection');
const activities = require('./activities');
const { getTemporalConfig } = require('./config');

const HEARTBEAT_INTERVAL_MS = Number.parseInt(
  process.env.TEMPORAL_WORKER_HEARTBEAT_INTERVAL_MS || '15000',
  10,
);

function buildWorkerIdentity(config) {
  return [
    'skycommand-temporal-worker',
    os.hostname(),
    process.pid,
    config.namespace,
    config.taskQueue,
  ]
    .filter(Boolean)
    .join(':');
}

async function recordWorkerHeartbeat({ config, workerIdentity, status = 'ONLINE', error = null }) {
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
        workerIdentity,
        config.namespace,
        config.taskQueue,
        status,
        process.pid,
        os.hostname(),
        process.env.npm_package_version || 'dev',
        config.address,
        JSON.stringify({
          nodeVersion: process.version,
          pid: process.pid,
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host',
          configProfile: process.env.SKYCOMMAND_CONFIG_PROFILE || null,
          runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host',
          configProfile: process.env.SKYCOMMAND_CONFIG_PROFILE || null,
          ...(error ? { error: error.message || String(error) } : {}),
        }),
      ],
    );
  } catch (heartbeatError) {
    if (heartbeatError?.code === '42P01') {
      console.warn('[Temporal] Worker heartbeat table not found. Run migration 00054__temporal_worker_heartbeats.sql.');
      return;
    }

    console.warn('[Temporal] Failed to record worker heartbeat:', heartbeatError.message || heartbeatError);
  }
}

async function assertDockerWorkerConfiguration() {
  const runtime = String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase();
  if (runtime !== 'docker') {
    return null;
  }

  const profileCode = String(process.env.SKYCOMMAND_CONFIG_PROFILE || '').trim();
  if (profileCode !== 'DOCKER_LOCAL') {
    throw new Error(
      `Docker Temporal worker requires SKYCOMMAND_CONFIG_PROFILE=DOCKER_LOCAL; received '${profileCode || 'blank'}'.`,
    );
  }

  const result = await query(
    `
      SELECT rp.root_path
      FROM core.repository_paths rp
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE r.repo_code = 'SkyCommand'
        AND cp.profile_code = 'DOCKER_LOCAL'
        AND r.active = TRUE
        AND rp.active = TRUE
        AND cp.active = TRUE
      LIMIT 1
    `,
  );

  const rootPath = String(result.rows?.[0]?.root_path || '').trim();
  if (!rootPath) {
    throw new Error(
      'Docker Temporal worker requires the DOCKER_LOCAL repository profile. Apply migration 00098__docker_local_repository_profile.sql first.',
    );
  }
  if (!fs.existsSync(rootPath)) {
    throw new Error(
      `DOCKER_LOCAL SkyCommand path is not mounted inside the worker container: ${rootPath}. Check SKYCOMMAND_DOCKER_WORKSPACE_ROOT.`,
    );
  }

  console.log(`[Temporal] dockerProfile=${profileCode}`);
  console.log(`[Temporal] dockerSkyCommandRoot=${rootPath}`);
  if (String(process.env.SKYCOMMAND_DOCKER_GIT_ENABLED || '').trim().toLowerCase() !== 'true') {
    console.log('[Temporal] Docker Git-changing tools are disabled until container Git credentials are configured.');
  }

  return { profileCode, rootPath };
}

function startHeartbeatLoop(config, workerIdentity) {
  let stopped = false;
  const heartbeat = () => {
    if (!stopped) {
      recordWorkerHeartbeat({ config, workerIdentity, status: 'ONLINE' });
    }
  };
  const interval = setInterval(heartbeat, Number.isFinite(HEARTBEAT_INTERVAL_MS) && HEARTBEAT_INTERVAL_MS > 0 ? HEARTBEAT_INTERVAL_MS : 15000);

  interval.unref?.();
  heartbeat();

  const stop = async (status = 'STOPPED', error = null) => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(interval);
    await recordWorkerHeartbeat({ config, workerIdentity, status, error });
  };

  process.once('SIGINT', () => {
    stop('STOPPING').finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    stop('STOPPING').finally(() => process.exit(0));
  });

  return stop;
}

async function main() {
  const config = getTemporalConfig();
  const workerIdentity = buildWorkerIdentity(config);

  console.log('[Temporal] Starting SkyCommand worker');
  console.log(`[Temporal] address=${config.address}`);
  console.log(`[Temporal] namespace=${config.namespace}`);
  console.log(`[Temporal] taskQueue=${config.taskQueue}`);
  console.log(`[Temporal] workerIdentity=${workerIdentity}`);

  await assertDockerWorkerConfiguration();
  await recordWorkerHeartbeat({ config, workerIdentity, status: 'STARTING' });

  const connection = await NativeConnection.connect({
    address: config.address,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
    identity: workerIdentity,
  });
  const stopHeartbeat = startHeartbeatLoop(config, workerIdentity);

  try {
    await worker.run();
    await stopHeartbeat('STOPPED');
  } catch (error) {
    await stopHeartbeat('ERROR', error);
    throw error;
  }
}

main().catch((error) => {
  console.error('[Temporal] Worker failed to start');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
