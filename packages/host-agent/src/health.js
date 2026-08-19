#!/usr/bin/env node

require('dotenv').config({
  path: require('node:path').join(__dirname, '../../../.env'),
});

const { randomUUID } = require('node:crypto');
const { Connection, Client } = require('@temporalio/client');

const { getTemporalConfig } = require('../../temporal/src/config');
const { DEFAULT_HOST_AGENT_TASK_QUEUE } = require('./config');

async function main() {
  const temporal = getTemporalConfig();
  const hostTaskQueue =
    String(process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE).trim() ||
    DEFAULT_HOST_AGENT_TASK_QUEUE;
  const workflowId = `skycommand-host-agent-health-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const connection = await Connection.connect({ address: temporal.address });

  try {
    const client = new Client({ connection, namespace: temporal.namespace });
    const result = await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporal.taskQueue,
      workflowId,
      args: [
        {
          toolCode: '__health',
          hostTaskQueue,
        },
      ],
    });

    if (!result?.ok || result?.result?.status !== 'ONLINE') {
      throw new Error(result?.error?.message || 'SkyCommand Host Agent health check failed.');
    }

    console.log('[SkyCommand Host Agent] Health check passed.');
    console.log(JSON.stringify(result.result, null, 2));
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('[SkyCommand Host Agent] Health check failed.');
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
