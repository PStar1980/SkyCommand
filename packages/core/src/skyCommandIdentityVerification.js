#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const EXPECTED_REPOSITORY_URL = 'https://github.com/PStar1980/SkyCommand.git';
const EXPECTED_DEV_PATH =
  'C:\\Users\\pauls\\Dropbox\\Programming\\SkyEco System\\SkyCommand System\\SkyCommand';

dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  return new Pool({
    host: requireEnv('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
  });
}

async function loadIdentityState(pool) {
  const [repositoriesResult, applicationsResult, referencesResult] = await Promise.all([
    pool.query(`
      SELECT
        repository.repo_id,
        repository.repo_code,
        repository.repo_name,
        repository.remote_url,
        repository.main_branch,
        repository.dev_branch,
        repository.active AS repository_active,
        repository.is_skycommand_repository,
        profile.profile_code,
        repository_path.root_path,
        repository_path.active AS path_active
      FROM core.repositories repository
      LEFT JOIN core.repository_paths repository_path
        ON repository_path.repo_id = repository.repo_id
      LEFT JOIN core.config_profiles profile
        ON profile.profile_id = repository_path.profile_id
      WHERE repository.repo_code IN ('SkyServer', 'SkyCommand')
      ORDER BY repository.repo_code, profile.profile_code
    `),
    pool.query(`
      SELECT app_code, title, description, active
      FROM core.applications
      WHERE app_code IN ('SKYSERVER_ADMIN', 'SKYSERVER_CORE', 'SKYSERVER_WORKER')
      ORDER BY app_code
    `),
    pool.query(`
      SELECT
        repository.repo_code,
        COUNT(tool.tool_id)::INTEGER AS linked_tool_count
      FROM core.repositories repository
      LEFT JOIN core.tools tool
        ON tool.script_repo_id = repository.repo_id
      WHERE repository.repo_code IN ('SkyServer', 'SkyCommand')
      GROUP BY repository.repo_code
      ORDER BY repository.repo_code
    `),
  ]);

  return {
    repositories: repositoriesResult.rows,
    applications: applicationsResult.rows,
    references: referencesResult.rows,
  };
}

function verifyIdentityState(state) {
  const failures = [];
  const canonicalRows = state.repositories.filter(
    (row) => row.repo_code === 'SkyCommand',
  );
  const legacyRows = state.repositories.filter((row) => row.repo_code === 'SkyServer');
  const canonicalRepositoryIds = new Set(canonicalRows.map((row) => row.repo_id));
  const devRow = canonicalRows.find((row) => row.profile_code === 'DEV_LOCAL');

  if (canonicalRepositoryIds.size !== 1) {
    failures.push(
      `Expected one canonical SkyCommand repository identity; found ${canonicalRepositoryIds.size}.`,
    );
  }
  if (legacyRows.length > 0) {
    failures.push('A legacy SkyServer repository row still exists.');
  }
  if (!devRow) {
    failures.push('SkyCommand has no DEV_LOCAL repository path.');
  } else {
    if (devRow.remote_url !== EXPECTED_REPOSITORY_URL) {
      failures.push(`Unexpected Git remote URL: ${devRow.remote_url || 'NULL'}.`);
    }
    if (devRow.root_path !== EXPECTED_DEV_PATH) {
      failures.push(`Unexpected DEV_LOCAL root path: ${devRow.root_path || 'NULL'}.`);
    }
    if (!devRow.repository_active || !devRow.path_active) {
      failures.push('The SkyCommand repository and DEV_LOCAL path must both be active.');
    }
    if (!devRow.is_skycommand_repository) {
      failures.push('The canonical repository is not designated as the SkyCommand repository.');
    }
  }

  const expectedTitles = new Map([
    ['SKYSERVER_ADMIN', 'SkyCommand'],
    ['SKYSERVER_CORE', 'SkyCommand Core'],
    ['SKYSERVER_WORKER', 'SkyCommand Worker'],
  ]);

  for (const [appCode, expectedTitle] of expectedTitles) {
    const row = state.applications.find((item) => item.app_code === appCode);
    if (!row) {
      failures.push(`Stable application key ${appCode} is missing.`);
      continue;
    }
    if (row.title !== expectedTitle) {
      failures.push(`${appCode} has title ${row.title || 'NULL'} instead of ${expectedTitle}.`);
    }
  }

  return failures;
}

function printIdentityState(state) {
  console.log('\nSkyCommand repository identity verification');
  console.log('-------------------------------------------');
  console.table(
    state.repositories.map((row) => ({
      repository: row.repo_code,
      profile: row.profile_code || '—',
      rootPath: row.root_path || '—',
      remote: row.remote_url || '—',
      designated: row.is_skycommand_repository,
      active: Boolean(row.repository_active && row.path_active),
    })),
  );
  console.table(
    state.applications.map((row) => ({
      appCode: row.app_code,
      title: row.title,
      active: row.active,
    })),
  );
  console.table(
    state.references.map((row) => ({
      repository: row.repo_code,
      linkedTools: row.linked_tool_count,
    })),
  );
}

async function main() {
  const pool = createPool();
  try {
    const state = await loadIdentityState(pool);
    printIdentityState(state);
    const failures = verifyIdentityState(state);

    if (failures.length > 0) {
      failures.forEach((failure) => console.error(`❌ ${failure}`));
      throw new Error('SkyCommand repository identity verification failed.');
    }

    console.log('✅ SkyCommand repository identity and compatibility boundary passed.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_DEV_PATH,
  EXPECTED_REPOSITORY_URL,
  loadIdentityState,
  verifyIdentityState,
};
