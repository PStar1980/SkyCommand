#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function fail(message) {
  console.error(`[SkyCommand Core candidate] ${message}`);
  process.exit(1);
}

const candidatePort = String(process.env.SKYCOMMAND_POSTGRES_HOST_PORT || '55432').trim();
if (!/^\d+$/.test(candidatePort)) {
  fail(`Invalid SKYCOMMAND_POSTGRES_HOST_PORT: ${candidatePort}`);
}

const env = {
  ...process.env,
  PGHOST: '127.0.0.1',
  PGPORT: candidatePort,
  SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL',
  SKYCOMMAND_CORE_CANDIDATE_DB: 'true',
  SKYCOMMAND_CORE_WORKFLOW_EXECUTOR_MODE: 'inline',
  TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
};

console.log(`[SkyCommand Core candidate] database=127.0.0.1:${candidatePort}/${env.PGDATABASE}`);
console.log('[SkyCommand Core candidate] repositoryProfile=DEV_LOCAL (host CLI uses Windows repository paths)');
console.log('[SkyCommand Core candidate] workflowExecutor=inline only until the Docker services are cut over to the candidate database.');

const result = spawnSync(process.execPath, ['packages/core/src/SkyCommand_Core.js'], {
  cwd: repositoryRoot,
  env,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  fail(`CLI could not start: ${result.error.message}`);
}
process.exit(result.status || 0);
