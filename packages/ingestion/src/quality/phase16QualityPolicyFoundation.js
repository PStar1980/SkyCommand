#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'migrations', '00088__portable_quality_policies.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'seeds', '00089__portable_quality_policies_seed.sql',
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
  const [relationResult, defaultResult, productionResult, macroResult] = await Promise.all([
    pool.query(`
      SELECT
        to_regclass('data.source_quality_policies') IS NOT NULL AS source_policies,
        to_regclass('data.asset_quality_policies') IS NOT NULL AS asset_policies,
        to_regclass('data.vw_asset_quality_policies') IS NOT NULL AS resolved_view
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE enabled_default = TRUE)::int AS enabled_defaults,
        COUNT(*) FILTER (WHERE enabled_default = FALSE)::int AS disabled_defaults
      FROM data.ingestion_quality_check_codes
      WHERE active = TRUE
    `),
    pool.query(`
      SELECT
        source.source_code,
        COUNT(*)::int AS policy_count,
        COUNT(*) FILTER (WHERE policy.enabled = TRUE)::int AS enabled_count
      FROM data.source_quality_policies policy
      JOIN data.sources source ON source.source_id = policy.source_id
      JOIN data.domains domain ON domain.domain_id = source.domain_id
      WHERE domain.domain_code = 'MACRO'
        AND source.source_code IN ('FRED', 'BOC', 'STATCAN')
        AND policy.active = TRUE
      GROUP BY source.source_code
      ORDER BY source.source_code
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS macro_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_macro_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
  ]);

  const relations = relationResult.rows[0] || {};
  const defaults = defaultResult.rows[0] || {};
  const production = productionResult.rows;
  const macro = macroResult.rows[0] || {};

  console.log('\nSkyCommand Phase 16.6.2 portable quality-policy foundation');
  console.log('----------------------------------------------------------');
  console.table(production.map((row) => ({
    source: row.source_code,
    policies: Number(row.policy_count),
    enabled: Number(row.enabled_count),
  })));
  console.log(`Enabled check defaults: ${defaults.enabled_defaults || 0}`);
  console.log(`Disabled check defaults: ${defaults.disabled_defaults || 0}`);
  console.log(`Macro assets preserved: ${macro.macro_assets || 0}`);
  console.log(`Active discoverable macro assets: ${macro.active_macro_assets || 0}`);

  const failures = [];
  if (!relations.source_policies || !relations.asset_policies || !relations.resolved_view) {
    failures.push('one or more quality-policy relations are missing');
  }
  if (Number(defaults.enabled_defaults || 0) < 7) failures.push('expected core quality checks enabled by default');
  if (Number(defaults.disabled_defaults || 0) < 4) failures.push('expected advanced checks disabled until configured');
  if (production.length !== 3 || production.some((row) => Number(row.policy_count) < 2)) {
    failures.push('FRED, BOC, and STATCAN require seeded source quality policies');
  }
  if (Number(macro.macro_assets || 0) !== 73) failures.push('expected 73 preserved macro assets');
  if (Number(macro.active_macro_assets || 0) !== 69) failures.push('expected 69 active macro assets');

  if (failures.length > 0) {
    throw new Error(`Phase 16.6.2 verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Source/asset policy precedence, defaults, and production quality-policy seeds passed.');
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
    throw new Error('Usage: phase16QualityPolicyFoundation.js setup|verify');
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

module.exports = { createPool, verify };
