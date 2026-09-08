#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeConnection, Worker } = require('@temporalio/worker');
const dotenv = require('dotenv');

const { getBrowserRuntimeConfig } = require('../../../packages/browser/src/config');
const activities = require('../../../packages/browser/src/temporal/activities');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function writeHealth(config, status, details = {}) {
  const payload = {
    service: 'skycommand-browser-worker',
    status,
    taskQueue: config.taskQueue,
    namespace: config.temporalNamespace,
    pid: process.pid,
    hostname: os.hostname(),
    lastSeenAt: new Date().toISOString(),
    ...details,
  };

  try {
    fs.mkdirSync(path.dirname(config.healthFile), { recursive: true });
    fs.writeFileSync(config.healthFile, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    console.warn('[Browser Worker] Failed to write health heartbeat:', error.message || error);
  }
}

async function main() {
  const config = getBrowserRuntimeConfig(repositoryRoot);

  console.log('[Browser Worker] Starting SkyCommand dedicated browser worker');
  console.log(`[Browser Worker] temporal=${config.temporalAddress}`);
  console.log(`[Browser Worker] namespace=${config.temporalNamespace}`);
  console.log(`[Browser Worker] taskQueue=${config.taskQueue}`);
  console.log(`[Browser Worker] baseURL=${config.baseUrl}`);
  console.log(`[Browser Worker] maxConcurrentActivities=${config.maxConcurrentActivities}`);
  console.log(`[Browser Worker] executionTimeoutMs=${config.executionTimeoutMs}`);

  writeHealth(config, 'STARTING');

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('../../../packages/browser/src/temporal/workflows'),
    activities,
    identity: `skycommand-browser-worker@${os.hostname()}:${process.pid}`,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
    maxConcurrentWorkflowTaskExecutions: config.maxConcurrentWorkflowTasks,
  });

  writeHealth(config, 'ONLINE');
  const heartbeatTimer = setInterval(
    () => writeHealth(config, 'ONLINE'),
    config.heartbeatIntervalMs,
  );
  heartbeatTimer.unref?.();

  async function shutdown(signal) {
    writeHealth(config, 'STOPPING', { signal });
    clearInterval(heartbeatTimer);
    try {
      await worker.shutdown();
    } catch (error) {
      console.warn('[Browser Worker] Worker shutdown warning:', error.message || error);
    }
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await worker.run();
    writeHealth(config, 'STOPPED');
  } catch (error) {
    writeHealth(config, 'ERROR', { error: error.message || String(error) });
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    await connection.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[Browser Worker] Failed to start');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
