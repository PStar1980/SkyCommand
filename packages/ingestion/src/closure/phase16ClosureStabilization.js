#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

const { pool } = require('../../../db/src/connection');
const ingestionLedgerService = require('../ledger/ingestionLedgerService');
const freshnessService = require('../freshness/freshnessService');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function verify() {
  const warnings = [];
  const warningListener = (warning) => {
    warnings.push(String(warning?.message || warning));
  };
  process.on('warning', warningListener);

  const client = await pool.connect();
  const query = client.query.bind(client);

  try {
    const platformResult = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM data.domains WHERE active = TRUE) AS active_domains,
        (SELECT COUNT(*)::int FROM data.sources WHERE active = TRUE) AS active_sources,
        (SELECT COUNT(*)::int FROM data.vw_assets WHERE discoverable = TRUE) AS discoverable_assets,
        (SELECT COUNT(*)::int FROM data.vw_metrics WHERE discoverable = TRUE) AS discoverable_metrics,
        (SELECT COUNT(*)::int FROM data.vw_ingestion_tools WHERE profile_active = TRUE) AS active_ingestion_profiles
    `);

    const macroResult = await query(`
      SELECT
        COUNT(*)::int AS registered_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE)::int AS active_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS discoverable_assets
      FROM data.vw_assets
      WHERE domain_code = 'MACRO'
    `);

    const freshnessResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE freshness_status_code = 'CURRENT')::int AS current_assets,
        COUNT(*) FILTER (WHERE freshness_status_code = 'WARNING')::int AS warning_assets,
        COUNT(*) FILTER (WHERE freshness_status_code = 'ERROR')::int AS error_assets,
        COALESCE(
          ARRAY_AGG(asset_code ORDER BY asset_code)
            FILTER (WHERE freshness_status_code = 'WARNING'),
          ARRAY[]::text[]
        ) AS warning_asset_codes
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
        AND asset_active = TRUE
        AND discoverable = TRUE
    `);

    const latestRunResult = await query(`
      SELECT ingestion_run_id, source_code
      FROM data.vw_ingestion_runs
      ORDER BY started_at DESC, ingestion_run_id DESC
      LIMIT 1
    `);

    let latestRun = null;
    let freshnessRows = [];
    if (latestRunResult.rows[0]) {
      latestRun = await ingestionLedgerService.getRun(
        latestRunResult.rows[0].ingestion_run_id,
        { query },
      );
      freshnessRows = await freshnessService.refreshFreshnessSnapshots({
        query,
        sourceCode: latestRunResult.rows[0].source_code,
        persist: false,
      });
    }

    await new Promise((resolve) => setImmediate(resolve));
    const sharedClientWarnings = warnings.filter((message) =>
      message.includes('already executing a query'),
    );

    const platform = platformResult.rows[0] || {};
    const macro = macroResult.rows[0] || {};
    const freshness = freshnessResult.rows[0] || {};

    assert(number(platform.active_domains) >= 1, 'Expected at least one active data domain.');
    assert(number(platform.active_sources) >= 4, 'Expected the four Phase 16 source profiles.');
    assert(number(platform.active_ingestion_profiles) >= 4, 'Expected active ingestion profiles.');
    assert(number(macro.registered_assets) >= 73, 'Expected the preserved macro asset catalogue.');
    assert(number(macro.active_assets) >= 69, 'Expected the preserved active macro assets.');
    assert(number(freshness.error_assets) === 0, 'Active discoverable macro assets contain freshness errors.');
    assert(sharedClientWarnings.length === 0,
      `Detected overlapping-query pg warning(s): ${sharedClientWarnings.join(' | ')}`);

    console.log('\nSkyCommand Phase 16.9 closure stabilization');
    console.log('-------------------------------------------');
    console.table([{
      activeDomains: number(platform.active_domains),
      activeSources: number(platform.active_sources),
      discoverableAssets: number(platform.discoverable_assets),
      discoverableMetrics: number(platform.discoverable_metrics),
      ingestionProfiles: number(platform.active_ingestion_profiles),
    }]);
    console.table([{
      macroRegistered: number(macro.registered_assets),
      macroActive: number(macro.active_assets),
      macroDiscoverable: number(macro.discoverable_assets),
      freshnessCurrent: number(freshness.current_assets),
      freshnessWatch: number(freshness.warning_assets),
      freshnessErrors: number(freshness.error_assets),
    }]);
    console.log(`Watch assets: ${(freshness.warning_asset_codes || []).join(', ') || 'None'}`);
    console.log(`Latest durable run detail: ${latestRun?.run?.ingestionRunId || 'No ingestion runs found'}`);
    console.log(`Read-only freshness evaluations: ${freshnessRows.length}`);
    console.log('✅ Generic catalogue, ingestion profiles, metrics, and macro compatibility baseline are present.');
    console.log('✅ Active discoverable macro assets have no freshness ERROR state.');
    console.log('✅ Ledger detail and freshness reads are safe on one checked-out pg Client.');
    console.log('✅ No node-postgres overlapping-query deprecation warning was emitted.');
    console.log('✅ Phase 16 closure stabilization is ready for the final live regression and promotion pass.');
  } finally {
    process.removeListener('warning', warningListener);
    client.release();
    await pool.end();
  }
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  if (command !== 'verify') throw new Error(`Unknown command: ${command}. Expected verify.`);
  await verify();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`❌ ${error.message}`);
    try { await pool.end(); } catch (_) { /* best effort */ }
    process.exitCode = 1;
  });
}

module.exports = { verify };
