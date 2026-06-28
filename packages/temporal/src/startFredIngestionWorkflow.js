require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const { Connection, Client } = require('@temporalio/client');
const { randomUUID } = require('crypto');

const { getTemporalConfig, parsePositiveInteger } = require('./config');

async function main() {
  const config = getTemporalConfig();
  const workflowId = `${config.fredWorkflowIdPrefix}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const timeoutMs = parsePositiveInteger(
    process.env.TEMPORAL_FRED_ACTIVITY_TIMEOUT_MS,
    30 * 60 * 1000,
    24 * 60 * 60 * 1000,
  );

  console.log('[Temporal] Starting FRED ingestion workflow');
  console.log(`[Temporal] address=${config.address}`);
  console.log(`[Temporal] namespace=${config.namespace}`);
  console.log(`[Temporal] taskQueue=${config.taskQueue}`);
  console.log(`[Temporal] workflowId=${workflowId}`);

  const connection = await Connection.connect({
    address: config.address,
  });

  const client = new Client({
    connection,
    namespace: config.namespace,
  });

  const handle = await client.workflow.start('fredIngestionWorkflow', {
    taskQueue: config.taskQueue,
    workflowId,
    args: [
      {
        workflowId,
        runSource: 'manual_temporal_pilot',
        timeoutMs,
      },
    ],
  });

  console.log(`[Temporal] Started workflow: ${handle.workflowId}`);
  console.log('[Temporal] Waiting for result...');

  const result = await handle.result();

  console.log('[Temporal] Workflow complete');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[Temporal] Failed to start/run FRED ingestion workflow');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
