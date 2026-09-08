const { sourceDirectoryForTest } = require('../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) throw new Error(`[SkyCommand Browser Worker self-test] ${message}`);
}

const root = path.resolve(sourceDir, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const compose = read('compose.yaml');
const dockerfile = read('docker/browser-worker.Dockerfile');
const workerPackage = JSON.parse(read('docker/browser-worker.package.json'));
const worker = read('apps/browser-worker/src/index.js');
const health = read('apps/browser-worker/src/health.js');
const runner = read('packages/browser/src/browserTestRunner.js');
const temporalWorkflow = read('packages/browser/src/temporal/workflows.js');
const smoke = read('scripts/browser/browserWorkerSmoke.js');
const playwrightConfig = read('tests/browser/playwright.config.js');
const dashboard = read('apps/admin-web/src/pages/Dashboard.jsx');
const supervisorConfig = read('packages/supervisor/src/config.js');
const packageJson = JSON.parse(read('package.json'));

assert(
  compose.includes('browser-worker:') &&
    compose.includes('dockerfile: docker/browser-worker.Dockerfile') &&
    compose.includes('SKYCOMMAND_BROWSER_TASK_QUEUE: ${SKYCOMMAND_BROWSER_TASK_QUEUE:-skycommand-browser-local}') &&
    compose.includes('SKYCOMMAND_BROWSER_BASE_URL: ${SKYCOMMAND_BROWSER_DOCKER_BASE_URL:-http://web:8080}') &&
    compose.includes('SKYCOMMAND_BROWSER_ARTIFACT_ROOT: /workspace/SkyEco System/SkyCommand System/SkyCommand/artifacts/browser/tests') &&
    compose.includes('init: true') &&
    compose.includes('ipc: host') &&
    compose.includes('apps/browser-worker/src/health.js'),
  'Compose must define an isolated Playwright Browser Worker with its own task queue, host artifact mount, init process, Chromium IPC policy, and health check.',
);
assert(
  dockerfile.includes('mcr.microsoft.com/playwright:v1.60.0-noble') &&
    dockerfile.includes('COPY docker/browser-worker.package.json ./package.json') &&
    dockerfile.includes('COPY tests/browser ./tests/browser') &&
    dockerfile.includes('apps/browser-worker/src/index.js'),
  'Browser Worker image must pin the Playwright image to the project version and include only the browser runtime/spec sources it executes.',
);
assert(
  workerPackage.dependencies?.['@playwright/test'] === '1.60.0' &&
    workerPackage.dependencies?.['@temporalio/worker'] === '1.18.1' &&
    workerPackage.dependencies?.['@temporalio/workflow'] === '1.18.1',
  'Browser Worker runtime dependencies must pin Playwright and Temporal versions.',
);
assert(
  worker.includes('maxConcurrentActivityTaskExecutions') &&
    worker.includes('maxConcurrentWorkflowTaskExecutions') &&
    worker.includes("writeHealth(config, 'ONLINE')") &&
    health.includes('healthFreshnessMs'),
  'Browser Worker must expose bounded concurrency and a freshness-based container health signal.',
);
assert(
  runner.includes("tests/browser/specs/") &&
    runner.includes("'--workers=1'") &&
    runner.includes('SKYCOMMAND_BROWSER_TEST_PATH_NOT_ALLOWED') &&
    runner.includes('executionTimeoutMs'),
  'Browser test execution must remain rooted beneath the approved spec directory with one Playwright worker and a hard execution timeout.',
);
assert(
  temporalWorkflow.includes('browserExecutionWorkflow') &&
    temporalWorkflow.includes('maximumAttempts: 1') &&
    smoke.includes("client.workflow.start('browserExecutionWorkflow'") &&
    smoke.includes("grep: '@smoke'"),
  'Phase 2 must prove Temporal-backed browser execution without automatic retries.',
);
assert(
  playwrightConfig.includes('SKYCOMMAND_BROWSER_ARTIFACT_ROOT') &&
    dashboard.includes("label: 'Browser worker'") &&
    supervisorConfig.includes("'browser-worker'"),
  'Browser artifacts must support a host-mounted path and Browser Worker health must surface through the Command Center/Supervisor runtime.',
);

const scripts = packageJson.scripts || {};
for (const name of [
  'browser:worker:docker:up',
  'browser:worker:docker:stop',
  'browser:worker:docker:restart',
  'browser:worker:docker:status',
  'browser:worker:docker:logs',
  'browser:worker:smoke',
]) {
  assert(scripts[name], `Missing Browser Worker npm command: ${name}`);
}

console.log('[SkyCommand] Browser Worker Docker foundation self-test passed.');
