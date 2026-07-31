const dotenv = require('dotenv');
const { query } = require('../../../db/src/connection');
const ingestionStatusService = require('../../../../apps/api/src/services/ingestionStatusService');

dotenv.config();

async function verify() {
  const [snapshotResult, reasonResult, summary] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_snapshots,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE AND freshness_status_code = 'CURRENT')::int AS current_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE AND freshness_status_code = 'WARNING')::int AS warning_assets,
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE AND freshness_status_code = 'ERROR')::int AS error_assets
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
        AND refreshed_at IS NOT NULL
    `),
    query(`
      SELECT freshness_reason_code AS reason, COUNT(*)::int AS assets
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
        AND asset_active = TRUE
        AND discoverable = TRUE
      GROUP BY freshness_reason_code
      ORDER BY freshness_reason_code
    `),
    ingestionStatusService.getIngestionStatusSummary({ recentLimit: 3 }),
  ]);

  const snapshot = snapshotResult.rows[0] || {};
  const activeSnapshots = Number(snapshot.active_snapshots || 0);
  const currentAssets = Number(snapshot.current_assets || 0);
  const warningAssets = Number(snapshot.warning_assets || 0);
  const errorAssets = Number(snapshot.error_assets || 0);

  if (activeSnapshots !== 69) {
    throw new Error(`Expected 69 active macro freshness snapshots, found ${activeSnapshots}.`);
  }
  if (Number(summary.activeIndicators || 0) !== 69) {
    throw new Error(`Legacy status contract returned ${summary.activeIndicators} active indicators instead of 69.`);
  }
  if (Number(summary.currentIndicators || 0) !== currentAssets) {
    throw new Error(`Legacy CURRENT count ${summary.currentIndicators} does not match snapshot CURRENT count ${currentAssets}.`);
  }
  if (Number(summary.staleIndicators || 0) !== warningAssets) {
    throw new Error(`Legacy STALE/watch count ${summary.staleIndicators} does not match snapshot WARNING count ${warningAssets}.`);
  }
  if (Number(summary.errorIndicators || 0) !== errorAssets) {
    throw new Error(`Legacy ERROR count ${summary.errorIndicators} does not match snapshot ERROR count ${errorAssets}.`);
  }

  console.log('\nSkyCommand Phase 16.3.2 freshness/status integration');
  console.log('--------------------------------------------------');
  console.log(`Active snapshot-backed macro assets: ${activeSnapshots}`);
  console.log(`Legacy current indicators: ${summary.currentIndicators}`);
  console.log(`Legacy watch/stale indicators: ${summary.staleIndicators}`);
  console.log(`Legacy error indicators: ${summary.errorIndicators}`);
  console.table(reasonResult.rows);
  console.log('✅ Existing ingestion status now resolves through persisted explainable-freshness snapshots.');
  console.log('✅ Active legacy status counts reconcile exactly to the generic snapshot seam.');
  console.log('✅ The runtime status path no longer needs per-indicator table existence/stats queries.');
}

if (require.main === module) {
  verify()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`❌ ${error.message}`);
      process.exit(1);
    });
}

module.exports = { verify };
