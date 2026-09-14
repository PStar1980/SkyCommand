const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  createDatabaseHealthFailureToolResult,
  createDatabaseHealthToolResult,
  normalizeDatabaseName,
  parseDatabaseNames,
} = require('./db_health');
const { getConfiguredDatabaseIdentity } = require('./connection');
const { validateToolResult } = require('../../tools/src/toolResultContract');
const outputSchema = require('../../tools/contracts/database_health_summary.v1.schema.json');
const repositoryRoot = path.resolve(sourceDir, '../../..');
const apiServerSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/server.js'),
  'utf8',
);

function run() {
  const identity = getConfiguredDatabaseIdentity({
    PGHOST: 'postgres',
    PGPORT: '5432',
    PGUSER: 'postgres',
    PGPASSWORD: 'must-not-be-exposed',
  });
  assert.deepStrictEqual(identity, {
    configuredHost: 'postgres',
    configuredPort: 5432,
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(identity, 'PGUSER'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(identity, 'PGPASSWORD'), false);
  assert.match(apiServerSource, /const configured = getConfiguredDatabaseIdentity\(\);/);
  assert.match(apiServerSource, /\.\.\.configured/);
  assert.match(apiServerSource, /serverPort/);
  assert.doesNotMatch(apiServerSource, /password:\s*db\./i);

  const parsed = parseDatabaseNames(
    ['skycommand_dev', 'skycommand_test', '--no-fail-when-offline'],
    'ignored',
  );
  assert.deepStrictEqual(parsed.databaseNames, ['skycommand_dev', 'skycommand_test']);
  assert.strictEqual(parsed.failWhenOffline, false);
  assert.strictEqual(normalizeDatabaseName('SkyCommand_Dev'), 'SkyCommand_Dev');
  assert.throws(() => normalizeDatabaseName('bad-name'), /letters, numbers, and underscores/);

  const result = {
    checkedAt: new Date().toISOString(),
    durationMs: 25,
    failWhenOffline: false,
    allOnline: false,
    requestedCount: 2,
    onlineCount: 1,
    offlineCount: 1,
    databases: [
      {
        databaseName: 'skycommand_dev',
        online: true,
        latencyMs: 10,
        currentUser: 'postgres',
        serverAddress: '127.0.0.1',
        serverPort: 5432,
        serverVersion: '17.0',
        checkedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      },
      {
        databaseName: 'skycommand_test',
        online: false,
        latencyMs: 15,
        currentUser: null,
        serverAddress: null,
        serverPort: null,
        serverVersion: null,
        checkedAt: new Date().toISOString(),
        errorCode: '3D000',
        errorMessage: 'database does not exist',
      },
    ],
  };

  const validated = validateToolResult(createDatabaseHealthToolResult(result), {
    expectedOutputType: 'database_health_summary.v1',
    outputSchema,
  });
  assert.strictEqual(validated.success, true);
  assert.strictEqual(validated.output.allOnline, false);
  assert.strictEqual(validated.warnings.length, 1);

  const failure = validateToolResult(
    createDatabaseHealthFailureToolResult(
      Object.assign(new Error('Missing database configuration.'), {
        code: 'DATABASE_ENVIRONMENT_MISSING',
      }),
    ),
    {
      expectedOutputType: 'database_health_summary.v1',
      outputSchema,
    },
  );
  assert.strictEqual(failure.success, false);
  assert.strictEqual(failure.output.requestedCount, 0);

  console.log('Database health structured-result self-test passed.');
}

run();
