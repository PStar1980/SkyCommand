const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

// The Assistant service imports the shared DB connection module for its normal
// API wiring. R7 capability assertions are offline; provide synthetic
// connection metadata so importing that service cannot require a live socket.
process.env.PGHOST ||= '127.0.0.1';
process.env.PGPORT ||= '5432';
process.env.PGDATABASE ||= 'skyserver_dev';
process.env.PGUSER ||= 'postgres';
process.env.PGPASSWORD ||= 'r7-self-test-only';

const RETIRED_ENV_FLAGS = [
  'SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED',
  'SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED',
  'SKYCOMMAND_DB_UPGRADE_APPLY_REQUEST_TTL_MINUTES',
  'SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED',
  'SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED',
  'SKYCOMMAND_MCP_DB_UPGRADE_APPLY_REQUEST_ENABLED',
];

const RETIRED_SURFACE_MARKERS = [
  'databaseUpgradeApplyRequest',
  'database-upgrade/apply-requests',
  'skycommand_database_upgrade_plan',
  'skycommand_database_upgrade_apply_request',
  'DB_UPGRADE_PLAN',
  'DB_UPGRADE_APPLY_REQUEST',
  'DB_UPGRADE_APPLY_APPROVE',
];

function file(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(file(relativePath), 'utf8');
}

function assertNoMarkers(relativePath, markers = RETIRED_SURFACE_MARKERS) {
  const source = read(relativePath);
  for (const marker of markers) {
    assert.equal(
      source.includes(marker),
      false,
      `${relativePath} still contains retired R7 marker ${marker}`,
    );
  }
}

async function main() {
  const example = read('.env.example');
  for (const flag of RETIRED_ENV_FLAGS) assert.equal(example.includes(flag), false);
  if (fs.existsSync(file('.env'))) {
    const localEnv = read('.env');
    for (const flag of RETIRED_ENV_FLAGS) assert.equal(localEnv.includes(flag), false);
  }

  const activeSurfaceFiles = [
    'apps/api/src/services/assistantIntegrationService.js',
    'apps/api/src/controllers/assistantIntegrationController.js',
    'apps/api/src/routes/assistantIntegration.routes.js',
    'apps/api/src/routes/admin.routes.js',
    'apps/admin-web/src/main.jsx',
    'apps/admin-web/src/components/Navbar.jsx',
    'apps/admin-web/src/services/adminService.js',
    'scripts/mcp/skycommandMcpGateway.js',
    'packages/config/src/devEnvReconcile.js',
  ];
  for (const relativePath of activeSurfaceFiles) assertNoMarkers(relativePath);

  for (const retiredPath of [
    'apps/admin-web/src/pages/DatabaseUpgradeRequests.jsx',
    'apps/api/src/controllers/databaseUpgradeApplyRequestController.js',
    'apps/api/src/services/databaseUpgradeApplyRequestService.js',
  ]) {
    assert.equal(fs.existsSync(file(retiredPath)), false, `${retiredPath} must be retired`);
  }

  const assistant = require(file('apps/api/src/services/assistantIntegrationService'));
  const capabilities = assistant.getCapabilities({ permissionCodes: [], agentId: 'r7-test' });
  for (const retiredField of [
    'databaseUpgradePlan',
    'databaseUpgradeApplyRequest',
    'databaseUpgradeApplyExecution',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(capabilities, retiredField), false);
  }
  assert.equal(
    Object.keys(capabilities.endpoints).some((endpoint) => endpoint.includes('database-upgrade')),
    false,
  );
  const openApi = assistant.getOpenApiDocument();
  assert.equal(
    Object.keys(openApi.paths).some((endpoint) => endpoint.includes('database-upgrade')),
    false,
  );

  const gateway = require(file('scripts/mcp/skycommandMcpGateway'));
  const gatewayConfig = gateway.getGatewayConfig({
    SKYCOMMAND_MCP_EXECUTION_ENABLED: 'true',
    SKYCOMMAND_MCP_DEV_PROMOTION_ENABLED: 'true',
    SKYCOMMAND_MCP_ALLOWED_AUTOMATION_CODES: 'command-center-status-snapshot',
  });
  const gatewayToolNames = gateway.getToolDefinitions(gatewayConfig).map((tool) => tool.name);
  assert.equal(gatewayToolNames.some((name) => name.includes('database_upgrade')), false);

  const applyTool = require(file('packages/db_upgrade/src/databaseUpgradeApplyTool'));
  assert.equal(applyTool.TOOL_CODE, 'database_upgrade_apply');
  assert.equal(applyTool.PERMISSION_CODE, 'DB_UPGRADE_APPLY');
  const engine = require(file('packages/db_upgrade/src/databaseUpgradeEngine'));
  assert.equal(typeof engine.executeRegisteredDatabaseUpgrade, 'function');

  const migrationNames = fs.readdirSync(file('packages/db_build/src/migrations'));
  for (const ordinal of ['00130', '00131', '00132']) {
    assert.equal(
      migrationNames.some((name) => name.startsWith(`${ordinal}__`)),
      true,
      `${ordinal} historical migration must remain present`,
    );
  }
  const migration = read('packages/db_build/src/migrations/00147__retire_d2_database_upgrade_surfaces.sql');
  for (const permissionCode of [
    'DB_UPGRADE_PLAN',
    'DB_UPGRADE_APPLY_REQUEST',
    'DB_UPGRADE_APPLY_APPROVE',
  ]) {
    assert.ok(migration.includes(`'${permissionCode}'`));
  }
  assert.equal(/\bDELETE\s+FROM\b/i.test(migration), false);
  assert.equal(/\bDROP\b/i.test(migration), false);
  assert.equal(/\bTRUNCATE\b/i.test(migration), false);
  assert.ok(migration.includes('SET active = FALSE'));

  const databaseUpgradeDoc = read('docs/development/SkyCommand_Database_Upgrade.md');
  assert.ok(databaseUpgradeDoc.includes('database_upgrade_apply'));
  assert.ok(databaseUpgradeDoc.includes('dev_change_finalize'));
  assert.ok(databaseUpgradeDoc.includes('NO_CHANGES'));
  assert.equal(databaseUpgradeDoc.includes('/api/assistant/database-upgrade'), false);
  assert.equal(databaseUpgradeDoc.includes('DB_UPGRADE_APPLY_REQUEST'), false);

  console.log('R7 database-upgrade cleanup self-test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
