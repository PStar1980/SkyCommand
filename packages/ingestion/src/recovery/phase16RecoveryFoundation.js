#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'migrations', '00090__ingestion_recovery_foundation.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'seeds', '00091__ingestion_recovery_foundation_seed.sql',
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
  const [statusResult, relationResult, triggerResult, macroResult, profileResult] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS status_count
      FROM data.ingestion_recovery_status_codes
      WHERE active = TRUE
    `),
    pool.query(`
      SELECT
        to_regclass('data.ingestion_recovery_requests') IS NOT NULL AS requests,
        to_regclass('data.vw_ingestion_recovery_requests') IS NOT NULL AS request_view
    `),
    pool.query(`
      SELECT COUNT(*)::int AS trigger_count
      FROM pg_trigger
      WHERE tgname IN (
        'ingestion_recovery_request_validate_alignment',
        'ingestion_run_validate_recovery_request'
      )
        AND NOT tgisinternal
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS macro_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_macro_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS profiles,
        COUNT(*) FILTER (WHERE supports_resume = TRUE)::int AS resume_enabled
      FROM data.vw_ingestion_tools
      WHERE discoverable = TRUE
    `),
  ]);

  const statuses = Number(statusResult.rows[0]?.status_count || 0);
  const relations = relationResult.rows[0] || {};
  const triggers = Number(triggerResult.rows[0]?.trigger_count || 0);
  const macro = macroResult.rows[0] || {};
  const profiles = profileResult.rows[0] || {};

  console.log('\nSkyCommand Phase 16.7.1 resumable recovery foundation');
  console.log('-----------------------------------------------------');
  console.log(`Recovery status codes: ${statuses}`);
  console.log(`Recovery alignment guardrails: ${triggers}`);
  console.log(`Discoverable ingestion profiles: ${profiles.profiles || 0}`);
  console.log(`Production profiles currently resume-enabled: ${profiles.resume_enabled || 0}`);
  console.log(`Macro assets preserved: ${macro.macro_assets || 0}`);
  console.log(`Active discoverable macro assets: ${macro.active_macro_assets || 0}`);

  const failures = [];
  if (statuses !== 5) failures.push('expected 5 recovery status codes');
  if (!relations.requests || !relations.request_view) failures.push('recovery request table/view missing');
  if (triggers !== 2) failures.push('expected 2 deferred recovery alignment guardrails');
  if (Number(macro.macro_assets || 0) !== 73) failures.push('expected 73 preserved macro assets');
  if (Number(macro.active_macro_assets || 0) !== 69) failures.push('expected 69 active macro assets');

  if (failures.length > 0) {
    throw new Error(`Phase 16.7.1 verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Durable recovery intent, lineage, status codes, and alignment guardrails passed.');
  console.log('ℹ️ Production profiles remain disabled for resume until the live tool/API integration checkpoint.');
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
    throw new Error('Usage: phase16RecoveryFoundation.js setup|verify');
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
