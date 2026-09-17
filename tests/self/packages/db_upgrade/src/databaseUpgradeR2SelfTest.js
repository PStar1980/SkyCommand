const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const root = path.resolve(sourceDir, '../../..');
const {
  BASELINE_CONTRACT,
  BASELINE_ORDINAL,
  discoverGovernedSqlChanges,
  executeRegisteredDatabaseUpgrade,
} = require(path.join(root, 'packages/db_upgrade/src/databaseUpgradeEngine'));
const { executeRegisteredDevDatabaseUpgrade, verifyRegisteredDevContext } = require(
  path.join(root, 'packages/db_upgrade/src/databaseUpgradeApplyTool'),
);
const { parseCliArguments } = require(
  path.join(root, 'packages/db_upgrade/src/databaseUpgradeApply'),
);
const { DATABASE_UPGRADE_OUTPUT_TYPE, createDatabaseUpgradeToolResult } = require(
  path.join(root, 'packages/db_upgrade/src/databaseUpgradeResult'),
);
const { validateToolResult } = require(path.join(root, 'packages/tools/src/toolResultContract'));
const outputSchema = require(
  path.join(root, 'packages/tools/contracts/database_upgrade_summary.v1.schema.json'),
);

const SYSTEM_IDENTIFIER = '9223372036854775807';
const REPOSITORY_ID = 'repo-registered';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function makeEnvironment(overrides = {}) {
  return {
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGDATABASE: 'skyserver_dev',
    PGUSER: 'postgres',
    PGPASSWORD: 'fixture-secret',
    SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL',
    SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION: 'r2-test-revision',
    SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
    SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: SYSTEM_IDENTIFIER,
    SKYCOMMAND_EXECUTION_ID: 'r2-test-execution',
    ...overrides,
  };
}

function baselineRow() {
  return {
    baseline_id: 'baseline-r2',
    baseline_contract: BASELINE_CONTRACT,
    baseline_ordinal: BASELINE_ORDINAL,
    database_name: 'skyserver_dev',
    database_server_version: '18.6',
    source_revision: 'r2-test-revision',
    evidence: { systemIdentifier: SYSTEM_IDENTIFIER },
    verified_at: '2026-09-16T00:00:00.000Z',
  };
}

function ledgerRow(change, index = 1) {
  return {
    change_id: `change-r2-${index}`,
    baseline_id: 'baseline-r2',
    ordinal: change.ordinal,
    change_kind: change.kind,
    source_path: change.relativePath,
    sha256: change.sha256,
    applied_at: '2026-09-16T00:00:00.000Z',
    source_revision: 'r2-test-revision',
    plan_digest: 'A'.repeat(64),
    runner_version: 'database_upgrade.v1',
    evidence: { receipt: 'SUCCESS' },
  };
}

class FakeUpgradeClient {
  constructor({
    databaseName = 'skyserver_dev',
    systemIdentifier = SYSTEM_IDENTIFIER,
    ledgerRows = [],
  } = {}) {
    this.databaseName = databaseName;
    this.systemIdentifier = systemIdentifier;
    this.baselineRows = ledgerRows.length ? [baselineRow()] : [];
    this.ledgerRows = [...ledgerRows];
    this.executedSql = [];
    this.mutations = [];
    this.queries = [];
    this.transactionSnapshot = null;
    this.committed = false;
    this.lockAcquired = true;
    this.throwAfterCommit = false;
    this.failOnSql = null;
    this.released = false;
  }

  snapshot() {
    return {
      baselineRows: this.baselineRows.map((row) => ({ ...row, evidence: { ...row.evidence } })),
      ledgerRows: this.ledgerRows.map((row) => ({ ...row, evidence: { ...row.evidence } })),
    };
  }

  restore(snapshot) {
    this.baselineRows = snapshot.baselineRows;
    this.ledgerRows = snapshot.ledgerRows;
  }

  async query(text, params = []) {
    const sql = String(text);
    const trimmed = sql.trim();
    this.queries.push({ sql, params });

    if (/^BEGIN$/i.test(trimmed)) {
      this.transactionSnapshot = this.snapshot();
      this.committed = false;
      this.mutations.push('BEGIN');
      return { rows: [] };
    }
    if (/^COMMIT$/i.test(trimmed)) {
      this.mutations.push('COMMIT');
      this.committed = true;
      this.transactionSnapshot = null;
      if (this.throwAfterCommit) {
        this.throwAfterCommit = false;
        throw new Error('simulated lost commit response');
      }
      return { rows: [] };
    }
    if (/^ROLLBACK$/i.test(trimmed)) {
      this.mutations.push('ROLLBACK');
      if (this.transactionSnapshot && !this.committed) this.restore(this.transactionSnapshot);
      this.transactionSnapshot = null;
      return { rows: [] };
    }
    if (/^SELECT pg_try_advisory_lock/i.test(trimmed)) {
      return { rows: [{ acquired: this.lockAcquired }] };
    }
    if (/^SELECT pg_advisory_unlock/i.test(trimmed)) {
      return { rows: [{ released: true }] };
    }
    if (sql.includes('current_database()')) {
      return {
        rows: [
          {
            database_name: this.databaseName,
            server_version: '18.6',
            server_port: 5432,
            system_identifier: this.systemIdentifier,
          },
        ],
      };
    }
    if (sql.includes('information_schema.schemata')) {
      return {
        rows: [{ schema_name: 'core' }, { schema_name: 'auth' }, { schema_name: 'worker' }],
      };
    }
    if (sql.includes('FROM pg_constraint')) {
      return {
        rows: [
          { definition: "CHECK (run_source IN ('manual', 'assistant'))" },
          { definition: "CHECK (trigger_type IN ('MANUAL', 'ASSISTANT'))" },
        ],
      };
    }
    if (sql.includes("to_regclass('core.database_upgrade_baselines')")) {
      return {
        rows: [
          {
            baseline_table: 'core.database_upgrade_baselines',
            ledger_table: 'core.database_upgrade_ledger',
          },
        ],
      };
    }
    if (sql.includes("to_regclass('core.repositories')")) {
      return {
        rows: [
          {
            repositories: 'core.repositories',
            workflow_run_records: 'worker.workflow_run_records',
            browser_automations: 'core.browser_automations',
          },
        ],
      };
    }
    if (sql.includes('FROM core.database_upgrade_baselines')) return { rows: this.baselineRows };
    if (sql.includes('FROM core.database_upgrade_ledger')) return { rows: this.ledgerRows };
    if (/^INSERT INTO core\.database_upgrade_baselines/i.test(trimmed)) {
      this.mutations.push('INSERT_BASELINE');
      this.baselineRows = [baselineRow()];
      return { rows: [{ baseline_id: 'baseline-r2' }] };
    }
    if (/^INSERT INTO core\.database_upgrade_ledger/i.test(trimmed)) {
      this.mutations.push('INSERT_LEDGER');
      this.ledgerRows.push({
        ...ledgerRow(
          {
            ordinal: Number(params[1]),
            kind: params[2],
            relativePath: params[3],
            sha256: params[4],
          },
          this.ledgerRows.length + 1,
        ),
        baseline_id: params[0],
        source_revision: params[5],
        plan_digest: params[6],
      });
      return { rows: [] };
    }

    if (this.failOnSql && sql.includes(this.failOnSql)) {
      this.executedSql.push(sql);
      throw new Error(`simulated SQL failure for ${this.failOnSql}`);
    }
    this.executedSql.push(sql);
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

function adapterFor(client) {
  return { connect: async () => client };
}

function makeTempSqlRoot(files) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-r2-'));
  for (const rootName of ['migrations', 'seeds']) {
    fs.mkdirSync(path.join(temporaryRoot, 'packages', 'db_build', 'src', rootName), {
      recursive: true,
    });
  }
  for (const file of files) {
    fs.writeFileSync(
      path.join(temporaryRoot, 'packages', 'db_build', 'src', file.rootName, file.name),
      file.contents || 'SELECT 1;',
    );
  }
  return temporaryRoot;
}

function delegatedFileSystem(overrides = {}) {
  return {
    existsSync: (...args) => fs.existsSync(...args),
    readdirSync: (...args) => fs.readdirSync(...args),
    lstatSync: (...args) => fs.lstatSync(...args),
    realpathSync: (...args) => fs.realpathSync(...args),
    readFileSync: (...args) => fs.readFileSync(...args),
    ...overrides,
  };
}

function createNormalToolExecutionHarness(temporaryRoot) {
  const servicePath = require.resolve(
    path.join(root, 'apps/api/src/services/scriptExecutionService'),
  );
  const connectionPath = require.resolve(path.join(root, 'packages/db/src/connection'));
  const authServicePath = require.resolve(path.join(root, 'apps/api/src/services/authService'));
  const toolsPath = require.resolve(path.join(root, 'packages/tools/src'));
  const queries = [];
  const auditEvents = [];
  let executionStarted = 0;
  let executionFinished = 0;
  let processExecutionCount = 0;
  const tool = {
    app_code: 'SKYSERVER_CORE',
    category_code: 'database_tools',
    category_label: 'Database Tools',
    tool_id: '11111111-1111-4111-8111-111111111111',
    script_repo_id: REPOSITORY_ID,
    tool_code: 'database_upgrade_apply',
    name: 'databaseUpgradeApply',
    label: 'Apply DEV Database Upgrade',
    description: 'R2 normal Tool execution fixture.',
    script_repo_code: 'SkyCommand',
    script_path: 'packages/db_upgrade/src/databaseUpgradeApply.js',
    runtime_code: 'node',
    runtime_executable: null,
    permission_code: 'DB_UPGRADE_APPLY',
    risk_code: 'medium',
    risk_rank: 2,
    requires_confirmation: false,
    confirmation_text: null,
    captures_output: true,
    allow_params: false,
    tool_display_order: 25,
    output_type: 'database_upgrade_summary.v1',
    output_schema_path: null,
    managed_by_skycommand: false,
    root_path: temporaryRoot,
  };

  const query = async (text, params = []) => {
    const sql = String(text);
    queries.push({ sql, params });

    if (sql.includes('FROM core.vw_tool_manifest')) {
      return { rowCount: 1, rows: [tool] };
    }
    if (sql.includes('FROM core.vw_tool_parameters')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO auth.script_execution_log')) {
      executionStarted += 1;
      return {
        rowCount: 1,
        rows: [
          {
            execution_id: '22222222-2222-4222-8222-222222222222',
            started_at: '2026-09-17T00:00:00.000Z',
          },
        ],
      };
    }
    if (sql.includes('UPDATE auth.script_execution_log')) {
      executionFinished += 1;
      return { rowCount: 1, rows: [] };
    }

    throw new Error('unexpected normal Tool query: ' + sql);
  };

  const recordAuditEvent = async (event) => {
    auditEvents.push(event);
  };
  const executeToolProcess = async () => {
    processExecutionCount += 1;
    return {
      processStatus: 'SUCCESS',
      status: 'SUCCESS',
      exitCode: 0,
      durationMs: 1,
      stdout: '',
      stderr: '',
      timedOut: false,
      toolResult: null,
      toolResultContract: {
        required: false,
        expectedOutputType: 'database_upgrade_summary.v1',
        schemaValidated: false,
        status: 'NOT_EMITTED',
        schemaVersion: null,
        outputType: null,
        byteLength: 0,
        businessSuccess: null,
        error: null,
      },
    };
  };

  const originalLoad = Module._load;
  const previousServiceCacheEntry = require.cache[servicePath];
  delete require.cache[servicePath];
  Module._load = function loadWithR2Harness(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === connectionPath) return { query };
    if (resolved === authServicePath) return { recordAuditEvent };
    if (resolved === toolsPath) {
      return {
        executeToolProcess,
        bindParameterArgument: () => [],
      };
    }
    return originalLoad.apply(this, arguments);
  };

  let service;
  try {
    service = require(servicePath);
  } finally {
    Module._load = originalLoad;
    if (previousServiceCacheEntry) require.cache[servicePath] = previousServiceCacheEntry;
    else delete require.cache[servicePath];
  }

  return {
    service,
    tool,
    queries,
    auditEvents,
    get executionStarted() {
      return executionStarted;
    },
    get executionFinished() {
      return executionFinished;
    },
    get processExecutionCount() {
      return processExecutionCount;
    },
  };
}

function makeNormalToolRoot() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-r2-tool-'));
  const scriptFile = path.join(
    temporaryRoot,
    'packages',
    'db_upgrade',
    'src',
    'databaseUpgradeApply.js',
  );
  fs.mkdirSync(path.dirname(scriptFile), { recursive: true });
  fs.writeFileSync(scriptFile, '// test-only placeholder\n');
  return temporaryRoot;
}

async function expectCode(promiseFactory, expectedCode) {
  let captured;
  await assert.rejects(promiseFactory, (error) => {
    assert.equal(error.code, expectedCode);
    captured = error;
    return true;
  });
  return captured;
}

async function expectStatusCode(promiseFactory, expectedStatusCode) {
  let captured;
  await assert.rejects(promiseFactory, (error) => {
    assert.equal(error.statusCode, expectedStatusCode);
    captured = error;
    return true;
  });
  return captured;
}

async function executeFixture(temporaryRoot, client, environment = {}) {
  return executeRegisteredDatabaseUpgrade({
    environment: makeEnvironment(environment),
    adapter: adapterFor(client),
    repositoryRoot: temporaryRoot,
    binding: {
      environmentCode: 'DEV_LOCAL',
      repositoryCode: 'SkyCommand',
      repositoryId: REPOSITORY_ID,
      toolCode: 'database_upgrade_apply',
      toolId: 'tool-r2',
      permissionCode: 'DB_UPGRADE_APPLY',
    },
  });
}

class FakeRegistrationClient {
  constructor(repositoryRoot) {
    this.repositoryRoot = repositoryRoot;
    this.released = false;
  }

  async query(text) {
    const sql = String(text);
    if (sql.includes('FROM core.config_profiles')) {
      return {
        rowCount: 1,
        rows: [
          {
            profile_code: 'DEV_LOCAL',
            repo_id: REPOSITORY_ID,
            repo_code: 'SkyCommand',
            root_path: this.repositoryRoot,
          },
        ],
      };
    }
    if (sql.includes('FROM core.tools')) {
      return {
        rowCount: 1,
        rows: [
          {
            tool_id: 'tool-r2',
            tool_code: 'database_upgrade_apply',
            script_path: 'packages/db_upgrade/src/databaseUpgradeApply.js',
            runtime_code: 'node',
            permission_code: 'DB_UPGRADE_APPLY',
            risk_code: 'medium',
            requires_confirmation: false,
            allow_params: false,
            enabled: true,
            script_repo_id: REPOSITORY_ID,
            repo_code: 'SkyCommand',
          },
        ],
      };
    }
    if (sql.includes('FROM core.tool_visibility')) {
      return {
        rowCount: 4,
        rows: ['admin-web', 'api', 'cli', 'worker'].map((channel_code) => ({ channel_code })),
      };
    }
    throw new Error(`unexpected registration query: ${sql}`);
  }

  release() {
    this.released = true;
  }
}

async function run() {
  const temporaryRoots = [];
  try {
    const successfulRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
    ]);
    temporaryRoots.push(successfulRoot);
    const successfulClient = new FakeUpgradeClient();
    const applied = await executeFixture(successfulRoot, successfulClient);
    assert.equal(applied.outcome, 'APPLIED');
    assert.equal(applied.appliedCount, 1);
    assert.equal(applied.fileOutcomes[0].status, 'COMMITTED');
    assert.equal(applied.revalidation.outcome, 'VERIFIED');
    assert.equal(successfulClient.executedSql[0], 'SELECT 1;');
    validateToolResult(createDatabaseUpgradeToolResult(applied), {
      expectedOutputType: DATABASE_UPGRADE_OUTPUT_TYPE,
      outputSchema,
    });

    const repeated = await executeFixture(successfulRoot, successfulClient);
    assert.equal(repeated.outcome, 'NO_CHANGES');
    assert.equal(repeated.execution.reconciledFromLedger, true);
    assert.equal(successfulClient.executedSql.filter((sql) => sql === 'SELECT 1;').length, 1);

    const currentRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
    ]);
    temporaryRoots.push(currentRoot);
    const currentChange = discoverGovernedSqlChanges({ repositoryRoot: currentRoot })[0];
    const currentClient = new FakeUpgradeClient({ ledgerRows: [ledgerRow(currentChange)] });
    const noChanges = await executeFixture(currentRoot, currentClient);
    assert.equal(noChanges.outcome, 'NO_CHANGES');
    assert.equal(noChanges.lock.requested, false);
    assert.equal(currentClient.executedSql.length, 0);

    const bytesRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
    ]);
    temporaryRoots.push(bytesRoot);
    const bytesPath = path.join(
      bytesRoot,
      'packages',
      'db_build',
      'src',
      'migrations',
      '00129__first.sql',
    );
    let readCount = 0;
    const driftClient = new FakeUpgradeClient();
    await expectCode(
      () =>
        executeRegisteredDatabaseUpgrade({
          environment: makeEnvironment(),
          adapter: adapterFor(driftClient),
          repositoryRoot: bytesRoot,
          fileSystem: delegatedFileSystem({
            readFileSync(filePath, ...args) {
              readCount += 1;
              if (path.resolve(filePath) === path.resolve(bytesPath) && readCount > 1)
                return Buffer.from('SELECT 2;');
              return fs.readFileSync(filePath, ...args);
            },
          }),
          binding: {
            environmentCode: 'DEV_LOCAL',
            repositoryCode: 'SkyCommand',
            repositoryId: REPOSITORY_ID,
            toolCode: 'database_upgrade_apply',
            toolId: 'tool-r2',
            permissionCode: 'DB_UPGRADE_APPLY',
          },
        }),
      'DATABASE_UPGRADE_MANIFEST_DRIFT',
    );
    assert.equal(driftClient.executedSql.length, 0);

    const removalRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
      { rootName: 'migrations', name: '00130__second.sql', contents: 'SELECT 2;' },
    ]);
    temporaryRoots.push(removalRoot);
    let removalDiscoveryCount = 0;
    const removalClient = new FakeUpgradeClient();
    await expectCode(
      () =>
        executeRegisteredDatabaseUpgrade({
          environment: makeEnvironment(),
          adapter: adapterFor(removalClient),
          repositoryRoot: removalRoot,
          fileSystem: delegatedFileSystem({
            readdirSync(directory, ...args) {
              const entries = fs.readdirSync(directory, ...args);
              if (directory.endsWith(path.join('src', 'migrations'))) {
                removalDiscoveryCount += 1;
                if (removalDiscoveryCount === 2)
                  return entries.filter((entry) => entry.name !== '00130__second.sql');
              }
              return entries;
            },
          }),
          binding: {
            environmentCode: 'DEV_LOCAL',
            repositoryCode: 'SkyCommand',
            repositoryId: REPOSITORY_ID,
            toolCode: 'database_upgrade_apply',
            toolId: 'tool-r2',
            permissionCode: 'DB_UPGRADE_APPLY',
          },
        }),
      'DATABASE_UPGRADE_MANIFEST_DRIFT',
    );
    assert.equal(removalClient.executedSql.length, 0);

    const additionRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
      { rootName: 'migrations', name: '00130__appears.sql', contents: 'SELECT 2;' },
    ]);
    temporaryRoots.push(additionRoot);
    let additionDiscoveryCount = 0;
    const additionClient = new FakeUpgradeClient();
    await expectCode(
      () =>
        executeRegisteredDatabaseUpgrade({
          environment: makeEnvironment(),
          adapter: adapterFor(additionClient),
          repositoryRoot: additionRoot,
          fileSystem: delegatedFileSystem({
            readdirSync(directory, ...args) {
              const entries = fs.readdirSync(directory, ...args);
              if (directory.endsWith(path.join('src', 'migrations'))) {
                additionDiscoveryCount += 1;
                if (additionDiscoveryCount === 1) {
                  return entries.filter((entry) => entry.name !== '00130__appears.sql');
                }
              }
              return entries;
            },
          }),
          binding: {
            environmentCode: 'DEV_LOCAL',
            repositoryCode: 'SkyCommand',
            repositoryId: REPOSITORY_ID,
            toolCode: 'database_upgrade_apply',
            toolId: 'tool-r2',
            permissionCode: 'DB_UPGRADE_APPLY',
          },
        }),
      'DATABASE_UPGRADE_MANIFEST_DRIFT',
    );
    assert.equal(additionClient.executedSql.length, 0);
    assert.equal(additionClient.ledgerRows.length, 0);

    const pathRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
    ]);
    temporaryRoots.push(pathRoot);
    const pathClient = new FakeUpgradeClient();
    await expectCode(
      () =>
        executeRegisteredDatabaseUpgrade({
          environment: makeEnvironment(),
          adapter: adapterFor(pathClient),
          repositoryRoot: pathRoot,
          fileSystem: delegatedFileSystem({
            lstatSync(filePath, ...args) {
              if (path.basename(filePath) === '00129__first.sql')
                return { isSymbolicLink: () => true };
              return fs.lstatSync(filePath, ...args);
            },
          }),
          binding: {
            environmentCode: 'DEV_LOCAL',
            repositoryCode: 'SkyCommand',
            repositoryId: REPOSITORY_ID,
            toolCode: 'database_upgrade_apply',
            toolId: 'tool-r2',
            permissionCode: 'DB_UPGRADE_APPLY',
          },
        }),
      'DATABASE_UPGRADE_SQL_PATH_ESCAPE',
    );

    const wrongDatabaseClient = new FakeUpgradeClient({ databaseName: 'other_database' });
    const wrongDatabaseRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql' },
    ]);
    temporaryRoots.push(wrongDatabaseRoot);
    await expectCode(
      () => executeFixture(wrongDatabaseRoot, wrongDatabaseClient),
      'DATABASE_UPGRADE_CONNECTED_DATABASE_MISMATCH',
    );

    const wrongSystemClient = new FakeUpgradeClient();
    const wrongSystemRoot = makeTempSqlRoot([{ rootName: 'migrations', name: '00129__first.sql' }]);
    temporaryRoots.push(wrongSystemRoot);
    await expectCode(
      () =>
        executeFixture(wrongSystemRoot, wrongSystemClient, {
          SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '12345678901234567890',
        }),
      'DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_MISMATCH',
    );

    const duplicateRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__one.sql' },
      { rootName: 'seeds', name: '00129__two.sql' },
    ]);
    temporaryRoots.push(duplicateRoot);
    await expectCode(
      async () => discoverGovernedSqlChanges({ repositoryRoot: duplicateRoot }),
      'DATABASE_UPGRADE_DUPLICATE_ORDINAL',
    );
    const malformedRoot = makeTempSqlRoot([{ rootName: 'migrations', name: '00129-bad.sql' }]);
    temporaryRoots.push(malformedRoot);
    await expectCode(
      async () => discoverGovernedSqlChanges({ repositoryRoot: malformedRoot }),
      'DATABASE_UPGRADE_MALFORMED_SQL_FILENAME',
    );

    const failureRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
      { rootName: 'migrations', name: '00130__fails.sql', contents: 'SELECT FAIL_CHANGE;' },
      { rootName: 'migrations', name: '00131__third.sql', contents: 'SELECT 3;' },
    ]);
    temporaryRoots.push(failureRoot);
    const failureClient = new FakeUpgradeClient();
    failureClient.failOnSql = 'FAIL_CHANGE';
    const failureError = await expectCode(
      () => executeFixture(failureRoot, failureClient),
      'DATABASE_UPGRADE_CHANGE_FAILED',
    );
    assert.equal(failureClient.ledgerRows.length, 1);
    assert.equal(failureClient.ledgerRows[0].ordinal, 129);
    assert.deepEqual(
      failureError.upgradeResult.fileOutcomes.map((outcome) => outcome.status),
      ['COMMITTED', 'FAILED_ROLLED_BACK', 'PENDING_NOT_ATTEMPTED'],
    );
    failureClient.failOnSql = null;
    const retried = await executeFixture(failureRoot, failureClient);
    assert.equal(retried.outcome, 'APPLIED');
    assert.equal(failureClient.ledgerRows.length, 3);
    assert.equal(failureClient.executedSql.filter((sql) => sql === 'SELECT 1;').length, 1);
    assert.equal(
      failureClient.executedSql.filter((sql) => sql === 'SELECT FAIL_CHANGE;').length,
      2,
    );
    assert.equal(failureClient.executedSql.filter((sql) => sql === 'SELECT 3;').length, 1);

    const interruptionRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql', contents: 'SELECT 1;' },
    ]);
    temporaryRoots.push(interruptionRoot);
    const interruptionClient = new FakeUpgradeClient();
    interruptionClient.throwAfterCommit = true;
    const interruptionError = await expectCode(
      () => executeFixture(interruptionRoot, interruptionClient),
      'DATABASE_UPGRADE_COMMIT_UNCERTAIN',
    );
    assert.equal(interruptionClient.ledgerRows.length, 1);
    assert.equal(interruptionError.upgradeResult.fileOutcomes[0].status, 'COMMITTED_RECONCILED');
    const reconciledRetry = await executeFixture(interruptionRoot, interruptionClient);
    assert.equal(reconciledRetry.outcome, 'NO_CHANGES');
    assert.equal(interruptionClient.executedSql.filter((sql) => sql === 'SELECT 1;').length, 1);

    const registrationRoot = makeTempSqlRoot([
      { rootName: 'migrations', name: '00129__first.sql' },
    ]);
    temporaryRoots.push(registrationRoot);
    const registrationClient = new FakeRegistrationClient(registrationRoot);
    const binding = await verifyRegisteredDevContext({
      environment: makeEnvironment(),
      adapter: adapterFor(registrationClient),
      repositoryRoot: registrationRoot,
    });
    assert.deepEqual(binding, {
      environmentCode: 'DEV_LOCAL',
      repositoryCode: 'SkyCommand',
      repositoryId: REPOSITORY_ID,
      toolCode: 'database_upgrade_apply',
      toolId: 'tool-r2',
      permissionCode: 'DB_UPGRADE_APPLY',
    });
    assert.equal(registrationClient.released, true);
    await expectCode(
      () =>
        verifyRegisteredDevContext({
          environment: makeEnvironment({ SKYCOMMAND_CONFIG_PROFILE: 'PRODUCTION' }),
          adapter: adapterFor(registrationClient),
          repositoryRoot: registrationRoot,
        }),
      'DATABASE_UPGRADE_DEV_PROFILE_REQUIRED',
    );
    assert.deepEqual(parseCliArguments([]), {});
    await expectCode(
      async () => parseCliArguments(['--sql=SELECT 1']),
      'DATABASE_UPGRADE_ARGUMENT_NOT_ALLOWED',
    );
    await expectCode(
      async () => parseCliArguments(['anything']),
      'DATABASE_UPGRADE_ARGUMENT_NOT_ALLOWED',
    );

    const normalToolRoot = makeNormalToolRoot();
    temporaryRoots.push(normalToolRoot);
    const normalToolLogRoot = path.join(normalToolRoot, 'execution-logs');
    const previousExecutionLogRoot = process.env.SKYCOMMAND_EXECUTION_LOG_ROOT;
    process.env.SKYCOMMAND_EXECUTION_LOG_ROOT = normalToolLogRoot;
    try {
      const normalToolHarness = createNormalToolExecutionHarness(normalToolRoot);
      assert.equal(normalToolHarness.tool.allow_params, false);

      const authorizedExecution = await normalToolHarness.service.runTool({
        toolCode: 'database_upgrade_apply',
        parameters: {},
        user: { userId: 'r2-super-admin' },
        permissions: [
          { permissionCode: 'CORE_VIEW_TOOLS' },
          { permissionCode: 'DB_UPGRADE_APPLY' },
          { permissionCode: 'CORE_RUN_MEDIUM_RISK_SCRIPT' },
        ],
      });
      assert.equal(authorizedExecution.status, 'SUCCESS');
      assert.equal(normalToolHarness.executionStarted, 1);
      assert.equal(normalToolHarness.executionFinished, 1);
      assert.equal(normalToolHarness.processExecutionCount, 1);

      const unauthorizedHarness = createNormalToolExecutionHarness(normalToolRoot);
      const unauthorizedError = await expectStatusCode(
        () =>
          unauthorizedHarness.service.runTool({
            toolCode: 'database_upgrade_apply',
            parameters: {},
            user: { userId: 'r2-limited-caller' },
            permissions: [
              { permissionCode: 'CORE_VIEW_TOOLS' },
              { permissionCode: 'CORE_RUN_MEDIUM_RISK_SCRIPT' },
            ],
          }),
        403,
      );
      assert.deepEqual(unauthorizedError.details.missingPermissions, ['DB_UPGRADE_APPLY']);
      assert.equal(unauthorizedHarness.executionStarted, 0);
      assert.equal(unauthorizedHarness.processExecutionCount, 0);
      assert.equal(normalToolHarness.auditEvents.at(-1).eventType, 'TOOL_EXECUTION');
      assert.equal(unauthorizedHarness.auditEvents.at(-1).eventType, 'TOOL_EXECUTION_DENIED');

      const zeroParameterHarness = createNormalToolExecutionHarness(normalToolRoot);
      const zeroParameterError = await expectStatusCode(
        () =>
          zeroParameterHarness.service.runTool({
            toolCode: 'database_upgrade_apply',
            parameters: { targetDatabase: 'other_database' },
            user: { userId: 'r2-super-admin' },
            permissions: [
              { permissionCode: 'CORE_VIEW_TOOLS' },
              { permissionCode: 'DB_UPGRADE_APPLY' },
              { permissionCode: 'CORE_RUN_MEDIUM_RISK_SCRIPT' },
            ],
          }),
        400,
      );
      assert.match(zeroParameterError.message, /Unknown parameter\(s\): targetDatabase/);
      assert.equal(zeroParameterHarness.executionStarted, 0);
      assert.equal(zeroParameterHarness.processExecutionCount, 0);
    } finally {
      if (previousExecutionLogRoot === undefined) delete process.env.SKYCOMMAND_EXECUTION_LOG_ROOT;
      else process.env.SKYCOMMAND_EXECUTION_LOG_ROOT = previousExecutionLogRoot;
    }

    console.log('[db-upgrade-r2:self-test] PASS (19 contract scenarios)');
  } finally {
    for (const temporaryRoot of temporaryRoots.reverse()) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error('[db-upgrade-r2:self-test] FAIL', error);
  process.exitCode = 1;
});
