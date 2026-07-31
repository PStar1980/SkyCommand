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
  '00077__portable_asset_metric_catalogue.sql',
);
const SEED_PATH = path.join(
  REPOSITORY_ROOT,
  'packages',
  'db_build',
  'src',
  'seeds',
  '00078__portable_asset_metric_catalogue_seed.sql',
);

const EXPECTED_MACRO_ASSET_COUNT = 73;
const EXPECTED_ACTIVE_MACRO_ASSET_COUNT = 69;
const EXPECTED_HEADLINE_METRIC_COUNT = 5;
const EXPECTED_STATCAN_VECTOR_BINDING_COUNT = 14;

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
  const [summaryResult, sourceCountsResult, mismatchResult, invalidBindingsResult, metricResult] =
    await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS asset_count,
          COUNT(*) FILTER (WHERE asset_active = TRUE)::int AS active_asset_count,
          COUNT(*) FILTER (WHERE discoverable = TRUE)::int AS discoverable_asset_count,
          COUNT(*) FILTER (WHERE provider_resource_code IS NOT NULL)::int AS enriched_provider_bindings,
          COUNT(*) FILTER (
            WHERE source_code = 'STATCAN'
              AND provider_resource_code IS NOT NULL
              AND provider_locator IS NOT NULL
          )::int AS statcan_vector_bindings
        FROM data.vw_assets
        WHERE domain_code = 'MACRO'
      `),
      pool.query(`
        SELECT
          source_code,
          COUNT(*)::int AS assets,
          COUNT(*) FILTER (WHERE asset_active = TRUE)::int AS active_assets,
          COUNT(*) FILTER (WHERE discoverable = TRUE)::int AS discoverable_assets
        FROM data.vw_assets
        WHERE domain_code = 'MACRO'
        GROUP BY source_code
        ORDER BY source_code
      `),
      pool.query(`
        SELECT
          indicator.indicator_code,
          indicator.source,
          indicator.active,
          asset.asset_id,
          asset.source_id,
          asset.provider_asset_code
        FROM macro.indicators indicator
        LEFT JOIN data.vw_assets asset
          ON asset.domain_code = 'MACRO'
         AND asset.asset_code = indicator.indicator_code
        WHERE asset.asset_id IS NULL
           OR asset.source_id IS NULL
           OR asset.source_code <> UPPER(indicator.source)
           OR asset.asset_active <> COALESCE(indicator.active, TRUE)
        ORDER BY indicator.indicator_code
      `),
      pool.query(`
        SELECT
          asset.asset_code,
          asset.domain_code AS asset_domain,
          source.domain_code AS source_domain,
          asset.source_code
        FROM data.vw_assets asset
        JOIN data.sources source ON source.source_id = asset.source_id
        WHERE asset.domain_id <> source.domain_id
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS metric_count,
          COUNT(*) FILTER (WHERE metric_active = TRUE)::int AS active_metric_count,
          COALESCE(SUM(JSONB_ARRAY_LENGTH(dependencies)), 0)::int AS dependency_count
        FROM data.vw_metrics
        WHERE domain_code = 'MACRO'
      `),
    ]);

  return {
    summary: summaryResult.rows[0] || {},
    sourceCounts: sourceCountsResult.rows,
    mismatches: mismatchResult.rows,
    invalidBindings: invalidBindingsResult.rows,
    metrics: metricResult.rows[0] || {},
  };
}

function printVerification(verification) {
  console.log('\nSkyCommand Phase 16.2.1 portable asset and metric catalogue');
  console.log('----------------------------------------------------------');
  console.log(`Macro assets: ${verification.summary.asset_count || 0}`);
  console.log(`Active macro assets: ${verification.summary.active_asset_count || 0}`);
  console.log(`Discoverable macro assets: ${verification.summary.discoverable_asset_count || 0}`);
  console.log(`Enriched provider bindings: ${verification.summary.enriched_provider_bindings || 0}`);
  console.log(`Headline metrics: ${verification.metrics.metric_count || 0}`);
  console.log(`Metric dependencies: ${verification.metrics.dependency_count || 0}`);

  if (verification.sourceCounts.length > 0) {
    console.table(
      verification.sourceCounts.map((row) => ({
        source: row.source_code,
        assets: row.assets,
        active: row.active_assets,
        discoverable: row.discoverable_assets,
      })),
    );
  }

  if (verification.mismatches.length > 0) {
    console.error('❌ Legacy macro indicators missing or mismatched in the generic catalogue:');
    console.table(verification.mismatches);
  }

  if (verification.invalidBindings.length > 0) {
    console.error('❌ Cross-domain asset/source bindings detected:');
    console.table(verification.invalidBindings);
  }
}

async function verify(pool) {
  const verification = await loadVerification(pool);
  printVerification(verification);

  const failures = [];

  if (Number(verification.summary.asset_count || 0) !== EXPECTED_MACRO_ASSET_COUNT) {
    failures.push(`expected ${EXPECTED_MACRO_ASSET_COUNT} macro assets`);
  }

  if (
    Number(verification.summary.active_asset_count || 0) !== EXPECTED_ACTIVE_MACRO_ASSET_COUNT
  ) {
    failures.push(`expected ${EXPECTED_ACTIVE_MACRO_ASSET_COUNT} active macro assets`);
  }

  if (
    Number(verification.summary.statcan_vector_bindings || 0) !==
    EXPECTED_STATCAN_VECTOR_BINDING_COUNT
  ) {
    failures.push(`expected ${EXPECTED_STATCAN_VECTOR_BINDING_COUNT} StatCan vector bindings`);
  }

  if (Number(verification.metrics.metric_count || 0) < EXPECTED_HEADLINE_METRIC_COUNT) {
    failures.push(`expected at least ${EXPECTED_HEADLINE_METRIC_COUNT} headline metrics`);
  }

  if (Number(verification.metrics.dependency_count || 0) < EXPECTED_HEADLINE_METRIC_COUNT) {
    failures.push(`expected at least ${EXPECTED_HEADLINE_METRIC_COUNT} metric dependencies`);
  }

  if (verification.mismatches.length > 0) {
    failures.push('legacy macro projection mismatch');
  }

  if (verification.invalidBindings.length > 0) {
    failures.push('cross-domain asset/source bindings');
  }

  if (failures.length > 0) {
    throw new Error(`Phase 16.2.1 catalogue verification failed: ${failures.join('; ')}.`);
  }

  console.log('✅ Generic asset/source/metric catalogue and macro compatibility projection passed.');
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

    throw new Error('Usage: phase16AssetMetricCatalogue.js setup|verify');
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
