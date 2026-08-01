#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'migrations', '00086__revision_quality_foundation.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages', 'db_build', 'src', 'seeds', '00087__revision_quality_foundation_seed.sql',
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
  const [codeResult, relationResult, columnResult, guardResult, profileResult, macroResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM data.ingestion_quality_status_codes WHERE active = TRUE)::int AS statuses,
        (SELECT COUNT(*) FROM data.ingestion_quality_severity_codes WHERE active = TRUE)::int AS severities,
        (SELECT COUNT(*) FROM data.ingestion_quality_check_codes WHERE active = TRUE)::int AS checks
    `),
    pool.query(`
      SELECT
        to_regclass('data.ingestion_revision_events') IS NOT NULL AS revisions,
        to_regclass('data.ingestion_quality_events') IS NOT NULL AS quality_events,
        to_regclass('data.ingestion_rejection_events') IS NOT NULL AS rejections,
        to_regclass('data.vw_ingestion_revision_events') IS NOT NULL AS revision_view,
        to_regclass('data.vw_ingestion_quality_events') IS NOT NULL AS quality_view,
        to_regclass('data.vw_ingestion_rejection_events') IS NOT NULL AS rejection_view
    `),
    pool.query(`
      SELECT COUNT(*)::int AS column_count
      FROM information_schema.columns
      WHERE table_schema = 'data'
        AND table_name IN ('ingestion_runs', 'ingestion_run_items')
        AND column_name IN ('revisions_detected', 'quality_issue_count', 'quality_status_code')
    `),
    pool.query(`
      SELECT COUNT(*)::int AS guard_count
      FROM pg_trigger
      WHERE tgname IN (
        'ingestion_revision_events_validate_alignment',
        'ingestion_quality_events_validate_alignment',
        'ingestion_rejection_events_validate_alignment'
      )
        AND NOT tgisinternal
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE adapter_code IN ('FRED', 'BOC', 'STATCAN'))::int AS production_profiles,
        COUNT(*) FILTER (
          WHERE adapter_code IN ('FRED', 'BOC', 'STATCAN')
            AND supports_revisions = TRUE
        )::int AS revision_enabled_profiles
      FROM data.ingestion_tool_profiles
      WHERE active = TRUE
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS macro_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_macro_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `),
  ]);

  const codes = codeResult.rows[0] || {};
  const relations = relationResult.rows[0] || {};
  const columns = Number(columnResult.rows[0]?.column_count || 0);
  const guards = Number(guardResult.rows[0]?.guard_count || 0);
  const profiles = profileResult.rows[0] || {};
  const macro = macroResult.rows[0] || {};

  console.log('\nSkyCommand Phase 16.6.1 revision-aware loading and quality foundation');
  console.log('-----------------------------------------------------------------');
  console.log(`Quality statuses: ${codes.statuses || 0}`);
  console.log(`Quality severities: ${codes.severities || 0}`);
  console.log(`Quality checks: ${codes.checks || 0}`);
  console.log(`Ledger revision/quality columns: ${columns}`);
  console.log(`Evidence alignment guardrails: ${guards}`);
  console.log(`Revision-enabled production profiles: ${profiles.revision_enabled_profiles || 0}/${profiles.production_profiles || 0}`);
  console.log(`Macro assets preserved: ${macro.macro_assets || 0}`);
  console.log(`Active discoverable macro assets: ${macro.active_macro_assets || 0}`);

  const failures = [];
  if (Number(codes.statuses || 0) < 3) failures.push('expected at least 3 quality statuses');
  if (Number(codes.severities || 0) < 3) failures.push('expected at least 3 quality severities');
  if (Number(codes.checks || 0) < 11) failures.push('expected at least 11 portable quality checks');
  if (!relations.revisions || !relations.quality_events || !relations.rejections
      || !relations.revision_view || !relations.quality_view || !relations.rejection_view) {
    failures.push('one or more revision/quality evidence relations are missing');
  }
  if (columns !== 6) failures.push('expected 6 revision/quality ledger columns');
  if (guards !== 3) failures.push('expected 3 deferred evidence-alignment guardrails');
  if (Number(profiles.production_profiles || 0) !== 3
      || Number(profiles.revision_enabled_profiles || 0) !== 3) {
    failures.push('FRED, BOC, and STATCAN profiles must declare revision support');
  }
  if (Number(macro.macro_assets || 0) !== 73) failures.push('expected 73 preserved macro assets');
  if (Number(macro.active_macro_assets || 0) !== 69) failures.push('expected 69 active macro assets');

  if (failures.length > 0) {
    throw new Error(`Phase 16.6.1 verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Revision evidence, rejection evidence, quality contracts, and production profile capabilities passed.');
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
    throw new Error('Usage: phase16RevisionQualityFoundation.js setup|verify');
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
