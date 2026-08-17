require('../../../scripts/node/util/bootstrap');

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { query } = require('../../../packages/db/src/connection');

const workerNodeService = require('./jobs/workerNodeService');
const { startSchedulePoller, getPollIntervalSeconds } = require('./schedulers/schedulePoller');
const { startListenerPoller } = require('./listeners/listenerPoller');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}


function isDockerRuntime() {
  return String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase() === 'docker';
}

async function assertDockerWorkerConfiguration() {
  if (!isDockerRuntime()) {
    return null;
  }

  const profileCode = String(process.env.SKYCOMMAND_CONFIG_PROFILE || '').trim();
  if (profileCode !== 'DOCKER_LOCAL') {
    throw new Error(
      `Docker Node worker requires SKYCOMMAND_CONFIG_PROFILE=DOCKER_LOCAL; received '${profileCode || 'blank'}'.`,
    );
  }

  const result = await query(
    `
      SELECT r.repo_code, rp.root_path
      FROM core.repository_paths rp
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = 'DOCKER_LOCAL'
        AND r.active = TRUE
        AND rp.active = TRUE
        AND cp.active = TRUE
      ORDER BY r.display_order ASC, r.repo_code ASC
    `,
  );

  const repositoryPaths = (result.rows || [])
    .map((row) => ({
      repoCode: String(row.repo_code || '').trim(),
      rootPath: String(row.root_path || '').trim(),
    }))
    .filter((row) => row.repoCode && row.rootPath);
  const skyCommandRepository = repositoryPaths.find((row) => row.repoCode === 'SkyCommand');
  const rootPath = skyCommandRepository?.rootPath || '';

  if (!rootPath) {
    throw new Error(
      'Docker Node worker requires the DOCKER_LOCAL repository profile. Apply migration 00098__docker_local_repository_profile.sql first.',
    );
  }
  if (!fs.existsSync(rootPath)) {
    throw new Error(
      `DOCKER_LOCAL SkyCommand path is not mounted inside the Node worker container: ${rootPath}. Check SKYCOMMAND_DOCKER_WORKSPACE_ROOT.`,
    );
  }

  const mountedRepositoryPaths = repositoryPaths.filter((repository) =>
    fs.existsSync(repository.rootPath),
  );
  const clearSafeDirectories = spawnSync(
    'git',
    ['config', '--global', '--unset-all', 'safe.directory'],
    { encoding: 'utf8' },
  );
  if (![0, 5].includes(clearSafeDirectories.status ?? 1)) {
    throw new Error(
      `Unable to reset Docker Git safe.directory configuration: ${String(clearSafeDirectories.stderr || clearSafeDirectories.error?.message || 'unknown error').trim()}`,
    );
  }

  for (const repository of mountedRepositoryPaths) {
    const safeDirectoryResult = spawnSync(
      'git',
      ['config', '--global', '--add', 'safe.directory', repository.rootPath],
      { encoding: 'utf8' },
    );
    if (safeDirectoryResult.status !== 0) {
      throw new Error(
        `Unable to register Docker Git safe.directory for ${repository.repoCode}: ${String(safeDirectoryResult.stderr || safeDirectoryResult.error?.message || 'unknown error').trim()}`,
      );
    }
  }

  const unsupportedScheduleResult = await query(
    `
      SELECT COUNT(*)::int AS unsupported_count
      FROM worker.schedules s
      JOIN core.tools t ON t.tool_id = s.tool_id
      WHERE s.enabled = TRUE
        AND s.deleted_at IS NULL
        AND t.runtime_code <> 'node'
        AND EXISTS (
          SELECT 1
          FROM core.tool_visibility tv
          WHERE tv.tool_id = s.tool_id
            AND tv.channel_code = 'worker'
        )
    `,
  );
  const unsupportedScheduledTools = Number(
    unsupportedScheduleResult.rows?.[0]?.unsupported_count || 0,
  );

  const dockerGitEnabled =
    String(process.env.SKYCOMMAND_DOCKER_GIT_ENABLED || '').trim().toLowerCase() === 'true';
  if (dockerGitEnabled) {
    const tokenFile = String(
      process.env.SKYCOMMAND_GITHUB_TOKEN_FILE || '/run/secrets/skycommand_github_token',
    ).trim();
    const githubUsername = String(process.env.SKYCOMMAND_GITHUB_USERNAME || '').trim();
    const authorName = String(process.env.GIT_AUTHOR_NAME || '').trim();
    const authorEmail = String(process.env.GIT_AUTHOR_EMAIL || '').trim();

    if (!githubUsername || !authorName || !authorEmail) {
      throw new Error(
        'Docker Git automation is enabled but GitHub username/commit identity is incomplete.',
      );
    }
    if (!fs.existsSync(tokenFile) || fs.readFileSync(tokenFile, 'utf8').trim() === '') {
      throw new Error(
        `Docker Git automation is enabled but the mounted GitHub token secret is missing or empty: ${tokenFile}.`,
      );
    }
  }

  console.log(`[SkyCommand Worker] dockerProfile=${profileCode}`);
  console.log(`[SkyCommand Worker] dockerSkyCommandRoot=${rootPath}`);
  console.log(`[SkyCommand Worker] dockerGitSafeDirectories=${mountedRepositoryPaths.length}`);
  console.log(`[SkyCommand Worker] dockerUnsupportedScheduledTools=${unsupportedScheduledTools}`);
  if (unsupportedScheduledTools > 0) {
    console.log(
      '[SkyCommand Worker] Docker Node worker only claims Node.js-backed schedules; PowerShell-backed schedules remain unclaimed for a compatible host worker.',
    );
  }
  console.log(
    `[SkyCommand Worker] dockerGit=${dockerGitEnabled ? 'enabled' : 'disabled'}`,
  );

  return {
    profileCode,
    rootPath,
    mountedRepositoryCount: mountedRepositoryPaths.length,
    unsupportedScheduledTools,
    dockerGitEnabled,
  };
}

async function startWorker() {
  const dockerConfiguration = await assertDockerWorkerConfiguration();
  const schedulerEnabled = parseBoolean(process.env.WORKER_SCHEDULER_ENABLED, true);
  const listenerEnabled = parseBoolean(process.env.WORKER_LISTENER_ENABLED, false);

  const workerNode = await workerNodeService.registerWorkerNode({
    schedulerEnabled,
    listenerEnabled,
    pollIntervalSeconds: getPollIntervalSeconds(),
    startedBy: 'apps/worker/src/index.js',
    runtimeEnvironment: process.env.SKYCOMMAND_RUNTIME_ENV || 'host',
    configProfile: process.env.SKYCOMMAND_CONFIG_PROFILE || null,
    dockerSkyCommandRoot: dockerConfiguration?.rootPath || null,
    dockerUnsupportedScheduledTools: dockerConfiguration?.unsupportedScheduledTools || 0,
  });

  console.log(
    `[SkyCommand Worker] Registered node ${workerNode.nodeName} (${workerNode.workerNodeId}).`,
  );
  console.log(
    `[SkyCommand Worker] Scheduler enabled: ${schedulerEnabled} | Listener enabled: ${listenerEnabled}`,
  );

  const heartbeatTimer = workerNodeService.startHeartbeat(workerNode);
  const stopHandles = [];

  if (schedulerEnabled) {
    stopHandles.push(startSchedulePoller({ workerNode }));
    console.log(
      `[SkyCommand Worker] Schedule poller started (${getPollIntervalSeconds()}s interval).`,
    );
  }

  if (listenerEnabled) {
    stopHandles.push(startListenerPoller({ workerNode }));
  }

  let stopping = false;

  async function shutdown(signal) {
    if (stopping) {
      return;
    }

    stopping = true;
    console.log(`[SkyCommand Worker] Received ${signal}; shutting down.`);

    try {
      await workerNodeService.markWorkerNodeStopping(workerNode.workerNodeId);
    } catch (error) {
      console.warn('[SkyCommand Worker] Failed to mark worker as STOPPING:', error.message);
    }

    for (const handle of stopHandles) {
      try {
        handle.stop?.();
      } catch (error) {
        console.warn('[SkyCommand Worker] Failed to stop worker component:', error.message);
      }
    }

    clearInterval(heartbeatTimer);

    try {
      await workerNodeService.markWorkerNodeOffline(workerNode.workerNodeId, {
        stoppedAt: new Date().toISOString(),
        signal,
      });
    } catch (error) {
      console.warn('[SkyCommand Worker] Failed to mark worker as OFFLINE:', error.message);
    }

    process.exit(0);
  }

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  process.on('uncaughtException', async (error) => {
    console.error('[SkyCommand Worker] Uncaught exception:', error);

    try {
      await workerNodeService.markWorkerNodeError(workerNode.workerNodeId, error, {
        source: 'uncaughtException',
      });
    } finally {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[SkyCommand Worker] Unhandled rejection:', reason);

    try {
      await workerNodeService.markWorkerNodeError(workerNode.workerNodeId, reason, {
        source: 'unhandledRejection',
      });
    } finally {
      process.exit(1);
    }
  });

  return {
    workerNode,
    stopHandles,
  };
}

if (require.main === module) {
  startWorker().catch((error) => {
    console.error('[SkyCommand Worker] Startup failed:', error);
    process.exit(1);
  });
}

module.exports = {
  assertDockerWorkerConfiguration,
  startWorker,
};
