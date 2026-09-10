const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00119__browser_automation_execution.sql');
const seed = read('packages/db_build/src/seeds/00120__browser_automation_execution_seed.sql');
const executionService = read('apps/api/src/services/browserAutomationExecutionService.js');
const controller = read('apps/api/src/controllers/browserAutomationController.js');
const routes = read('apps/api/src/routes/browserAutomation.routes.js');
const runner = read('packages/browser/src/browserAutomationRunner.js');
const browserActivities = read('packages/browser/src/temporal/activities.js');
const browserWorkflows = read('packages/browser/src/temporal/workflows.js');
const hostActivities = read('packages/host-agent/src/activities.js');
const hostWorkflow = read('packages/temporal/src/workflows/hostAgentWorkflow.js');
const source = read('browser-automation/scripts/skycommand/commandCenterStatus.js');

for (const table of ['worker.browser_automation_runs', 'worker.browser_automation_artifacts', 'worker.vw_browser_automation_runs']) {
  assert.ok(migration.includes(table), `Phase 7 migration should define ${table}.`);
}
assert.ok(migration.includes("execution_mode IN ('HEADLESS','INTERACTIVE')"));
assert.ok(migration.includes("status IN ('STARTED','RUNNING','SUCCESS','FAILED','CANCELED','TERMINATED','TIMED_OUT')"));
assert.ok(seed.includes("automation_code = 'command-center-status-snapshot'"));
assert.ok(seed.includes('SET enabled = TRUE'), 'Phase 7 should enable the safe reference automation after execution support lands.');

for (const symbol of [
  'startRegisteredAutomation',
  'resolveParameters',
  'assertConfirmation',
  'BROWSER_AUTOMATION_CONCURRENCY_LIMIT',
  'browserAutomationExecutionWorkflow',
  'INTERACTIVE',
  'getHostAgentAvailability',
  'replaceRunArtifacts',
  'getArtifact',
]) {
  assert.ok(executionService.includes(symbol), `Execution service should implement ${symbol}.`);
}
assert.ok(executionService.includes("status IN ('STARTED','RUNNING')"), 'Execution should enforce per-automation concurrency against active runs.');
assert.ok(executionService.includes("executionType: 'AUTOMATION'"));
assert.ok(executionService.includes("toolCode: '__browser_automation_interactive'"));
assert.ok(executionService.includes("triggerSource = 'MANUAL'"));

assert.ok(routes.includes("router.post('/:automationCode/run'"));
assert.ok(routes.includes("router.get('/runs'"));
assert.ok(routes.includes("router.get('/runs/:workflowId'"));
assert.ok(routes.includes("router.get('/runs/:workflowId/artifacts/:artifactId'"));
assert.ok(controller.includes('startAutomation'));
assert.ok(controller.includes('listRuns'));
assert.ok(controller.includes('getRun'));
assert.ok(controller.includes('getArtifact'));

for (const symbol of [
  'runBrowserAutomation',
  'resolveAutomationScript',
  'validateAutomationResult',
  'authenticateSkyCommand',
  'captureScreenshot',
  'saveDownload',
  'browser-automation/scripts/',
  'SKYCOMMAND_BROWSER_INTERACTIVE_TOPMOST',
]) {
  assert.ok(runner.includes(symbol), `Shared Playwright Automation runner should implement ${symbol}.`);
}
assert.ok(runner.includes("contract: normalizeText(input.outputType, 'browser_automation_summary.v1')"));
assert.ok(runner.includes("status: executionError ? 'FAILED' : 'SUCCESS'"));
assert.ok(runner.includes("fs.writeFileSync(path.join(runRoot, 'skycommand-automation-summary.json')"));

assert.ok(browserActivities.includes('executeBrowserAutomationActivity'));
assert.ok(browserWorkflows.includes('browserAutomationExecutionWorkflow'));
assert.ok(browserWorkflows.includes('maximumAttempts: retryCount + 1'));
assert.ok(hostActivities.includes('__browser_automation_interactive'));
assert.ok(hostWorkflow.includes('__browser_automation_interactive'));
assert.ok(source.includes('async function execute'));
assert.ok(source.includes("page.goto('/dashboard')"));
assert.ok(source.includes("helpers.captureScreenshot('Command Center Status Snapshot')"));
assert.ok(source.includes("contract: 'browser_automation_summary.v1'"));

console.log('[SkyCommand] Playwright Automation Phase 7 execution self-test passed.');
