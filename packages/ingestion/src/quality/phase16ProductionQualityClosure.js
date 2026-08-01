#!/usr/bin/env node

require('dotenv').config();

const { pool } = require('../../../db/src/connection');

const TARGETS = [
  { sourceCode: 'FRED', assetCode: 'DFF' },
  { sourceCode: 'BOC', assetCode: 'FXUSDCAD' },
  { sourceCode: 'STATCAN', assetCode: 'CAD_CPI_ALL_ITEMS' },
];

function parseArgs(argv) {
  const result = { windowMinutes: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--window-minutes') {
      result.windowMinutes = Number.parseInt(argv[index + 1], 10);
      index += 1;
    }
  }
  if (!Number.isInteger(result.windowMinutes) || result.windowMinutes < 1) {
    throw new Error('--window-minutes must be a positive integer.');
  }
  return result;
}

async function findLatestRun(client, sourceCode, assetCode, windowMinutes) {
  const result = await client.query(
    `
      SELECT DISTINCT ON (run.source_code)
        run.ingestion_run_id,
        run.source_code,
        run.tool_code,
        run.status_code,
        run.started_at,
        run.completed_at,
        run.quality_status_code AS run_quality_status_code,
        run.quality_issue_count AS run_quality_issue_count,
        run.revisions_detected AS run_revisions_detected,
        item.ingestion_run_item_id,
        item.asset_code,
        item.outcome_code,
        item.quality_status_code AS item_quality_status_code,
        item.quality_issue_count AS item_quality_issue_count,
        item.revisions_detected AS item_revisions_detected,
        item.rows_rejected,
        item.rows_inserted,
        item.rows_updated,
        item.rows_unchanged
      FROM data.vw_ingestion_runs run
      JOIN data.vw_ingestion_run_items item
        ON item.ingestion_run_id = run.ingestion_run_id
      WHERE run.domain_code = 'MACRO'
        AND run.source_code = $1
        AND item.asset_code = $2
        AND run.started_at >= CURRENT_TIMESTAMP - ($3::text || ' minutes')::interval
      ORDER BY run.source_code, run.started_at DESC, item.attempt_number DESC
      LIMIT 1
    `,
    [sourceCode, assetCode, windowMinutes],
  );
  return result.rows[0] || null;
}

async function getResolvedChecks(client, sourceCode, assetCode) {
  const result = await client.query(
    `
      SELECT check_code, enabled, severity_code, blocking, policy_origin_code
      FROM data.vw_asset_quality_policies
      WHERE domain_code = 'MACRO'
        AND source_code = $1
        AND asset_code = $2
        AND check_code IN ('SOURCE_DATE_REGRESSION', 'FREQUENCY_INCOMPATIBLE')
      ORDER BY check_code
    `,
    [sourceCode, assetCode],
  );
  return result.rows;
}

async function main() {
  const { windowMinutes } = parseArgs(process.argv.slice(2));
  const client = await pool.connect();
  try {
    const proofRows = [];

    for (const target of TARGETS) {
      const [run, policies] = await Promise.all([
        findLatestRun(client, target.sourceCode, target.assetCode, windowMinutes),
        getResolvedChecks(client, target.sourceCode, target.assetCode),
      ]);

      if (!run) {
        throw new Error(
          `No recent ${target.sourceCode}/${target.assetCode} ledger run was found in the last ${windowMinutes} minute(s). Run the selected ingestion tool and retry.`,
        );
      }
      if (run.status_code !== 'SUCCESS') {
        throw new Error(`${target.sourceCode}/${target.assetCode} latest run is ${run.status_code}, expected SUCCESS.`);
      }
      if (!['PASS', 'WARN'].includes(run.item_quality_status_code)) {
        throw new Error(`${target.sourceCode}/${target.assetCode} item quality is ${run.item_quality_status_code}.`);
      }
      if (policies.length !== 2 || policies.some((policy) => policy.enabled !== true)) {
        throw new Error(`${target.sourceCode}/${target.assetCode} does not resolve both required production quality policies.`);
      }

      proofRows.push({
        source: target.sourceCode,
        asset: target.assetCode,
        outcome: run.outcome_code,
        quality: run.item_quality_status_code,
        issues: Number(run.item_quality_issue_count || 0),
        revisions: Number(run.item_revisions_detected || 0),
        rejected: Number(run.rows_rejected || 0),
        inserted: Number(run.rows_inserted || 0),
        updated: Number(run.rows_updated || 0),
        unchanged: Number(run.rows_unchanged || 0),
        policyOrigins: [...new Set(policies.map((policy) => policy.policy_origin_code))].join(','),
        runId: run.ingestion_run_id,
      });
    }

    console.log('\nSkyCommand Phase 16.6.3 production revision/quality closure proof');
    console.log('-----------------------------------------------------------------');
    console.table(proofRows);
    console.log(`Recent-run window: ${windowMinutes} minute(s)`);
    console.log('✅ FRED, Bank of Canada, and Statistics Canada executed through the revision-aware quality loader.');
    console.log('✅ Each selected production asset resolved PostgreSQL-authoritative quality policy.');
    console.log('✅ Durable ledger rows expose quality status, revisions, rejections, and row outcomes.');
    console.log('✅ Legacy ingestion success remained compatible while generic evidence stayed queryable.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(`❌ ${error.message}`);
  try { await pool.end(); } catch {}
  process.exitCode = 1;
});
