#!/usr/bin/env node

const path = require('path');

const { persistRunSummary } = require('../ledger/ingestionLedgerService');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
let environmentLoaded = false;

function loadEnvironment() {
  if (environmentLoaded) return;
  require('dotenv').config({ path: path.join(REPOSITORY_ROOT, '.env') });
  environmentLoaded = true;
}

const PHASE = '16.7.3';
const FAILED_ASSET = 'DFF';
const SUCCESSFUL_ASSET = 'CPIAUCSL';
const LANES = new Set(['INTERACTIVE', 'WORKFLOW']);

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function createPool() {
  loadEnvironment();
  const { Pool } = require('pg');
  return new Pool({
    host: requireEnv('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: requireEnv('PGDATABASE'),
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
  });
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeLane(value) {
  const lane = String(value || 'INTERACTIVE').trim().toUpperCase();
  if (!LANES.has(lane)) throw new Error(`Unsupported live recovery lane: ${lane}. Use INTERACTIVE or WORKFLOW.`);
  return lane;
}

function parseArgs(args = process.argv.slice(2)) {
  const options = {
    command: String(args[0] || 'prepare').trim().toLowerCase(),
    lane: 'INTERACTIVE',
    originalRunId: null,
    fresh: false,
  };

  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--lane') {
      options.lane = normalizeLane(args[index + 1]);
      index += 1;
    } else if (value.startsWith('--lane=')) {
      options.lane = normalizeLane(value.slice('--lane='.length));
    } else if (value === '--run-id' || value === '--original-run-id') {
      options.originalRunId = normalizeText(args[index + 1]);
      index += 1;
    } else if (value.startsWith('--run-id=')) {
      options.originalRunId = normalizeText(value.slice('--run-id='.length));
    } else if (value.startsWith('--original-run-id=')) {
      options.originalRunId = normalizeText(value.slice('--original-run-id='.length));
    } else if (value === '--fresh') {
      options.fresh = true;
    }
  }

  options.lane = normalizeLane(options.lane);
  return options;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findReusableFixture(pool, lane) {
  const result = await pool.query(
    `
      SELECT run.*
      FROM data.vw_ingestion_runs run
      WHERE run.metadata->>'phase' = $1
        AND run.metadata->>'liveRecoveryClosure' = 'true'
        AND run.metadata->>'lane' = $2
        AND run.status_code = 'PARTIAL'
        AND NOT EXISTS (
          SELECT 1
          FROM data.ingestion_recovery_requests request
          WHERE request.original_run_id = run.ingestion_run_id
            AND request.status_code = 'COMPLETED'
        )
      ORDER BY run.created_at DESC
      LIMIT 1
    `,
    [PHASE, lane],
  );
  return result.rows[0] || null;
}

async function prepare(pool, options = {}) {
  const lane = normalizeLane(options.lane);
  if (!options.fresh) {
    const existing = await findReusableFixture(pool, lane);
    if (existing) {
      printPreparation(existing.ingestion_run_id, lane, true);
      return existing;
    }
  }

  const now = new Date();
  const startedAt = new Date(now.getTime() - 1500).toISOString();
  const completedAt = new Date(now.getTime() - 500).toISOString();
  const detail = await persistRunSummary({
    domainCode: 'MACRO',
    sourceCode: 'FRED',
    modeCode: 'SELECTED',
    triggerCode: 'PROOF',
    selectedAssets: [FAILED_ASSET, SUCCESSFUL_ASSET],
    startedAt,
    completedAt,
    items: [
      {
        assetCode: FAILED_ASSET,
        attemptNumber: 1,
        outcome: 'FAILED',
        retryable: true,
        errorCategoryCode: 'SOURCE_DATA',
        errorCode: 'PHASE16_LIVE_RECOVERY_FIXTURE',
        errorMessage: 'Synthetic failed asset prepared for the Phase 16.7.3 live recovery closure proof.',
        startedAt,
        completedAt,
      },
      {
        assetCode: SUCCESSFUL_ASSET,
        attemptNumber: 1,
        outcome: 'UNCHANGED',
        rowsStaged: 1,
        rowsUnchanged: 1,
        currentTargetMaxDate: '2026-07-01',
        qualityStatusCode: 'PASS',
        startedAt,
        completedAt,
      },
    ],
    metadata: {
      phase: PHASE,
      liveRecoveryClosure: true,
      lane,
      fixture: true,
    },
  }, {
    toolCode: 'ingestion_fred',
    summary: `Phase ${PHASE} ${lane.toLowerCase()} live recovery fixture.`,
    requestContext: {
      phase: PHASE,
      liveRecoveryClosure: true,
      lane,
      failedAsset: FAILED_ASSET,
      successfulAsset: SUCCESSFUL_ASSET,
    },
    metadata: {
      phase: PHASE,
      liveRecoveryClosure: true,
      lane,
      fixture: true,
    },
  });

  printPreparation(detail.run.ingestionRunId, lane, false);
  return detail.run;
}

function printPreparation(originalRunId, lane, reused) {
  console.log('\nSkyCommand Phase 16.7.3 live recovery fixture');
  console.log('------------------------------------------------------------');
  console.log(`Lane: ${lane}`);
  console.log(`Original partial run: ${originalRunId}`);
  console.log(`Failed asset: ${FAILED_ASSET}`);
  console.log(`Successful asset that must remain untouched: ${SUCCESSFUL_ASSET}`);
  if (reused) console.log('Fixture: reused existing uncompleted fixture');

  if (lane === 'INTERACTIVE') {
    console.log('\nRun Tools instructions:');
    console.log('1. Open Tools → Run Tools → Run FRED Ingestion.');
    console.log(`2. Indicators: ${FAILED_ASSET} (or leave blank to select every eligible failed asset).`);
    console.log('3. Concurrency: 1');
    console.log(`4. Resume Run ID: ${originalRunId}`);
    console.log('5. Recovery Mode: INCREMENTAL');
    console.log('6. Force Refresh: false');
    console.log('7. Confirm and run.');
  } else {
    console.log('\nWorkflow instructions:');
    console.log('1. Open Workflows → Start Workflow → Macro Refresh Pipeline.');
    console.log(`2. FRED indicators: ${FAILED_ASSET}`);
    console.log('3. FRED concurrency: 1');
    console.log(`4. FRED resume run ID: ${originalRunId}`);
    console.log('5. FRED recovery mode: INCREMENTAL');
    console.log('6. FRED force refresh: false');
    console.log('7. Keep Bank of Canada and Statistics Canada selections small, then start the workflow.');
  }

  console.log('\nAfter completion, verify with:');
  console.log(`npm run phase16:recovery-live:verify -- --lane ${lane.toLowerCase()} --run-id ${originalRunId}`);
  console.log('\nℹ️ The fixture and recovery records are intentionally retained as durable audit evidence.');
}

async function loadVerificationCandidate(pool, options = {}) {
  const values = [PHASE, normalizeLane(options.lane), options.originalRunId || null];
  const result = await pool.query(
    `
      SELECT
        original.ingestion_run_id AS original_run_id,
        original.status_code AS original_status_code,
        original.metadata AS original_metadata,
        request.recovery_request_id,
        request.status_code AS recovery_status_code,
        request.requested_assets,
        request.failed_assets_snapshot,
        request.selection_code,
        request.recovery_run_id,
        child.script_execution_id,
        child.workflow_run_record_id,
        child.workflow_node_run_record_id,
        child.temporal_workflow_id,
        child.temporal_run_id,
        child.resumed_from_run_id,
        child.status_code AS child_status_code,
        child.trigger_code AS child_trigger_code,
        child.selected_assets AS child_selected_assets,
        child.request_context AS child_request_context,
        child.metadata AS child_metadata
      FROM data.vw_ingestion_runs original
      JOIN data.vw_ingestion_recovery_requests request
        ON request.original_run_id = original.ingestion_run_id
       AND request.status_code = 'COMPLETED'
      JOIN data.vw_ingestion_runs child
        ON child.ingestion_run_id = request.recovery_run_id
      WHERE original.metadata->>'phase' = $1
        AND original.metadata->>'liveRecoveryClosure' = 'true'
        AND original.metadata->>'lane' = $2
        AND ($3::uuid IS NULL OR original.ingestion_run_id = $3::uuid)
      ORDER BY request.completed_at DESC, request.created_at DESC
      LIMIT 1
    `,
    values,
  );
  return result.rows[0] || null;
}

async function loadLatestItems(pool, ingestionRunId) {
  const result = await pool.query(
    `
      WITH ranked AS (
        SELECT
          item.asset_code,
          item.outcome_code,
          item.success_like,
          item.attempt_number,
          ROW_NUMBER() OVER (
            PARTITION BY item.asset_code
            ORDER BY item.attempt_number DESC, item.created_at DESC, item.ingestion_run_item_id DESC
          ) AS rank_number
        FROM data.vw_ingestion_run_items item
        WHERE item.ingestion_run_id = $1
      )
      SELECT asset_code, outcome_code, success_like, attempt_number
      FROM ranked
      WHERE rank_number = 1
      ORDER BY asset_code
    `,
    [ingestionRunId],
  );
  return result.rows;
}

async function loadExecution(pool, executionId) {
  if (!executionId) return null;
  const result = await pool.query(
    `
      SELECT execution_id, script_name, status, parameters, metadata
      FROM auth.script_execution_log
      WHERE execution_id = $1
      LIMIT 1
    `,
    [executionId],
  );
  return result.rows[0] || null;
}

async function loadWorkflowEvidence(pool, workflowRunRecordId, workflowNodeRunRecordId) {
  if (!workflowRunRecordId || !workflowNodeRunRecordId) return { workflowRun: null, workflowNode: null };
  const [runResult, nodeResult] = await Promise.all([
    pool.query(
      `
        SELECT workflow_run_record_id, workflow_code, status, temporal_workflow_id, temporal_run_id
        FROM worker.workflow_run_records
        WHERE workflow_run_record_id = $1
        LIMIT 1
      `,
      [workflowRunRecordId],
    ),
    pool.query(
      `
        SELECT workflow_node_run_record_id, workflow_run_record_id, node_key, target_code, status
        FROM worker.workflow_node_run_records
        WHERE workflow_node_run_record_id = $1
        LIMIT 1
      `,
      [workflowNodeRunRecordId],
    ),
  ]);
  return {
    workflowRun: runResult.rows[0] || null,
    workflowNode: nodeResult.rows[0] || null,
  };
}

function normalizeUuidText(value) {
  return String(value || '').trim().toLowerCase();
}

function getLedgerReference(execution = {}) {
  return execution?.metadata?.toolResult?.metadata?.ingestionLedger || null;
}

async function verify(pool, options = {}) {
  const lane = normalizeLane(options.lane);
  const candidate = await loadVerificationCandidate(pool, { ...options, lane });
  if (!candidate) {
    throw new Error(
      `No completed ${lane.toLowerCase()} recovery was found for the Phase ${PHASE} fixture. Prepare the fixture, run the recovery, then retry.`,
    );
  }

  const [originalItems, childItems, execution, workflowEvidence] = await Promise.all([
    loadLatestItems(pool, candidate.original_run_id),
    loadLatestItems(pool, candidate.recovery_run_id),
    loadExecution(pool, candidate.script_execution_id),
    loadWorkflowEvidence(pool, candidate.workflow_run_record_id, candidate.workflow_node_run_record_id),
  ]);

  const originalByAsset = new Map(originalItems.map((item) => [item.asset_code, item]));
  const childAssets = childItems.map((item) => item.asset_code);
  const ledgerReference = getLedgerReference(execution);
  const launchChannel = String(execution?.metadata?.launchChannel || '').trim().toUpperCase();

  assert(candidate.original_status_code === 'PARTIAL', `Original run must be PARTIAL; found ${candidate.original_status_code}.`);
  assert(originalByAsset.get(FAILED_ASSET)?.success_like === false, `${FAILED_ASSET} was not failed in the original run.`);
  assert(originalByAsset.get(SUCCESSFUL_ASSET)?.success_like === true, `${SUCCESSFUL_ASSET} was not successful in the original run.`);
  assert(candidate.recovery_status_code === 'COMPLETED', `Recovery request status is ${candidate.recovery_status_code}.`);
  assert(candidate.child_status_code === 'SUCCESS', `Recovery child run status is ${candidate.child_status_code}.`);
  assert(candidate.selection_code === 'FAILED_ONLY', `Recovery selection is ${candidate.selection_code}.`);
  assert(normalizeUuidText(candidate.resumed_from_run_id) === normalizeUuidText(candidate.original_run_id), 'Recovery child ancestry is incorrect.');
  assert(childAssets.length === 1 && childAssets[0] === FAILED_ASSET, `Recovery child executed unexpected assets: ${childAssets.join(', ') || '(none)'}.`);
  assert(!childAssets.includes(SUCCESSFUL_ASSET), `${SUCCESSFUL_ASSET} was unnecessarily re-executed.`);
  assert(execution, 'Linked script execution was not found.');
  assert(execution.script_name === 'ingestion_fred', `Expected ingestion_fred execution; found ${execution.script_name}.`);
  assert(launchChannel === lane, `Expected ${lane} launch channel; found ${launchChannel || '(null)'}.`);
  assert(ledgerReference?.persisted, 'Structured ToolResult is missing a persisted ingestion-ledger reference.');
  assert(normalizeUuidText(ledgerReference.ingestionRunId) === normalizeUuidText(candidate.recovery_run_id), 'ToolResult ledger reference does not match the recovery child run.');
  assert(normalizeUuidText(ledgerReference.resumedFromRunId) === normalizeUuidText(candidate.original_run_id), 'ToolResult recovery ancestry does not match the original run.');
  assert(normalizeUuidText(ledgerReference.recoveryRequestId) === normalizeUuidText(candidate.recovery_request_id), 'ToolResult recovery request reference is incorrect.');

  if (lane === 'WORKFLOW') {
    const { workflowRun, workflowNode } = workflowEvidence;
    assert(candidate.workflow_run_record_id, 'Workflow recovery child is missing workflow_run_record_id.');
    assert(candidate.workflow_node_run_record_id, 'Workflow recovery child is missing workflow_node_run_record_id.');
    assert(candidate.temporal_workflow_id, 'Workflow recovery child is missing temporal_workflow_id.');
    assert(candidate.temporal_run_id, 'Workflow recovery child is missing temporal_run_id.');
    assert(workflowRun, 'Linked workflow run record was not found.');
    assert(workflowNode, 'Linked workflow node run record was not found.');
    assert(workflowNode.target_code === 'ingestion_fred', `Workflow recovery node targets ${workflowNode.target_code}.`);
    assert(normalizeUuidText(workflowNode.workflow_run_record_id) === normalizeUuidText(candidate.workflow_run_record_id), 'Workflow node does not belong to the recovery workflow run.');
    assert(String(workflowRun.temporal_workflow_id || '') === String(candidate.temporal_workflow_id || ''), 'Temporal workflow ID does not reconcile.');
    assert(String(workflowRun.temporal_run_id || '') === String(candidate.temporal_run_id || ''), 'Temporal run ID does not reconcile.');
  } else {
    assert(!candidate.workflow_run_record_id, 'Interactive recovery unexpectedly contains workflow linkage.');
  }

  console.log(`\nSkyCommand Phase ${PHASE} live recovery closure proof`);
  console.log('------------------------------------------------------------');
  console.log(`Lane: ${lane}`);
  console.log(`Original partial run: ${candidate.original_run_id}`);
  console.log(`Recovery request: ${candidate.recovery_request_id}`);
  console.log(`Recovery child run: ${candidate.recovery_run_id}`);
  console.log(`Script execution: ${candidate.script_execution_id}`);
  console.log(`Recovered assets: ${childAssets.join(', ')}`);
  if (lane === 'WORKFLOW') {
    console.log(`Workflow run: ${candidate.workflow_run_record_id}`);
    console.log(`Workflow node run: ${candidate.workflow_node_run_record_id}`);
    console.log(`Temporal workflow: ${candidate.temporal_workflow_id}`);
    console.log(`Temporal run: ${candidate.temporal_run_id}`);
  }
  console.log('✅ The live registered FRED tool completed a durable failed-only recovery.');
  console.log(`✅ The ${lane.toLowerCase()} execution lane preserved script-execution and ledger linkage.`);
  console.log(`✅ Only ${FAILED_ASSET} was re-fetched and reloaded; successful ${SUCCESSFUL_ASSET} remained untouched.`);
  console.log('✅ Recovery request, child run, ToolResult, and original-run ancestry reconcile exactly.');
  if (lane === 'WORKFLOW') {
    console.log('✅ Workflow node, SkyCommand workflow run, and Temporal workflow/run linkage are complete.');
  }
  console.log('ℹ️ Live proof records remain in PostgreSQL as intentional durable audit evidence.');

  return { candidate, originalItems, childItems, execution, workflowEvidence };
}

async function main() {
  const options = parseArgs();
  const pool = createPool();
  try {
    if (options.command === 'prepare') {
      await prepare(pool, options);
    } else if (options.command === 'verify') {
      await verify(pool, options);
    } else {
      throw new Error(`Unknown command: ${options.command}. Use prepare or verify.`);
    }
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
  FAILED_ASSET,
  LANES,
  PHASE,
  SUCCESSFUL_ASSET,
  findReusableFixture,
  loadVerificationCandidate,
  normalizeLane,
  parseArgs,
  prepare,
  verify,
};
