#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { Connection, Client } = require('@temporalio/client');

const { getBrowserRuntimeConfig } = require('../../packages/browser/src/config');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

async function main() {
  const config = getBrowserRuntimeConfig(repositoryRoot);
  const workflowId = `skycommand-browser-smoke-${Date.now()}`;

  console.log('[Browser Worker Smoke] Starting Temporal-backed Playwright smoke proof');
  console.log(`[Browser Worker Smoke] temporal=${config.temporalAddress}`);
  console.log(`[Browser Worker Smoke] taskQueue=${config.taskQueue}`);

  const connection = await Connection.connect({ address: config.temporalAddress });
  const client = new Client({ connection, namespace: config.temporalNamespace });

  try {
    const handle = await client.workflow.start('browserExecutionWorkflow', {
      taskQueue: config.taskQueue,
      workflowId,
      args: [
        {
          executionType: 'TEST',
          testPath: 'tests/browser/specs/workflows/workflowInitialization.spec.js',
          grep: '@smoke',
        },
      ],
    });

    console.log(`[Browser Worker Smoke] workflowId=${handle.workflowId}`);
    const result = await handle.result();
    console.log(
      `[Browser Worker Smoke] ${result.status} · ${result.testPath} · ${result.durationMs} ms`,
    );
    if (result.status !== 'PASSED') process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('[Browser Worker Smoke] FAILED');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
