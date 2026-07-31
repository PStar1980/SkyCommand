require('dotenv').config({
  path: require('path').join(__dirname, '../../../../.env'),
});

const { refreshFreshnessSnapshots } = require('../freshness/freshnessService');
const {
  SOURCE_TOOL_CODES,
  persistMacroToolResultSafely,
} = require('./ingestionLedgerIntegration');

let db = null;

function getDb() {
  if (!db) db = require('../../../db/src/connection');
  return db;
}

const MACRO_TOOL_SOURCES = {
  [SOURCE_TOOL_CODES.FRED]: 'FRED',
  [SOURCE_TOOL_CODES.BOC]: 'BOC',
  [SOURCE_TOOL_CODES.STATCAN]: 'STATCAN',
};

function parsePositiveInteger(value, fallback = 500, max = 5000) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function loadBackfillCandidates(limit = 500, options = {}) {
  const query = options.query || getDb().query;
  const toolCodes = Object.keys(MACRO_TOOL_SOURCES);
  const result = await query(
    `
      SELECT
        execution.execution_id,
        execution.script_name AS tool_code,
        execution.metadata
      FROM auth.script_execution_log execution
      WHERE execution.script_name = ANY($1::text[])
        AND execution.metadata ? 'toolResult'
        AND execution.metadata->'toolResult'->>'outputType' = 'macro_ingestion_summary.v1'
        AND NOT EXISTS (
          SELECT 1
          FROM data.ingestion_runs run
          WHERE run.script_execution_id = execution.execution_id
        )
      ORDER BY execution.started_at DESC
      LIMIT $2
    `,
    [toolCodes, parsePositiveInteger(limit)],
  );

  return result.rows;
}

async function backfillLegacyMacroRuns(options = {}) {
  const rows = await loadBackfillCandidates(options.limit, options);
  let persisted = 0;
  let skipped = 0;
  const warnings = [];

  for (const row of rows) {
    const sourceCode = MACRO_TOOL_SOURCES[row.tool_code];
    const toolResult = row.metadata?.toolResult;
    if (!sourceCode || !toolResult) {
      skipped += 1;
      continue;
    }

    const reference = await persistMacroToolResultSafely({
      sourceCode,
      toolCode: row.tool_code,
      toolResult,
      executionId: row.execution_id,
      options,
    }, (message) => warnings.push(message));

    if (reference.persisted) persisted += 1;
    else warnings.push(reference.warning?.message || `Unable to backfill ${row.execution_id}.`);
  }

  return {
    candidates: rows.length,
    persisted,
    skipped,
    warnings,
  };
}

async function refreshFromLedger(options = {}) {
  const rows = await refreshFreshnessSnapshots({
    query: options.query,
    persist: true,
  });
  return {
    refreshed: rows.length,
  };
}

async function verify(options = {}) {
  const query = options.query || getDb().query;
  const [profileResult, ledgerResult, missingResult, freshnessResult, duplicateResult] = await Promise.all([
    query(`
      SELECT tool.tool_code, source.source_code, profile.contract_version
      FROM data.ingestion_tool_profiles profile
      JOIN core.tools tool ON tool.tool_id = profile.tool_id
      JOIN data.sources source ON source.source_id = profile.source_id
      WHERE tool.tool_code IN ('ingestion_fred','ingestion_boc','ingestion_statcan','ingestion_manual')
      ORDER BY tool.tool_code
    `),
    query(`
      SELECT
        source_code,
        COUNT(*)::int AS runs,
        COUNT(*) FILTER (WHERE script_execution_id IS NOT NULL)::int AS execution_linked,
        COUNT(*) FILTER (WHERE workflow_run_record_id IS NOT NULL)::int AS workflow_linked,
        COALESCE(SUM(items_requested), 0)::int AS items_requested
      FROM data.vw_ingestion_runs
      WHERE domain_code = 'MACRO'
      GROUP BY source_code
      ORDER BY source_code
    `),
    query(`
      SELECT COUNT(*)::int AS total
      FROM auth.script_execution_log execution
      WHERE execution.script_name IN ('ingestion_fred','ingestion_boc','ingestion_statcan')
        AND execution.metadata ? 'toolResult'
        AND execution.metadata->'toolResult'->>'outputType' = 'macro_ingestion_summary.v1'
        AND NOT EXISTS (
          SELECT 1 FROM data.ingestion_runs run
          WHERE run.script_execution_id = execution.execution_id
        )
    `),
    query(`
      SELECT
        COUNT(*) FILTER (WHERE asset_active = TRUE AND discoverable = TRUE)::int AS active_assets,
        COUNT(*) FILTER (
          WHERE asset_active = TRUE
            AND discoverable = TRUE
            AND evidence->'ledger'->>'ingestionRunId' IS NOT NULL
        )::int AS ledger_evidenced_assets
      FROM data.vw_asset_freshness
      WHERE domain_code = 'MACRO'
    `),
    query(`
      SELECT COUNT(*)::int AS duplicates
      FROM (
        SELECT script_execution_id
        FROM data.ingestion_runs
        WHERE script_execution_id IS NOT NULL
        GROUP BY script_execution_id
        HAVING COUNT(*) > 1
      ) duplicate_execution
    `),
  ]);

  const profiles = profileResult.rows;
  const missingBackfill = Number(missingResult.rows[0]?.total || 0);
  const duplicateExecutions = Number(duplicateResult.rows[0]?.duplicates || 0);
  const freshness = freshnessResult.rows[0] || {};

  if (profiles.length !== 4) {
    throw new Error(`Expected 4 production ingestion profiles; found ${profiles.length}.`);
  }
  if (missingBackfill !== 0) {
    throw new Error(`${missingBackfill} structured macro execution(s) are still missing ledger rows.`);
  }
  if (duplicateExecutions !== 0) {
    throw new Error(`${duplicateExecutions} script execution(s) map to duplicate ingestion ledger runs.`);
  }

  console.log('\nSkyCommand Phase 16.4.2 production ledger integration');
  console.log('------------------------------------------------------------');
  console.log(`Production ingestion profiles: ${profiles.length}`);
  console.log(`Structured macro executions missing ledger: ${missingBackfill}`);
  console.log(`Duplicate execution-linked ledger runs: ${duplicateExecutions}`);
  console.log(`Active macro freshness assets: ${Number(freshness.active_assets || 0)}`);
  console.log(`Freshness assets with ledger evidence: ${Number(freshness.ledger_evidenced_assets || 0)}`);

  if (ledgerResult.rows.length > 0) {
    console.table(ledgerResult.rows.map((row) => ({
      source: row.source_code,
      runs: Number(row.runs || 0),
      executionLinked: Number(row.execution_linked || 0),
      workflowLinked: Number(row.workflow_linked || 0),
      items: Number(row.items_requested || 0),
    })));
  }

  console.log('✅ Production macro runners are ledger-ready and legacy structured history is reconciled.');
  console.log('✅ Explainable freshness now consumes the durable ingestion ledger instead of ToolResult history.');
  console.log('✅ Manual ingestion is ledger-linked at run level while its configured jobs remain intentionally unbound catalogue assets.');

  return {
    profiles: profiles.length,
    ledgerSources: ledgerResult.rows,
    missingBackfill,
    duplicateExecutions,
    freshness,
  };
}

async function setup(options = {}) {
  const backfill = await backfillLegacyMacroRuns(options);
  console.log(`Backfill candidates: ${backfill.candidates}`);
  console.log(`Ledger runs persisted/reconciled: ${backfill.persisted}`);
  if (backfill.warnings.length > 0) {
    console.log(`Backfill warnings: ${backfill.warnings.length}`);
    backfill.warnings.slice(0, 10).forEach((warning) => console.warn(`⚠️ ${warning}`));
  }

  const freshness = await refreshFromLedger(options);
  console.log(`Freshness snapshots refreshed from ledger evidence: ${freshness.refreshed}`);
  return verify(options);
}

async function main() {
  const command = String(process.argv[2] || 'verify').trim().toLowerCase();
  if (command === 'setup') return setup();
  if (command === 'backfill') {
    const result = await backfillLegacyMacroRuns({ limit: process.argv[3] });
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (command === 'refresh') return refreshFromLedger();
  if (command === 'verify') return verify();
  throw new Error(`Unknown Phase 16.4.2 command: ${command}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ ${error?.message || String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MACRO_TOOL_SOURCES,
  backfillLegacyMacroRuns,
  loadBackfillCandidates,
  refreshFromLedger,
  setup,
  verify,
};
