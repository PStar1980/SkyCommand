const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';

const assistant = require(path.join(ROOT, 'apps/api/src/services/assistantIntegrationService'));
const middleware = require(
  path.join(ROOT, 'apps/api/src/middleware/assistantIntegrationMiddleware'),
);

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function permissions(...permissionCodes) {
  return permissionCodes.map((permissionCode) => ({ permissionCode }));
}

function environment(overrides = {}) {
  return {
    PGDATABASE: 'skyserver_dev',
    SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED: 'true',
    SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
    SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '12345678901234567890',
    ...overrides,
  };
}

function planResult(overrides = {}) {
  return {
    mode: 'PLAN',
    databaseIdentity: {
      databaseName: 'skyserver_dev',
      serverVersion: '17.0',
      serverPort: 5432,
      systemIdentifier: '12345678901234567890',
    },
    baseline: {
      status: 'VERIFIED',
      contract: 'skycommand_database_baseline.v1',
      ordinal: 128,
      recorded: true,
      probes: [{ name: 'REQUIRED_SCHEMAS', status: 'PASS', evidence: { schemas: ['core'] } }],
    },
    sourceRevision: 'test-revision',
    planDigest: { algorithm: 'SHA-256', digest: 'A'.repeat(64) },
    pendingCount: 1,
    pendingChanges: [
      {
        ordinal: 130,
        kind: 'MIGRATION',
        relativePath:
          'packages/db_build/src/migrations/00130__assistant_database_upgrade_plan_permission.sql',
        sha256: 'B'.repeat(64),
      },
    ],
    appliedCount: 0,
    ledger: { available: true, verification: 'VERIFIED', appliedCount: 0, driftDetected: false },
    warnings: [{ code: 'HISTORICAL_SQL_NOT_INDIVIDUALLY_LEDGERED', message: 'safe warning' }],
    errors: [],
    outcome: 'PLAN_READY',
    timing: {
      startedAt: '2026-09-15T00:00:00.000Z',
      completedAt: '2026-09-15T00:00:01.000Z',
      durationMs: 1000,
    },
    ...overrides,
  };
}

async function assertRejected(action, code, statusCode = undefined) {
  await assert.rejects(action, (error) => {
    assert.equal(error.details?.code || error.code, code);
    if (statusCode !== undefined) assert.equal(error.statusCode, statusCode);
    return true;
  });
}

async function run() {
  const envExample = read('.env.example');
  assert.ok(envExample.includes('SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED=false'));
  assert.ok(envExample.includes('SKYCOMMAND_MCP_DB_UPGRADE_PLAN_ENABLED=false'));
  assert.deepEqual(middleware.DEFAULT_ASSISTANT_PERMISSION_CODES, [
    'BROWSER_AUTOMATION_READ',
    'BROWSER_AUTOMATION_RUN',
  ]);
  assert.ok(!middleware.DEFAULT_ASSISTANT_PERMISSION_CODES.includes('DB_UPGRADE_PLAN'));
  assert.equal(assistant.getDatabaseUpgradePlanConfig({}).enabled, false);

  const validEnvironment = environment();
  const planPermissions = permissions('DB_UPGRADE_PLAN');
  let calls = [];
  const upgradeExecutor = async (input) => {
    calls.push(input);
    return planResult();
  };

  await assertRejected(
    () =>
      assistant.getDatabaseUpgradePlan({
        permissions: [],
        environment: validEnvironment,
        upgradeExecutor,
      }),
    'ASSISTANT_DATABASE_UPGRADE_PERMISSION_SCOPE_MISSING',
    403,
  );
  await assertRejected(
    () =>
      assistant.getDatabaseUpgradePlan({
        permissions: planPermissions,
        environment: environment({ SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: '' }),
        upgradeExecutor,
      }),
    'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_NOT_CONFIGURED',
    503,
  );
  await assertRejected(
    () =>
      assistant.getDatabaseUpgradePlan({
        permissions: planPermissions,
        environment: environment({ SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '' }),
        upgradeExecutor,
      }),
    'ASSISTANT_DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED',
    503,
  );
  await assertRejected(
    () =>
      assistant.getDatabaseUpgradePlan({
        permissions: planPermissions,
        environment: validEnvironment,
        upgradeExecutor: async () =>
          planResult({
            databaseIdentity: { ...planResult().databaseIdentity, databaseName: 'other_database' },
          }),
      }),
    'ASSISTANT_DATABASE_UPGRADE_OBSERVED_DATABASE_MISMATCH',
    409,
  );
  await assertRejected(
    () =>
      assistant.getDatabaseUpgradePlan({
        permissions: planPermissions,
        environment: validEnvironment,
        upgradeExecutor: async () =>
          planResult({
            databaseIdentity: {
              ...planResult().databaseIdentity,
              systemIdentifier: '99999999999999999999',
            },
          }),
      }),
    'ASSISTANT_DATABASE_UPGRADE_OBSERVED_SYSTEM_IDENTIFIER_MISMATCH',
    409,
  );

  const toolResult = await assistant.getDatabaseUpgradePlan({
    permissions: planPermissions,
    environment: validEnvironment,
    upgradeExecutor,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'PLAN');
  assert.deepEqual(Object.keys(calls[0]).sort(), ['environment', 'mode']);
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0], 'confirmed'));
  assert.ok(!Object.prototype.hasOwnProperty.call(calls[0], 'expectedPlanDigest'));
  assert.equal(toolResult.outputType, 'database_upgrade_summary.v1');
  assert.equal(toolResult.output.mode, 'PLAN');
  assert.equal(toolResult.output.outcome, 'PLAN_READY');
  assert.ok(!JSON.stringify(toolResult).includes('SELECT'));
  assert.ok(!JSON.stringify(toolResult).includes('password'));
  assert.ok(!JSON.stringify(toolResult).includes('test-token'));

  const disabledCapability = assistant.getCapabilities({
    permissionCodes: planPermissions.map((permission) => permission.permissionCode),
    environment: environment({ SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED: 'false' }),
  }).databaseUpgradePlan;
  assert.equal(disabledCapability.configured, true);
  assert.equal(disabledCapability.enabled, false);
  assert.equal(disabledCapability.executable, false);
  assert.equal(disabledCapability.permissionCode, 'DB_UPGRADE_PLAN');
  assert.deepEqual(disabledCapability.missingPermissionCodes, []);
  assert.equal(disabledCapability.databaseTargetConfigured, true);
  assert.equal(disabledCapability.systemIdentifierTargetConfigured, true);
  assert.equal(disabledCapability.readOnly, true);
  assert.equal(disabledCapability.applyExposed, false);

  const executableCapability = assistant.getCapabilities({
    permissionCodes: ['DB_UPGRADE_PLAN'],
    environment: validEnvironment,
  }).databaseUpgradePlan;
  assert.equal(executableCapability.enabled, true);
  assert.equal(executableCapability.executable, true);
  assert.equal(executableCapability.blockedReason, null);
  assert.deepEqual(
    assistant.getCapabilities({ permissionCodes: [], environment: validEnvironment })
      .databaseUpgradePlan.missingPermissionCodes,
    ['DB_UPGRADE_PLAN'],
  );

  const openApi = assistant.getOpenApiDocument();
  const openApiPlan = openApi.paths['/database-upgrade/plan'].get;
  assert.equal(openApiPlan.operationId, 'skycommand_database_upgrade_plan');
  assert.ok(openApiPlan.description.includes('does not expose APPLY'));
  assert.ok(!Object.prototype.hasOwnProperty.call(openApi.paths, '/database-upgrade/apply'));

  const routes = read('apps/api/src/routes/assistantIntegration.routes.js');
  const controller = read('apps/api/src/controllers/assistantIntegrationController.js');
  const service = read('apps/api/src/services/assistantIntegrationService.js');
  assert.ok(routes.includes("'/database-upgrade/plan'"));
  assert.ok(controller.includes('getDatabaseUpgradePlan'));
  assert.ok(!routes.includes("'/database-upgrade/apply'"));
  assert.ok(service.includes('expectedPlanDigest'));
  assert.ok(!service.includes("mode: 'APPLY'"));

  const auditEvents = [];
  const request = {
    ip: '127.0.0.1',
    headers: { authorization: 'Bearer must-not-be-audit-value' },
    session: { appCode: 'SKYSERVER_ADMIN' },
    assistantIntegration: { agentId: 'codex-local' },
    get: () => 'self-test',
  };
  await assistant.recordDatabaseUpgradePlanAudit({
    req: request,
    result: toolResult,
    success: true,
    auditRecorder: async (event) => auditEvents.push(event),
  });
  await assistant.recordDatabaseUpgradePlanAudit({
    req: request,
    success: false,
    error: { details: { code: 'ASSISTANT_DATABASE_UPGRADE_PERMISSION_SCOPE_MISSING' } },
    auditRecorder: async (event) => auditEvents.push(event),
  });
  assert.equal(auditEvents[0].eventType, 'ASSISTANT_DATABASE_UPGRADE_PLAN');
  assert.equal(auditEvents[0].metadata.permissionCode, 'DB_UPGRADE_PLAN');
  assert.equal(auditEvents[0].metadata.planDigest, 'A'.repeat(64));
  assert.equal(auditEvents[0].metadata.pendingCount, 1);
  assert.equal(auditEvents[0].metadata.ledgeredCount, 0);
  assert.equal(auditEvents[1].success, false);
  assert.equal(
    auditEvents[1].metadata.authorizationErrorCode,
    'ASSISTANT_DATABASE_UPGRADE_PERMISSION_SCOPE_MISSING',
  );
  assert.ok(!JSON.stringify(auditEvents).includes('must-not-be-audit-value'));

  const migration = read(
    'packages/db_build/src/migrations/00130__assistant_database_upgrade_plan_permission.sql',
  );
  assert.ok(migration.includes("'DB_UPGRADE_PLAN'"));
  assert.ok(migration.includes("WHERE role.role_code = 'SUPER_ADMIN'"));
  assert.ok(migration.includes('ON CONFLICT (permission_code) DO UPDATE'));
  assert.ok(migration.includes('ON CONFLICT (role_id, permission_id) DO UPDATE'));
  assert.ok(!migration.includes("'DB_UPGRADE_APPLY'"));

  const applyRequestMigration = read(
    'packages/db_build/src/migrations/00131__database_upgrade_apply_request_envelope.sql',
  );
  assert.ok(applyRequestMigration.includes("'DB_UPGRADE_APPLY_REQUEST'"));
  assert.ok(applyRequestMigration.includes("'DB_UPGRADE_APPLY_APPROVE'"));
  assert.ok(applyRequestMigration.includes("WHERE role.role_code = 'SUPER_ADMIN'"));
  assert.ok(applyRequestMigration.includes('database_upgrade_apply_requests'));

  console.log('[assistant-database-upgrade-plan:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
