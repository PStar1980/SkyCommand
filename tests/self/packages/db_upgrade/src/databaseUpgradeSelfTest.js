const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);
const root = path.resolve(sourceDir, '../../..');

const {
  BASELINE_CONTRACT,
  BASELINE_ORDINAL,
  acquireUpgradeLock,
  applyChange,
  buildPlan,
  discoverGovernedSqlChanges,
  executeApprovedDatabaseUpgrade,
  executeDatabaseUpgrade,
  parseGovernedFilename,
  readDatabaseIdentity,
  sha256,
} = require('./databaseUpgradeEngine');
const { parseCliArguments } = require(path.join(root, 'packages/db_upgrade/src/db_upgrade.js'));
const {
  DATABASE_UPGRADE_OUTPUT_TYPE,
  createDatabaseUpgradeToolResult,
} = require('./databaseUpgradeResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');
const outputSchema = require('../../tools/contracts/database_upgrade_summary.v1.schema.json');

const validEnvironment = {
  PGHOST: '127.0.0.1',
  PGPORT: '5432',
  PGDATABASE: 'skyserver_dev',
  PGUSER: 'postgres',
  PGPASSWORD: 'must-not-appear-in-output',
  SKYCOMMAND_DB_UPGRADE_SOURCE_REVISION: 'test-revision',
};
const validSystemIdentifier = '9223372036854775807';

class FakeClient {
  constructor({
    ledgerAvailable = false,
    baselineRows = [],
    ledgerRows = [],
    tables = null,
    lockAcquired = true,
    systemIdentifier = validSystemIdentifier,
  } = {}) {
    this.queries = [];
    this.mutations = [];
    this.ledgerAvailable = ledgerAvailable;
    this.baselineRows = baselineRows;
    this.ledgerRows = ledgerRows;
    this.tables = tables || {
      repositories: 'core.repositories',
      workflow_run_records: 'worker.workflow_run_records',
      browser_automations: 'core.browser_automations',
    };
    this.lockAcquired = lockAcquired;
    this.systemIdentifier = systemIdentifier;
    this.insertedBaselineParams = null;
    this.released = false;
  }

  async query(text, params = []) {
    const sql = String(text);
    this.queries.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) {
      this.mutations.push(sql.trim());
      return { rows: [] };
    }
    if (/^SELECT pg_try_advisory_lock/i.test(sql.trim())) {
      return { rows: [{ acquired: this.lockAcquired }] };
    }
    if (/^SELECT pg_advisory_unlock/i.test(sql.trim())) {
      return { rows: [{ released: true }] };
    }
    if (sql.includes('current_database()')) {
      return {
        rows: [{
          database_name: 'skyserver_dev',
          server_version: '16.4',
          server_port: 5432,
          system_identifier: this.systemIdentifier,
        }],
      };
    }
    if (sql.includes('information_schema.schemata')) {
      return { rows: [{ schema_name: 'core' }, { schema_name: 'auth' }, { schema_name: 'worker' }] };
    }
    if (sql.includes('FROM pg_constraint')) {
      return {
        rows: [
          { conname: 'run_source_check', definition: "CHECK (run_source IN ('manual', 'assistant'))" },
          { conname: 'trigger_type_check', definition: "CHECK (trigger_type IN ('MANUAL', 'ASSISTANT'))" },
        ],
      };
    }
    if (sql.includes("to_regclass('core.database_upgrade_baselines')")) {
      return {
        rows: [
          {
            baseline_table: this.ledgerAvailable ? 'core.database_upgrade_baselines' : null,
            ledger_table: this.ledgerAvailable ? 'core.database_upgrade_ledger' : null,
          },
        ],
      };
    }
    if (sql.includes('to_regclass(\'core.repositories\')')) {
      return { rows: [this.tables] };
    }
    if (sql.includes('FROM core.database_upgrade_baselines')) return { rows: this.baselineRows };
    if (sql.includes('FROM core.database_upgrade_ledger')) return { rows: this.ledgerRows };
    if (/^INSERT INTO core\.database_upgrade_baselines/i.test(sql.trim())) {
      this.mutations.push('INSERT_BASELINE');
      this.insertedBaselineParams = params;
      return { rows: [{ baseline_id: 'baseline-created-by-test' }] };
    }
    if (/^INSERT INTO core\.database_upgrade_ledger/i.test(sql.trim())) {
      this.mutations.push('INSERT_LEDGER');
      return { rows: [] };
    }
    this.mutations.push(sql.trim());
    return { rows: [] };
  }

  release() {
    this.released = true;
  }
}

function adapterFor(client) {
  return { connect: async () => client };
}

function verifiedTables() {
  return {
    repositories: 'core.repositories',
    workflow_run_records: 'worker.workflow_run_records',
    browser_automations: 'core.browser_automations',
  };
}

async function expectRejected(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function makeTempSqlRoot(files) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-db-upgrade-'));
  fs.mkdirSync(path.join(temporaryRoot, 'packages', 'db_build', 'src', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, 'packages', 'db_build', 'src', 'seeds'), { recursive: true });
  files.forEach(({ rootName, name, contents = 'SELECT 1;' }) => {
    fs.writeFileSync(
      path.join(temporaryRoot, 'packages', 'db_build', 'src', rootName, name),
      contents,
    );
  });
  return temporaryRoot;
}

async function run() {
  const sourceChanges = discoverGovernedSqlChanges();
  const postBaselineChanges = sourceChanges.filter((change) => change.ordinal > BASELINE_ORDINAL);
  const latestPostBaselineOrdinal = postBaselineChanges.at(-1)?.ordinal;
  assert.ok(
    Number.isInteger(latestPostBaselineOrdinal) && latestPostBaselineOrdinal > BASELINE_ORDINAL,
    'the source-controlled manifest must contain post-baseline changes',
  );
  assert.equal(
    postBaselineChanges.length,
    latestPostBaselineOrdinal - BASELINE_ORDINAL,
    'post-baseline ordinals must remain contiguous through the current source-controlled change',
  );

  const approvedContinuationClient = new FakeClient({ ledgerAvailable: true });
  const approvedContinuationPlan = await executeDatabaseUpgrade({
    mode: 'PLAN',
    environment: {
      ...validEnvironment,
      SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
      SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: validSystemIdentifier,
    },
    adapter: adapterFor(approvedContinuationClient),
  });
  const approvedContinuation = await executeApprovedDatabaseUpgrade({
    approvedRequest: {
      requestId: 'approved-request-1',
      status: 'APPROVED',
      planDigest: approvedContinuationPlan.planDigest.digest,
      requestDigest: 'A'.repeat(64),
      humanDecisionUserId: '00000000-0000-0000-0000-000000000001',
      humanDecisionAt: new Date().toISOString(),
    },
    environment: {
      ...validEnvironment,
      SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
      SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: validSystemIdentifier,
    },
    adapter: adapterFor(approvedContinuationClient),
  });
  assert.equal(approvedContinuation.outcome, 'APPLIED');
  assert.equal(approvedContinuation.appliedCount, postBaselineChanges.length);
  assert.equal(approvedContinuationClient.mutations.includes('BEGIN'), true);

  assert.ok(sourceChanges.some((change) => change.ordinal === 129));
  assert.ok(sourceChanges.some((change) => change.ordinal === 130));
  assert.ok(sourceChanges.some((change) => change.relativePath.endsWith('00128__assistant_workflow_run_attribution.sql')));
  assert.ok(sourceChanges.every((change) => change.ordinal > BASELINE_ORDINAL || change.separator === '__' || change.separator === '_'));
  assert.equal(parseGovernedFilename('00007_indicator_views.sql').separator, '_');
  assert.throws(() => parseGovernedFilename('not-a-governed-file.sql'), /malformed/i);
  assert.throws(() => parseGovernedFilename('00130_new_style.sql'), /double-underscore/i);
  assert.throws(() => parseGovernedFilename('00002_unregistered_legacy.sql'), /double-underscore/i);
  const identityClient = new FakeClient({ systemIdentifier: validSystemIdentifier });
  const identity = await readDatabaseIdentity(identityClient);
  assert.equal(identity.systemIdentifier, validSystemIdentifier);
  assert.equal(typeof identity.systemIdentifier, 'string');
  assert.match(identityClient.queries[0].sql, /pg_control_system\(\)/);
  assert.deepEqual(parseCliArguments(['plan']), {
    mode: 'PLAN',
    expectedPlanDigest: null,
    confirmed: false,
  });
  assert.deepEqual(parseCliArguments(['apply', '--confirm', '--expected-plan-digest', 'A'.repeat(64)]), {
    mode: 'APPLY',
    expectedPlanDigest: 'A'.repeat(64),
    confirmed: true,
  });
  assert.throws(() => parseCliArguments(['plan', '--sql=SELECT%201']), /Unsupported|not allowed/i);
  assert.throws(() => parseCliArguments(['apply', '--database=skyserver_dev']), /Unsupported|not allowed/i);

  const duplicateRoot = makeTempSqlRoot([
    { rootName: 'migrations', name: '00130__one.sql' },
    { rootName: 'seeds', name: '00130__two.sql' },
  ]);
  try {
    assert.throws(
      () => discoverGovernedSqlChanges({ repositoryRoot: duplicateRoot }),
      /Duplicate global SQL ordinal 00130/,
    );
  } finally {
    fs.rmSync(duplicateRoot, { recursive: true, force: true });
  }

  const malformedRoot = makeTempSqlRoot([{ rootName: 'migrations', name: '00130-bad.sql' }]);
  try {
    assert.throws(
      () => discoverGovernedSqlChanges({ repositoryRoot: malformedRoot }),
      /malformed/i,
    );
  } finally {
    fs.rmSync(malformedRoot, { recursive: true, force: true });
  }

  const planChanges = [
    { ordinal: 131, kind: 'SEED', relativePath: 'packages/db_build/src/seeds/00131__seed.sql', sha256: 'B'.repeat(64) },
    { ordinal: 130, kind: 'MIGRATION', relativePath: 'packages/db_build/src/migrations/00130__migration.sql', sha256: 'A'.repeat(64) },
  ];
  const planInput = {
    identity: {
      databaseName: 'skyserver_dev',
      serverPort: 5432,
      serverVersion: '16.4',
      systemIdentifier: validSystemIdentifier,
    },
    baseline: { status: 'VERIFIED' },
    ledgerState: { ledgerRows: [], baseline: null },
    changes: planChanges,
    sourceRevision: 'revision-a',
  };
  const orderedPlan = buildPlan(planInput);
  assert.deepEqual(orderedPlan.pending.map((change) => change.ordinal), [130, 131]);
  const changedDigest = buildPlan({ ...planInput, changes: planChanges.map((change) => ({ ...change, sha256: change.sha256 === 'A'.repeat(64) ? 'C'.repeat(64) : change.sha256 })) }).digest;
  assert.notEqual(orderedPlan.digest, changedDigest, 'plan digest binds pending checksums');
  const changedSetDigest = buildPlan({ ...planInput, changes: planChanges.slice(0, 1) }).digest;
  assert.notEqual(orderedPlan.digest, changedSetDigest, 'plan digest binds pending set');
  const changedSystemIdentifierDigest = buildPlan({
    ...planInput,
    identity: { ...planInput.identity, systemIdentifier: '12345678901234567890' },
  }).digest;
  assert.notEqual(
    orderedPlan.digest,
    changedSystemIdentifierDigest,
    'plan digest binds physical PostgreSQL cluster identity',
  );

  const planClient = new FakeClient();
  const planOutput = await executeDatabaseUpgrade({
    mode: 'PLAN',
    environment: validEnvironment,
    adapter: adapterFor(planClient),
  });
  assert.equal(planOutput.outcome, 'PLAN_READY');
  assert.equal(planOutput.pendingChanges[0].ordinal, 129);
  assert.equal(planOutput.baseline.recorded, false);
  assert.equal(planOutput.databaseIdentity.systemIdentifier, validSystemIdentifier);
  assert.equal(typeof planOutput.databaseIdentity.systemIdentifier, 'string');
  assert.equal(planClient.mutations.length, 0, 'PLAN performs no DDL/DML or transaction control');
  assert.equal(planClient.released, true);

  const cleanBuildLedgerPlan = await executeDatabaseUpgrade({
    mode: 'PLAN',
    environment: validEnvironment,
    adapter: adapterFor(new FakeClient({ ledgerAvailable: true })),
  });
  assert.equal(cleanBuildLedgerPlan.ledger.verification, 'NOT_INITIALIZED');
  assert.equal(cleanBuildLedgerPlan.pendingChanges[0].ordinal, 129);

  const validatedPlan = validateToolResult(createDatabaseUpgradeToolResult(planOutput), {
    expectedOutputType: DATABASE_UPGRADE_OUTPUT_TYPE,
    outputSchema,
  });
  const serializedPlan = JSON.stringify(validatedPlan);
  assert.doesNotMatch(serializedPlan, /must-not-appear-in-output/);
  assert.doesNotMatch(serializedPlan, /[A-Za-z]:\\/);
  assert.doesNotMatch(serializedPlan, /absolutePath|sqlText|connectionString|password/i);

  const disabledClient = new FakeClient();
  await expectRejected(
    executeDatabaseUpgrade({
      mode: 'APPLY',
      environment: validEnvironment,
      adapter: adapterFor(disabledClient),
      confirmed: true,
      expectedPlanDigest: '0'.repeat(64),
    }),
    'DATABASE_UPGRADE_DISABLED',
  );
  assert.equal(disabledClient.mutations.length, 0, 'APPLY remains disabled by default');

  const wrongTargetClient = new FakeClient();
  await expectRejected(
    executeDatabaseUpgrade({
      mode: 'APPLY',
      environment: { ...validEnvironment, SKYCOMMAND_DB_UPGRADE_ENABLED: 'true', SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'other_database' },
      adapter: adapterFor(wrongTargetClient),
      confirmed: true,
      expectedPlanDigest: '0'.repeat(64),
    }),
    'DATABASE_UPGRADE_TARGET_MISMATCH',
  );
  assert.equal(wrongTargetClient.mutations.length, 0);

  const blankSystemIdentifierClient = new FakeClient();
  await expectRejected(
    executeDatabaseUpgrade({
      mode: 'APPLY',
      environment: {
        ...validEnvironment,
        SKYCOMMAND_DB_UPGRADE_ENABLED: 'true',
        SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
        SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '',
      },
      adapter: adapterFor(blankSystemIdentifierClient),
      confirmed: true,
      expectedPlanDigest: '0'.repeat(64),
    }),
    'DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED',
  );
  assert.equal(blankSystemIdentifierClient.mutations.length, 0);

  const wrongSystemIdentifierClient = new FakeClient();
  await expectRejected(
    executeDatabaseUpgrade({
      mode: 'APPLY',
      environment: {
        ...validEnvironment,
        SKYCOMMAND_DB_UPGRADE_ENABLED: 'true',
        SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
        SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '12345678901234567890',
      },
      adapter: adapterFor(wrongSystemIdentifierClient),
      confirmed: true,
      expectedPlanDigest: '0'.repeat(64),
    }),
    'DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_MISMATCH',
  );
  assert.equal(wrongSystemIdentifierClient.mutations.length, 0);

  const missingEvidenceClient = new FakeClient({ tables: { ...verifiedTables(), workflow_run_records: null } });
  await expectRejected(
    executeDatabaseUpgrade({ mode: 'PLAN', environment: validEnvironment, adapter: adapterFor(missingEvidenceClient) }),
    'DATABASE_UPGRADE_BASELINE_EVIDENCE_MISSING',
  );

  const expectedMismatchClient = new FakeClient();
  await expectRejected(
    executeDatabaseUpgrade({
      mode: 'APPLY',
      environment: {
        ...validEnvironment,
        SKYCOMMAND_DB_UPGRADE_ENABLED: 'true',
        SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
        SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: validSystemIdentifier,
      },
      adapter: adapterFor(expectedMismatchClient),
      confirmed: true,
      expectedPlanDigest: '0'.repeat(64),
    }),
    'DATABASE_UPGRADE_PLAN_DIGEST_MISMATCH',
  );
  assert.equal(expectedMismatchClient.mutations.length, 0);

  const applyClient = new FakeClient({ ledgerAvailable: true });
  const applyOutput = await executeDatabaseUpgrade({
    mode: 'APPLY',
    environment: {
      ...validEnvironment,
      SKYCOMMAND_DB_UPGRADE_ENABLED: 'true',
      SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
      SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: validSystemIdentifier,
    },
    adapter: adapterFor(applyClient),
    confirmed: true,
    expectedPlanDigest: cleanBuildLedgerPlan.planDigest.digest,
  });
  assert.equal(applyOutput.outcome, 'APPLIED');
  assert.equal(applyOutput.appliedCount, postBaselineChanges.length);
  assert.equal(applyOutput.lock.acquired, true);
  assert.equal(applyOutput.lock.released, true);
  assert.ok(applyClient.mutations.includes('INSERT_BASELINE'));
  assert.ok(applyClient.mutations.includes('INSERT_LEDGER'));
  assert.equal(
    JSON.parse(applyClient.insertedBaselineParams[5]).systemIdentifier,
    validSystemIdentifier,
    'new baseline evidence preserves the verified cluster identity',
  );

  const firstChange = sourceChanges.find((change) => change.ordinal === 129);
  const ledgerClient = new FakeClient({
    ledgerAvailable: true,
    baselineRows: [{
      baseline_id: 'baseline-1',
      baseline_contract: BASELINE_CONTRACT,
      baseline_ordinal: BASELINE_ORDINAL,
      database_name: 'skyserver_dev',
      evidence: { systemIdentifier: validSystemIdentifier },
    }],
    ledgerRows: [{
      baseline_id: 'baseline-1',
      ordinal: 129,
      change_kind: firstChange.kind,
      source_path: firstChange.relativePath,
      sha256: 'F'.repeat(64),
    }],
  });
  await expectRejected(
    require('./databaseUpgradeEngine').readLedgerState(
      ledgerClient,
      { databaseName: 'skyserver_dev', systemIdentifier: validSystemIdentifier },
      sourceChanges,
    ),
    'DATABASE_UPGRADE_CHECKSUM_DRIFT',
  );

  const baselineDriftClient = new FakeClient({
    ledgerAvailable: true,
    baselineRows: [{
      baseline_id: 'baseline-1',
      baseline_contract: BASELINE_CONTRACT,
      baseline_ordinal: BASELINE_ORDINAL,
      database_name: 'skyserver_dev',
      evidence: { systemIdentifier: '12345678901234567890' },
    }],
  });
  await expectRejected(
    require('./databaseUpgradeEngine').readLedgerState(
      baselineDriftClient,
      { databaseName: 'skyserver_dev', systemIdentifier: validSystemIdentifier },
      sourceChanges,
    ),
    'DATABASE_UPGRADE_BASELINE_DATABASE_IDENTITY_DRIFT',
  );

  const lockClient = new FakeClient({ lockAcquired: false });
  await expectRejected(acquireUpgradeLock(lockClient), 'DATABASE_UPGRADE_LOCK_NOT_ACQUIRED');

  const failedChangeClient = new FakeClient();
  const failedQuery = failedChangeClient.query.bind(failedChangeClient);
  failedChangeClient.query = async (sql, params) => {
    if (String(sql).includes('FAIL_CHANGE')) throw new Error('simulated SQL failure');
    return failedQuery(sql, params);
  };
  await expectRejected(
    applyChange(
      failedChangeClient,
      { ordinal: 130, kind: 'MIGRATION', relativePath: 'packages/db_build/src/migrations/00130__fail.sql', sql: 'SELECT FAIL_CHANGE;', sha256: 'A'.repeat(64) },
      { baselineId: 'baseline-1', identity: { databaseName: 'skyserver_dev', serverVersion: '16.4', systemIdentifier: validSystemIdentifier }, sourceRevision: null, probes: [], planDigest: 'A'.repeat(64) },
    ),
    'DATABASE_UPGRADE_CHANGE_FAILED',
  );
  assert.ok(failedChangeClient.mutations.includes('ROLLBACK'));
  assert.equal(failedChangeClient.mutations.includes('INSERT_LEDGER'), false, 'failed SQL has no successful receipt');

  const atomicClient = new FakeClient();
  await applyChange(
    atomicClient,
    { ordinal: 130, kind: 'MIGRATION', relativePath: 'packages/db_build/src/migrations/00130__ok.sql', sql: 'SELECT 1;', sha256: 'A'.repeat(64) },
    { baselineId: 'baseline-1', identity: { databaseName: 'skyserver_dev', serverVersion: '16.4', systemIdentifier: validSystemIdentifier }, sourceRevision: null, probes: [], planDigest: 'A'.repeat(64) },
  );
  assert.deepEqual(atomicClient.mutations.slice(0, 3), ['BEGIN', 'SELECT 1;', 'INSERT_LEDGER']);
  assert.equal(atomicClient.mutations.at(-1), 'COMMIT');

  const doBlockClient = new FakeClient();
  await applyChange(
    doBlockClient,
    {
      ordinal: 130,
      kind: 'MIGRATION',
      relativePath: 'packages/db_build/src/migrations/00130__do_block_validation.sql',
      sql: 'DO $$ BEGIN IF TRUE THEN NULL; END IF; END $$;',
      sha256: 'A'.repeat(64),
    },
    { baselineId: 'baseline-1', identity: { databaseName: 'skyserver_dev', serverVersion: '16.4', systemIdentifier: validSystemIdentifier }, sourceRevision: null, probes: [], planDigest: 'A'.repeat(64) },
  );
  assert.equal(doBlockClient.mutations[1], 'DO $$ BEGIN IF TRUE THEN NULL; END IF; END $$;');

  const buildSource = fs.readFileSync(path.join(root, 'packages/db_build/src/db_build.js'), 'utf8');
  const ledgerMigration = fs.readFileSync(
    path.join(root, 'packages/db_build/src/migrations/00129__database_upgrade_ledger.sql'),
    'utf8',
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(buildSource, /DROP DATABASE IF EXISTS/);
  assert.match(buildSource, /function dropAndCreateDatabase/);
  assert.equal(packageJson.scripts['db:build'], 'node packages/db_build/src/db_build.js');
  assert.doesNotMatch(ledgerMigration.replace(/--.*$/gm, ''), /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.match(ledgerMigration, /core\.database_upgrade_baselines/);
  assert.match(ledgerMigration, /core\.database_upgrade_ledger/);
  assert.equal(sha256(fs.readFileSync(firstChange.absolutePath)), firstChange.sha256);

  console.log('[db-upgrade:self-test] PASS');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
