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
  '00076__ingestion_profile_guardrails.sql',
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

async function applyMigration(pool) {
  await pool.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  console.log(`✅ Applied ${path.relative(REPOSITORY_ROOT, MIGRATION_PATH).replace(/\\/g, '/')}`);
}

async function loadVerification(pool) {
  const [profiles, missing, outsideCategory, inactiveEnabled, domainMismatch, triggers] =
    await Promise.all([
      pool.query(`
        SELECT
          tool.tool_code,
          category.category_kind_code,
          domain.domain_code,
          source.source_code,
          profile.adapter_code,
          profile.contract_version,
          profile.active,
          tool.enabled AS tool_enabled
        FROM data.ingestion_tool_profiles profile
        JOIN core.tools tool ON tool.tool_id = profile.tool_id
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        JOIN data.domains domain ON domain.domain_id = profile.data_domain_id
        JOIN data.sources source ON source.source_id = profile.source_id
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT tool.tool_code, category.category_code
        FROM core.tools tool
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        LEFT JOIN data.ingestion_tool_profiles profile ON profile.tool_id = tool.tool_id
        WHERE category.category_kind_code = 'INGESTION'
          AND profile.tool_id IS NULL
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT tool.tool_code, category.category_code, category.category_kind_code
        FROM data.ingestion_tool_profiles profile
        JOIN core.tools tool ON tool.tool_id = profile.tool_id
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        WHERE category.category_kind_code <> 'INGESTION'
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT tool.tool_code
        FROM data.ingestion_tool_profiles profile
        JOIN core.tools tool ON tool.tool_id = profile.tool_id
        JOIN core.tool_categories category ON category.category_id = tool.category_id
        WHERE category.category_kind_code = 'INGESTION'
          AND tool.enabled = TRUE
          AND profile.active = FALSE
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT tool.tool_code, domain.domain_code, source.source_code
        FROM data.ingestion_tool_profiles profile
        JOIN core.tools tool ON tool.tool_id = profile.tool_id
        JOIN data.domains domain ON domain.domain_id = profile.data_domain_id
        JOIN data.sources source ON source.source_id = profile.source_id
        WHERE source.domain_id <> profile.data_domain_id
        ORDER BY tool.tool_code
      `),
      pool.query(`
        SELECT trigger_name, event_object_schema, event_object_table
        FROM information_schema.triggers
        WHERE trigger_name LIKE 'ingestion_tool_profile_contract_%'
        ORDER BY trigger_name
      `),
    ]);

  return {
    profiles: profiles.rows,
    missing: missing.rows,
    outsideCategory: outsideCategory.rows,
    inactiveEnabled: inactiveEnabled.rows,
    domainMismatch: domainMismatch.rows,
    triggers: triggers.rows,
  };
}

function printVerification(result) {
  console.log('\nSkyCommand Phase 16.1.2 ingestion profile guardrails');
  console.log('---------------------------------------------------');
  console.log(`Profiles: ${result.profiles.length}`);
  console.log(`Deferred guardrail triggers: ${result.triggers.length}`);

  if (result.profiles.length > 0) {
    console.table(
      result.profiles.map((row) => ({
        tool: row.tool_code,
        kind: row.category_kind_code,
        domain: row.domain_code,
        source: row.source_code,
        adapter: row.adapter_code,
        contract: row.contract_version,
        profileActive: row.active,
        toolEnabled: row.tool_enabled,
      })),
    );
  }

  for (const [label, rows] of [
    ['INGESTION tools missing profiles', result.missing],
    ['Profiles outside INGESTION categories', result.outsideCategory],
    ['Enabled tools with inactive profiles', result.inactiveEnabled],
    ['Source/domain mismatches', result.domainMismatch],
  ]) {
    if (rows.length > 0) {
      console.error(`❌ ${label}:`);
      console.table(rows);
    }
  }
}

async function verify(pool) {
  const result = await loadVerification(pool);
  printVerification(result);

  if (
    result.profiles.length < 4 ||
    result.triggers.length < 4 ||
    result.missing.length > 0 ||
    result.outsideCategory.length > 0 ||
    result.inactiveEnabled.length > 0 ||
    result.domainMismatch.length > 0
  ) {
    throw new Error('Phase 16.1.2 ingestion profile guardrail verification failed.');
  }

  console.log('✅ Portable ingestion profile invariants passed.');
  return result;
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  const pool = createPool();

  try {
    if (command === 'setup') {
      await applyMigration(pool);
      await verify(pool);
      return;
    }

    if (command === 'verify' || command === 'status') {
      await verify(pool);
      return;
    }

    throw new Error('Usage: phase16IngestionProfileGuardrails.js setup|verify');
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

module.exports = { loadVerification, verify };
