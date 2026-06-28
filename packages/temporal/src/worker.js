require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const { NativeConnection, Worker } = require('@temporalio/worker');

const activities = require('./activities');
const { getTemporalConfig } = require('./config');

async function main() {
  const config = getTemporalConfig();

  console.log('[Temporal] Starting SkyServer worker');
  console.log(`[Temporal] address=${config.address}`);
  console.log(`[Temporal] namespace=${config.namespace}`);
  console.log(`[Temporal] taskQueue=${config.taskQueue}`);

  const connection = await NativeConnection.connect({
    address: config.address,
  });

  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  await worker.run();
}

main().catch((error) => {
  console.error('[Temporal] Worker failed to start');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
