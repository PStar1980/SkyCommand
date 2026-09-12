const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
const middleware = require(path.join(ROOT, 'apps/api/src/middleware/assistantIntegrationMiddleware'));

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function includesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label} is missing: ${fragment}`);
  }
}

function run() {
  const migration = read('packages/db_build/src/migrations/00126__assistant_browser_automation_opt_in.sql');
  includesAll(migration, [
    'assistant_enabled BOOLEAN NOT NULL DEFAULT FALSE',
    'idx_browser_automations_assistant_catalogue',
  ], 'Assistant opt-in migration');

  const seed = read('packages/db_build/src/seeds/00127__assistant_browser_automation_reference_seed.sql');
  includesAll(seed, [
    "automation_code = 'command-center-status-snapshot'",
    'assistant_enabled = TRUE',
    "side_effect_level = 'READ_ONLY'",
    'requires_confirmation = FALSE',
  ], 'Assistant reference seed');

  const routes = read('apps/api/src/routes/assistantIntegration.routes.js');
  includesAll(routes, [
    'requireAssistantIntegration',
    "'/capabilities'",
    "'/openapi.json'",
    "'/browser-automations/:automationCode/runs'",
    "'/browser-automation-runs/:workflowId'",
    "'/browser-automation-runs/:workflowId/artifacts/:artifactId'",
  ], 'Assistant integration routes');

  const service = read('apps/api/src/services/assistantIntegrationService.js');
  includesAll(service, [
    "triggerSource: 'ASSISTANT'",
    "executionMode: 'HEADLESS'",
    'HUMAN_CONFIRMATION_REQUIRED',
    'ASSISTANT_PERMISSION_SCOPE_MISSING',
    "eventType: 'ASSISTANT_BROWSER_AUTOMATION'",
    "String(run?.triggerSource || '').toUpperCase() !== 'ASSISTANT'",
    'getOpenApiDocument',
  ], 'Assistant integration service');

  const registry = read('apps/api/src/services/browserAutomationRegistryService.js');
  includesAll(registry, [
    'assistantEnabled: toBoolean(row.assistant_enabled)',
    "assistantEnabled: 'assistant_enabled'",
    'Assistant execution cannot be enabled for confirmation-required Playwright Automations.',
    'Assistant-enabled Playwright Automations must define an execution permission.',
  ], 'Browser Automation registry assistant policy');

  const server = read('apps/api/src/server.js');
  assert.ok(server.includes("app.use('/api/assistant', assistantIntegrationRoutes);"));

  const admin = read('apps/admin-web/src/pages/BrowserAutomations.jsx');
  includesAll(admin, [
    'Assistant execution enabled',
    'assistantEnabled: Boolean(automation.assistantEnabled)',
    'assistantEnabled: Boolean(form.assistantEnabled)',
    'confirmation-required automations',
    'field="assistant"',
  ], 'Assistant opt-in UI');

  const envExample = read('.env.example');
  includesAll(envExample, [
    'SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=false',
    'SKYCOMMAND_ASSISTANT_API_TOKEN=',
    'SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN',
  ], 'Assistant environment configuration');

  assert.equal(middleware.safeTokenEquals('alpha', 'alpha'), true);
  assert.equal(middleware.safeTokenEquals('alpha', 'beta'), false);
  assert.deepEqual(middleware.DEFAULT_ASSISTANT_PERMISSION_CODES, ['BROWSER_AUTOMATION_READ', 'BROWSER_AUTOMATION_RUN']);

  console.log('[assistant-integration:self-test] PASS');
}

run();
