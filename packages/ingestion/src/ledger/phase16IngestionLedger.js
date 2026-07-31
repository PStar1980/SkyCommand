#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'migrations', '00082__generic_ingestion_ledger.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'seeds', '00083__generic_ingestion_ledger_seed.sql',
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
  const [codesResult, relationResult, guardResult, macroResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_run_status_codes WHERE active = TRUE)::int AS run_status_codes,
        (SELECT COUNT(*) FROM data.ingestion_item_outcome_codes WHERE active = TRUE)::int AS item_outcome_codes,
        (SELECT COUNT(*) FROM data.ingestion_error_categories WHERE active = TRUE)::int AS error_categories
    `),
    pool.query(`
      SELECT
        to_regclass('data.ingestion_runs') IS NOT NULL AS has_runs,
        to_regclass('data.ingestion_run_items') IS NOT NULL AS has_items,
        to_regclass('data.vw_ingestion_runs') IS NOT NULL AS has_run_view,
        to_regclass('data.vw_ingestion_run_items') IS NOT NULL AS has_item_view
    `),
    pool.query(`
      SELECT COUNT(*)::int AS guard_count
      FROM pg_trigger
      WHERE tgname IN ('ingestion_runs_validate_alignment', 'ingestion_run_items_validate_alignment')
        AND NOT tgisinternal
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS macro_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_macro_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
  ]);

  const codes = codesResult.rows[0] || {};
  const relations = relationResult.rows[0] || {};
  const guards = Number(guardResult.rows[0]?.guard_count || 0);
  const macro = macroResult.rows[0] || {};

  console.log('\nSkyCommand Phase 16.4.1 durable generic ingestion ledger');
  console.log('-------------------------------------------------------');
  console.log(`Run status codes: ${codes.run_status_codes || 0}`);
  console.log(`Item outcome codes: ${codes.item_outcome_codes || 0}`);
  console.log(`Error categories: ${codes.error_categories || 0}`);
  console.log(`Alignment guardrails: ${guards}`);
  console.log(`Macro assets preserved: ${macro.macro_assets || 0}`);
  console.log(`Active discoverable macro assets: ${macro.active_macro_assets || 0}`);

  const failures = [];
  if (!relations.has_runs || !relations.has_items || !relations.has_run_view || !relations.has_item_view) {
    failures.push('one or more ledger relations are missing');
  }
  if (Number(codes.run_status_codes || 0) < 6) failures.push('expected at least 6 run status codes');
  if (Number(codes.item_outcome_codes || 0) < 7) failures.push('expected at least 7 item outcome codes');
  if (Number(codes.error_categories || 0) < 10) failures.push('expected at least 10 error categories');
  if (guards < 2) failures.push('expected 2 deferred alignment guardrails');
  if (Number(macro.macro_assets || 0) !== 73) failures.push('expected 73 preserved macro assets');
  if (Number(macro.active_macro_assets || 0) !== 69) failures.push('expected 69 active discoverable macro assets');

  if (failures.length > 0) {
    throw new Error(`Phase 16.4.1 ledger verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Generic ingestion ledger schema, codes, guardrails, and macro compatibility baseline passed.');
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
    throw new Error('Usage: phase16IngestionLedger.js setup|verify');
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
