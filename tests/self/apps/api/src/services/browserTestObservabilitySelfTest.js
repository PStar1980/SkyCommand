const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00115__browser_test_observability.sql');
const executionModeMigration = read('packages/db_build/src/migrations/00116__browser_test_execution_mode.sql');
const service = read('apps/api/src/services/browserTestRegistryService.js');
const failureUtils = read('apps/api/src/services/browserTestFailureUtils.js');
const controller = read('apps/api/src/controllers/browserTestController.js');
const routes = read('apps/api/src/routes/browserTest.routes.js');
const runner = read('packages/browser/src/browserTestRunner.js');
const config = read('packages/browser/src/config.js');
const compose = read('compose.yaml');
const page = read('apps/admin-web/src/pages/BrowserTests.jsx');
const browserTestService = read('apps/admin-web/src/services/browserTestService.js');
const apiClient = read('apps/admin-web/src/services/api.js');
const hostActivities = read('packages/host-agent/src/activities.js');
const hostWorkflow = read('packages/temporal/src/workflows/hostAgentWorkflow.js');
const workflowSpec = read('tests/browser/specs/workflows/workflowInitialization.spec.js');
const playwrightConfig = read('tests/browser/playwright.config.js');
const reporter = read('tests/browser/reporters/skyCommandReporter.js');

for (const objectName of [
  'worker.browser_test_runs',
  'worker.browser_test_artifacts',
  'worker.vw_browser_test_runs',
]) {
  assert.ok(migration.includes(objectName), `Observability migration should define ${objectName}.`);
}

for (const column of [
  'source_commit_sha',
  'artifact_root',
  'result_summary',
  'failure_summary',
  'linked_workflow_ids',
]) {
  assert.ok(migration.includes(column), `Browser Test run ledger should persist ${column}.`);
}

assert.ok(executionModeMigration.includes('execution_mode'));
assert.ok(executionModeMigration.includes("'HEADLESS','INTERACTIVE'"));
assert.ok(executionModeMigration.includes('worker.vw_browser_test_runs'));
assert.ok(executionModeMigration.includes('.playwright-artifacts-'));
assert.ok(executionModeMigration.includes('traces/resources'));

assert.ok(service.includes('persistObservedRun'));
assert.ok(service.includes('backfillLegacyTemporalRuns'));
assert.ok(service.includes('getBrowserTestArtifact'));
assert.ok(service.includes('worker.vw_browser_test_runs'));
assert.ok(service.includes('worker.browser_test_artifacts'));
assert.ok(service.includes('resolveGitHeadSha'));
assert.ok(controller.includes('getArtifact'));
assert.ok(routes.includes("'/runs/:workflowId/artifacts/:artifactId'"));

assert.ok(runner.includes("contract: 'browser_test_summary.v1'"));
assert.ok(runner.includes('SKYCOMMAND_BROWSER_SUMMARY_PATH'));
assert.ok(runner.includes('SKYCOMMAND_BROWSER_ARTIFACT_ROOT'));
assert.ok(runner.includes('collectBrowserArtifacts'));
assert.ok(runner.includes('shouldExposeBrowserArtifact'));
assert.ok(runner.includes("'--headed'"));
assert.ok(runner.includes('executionMode'));
assert.ok(runner.includes('resolveGitHeadSha'));
assert.ok(config.includes('sourceRepositoryRoot'));
assert.ok(config.includes('artifactRoot'));
assert.ok(compose.includes('SKYCOMMAND_BROWSER_SOURCE_REPOSITORY_ROOT'));
const apiComposeBlock = compose.split('\n  api:')[1]?.split('\n  web:')[0] || '';
assert.ok(apiComposeBlock.includes('SKYCOMMAND_BROWSER_SOURCE_REPOSITORY_ROOT'));
assert.ok(apiComposeBlock.includes('SKYCOMMAND_BROWSER_ARTIFACT_ROOT'));


assert.ok(playwrightConfig.includes('reporters/skyCommandReporter.js'));
assert.ok(reporter.includes("contract: 'browser_test_summary.v1'"));
assert.ok(reporter.includes('linkedWorkflowIds'));
assert.ok(reporter.includes('result.attachments'));

assert.ok(browserTestService.includes('getArtifact'));
assert.ok(apiClient.includes('requestBlob'));
assert.ok(apiClient.includes('Authorization'));
assert.ok(page.includes("browserTestService.getArtifact"));
assert.ok(page.includes('Interactive (Headed · Host)'));
assert.ok(page.includes('Background (Headless)'));
assert.ok(page.includes('Execution mode'));
assert.ok(hostActivities.includes('__browser_test_interactive'));
assert.ok(hostActivities.includes('runBrowserTest'));
assert.ok(hostWorkflow.includes('isInteractiveBrowserTest'));
assert.ok(runner.includes('resolvePlaywrightCli'));
assert.ok(runner.includes('runChildProcess(process.execPath, [playwrightCli, ...args]'));
assert.equal(runner.includes('node_modules/.bin/playwright'), false);
assert.ok(service.includes('serializeTemporalFailure'));
assert.ok(failureUtils.includes('causeChain'));

assert.ok(workflowSpec.includes('Workflow Initialization Open'));
assert.ok(workflowSpec.includes('page.screenshot'));

for (const uiText of [
  'Structured Test Result',
  'Failure Evidence',
  'Browser Evidence',
  'Source revision',
  'Input Snapshot',
  'Download Trace',
]) {
  assert.ok(page.includes(uiText), `Playwright Test Operations should surface ${uiText}.`);
}

const { resolveGitHeadSha, normalizeExecutionId } = require(path.join(repositoryRoot, 'packages/browser/src/browserTestRunner.js'));
const { serializeTemporalFailure } = require(path.join(repositoryRoot, 'apps/api/src/services/browserTestFailureUtils.js'));
const rootCause = Object.assign(new Error('spawn Playwright ENOENT'), { code: 'ENOENT' });
rootCause.name = 'ApplicationFailure';
const activityFailure = new Error('Activity task failed');
activityFailure.name = 'ActivityFailure';
activityFailure.cause = rootCause;
const workflowFailure = new Error('Workflow execution failed');
workflowFailure.name = 'WorkflowFailedError';
workflowFailure.cause = activityFailure;
const failureSummary = serializeTemporalFailure(workflowFailure);
assert.equal(failureSummary.message, 'spawn Playwright ENOENT');
assert.equal(failureSummary.errorCode, 'ENOENT');
assert.equal(failureSummary.temporalMessage, 'Workflow execution failed');
assert.equal(failureSummary.causeChain.length, 3);
assert.equal(failureSummary.causeChain[2].name, 'ApplicationFailure');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-browser-lineage-'));
try {
  const gitDir = path.join(tempRoot, '.git');
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'refs', 'heads', 'main'), '0123456789abcdef0123456789abcdef01234567\n');
  assert.equal(resolveGitHeadSha(tempRoot), '0123456789abcdef0123456789abcdef01234567');
  assert.equal(normalizeExecutionId('phase5-run_123'), 'phase5-run_123');
  assert.throws(() => normalizeExecutionId('../escape'));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[SkyCommand] Browser Test observability self-test passed.');
