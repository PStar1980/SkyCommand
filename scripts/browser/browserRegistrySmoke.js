#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

const browserTestRegistryService = require('../../apps/api/src/services/browserTestRegistryService');

const TEST_CODE = process.env.SKYCOMMAND_BROWSER_REGISTRY_SMOKE_TEST_CODE || 'workflow-initialization-e2e';
const WORKFLOW_CODE = process.env.SKYCOMMAND_BROWSER_TEST_WORKFLOW_CODE || 'repo-map-zip';
const TIMEOUT_MS = 120000;
const POLL_MS = 500;

const permissions = [
  { permissionCode: 'BROWSER_TEST_READ' },
  { permissionCode: 'BROWSER_TEST_RUN' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('[Browser Registry Smoke] Loading registered Browser Test');
  const test = await browserTestRegistryService.getBrowserTestByCode(TEST_CODE, {
    includeDisabled: false,
  });
  if (!test) throw new Error(`Registered Browser Test '${TEST_CODE}' was not found.`);
  console.log(`[Browser Registry Smoke] test=${test.testCode} · environment=${test.defaultEnvironmentCode}`);

  const started = await browserTestRegistryService.startRegisteredBrowserTest({
    testCode: TEST_CODE,
    body: {
      environmentCode: test.defaultEnvironmentCode,
      parameters: {
        workflowCode: WORKFLOW_CODE,
      },
    },
    permissions,
  });

  const workflowId = started.execution.workflowId;
  console.log(`[Browser Registry Smoke] workflowId=${workflowId}`);
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const run = await browserTestRegistryService.getBrowserTestRun(workflowId);
    if (run.status === 'COMPLETED') {
      const status = run.result?.status || 'UNKNOWN';
      console.log(
        `[Browser Registry Smoke] ${status} · ${run.result?.testCode || TEST_CODE} · ${run.result?.durationMs || 0} ms`,
      );
      if (status !== 'PASSED') process.exitCode = 1;
      return;
    }
    if (['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'].includes(run.status)) {
      throw new Error(`Browser Test Temporal workflow ended with status ${run.status}.`);
    }
    await sleep(POLL_MS);
  }

  throw new Error(`Browser Test registry smoke did not complete within ${TIMEOUT_MS} ms.`);
}

main().catch((error) => {
  console.error('[Browser Registry Smoke] FAILED');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
