const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00113__browser_test_registry_foundation.sql');
const seed = read('packages/db_build/src/seeds/00114__browser_test_registry_seed.sql');
const service = read('apps/api/src/services/browserTestRegistryService.js');
const routes = read('apps/api/src/routes/browserTest.routes.js');
const adminRoutes = read('apps/api/src/routes/admin.routes.js');
const server = read('apps/api/src/server.js');
const runner = read('packages/browser/src/browserTestRunner.js');

for (const table of [
  'core.browser_environments',
  'core.browser_test_categories',
  'core.browser_tests',
  'core.browser_test_environments',
  'core.browser_test_parameters',
  'core.browser_test_parameter_options',
]) {
  assert.ok(migration.includes(table), `Browser Test migration should define ${table}.`);
}

for (const permission of [
  'BROWSER_TEST_READ',
  'BROWSER_TEST_RUN',
  'ADMIN_BROWSER_TEST_READ',
  'ADMIN_BROWSER_TEST_WRITE',
]) {
  assert.ok(seed.includes(permission), `Browser Test seed should register ${permission}.`);
}

assert.ok(seed.includes("'workflow-initialization-e2e'"));
assert.ok(seed.includes("'tests/browser/specs/workflows/workflowInitialization.spec.js'"));
assert.ok(seed.includes("'LOCAL'"));
assert.ok(seed.includes("'workflowCode'"));
assert.ok(seed.includes("'skyserver_workflows'"));

assert.ok(service.includes('startRegisteredBrowserTest'));
assert.ok(service.includes('listBrowserTestRuns'));
assert.ok(service.includes('skycommandBrowserTest'));
assert.ok(routes.includes("router.get('/runs'"));
assert.ok(service.includes('resolveBrowserTestParameters'));
assert.ok(service.includes("client.workflow.start('browserExecutionWorkflow'"));
assert.ok(service.includes('core.browser_test_parameters'));
assert.ok(service.includes('core.browser_test_environments'));

assert.ok(routes.includes("requirePermission('BROWSER_TEST_READ')"));
assert.ok(routes.includes("requirePermission('BROWSER_TEST_RUN')"));
assert.ok(adminRoutes.includes("'/browser-tests/options'"));
assert.ok(adminRoutes.includes("requirePermission('ADMIN_BROWSER_TEST_WRITE')"));
assert.ok(server.includes("app.use('/api/browser-tests', browserTestRoutes)"));

assert.ok(runner.includes('SKYCOMMAND_BROWSER_TEST_PARAMETERS'));
assert.ok(runner.includes('SKYCOMMAND_BROWSER_ENVIRONMENT_CODE'));
assert.ok(runner.includes("args.push('--project', normalizedBrowserType)"));

console.log('[SkyCommand] Browser Test registry self-test passed.');
