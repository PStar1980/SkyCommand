#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(sourceDir, '..', '..');
const source = fs.readFileSync(
  path.join(repositoryRoot, 'scripts/docker/postgresCutoverCheck.js'),
  'utf8',
);
const { validateRuntimeHealth } = require(
  path.join(repositoryRoot, 'scripts/docker/postgresCutoverCheck'),
);

const healthyEvidence = {
  apiHealth: { ok: true },
  dbHealth: {
    ok: true,
    database: 'skyserver_dev',
    configuredHost: 'postgres',
    configuredPort: 5432,
    version: '18.6',
  },
  database: { database: 'skyserver_dev', version: '18.6' },
  runtimeHost: 'postgres',
  runtimePort: 5432,
  temporalReachable: true,
};

assert.doesNotThrow(() => validateRuntimeHealth(healthyEvidence));
assert.doesNotThrow(() =>
  validateRuntimeHealth({
    ...healthyEvidence,
    dbHealth: { ok: true, database: 'skyserver_dev', version: '18.6' },
  }),
);
assert.throws(
  () =>
    validateRuntimeHealth({
      ...healthyEvidence,
      dbHealth: { ...healthyEvidence.dbHealth, configuredHost: 'host.docker.internal' },
    }),
  (error) =>
    error.message ===
    '[SkyCommand PostgreSQL cutover] Docker API database health reports a different configured PostgreSQL route.',
);
assert.match(source, /Promise\.allSettled/);
assert.match(source, /pool\.end\(\)\.catch/);
assert.match(source, /process\.exitCode = 1/);
assert.match(source, /socket\.removeAllListeners/);

console.log('[SkyCommand] PostgreSQL cutover-check cleanup and failure self-test passed.');
