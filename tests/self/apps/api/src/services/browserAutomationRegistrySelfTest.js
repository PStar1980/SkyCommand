const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const migration = read('packages/db_build/src/migrations/00117__browser_automation_registry_foundation.sql');
const seed = read('packages/db_build/src/seeds/00118__browser_automation_registry_seed.sql');
const service = read('apps/api/src/services/browserAutomationRegistryService.js');
const controller = read('apps/api/src/controllers/browserAutomationController.js');
const routes = read('apps/api/src/routes/browserAutomation.routes.js');
const adminRoutes = read('apps/api/src/routes/admin.routes.js');
const server = read('apps/api/src/server.js');
const contract = JSON.parse(read('packages/browser/contracts/browser_automation_summary.v1.schema.json'));
const source = read('browser-automation/scripts/skycommand/commandCenterStatus.js');
const dockerfile = read('docker/browser-worker.Dockerfile');
const dockerignore = read('docker/browser-worker.Dockerfile.dockerignore');
const browserConfig = read('packages/browser/src/config.js');

for (const table of [
  'core.browser_automation_categories',
  'core.browser_automations',
  'core.browser_automation_environments',
  'core.browser_automation_parameters',
  'core.browser_automation_parameter_options',
]) {
  assert.ok(migration.includes(table), `Playwright Automation migration should define ${table}.`);
}

for (const permission of [
  'BROWSER_AUTOMATION_READ',
  'BROWSER_AUTOMATION_RUN',
  'ADMIN_BROWSER_AUTOMATION_READ',
  'ADMIN_BROWSER_AUTOMATION_WRITE',
]) {
  assert.ok(seed.includes(permission), `Playwright Automation seed should register ${permission}.`);
}

for (const safetyControl of [
  "side_effect_level IN ('READ_ONLY','MUTATING','HIGH_IMPACT')",
  "idempotency_mode IN ('READ_ONLY','IDEMPOTENT','DEDUPLICATED','NON_IDEMPOTENT')",
  'browser_automation_retry_safety',
  'browser_automation_high_impact_confirmation',
]) {
  assert.ok(migration.includes(safetyControl), `Migration should enforce ${safetyControl}.`);
}

assert.ok(migration.includes('output_type TEXT NOT NULL'));
assert.ok(migration.includes('output_schema_path TEXT NOT NULL'));
assert.ok(migration.includes('max_concurrency INTEGER NOT NULL DEFAULT 1'));
assert.ok(seed.includes("'command-center-status-snapshot'"));
assert.ok(seed.includes("'browser-automation/scripts/skycommand/commandCenterStatus.js'"));
assert.ok(seed.includes("'browser_automation_summary.v1'"));
assert.ok(seed.includes("FALSE,\n  TRUE,\n  CURRENT_TIMESTAMP"), 'Reference automation should remain disabled until Phase 7 execution integration.');

assert.equal(contract.properties.contract.const, 'browser_automation_summary.v1');
assert.ok(contract.required.includes('status'));
assert.ok(source.includes("contract: 'browser_automation_summary.v1'"));
assert.ok(source.includes("page.goto('/dashboard')"));

assert.ok(service.includes('createBrowserAutomation'));
assert.ok(service.includes('replaceBrowserAutomationParameters'));
assert.ok(service.includes('replaceBrowserAutomationEnvironments'));
assert.ok(service.includes('assertSafetyConsistency'));
assert.ok(service.includes('NON_IDEMPOTENT automations must use retryCount 0'));
assert.ok(service.includes('HIGH_IMPACT automations must require confirmation'));
assert.ok(service.includes("browser-automation/scripts/"));
assert.ok(service.includes('defaultOutputContract'));

assert.ok(routes.includes("requirePermission('BROWSER_AUTOMATION_READ')"));
assert.ok(adminRoutes.includes("'/browser-automations/options'"));
assert.ok(adminRoutes.includes("requirePermission('ADMIN_BROWSER_AUTOMATION_WRITE')"));
assert.ok(controller.includes('listAdminAutomations'));
assert.ok(server.includes("app.use('/api/browser-automations', browserAutomationRoutes)"));

assert.ok(dockerfile.includes('COPY browser-automation ./browser-automation'));
assert.ok(dockerignore.includes('!browser-automation/**'));
assert.ok(browserConfig.includes('DEFAULT_BROWSER_AUTOMATION_ARTIFACT_RELATIVE_ROOT'));
assert.ok(browserConfig.includes('automationArtifactRoot'));

console.log('[SkyCommand] Playwright Automation registry self-test passed.');
