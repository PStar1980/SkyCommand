#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MIGRATION_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'migrations',
  '00074__portable_ingestion_identity.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'seeds',
  '00075__portable_ingestion_identity_seed.sql',
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
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, '/')}`);
}

async function loadVerification(pool) {
  const [summaryResult, toolsResult, missingProfilesResult, invalidProfilesResult] =
    await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE category_kind_code = 'INGESTION')::int AS ingestion_categories,
          COUNT(*) FILTER (WHERE category_kind_code = 'GENERAL')::int AS general_categories
        FROM core.tool_categories
      `),
      pool.query(`
        SELECT
          category_kind_code,
          domain_code,
          source_code,
          tool_code,
          adapter_code,
          contract_version,
          supports_incremental,
          supports_selected_assets,
          supports_backfill,
          supports_revisions,
          supports_resume,
          supports_dry_run,
          discoverable
        FROM data.vw_ingestion_tools
        ORDER BY domain_code, source_code, tool_code
      `),
      pool.query(`
        SELECT tool.tool_code, category.category_code
        FROM core.tools tool
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        LEFT JOIN data.ingestion_tool_profiles profile ON profile.tool_id = tool.tool_id
        WHERE category.category_kind_code = 'INGESTION'
          AND tool.enabled = TRUE
          AND category.enabled = TRUE
          AND (profile.tool_id IS NULL OR profile.active = FALSE)
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT tool.tool_code, category.category_code, category.category_kind_code
        FROM data.ingestion_tool_profiles profile
        JOIN core.tools tool ON tool.tool_id = profile.tool_id
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        WHERE profile.active = TRUE
          AND category.category_kind_code <> 'INGESTION'
        ORDER BY tool.tool_code
      `),
    ]);

  return {
    summary: summaryResult.rows[0] || {},
    tools: toolsResult.rows,
    missingProfiles: missingProfilesResult.rows,
    invalidProfiles: invalidProfilesResult.rows,
  };
}

function printVerification(verification) {
  console.log('\nSkyCommand Phase 16.1 ingestion identity');
  console.log('----------------------------------------');
  console.log(
    `Semantic categories: ${verification.summary.ingestion_categories || 0} INGESTION / ${verification.summary.general_categories || 0} GENERAL`,
  );
  console.log(`Discovered ingestion tools: ${verification.tools.length}`);

  if (verification.tools.length > 0) {
    console.table(
      verification.tools.map((row) => ({
        categoryKind: row.category_kind_code,
        domain: row.domain_code,
        source: row.source_code,
        tool: row.tool_code,
        adapter: row.adapter_code,
        contract: row.contract_version,
        incremental: row.supports_incremental,
        selectedAssets: row.supports_selected_assets,
        revisions: row.supports_revisions,
        resume: row.supports_resume,
        discoverable: row.discoverable,
      })),
    );
  }

  if (verification.missingProfiles.length > 0) {
    console.error('❌ Enabled ingestion-category tools missing an active profile:');
    console.table(verification.missingProfiles);
  }

  if (verification.invalidProfiles.length > 0) {
    console.error('❌ Active ingestion profiles assigned outside an INGESTION category:');
    console.table(verification.invalidProfiles);
  }
}

async function verify(pool) {
  const verification = await loadVerification(pool);
  printVerification(verification);

  if (
    Number(verification.summary.ingestion_categories || 0) < 1 ||
    verification.tools.length < 4 ||
    verification.missingProfiles.length > 0 ||
    verification.invalidProfiles.length > 0
  ) {
    throw new Error('Phase 16.1 semantic ingestion identity verification failed.');
  }

  console.log('✅ Semantic ingestion identity and profile invariants passed.');
  return verification;
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

    throw new Error('Usage: phase16IngestionIdentity.js setup|verify');
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
  loadVerification,
  verify,
};
