const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const root = path.resolve(sourceDir, '../../..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const reconcile = require(path.join(root, 'packages/config/src/devEnvReconcile'));
const { createDevEnvReconcileFailureToolResult, createDevEnvReconcileToolResult } = require(
  path.join(root, 'packages/config/src/devEnvReconcileResult'),
);
const { summarizeDevEnvReconcileParameters } = require(
  path.join(root, 'packages/config/src/devEnvReconcileSecurity'),
);
const { validateToolResult } = require(path.join(root, 'packages/tools/src/toolResultContract'));
const outputSchema = require(
  path.join(root, 'packages/tools/contracts/dev_env_reconcile_summary.v1.schema.json'),
);

const syntheticSecret = ['fixture', 'value', 'never', 'real'].join('-');

function fixtureRoot({
  env = [
    '# preserve this comment',
    'UNRELATED_SETTING=preserve-me',
    `PGPASSWORD=${syntheticSecret}`,
    `JWT_SECRET=${syntheticSecret}`,
    'SKYCOMMAND_TOOL_RESULT_MAX_BYTES=250000',
  ].join('\r\n') + '\r\n',
  example = [
    '# preserve this example comment',
    'UNRELATED_EXAMPLE=keep-me',
    'API_TELEMETRY_RETENTION_DAYS=30',
    'SKYCOMMAND_TOOL_RESULT_MAX_BYTES=250000',
  ].join('\r\n') + '\r\n',
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-r3-'));
  fs.writeFileSync(path.join(directory, '.env'), env, 'utf8');
  fs.writeFileSync(path.join(directory, '.env.example'), example, 'utf8');
  return directory;
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function runReconcile(directory, patch, options = {}) {
  return reconcile.reconcileEnvironment({
    repositoryRoot: directory,
    patch,
    executionId: 'r3-self-test-execution',
    ...options,
  });
}

function assertResultContract(result) {
  const toolResult = createDevEnvReconcileToolResult(result);
  validateToolResult(toolResult, {
    expectedOutputType: 'dev_env_reconcile_summary.v1',
    outputSchema,
  });
}

async function run() {
  const changedRoot = fixtureRoot();
  try {
    const first = runReconcile(changedRoot, { API_TELEMETRY_RETENTION_DAYS: 31 });
    assert.equal(first.outcome, 'CHANGED');
    assert.deepEqual(first.changedKeys, ['API_TELEMETRY_RETENTION_DAYS']);
    assert.deepEqual(first.envExample.changedKeys, []);
    assert.ok(first.configurationRevision?.digest);
    assert.equal(first.restart.required, true);
    assert.equal(first.restart.services.includes('api'), true);
    assert.equal(
      fs
        .readFileSync(path.join(changedRoot, '.env'), 'utf8')
        .includes('API_TELEMETRY_RETENTION_DAYS=31'),
      true,
    );
    assert.equal(
      fs
        .readFileSync(path.join(changedRoot, '.env'), 'utf8')
        .includes('UNRELATED_SETTING=preserve-me'),
      true,
    );
    assert.equal(
      fs.readFileSync(path.join(changedRoot, '.env'), 'utf8').includes('# preserve this comment'),
      true,
    );
    assert.equal(
      fs.readFileSync(path.join(changedRoot, '.env'), 'utf8').includes(syntheticSecret),
      true,
    );
    assertResultContract(first);

    const repeated = runReconcile(changedRoot, { API_TELEMETRY_RETENTION_DAYS: 31 });
    assert.equal(repeated.outcome, 'NO_CHANGES');
    assert.deepEqual(repeated.changedKeys, []);
    assert.equal(repeated.configurationRevision.digest, first.configurationRevision.digest);
    assertResultContract(repeated);
  } finally {
    cleanup(changedRoot);
  }

  const exampleRoot = fixtureRoot({
    env: [
      'UNRELATED_SETTING=preserve-me',
      `PGPASSWORD=${syntheticSecret}`,
      `JWT_SECRET=${syntheticSecret}`,
      'API_TELEMETRY_RETENTION_DAYS=30',
      'SKYCOMMAND_TOOL_RESULT_MAX_BYTES=250000',
    ].join('\n'),
  });
  try {
    const beforeEnv = fs.readFileSync(path.join(exampleRoot, '.env'), 'utf8');
    const result = runReconcile(exampleRoot, {
      API_TELEMETRY_RETENTION_DAYS: 32,
      SKYCOMMAND_TOOL_RESULT_MAX_BYTES: 262144,
    });
    assert.equal(result.outcome, 'CHANGED');
    assert.deepEqual(result.changedKeys, [
      'API_TELEMETRY_RETENTION_DAYS',
      'SKYCOMMAND_TOOL_RESULT_MAX_BYTES',
    ]);
    assert.deepEqual(result.envExample.changedKeys, ['SKYCOMMAND_TOOL_RESULT_MAX_BYTES']);
    const exampleContent = fs.readFileSync(path.join(exampleRoot, '.env.example'), 'utf8');
    assert.equal(exampleContent.includes('SKYCOMMAND_TOOL_RESULT_MAX_BYTES=262144'), true);
    assert.equal(exampleContent.includes(syntheticSecret), false);
    assert.equal(
      fs
        .readFileSync(path.join(exampleRoot, '.env'), 'utf8')
        .includes('UNRELATED_SETTING=preserve-me'),
      true,
    );
    assert.notEqual(fs.readFileSync(path.join(exampleRoot, '.env'), 'utf8'), beforeEnv);

    const sameEffectiveDifferentFormatting = fixtureRoot({
      env: [
        'SKYCOMMAND_TOOL_RESULT_MAX_BYTES="262144" # formatting only',
        'API_TELEMETRY_RETENTION_DAYS=32',
        `PGPASSWORD=${syntheticSecret}`,
        `JWT_SECRET=${syntheticSecret}`,
      ].join('\n'),
    });
    try {
      const sameRevision = runReconcile(sameEffectiveDifferentFormatting, {
        API_TELEMETRY_RETENTION_DAYS: 32,
        SKYCOMMAND_TOOL_RESULT_MAX_BYTES: 262144,
      });
      assert.equal(sameRevision.configurationRevision.digest, result.configurationRevision.digest);
    } finally {
      cleanup(sameEffectiveDifferentFormatting);
    }
  } finally {
    cleanup(exampleRoot);
  }

  for (const [patch, code] of [
    [{ UNKNOWN_SETTING: 1 }, 'RECONCILIATION_KEY_NOT_ALLOWLISTED'],
    [{ API_TELEMETRY_RETENTION_DAYS: 0 }, 'PATCH_VALUE_INVALID'],
    [{ PGDATABASE: 'other_database' }, 'PROTECTED_CONFIGURATION_KEY'],
    [{ JWT_SECRET: syntheticSecret }, 'SECRET_KEY_NOT_ALLOWED'],
    [{ SKYCOMMAND_ASSISTANT_PERMISSION_CODES: 'GIT_DEV_PR_MERGE_RUN,UNREGISTERED_PERMISSION' }, 'PATCH_VALUE_INVALID'],
  ]) {
    const directory = fixtureRoot();
    try {
      const envBefore = fs.readFileSync(path.join(directory, '.env'), 'utf8');
      const exampleBefore = fs.readFileSync(path.join(directory, '.env.example'), 'utf8');
      const result = runReconcile(directory, patch);
      assert.equal(result.outcome, 'BLOCKED');
      assert.equal(result.error.code, code);
      assert.equal(fs.readFileSync(path.join(directory, '.env'), 'utf8'), envBefore);
      assert.equal(fs.readFileSync(path.join(directory, '.env.example'), 'utf8'), exampleBefore);
      assert.equal(JSON.stringify(result).includes(syntheticSecret), false);
    } finally {
      cleanup(directory);
    }
  }

  const permissionScope = [
    'BROWSER_AUTOMATION_READ',
    'BROWSER_AUTOMATION_RUN',
    'WORKFLOW_RUN',
    'DEV_PROMOTION_PREFLIGHT',
    'CAPABILITY_CATALOG_EXPORT',
    'REPO_MAP_GENERATE',
    'REPO_ZIP_GENERATE',
    'GIT_COMMIT_RUN',
    'GIT_DEV_PR_MERGE_RUN',
    'GIT_MAIN_MERGE_RUN',
    'GIT_LOCAL_SYNC_RUN',
    'CORE_RUN_LOW_RISK_SCRIPT',
    'CORE_RUN_MEDIUM_RISK_SCRIPT',
    'CORE_RUN_HIGH_RISK_SCRIPT',
  ].join(',');
  const permissionRoot = fixtureRoot({
    env: [
      'UNRELATED_SETTING=preserve-me',
      `PGPASSWORD=${syntheticSecret}`,
      `JWT_SECRET=${syntheticSecret}`,
      `SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN`,
    ].join('\n'),
    example: [
      'SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN',
    ].join('\n'),
  });
  try {
    const result = runReconcile(permissionRoot, {
      SKYCOMMAND_ASSISTANT_PERMISSION_CODES: permissionScope,
    });
    assert.equal(result.outcome, 'CHANGED');
    assert.deepEqual(result.changedKeys, ['SKYCOMMAND_ASSISTANT_PERMISSION_CODES']);
    assert.deepEqual(result.envExample.changedKeys, []);
    assert.equal(
      fs.readFileSync(path.join(permissionRoot, '.env'), 'utf8').includes('GIT_DEV_PR_MERGE_RUN'),
      true,
    );
    const repeated = runReconcile(permissionRoot, {
      SKYCOMMAND_ASSISTANT_PERMISSION_CODES: permissionScope,
    });
    assert.equal(repeated.outcome, 'NO_CHANGES');
  } finally {
    cleanup(permissionRoot);
  }

  const missingSecretRoot = fixtureRoot({
    env: ['API_TELEMETRY_RETENTION_DAYS=30', 'JWT_SECRET='].join('\n'),
  });
  try {
    const result = runReconcile(missingSecretRoot, { API_TELEMETRY_RETENTION_DAYS: 31 });
    assert.equal(result.outcome, 'BLOCKED');
    assert.equal(result.error.code, 'REQUIRED_SECRET_UNAVAILABLE');
    assert.deepEqual(result.missingRequiredSecrets, [
      { key: 'PGPASSWORD', classification: 'SECRET' },
      { key: 'JWT_SECRET', classification: 'SECRET' },
    ]);
    assert.equal(JSON.stringify(result).includes(syntheticSecret), false);
  } finally {
    cleanup(missingSecretRoot);
  }

  const duplicateRoot = fixtureRoot({
    env: [
      'API_TELEMETRY_RETENTION_DAYS=30',
      'API_TELEMETRY_RETENTION_DAYS=31',
      `PGPASSWORD=${syntheticSecret}`,
      `JWT_SECRET=${syntheticSecret}`,
    ].join('\n'),
  });
  try {
    const result = runReconcile(duplicateRoot, { API_TELEMETRY_RETENTION_DAYS: 32 });
    assert.equal(result.outcome, 'BLOCKED');
    assert.equal(result.error.code, 'DUPLICATE_ELIGIBLE_KEY');
  } finally {
    cleanup(duplicateRoot);
  }

  const conflictRoot = fixtureRoot();
  try {
    const envPath = path.join(conflictRoot, '.env');
    const result = runReconcile(
      conflictRoot,
      { API_TELEMETRY_RETENTION_DAYS: 33 },
      {
        onBeforeFinalRevalidation({ target }) {
          if (target === 'env') fs.appendFileSync(envPath, '# concurrent edit\n', 'utf8');
        },
      },
    );
    assert.equal(result.outcome, 'BLOCKED');
    assert.equal(result.error.code, 'CONCURRENT_EDIT');
    assert.equal(fs.readFileSync(envPath, 'utf8').includes('# concurrent edit'), true);
    assert.equal(
      fs.readFileSync(envPath, 'utf8').includes('API_TELEMETRY_RETENTION_DAYS=33'),
      false,
    );
  } finally {
    cleanup(conflictRoot);
  }

  const failedWriteRoot = fixtureRoot();
  try {
    const envPath = path.join(failedWriteRoot, '.env');
    const original = fs.readFileSync(envPath, 'utf8');
    const fileSystem = {
      existsSync: fs.existsSync.bind(fs),
      readFileSync: fs.readFileSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      renameSync() {
        throw new Error('synthetic atomic failure');
      },
      rmSync: fs.rmSync.bind(fs),
    };
    const result = runReconcile(
      failedWriteRoot,
      { API_TELEMETRY_RETENTION_DAYS: 34 },
      { fileSystem },
    );
    assert.equal(result.outcome, 'FAILED');
    assert.equal(result.error.code, 'ATOMIC_REPLACE_FAILED');
    assert.equal(fs.readFileSync(envPath, 'utf8'), original);
    assert.equal(
      fs
        .readdirSync(failedWriteRoot)
        .some((name) => name.includes('.skycommand-') && name.endsWith('.tmp')),
      false,
    );
  } finally {
    cleanup(failedWriteRoot);
  }

  const redacted = summarizeDevEnvReconcileParameters({
    patchJson: JSON.stringify({ API_TELEMETRY_RETENTION_DAYS: 35, JWT_SECRET: syntheticSecret }),
  });
  assert.equal(JSON.stringify(redacted).includes(syntheticSecret), false);
  assert.equal(redacted.valuesRedacted, true);
  assert.equal(redacted.patchKeys.includes('[REDACTED_KEY]'), true);

  const failureResult = createDevEnvReconcileFailureToolResult({
    code: 'RECONCILIATION_FAILED',
    message: syntheticSecret,
  });
  assert.equal(JSON.stringify(failureResult).includes(syntheticSecret), false);

  const service = require(path.join(root, 'apps/api/src/services/scriptExecutionService'));
  const authService = require(path.join(root, 'apps/api/src/services/authService'));
  const originalRecordAuditEvent = authService.recordAuditEvent;
  authService.recordAuditEvent = async () => {};
  try {
    await assert.rejects(
      () =>
        service.assertRunAllowed({
          tool: {
            tool_code: 'dev_env_reconcile',
            permission_code: 'DEV_ENV_RECONCILE',
            risk_code: 'medium',
          },
          permissions: [],
          user: null,
          context: {},
        }),
      (error) => error.statusCode === 403,
    );
  } finally {
    authService.recordAuditEvent = originalRecordAuditEvent;
  }

  assert.throws(() => reconcile.parseCliArguments(['--repository', 'other']), {
    code: 'PATCH_REQUIRED',
  });
  await assert.rejects(
    () =>
      reconcile.verifyRegisteredDevContext({
        environment: { SKYCOMMAND_CONFIG_PROFILE: 'PRODUCTION' },
      }),
    (error) => error.code === 'REGISTERED_CONTEXT_INVALID',
  );

  console.log('[dev-env-reconcile:self-test] PASS');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
