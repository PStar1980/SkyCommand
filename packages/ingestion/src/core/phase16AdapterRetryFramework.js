#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'migrations', '00084__source_request_retry_policies.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'seeds', '00085__source_request_retry_policies_seed.sql',
);

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

async function applySqlFile(pool, filePath) {
  await pool.query(fs.readFileSync(filePath, 'utf8'));
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, '/')}`);
}

async function verify(pool) {
  const [policyResult, profileResult, macroResult] = await Promise.all([
    pool.query(`
      SELECT
        domain.domain_code,
        source.source_code,
        policy.request_timeout_ms,
        policy.max_attempts,
        policy.base_delay_ms,
        policy.max_delay_ms,
        policy.max_elapsed_ms,
        policy.jitter_ratio,
        policy.respect_retry_after
      FROM data.source_request_policies policy
      JOIN data.sources source ON source.source_id = policy.source_id
      JOIN data.domains domain ON domain.domain_id = source.domain_id
      WHERE domain.domain_code = 'MACRO'
        AND policy.active = TRUE
      ORDER BY source.source_code
    `),
    pool.query(`
      SELECT tool.tool_code, profile.adapter_code, profile.configuration
      FROM data.ingestion_tool_profiles profile
      JOIN core.tools tool ON tool.tool_id = profile.tool_id
      WHERE tool.tool_code IN (
        'ingestion_fred',
        'ingestion_boc',
        'ingestion_statcan',
        'ingestion_manual'
      )
      ORDER BY tool.tool_code
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS macro_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_macro_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
  ]);

  const policies = policyResult.rows;
  const profiles = profileResult.rows;
  const macro = macroResult.rows[0] || {};

  console.log('\nSkyCommand Phase 16.5.1 common adapter and retry framework');
  console.log('---------------------------------------------------------');
  console.table(policies.map((row) => ({
    source: row.source_code,
    timeoutMs: row.request_timeout_ms,
    maxAttempts: row.max_attempts,
    baseDelayMs: row.base_delay_ms,
    maxDelayMs: row.max_delay_ms,
    maxElapsedMs: row.max_elapsed_ms,
  })));
  console.log(`Adapter profiles: ${profiles.length}`);
  console.log(`Macro assets preserved: ${macro.macro_assets || 0}`);
  console.log(`Active discoverable macro assets: ${macro.active_macro_assets || 0}`);

  const failures = [];
  const policySources = new Set(policies.map((row) => row.source_code));
  for (const source of ['FRED', 'BOC', 'STATCAN', 'MANUAL']) {
    if (!policySources.has(source)) failures.push(`missing request policy for ${source}`);
  }
  if (profiles.length !== 4) failures.push('expected 4 production ingestion profiles');
  for (const profile of profiles) {
    if (profile.configuration?.runner !== 'common_source_adapter') {
      failures.push(`${profile.tool_code} is not marked for the common source adapter runner`);
    }
  }
  if (Number(macro.macro_assets || 0) !== 73) failures.push('expected 73 preserved macro assets');
  if (Number(macro.active_macro_assets || 0) !== 69) failures.push('expected 69 active discoverable macro assets');

  if (failures.length > 0) {
    throw new Error(`Phase 16.5.1 verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Source request policies and common-adapter profile metadata passed.');
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();
  try {
    if (command === 'setup') {
      await applySqlFile(pool, MIGRATION_PATH);
      await applySqlFile(pool, SEED_PATH);
      await verify(pool);
      return;
    }
    if (command === 'verify' || command === 'status') {
      await verify(pool);
      return;
    }
    throw new Error('Usage: phase16AdapterRetryFramework.js setup|verify');
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
