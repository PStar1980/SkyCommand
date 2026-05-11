require('../../../scripts/node/util/bootstrap');

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

async function startWorker() {
  const schedulerEnabled = parseBoolean(process.env.WORKER_SCHEDULER_ENABLED, true);
  const listenerEnabled = parseBoolean(process.env.WORKER_LISTENER_ENABLED, false);

  const workerNode = await workerNodeService.registerWorkerNode({
    schedulerEnabled,
    listenerEnabled,
    pollIntervalSeconds: getPollIntervalSeconds(),
    startedBy: 'apps/worker/src/index.js',
  });

  console.log(
    `[SkyServer Worker] Registered node ${workerNode.nodeName} (${workerNode.workerNodeId}).`,
  );
  console.log(
    `[SkyServer Worker] Scheduler enabled: ${schedulerEnabled} | Listener enabled: ${listenerEnabled}`,
  );

  const heartbeatTimer = workerNodeService.startHeartbeat(workerNode);
  const stopHandles = [];

  if (schedulerEnabled) {
    stopHandles.push(startSchedulePoller({ workerNode }));
    console.log(
      `[SkyServer Worker] Schedule poller started (${getPollIntervalSeconds()}s interval).`,
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
    console.log(`[SkyServer Worker] Received ${signal}; shutting down.`);

    try {
      await workerNodeService.markWorkerNodeStopping(workerNode.workerNodeId);
    } catch (error) {
      console.warn('[SkyServer Worker] Failed to mark worker as STOPPING:', error.message);
    }

    for (const handle of stopHandles) {
      try {
        handle.stop?.();
      } catch (error) {
        console.warn('[SkyServer Worker] Failed to stop worker component:', error.message);
      }
    }

    clearInterval(heartbeatTimer);

    try {
      await workerNodeService.markWorkerNodeOffline(workerNode.workerNodeId, {
        stoppedAt: new Date().toISOString(),
        signal,
      });
    } catch (error) {
      console.warn('[SkyServer Worker] Failed to mark worker as OFFLINE:', error.message);
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
    console.error('[SkyServer Worker] Uncaught exception:', error);

    try {
      await workerNodeService.markWorkerNodeError(workerNode.workerNodeId, error, {
        source: 'uncaughtException',
      });
    } finally {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('[SkyServer Worker] Unhandled rejection:', reason);

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
    console.error('[SkyServer Worker] Startup failed:', error);
    process.exit(1);
  });
}

module.exports = {
  startWorker,
};
