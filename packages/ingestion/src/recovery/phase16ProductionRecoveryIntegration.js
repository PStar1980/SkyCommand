#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const { discoverSourceAdapters, validateAdapterProfileAlignment } = require('../core/sourceAdapterRegistry');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') throw new Error(`Missing required environment variable: ${name}`);
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

async function verify(pool) {
  const profileResult = await pool.query(`
    SELECT
      tool.tool_code,
      profile.adapter_code,
      domain.domain_code,
      source.source_code,
      profile.contract_version,
      profile.supports_incremental,
      profile.supports_selected_assets,
      profile.supports_backfill,
      profile.supports_revisions,
      profile.supports_resume,
      profile.supports_dry_run,
      COUNT(parameter.parameter_id) FILTER (
        WHERE parameter.parameter_name IN ('resumeRunId', 'recoveryMode', 'forceRefresh')
          AND parameter.enabled = TRUE
      )::int AS recovery_parameters
    FROM data.ingestion_tool_profiles profile
    JOIN core.tools tool ON tool.tool_id = profile.tool_id
    JOIN data.domains domain ON domain.domain_id = profile.data_domain_id
    JOIN data.sources source ON source.source_id = profile.source_id
    LEFT JOIN core.tool_parameters parameter ON parameter.tool_id = tool.tool_id
    WHERE tool.tool_code IN ('ingestion_fred', 'ingestion_boc', 'ingestion_statcan')
    GROUP BY
      tool.tool_code, profile.adapter_code, domain.domain_code, source.source_code,
      profile.contract_version, profile.supports_incremental, profile.supports_selected_assets,
      profile.supports_backfill, profile.supports_revisions, profile.supports_resume,
      profile.supports_dry_run
    ORDER BY tool.tool_code
  `);
  const registry = discoverSourceAdapters();
  const failures = [];

  for (const row of profileResult.rows) {
    const adapter = registry.get(row.adapter_code);
    try {
      validateAdapterProfileAlignment(adapter, {
        toolCode: row.tool_code,
        adapterCode: row.adapter_code,
        domainCode: row.domain_code,
        sourceCode: row.source_code,
        contractVersion: row.contract_version,
        supportsIncremental: row.supports_incremental,
        supportsSelectedAssets: row.supports_selected_assets,
        supportsBackfill: row.supports_backfill,
        supportsRevisions: row.supports_revisions,
        supportsResume: row.supports_resume,
        supportsDryRun: row.supports_dry_run,
        active: true,
      });
    } catch (error) {
      failures.push(error.message);
    }
    if (!row.supports_resume) failures.push(`${row.tool_code} is not resume-enabled.`);
    if (!row.supports_selected_assets) failures.push(`${row.tool_code} does not support selected assets.`);
    if (row.recovery_parameters !== 3) failures.push(`${row.tool_code} has ${row.recovery_parameters}/3 recovery parameters.`);
  }

  if (profileResult.rows.length !== 3) failures.push(`Expected 3 production recovery profiles, found ${profileResult.rows.length}.`);

  console.log('\nSkyCommand Phase 16.7.2 production recovery integration');
  console.log('------------------------------------------------------------');
  console.table(profileResult.rows.map((row) => ({
    tool: row.tool_code,
    adapter: row.adapter_code,
    selectedAssets: row.supports_selected_assets,
    resume: row.supports_resume,
    recoveryParameters: row.recovery_parameters,
  })));

  if (failures.length > 0) throw new Error(`Phase 16.7.2 verification failed: ${failures.join('; ')}`);
  console.log('✅ FRED, Bank of Canada, and Statistics Canada are enabled for durable failed-only recovery.');
  console.log('✅ Runtime adapters, catalogue capabilities, and Run Tools/workflow parameters align.');
  console.log('✅ Recovery can enter through CLI flags or the existing registered ingestion-tool lane.');
}

async function main() {
  const pool = createPool();
  try {
    await verify(pool);
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
