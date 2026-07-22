const assert = require('node:assert/strict');
const {
  DATABASE_BUILD_OUTPUT_TYPE,
  createDatabaseBuildFailureToolResult,
  createDatabaseBuildToolResult,
  normalizeDatabaseBuildOutput,
} = require('./databaseBuildResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');
const outputSchema = require('../../tools/contracts/database_build_summary.v1.schema.json');

function buildFixture(overrides = {}) {
  return {
    startedAt: '2026-07-22T05:00:00.000Z',
    completedAt: '2026-07-22T05:00:02.500Z',
    durationMs: 2500,
    targetDatabase: 'skyserver_test',
    status: 'BUILT',
    phase: 'COMPLETE',
    buildCompleted: true,
    databaseDropped: true,
    databaseCreated: true,
    sqlRoots: ['packages/db_build/src/migrations', 'packages/db_build/src/seeds'],
    sqlFilesDiscovered: 2,
    sqlFilesExecuted: 2,
    migrationFilesDiscovered: 1,
    migrationFilesExecuted: 1,
    seedFilesDiscovered: 1,
    seedFilesExecuted: 1,
    firstSqlFile: 'packages/db_build/src/migrations/00001__core.sql',
    lastSqlFile: 'packages/db_build/src/seeds/00002__core_seed.sql',
    lastCompletedSqlFile: 'packages/db_build/src/seeds/00002__core_seed.sql',
    failedSqlFile: null,
    files: [
      {
        relativePath: 'packages/db_build/src/migrations/00001__core.sql',
        kind: 'MIGRATION',
        ordinal: 1,
        status: 'COMPLETED',
        durationMs: 1200,
      },
      {
        relativePath: 'packages/db_build/src/seeds/00002__core_seed.sql',
        kind: 'SEED',
        ordinal: 2,
        status: 'COMPLETED',
        durationMs: 1300,
      },
    ],
    ...overrides,
  };
}

function run() {
  const success = validateToolResult(createDatabaseBuildToolResult(buildFixture()), {
    expectedOutputType: DATABASE_BUILD_OUTPUT_TYPE,
    outputSchema,
  });

  assert.equal(success.success, true);
  assert.equal(success.output.buildCompleted, true);
  assert.equal(success.output.sqlFilesExecuted, 2);
  assert.equal(success.output.status, 'BUILT');

  const failureState = buildFixture({
    status: 'FAILED',
    phase: 'APPLY_SQL',
    buildCompleted: false,
    sqlFilesExecuted: 1,
    migrationFilesExecuted: 1,
    seedFilesExecuted: 0,
    lastCompletedSqlFile: 'packages/db_build/src/migrations/00001__core.sql',
    failedSqlFile: 'packages/db_build/src/seeds/00002__core_seed.sql',
    files: [
      {
        relativePath: 'packages/db_build/src/migrations/00001__core.sql',
        kind: 'MIGRATION',
        ordinal: 1,
        status: 'COMPLETED',
        durationMs: 1200,
      },
      {
        relativePath: 'packages/db_build/src/seeds/00002__core_seed.sql',
        kind: 'SEED',
        ordinal: 2,
        status: 'FAILED',
        durationMs: 400,
      },
    ],
  });
  const error = Object.assign(new Error('Failed while applying the seed file.'), {
    code: 'DATABASE_SQL_FILE_FAILED',
    buildResult: failureState,
  });
  const failure = validateToolResult(createDatabaseBuildFailureToolResult(error), {
    expectedOutputType: DATABASE_BUILD_OUTPUT_TYPE,
    outputSchema,
  });

  assert.equal(failure.success, false);
  assert.equal(failure.output.buildCompleted, false);
  assert.equal(failure.output.failedSqlFile, failureState.failedSqlFile);
  assert.equal(failure.error.details.phase, 'APPLY_SQL');

  const normalized = normalizeDatabaseBuildOutput({
    targetDatabase: 'skyserver_dev',
    files: [],
  });
  assert.equal(normalized.status, 'FAILED');
  assert.equal(normalized.sqlFilesDiscovered, 0);

  console.log('Database build structured-result self-test passed.');
}

run();
