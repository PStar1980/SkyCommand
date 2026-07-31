require('dotenv').config({
  path: require('path').join(__dirname, '../../../../.env'),
});

let db = null;

function getDb() {
  if (!db) db = require('../../../db/src/connection');
  return db;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseArgs(args = process.argv.slice(2)) {
  const options = {
    ingestionRunId: null,
    sourceCode: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--run-id') {
      options.ingestionRunId = normalizeText(args[index + 1]);
      index += 1;
    } else if (value === '--source') {
      options.sourceCode = normalizeText(args[index + 1])?.toUpperCase() || null;
      index += 1;
    }
  }

  return options;
}

async function loadCandidate(options = {}) {
  const query = options.query || getDb().query;
  const result = await query(
    `
      SELECT *
      FROM data.vw_ingestion_runs run
      WHERE run.workflow_run_record_id IS NOT NULL
        AND ($1::uuid IS NULL OR run.ingestion_run_id = $1::uuid)
        AND ($2::text IS NULL OR run.source_code = $2::text)
      ORDER BY run.created_at DESC
      LIMIT 1
    `,
    [options.ingestionRunId || null, options.sourceCode || null],
  );

  return result.rows[0] || null;
}

async function loadExecution(executionId, options = {}) {
  const query = options.query || getDb().query;
  if (!executionId) return null;
  const result = await query(
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

async function loadWorkflowRun(workflowRunRecordId, options = {}) {
  const query = options.query || getDb().query;
  if (!workflowRunRecordId) return null;
  const result = await query(
    `
      SELECT
        workflow_run_record_id,
        workflow_code,
        status,
        temporal_workflow_id,
        temporal_run_id
      FROM worker.workflow_run_records
      WHERE workflow_run_record_id = $1
      LIMIT 1
    `,
    [workflowRunRecordId],
  );
  return result.rows[0] || null;
}

async function loadWorkflowNode(workflowNodeRunRecordId, options = {}) {
  const query = options.query || getDb().query;
  if (!workflowNodeRunRecordId) return null;
  const result = await query(
    `
      SELECT
        workflow_node_run_record_id,
        workflow_run_record_id,
        node_key,
        node_type_code,
        target_code,
        status
      FROM worker.workflow_node_run_records
      WHERE workflow_node_run_record_id = $1
      LIMIT 1
    `,
    [workflowNodeRunRecordId],
  );
  return result.rows[0] || null;
}

async function loadItemEvidence(ingestionRunId, options = {}) {
  const query = options.query || getDb().query;
  const result = await query(
    `
      SELECT
        COUNT(*)::int AS attempts,
        COUNT(DISTINCT asset_id)::int AS assets,
        COUNT(*) FILTER (WHERE success_like = TRUE)::int AS success_attempts,
        COUNT(*) FILTER (WHERE success_like = FALSE)::int AS failed_attempts
      FROM data.vw_ingestion_run_items
      WHERE ingestion_run_id = $1
    `,
    [ingestionRunId],
  );
  return result.rows[0] || { attempts: 0, assets: 0, success_attempts: 0, failed_attempts: 0 };
}

function getToolResultLedgerReference(execution = {}) {
  return execution?.metadata?.toolResult?.metadata?.ingestionLedger || null;
}

function assertEqual(actual, expected, message) {
  if (String(actual || '') !== String(expected || '')) {
    throw new Error(`${message}: expected ${expected || '(null)'}, found ${actual || '(null)'}.`);
  }
}

async function verify(options = {}) {
  const candidate = await loadCandidate(options);
  if (!candidate) {
    throw new Error(
      'No workflow-linked ingestion run was found. Run a published workflow containing ingestion_fred, ingestion_boc, or ingestion_statcan, then retry this verifier.',
    );
  }

  const [execution, workflowRun, workflowNode, itemEvidence] = await Promise.all([
    loadExecution(candidate.script_execution_id, options),
    loadWorkflowRun(candidate.workflow_run_record_id, options),
    loadWorkflowNode(candidate.workflow_node_run_record_id, options),
    loadItemEvidence(candidate.ingestion_run_id, options),
  ]);

  if (!candidate.script_execution_id) throw new Error('Ledger run is missing script_execution_id.');
  if (!candidate.workflow_run_record_id) throw new Error('Ledger run is missing workflow_run_record_id.');
  if (!candidate.workflow_node_run_record_id) throw new Error('Ledger run is missing workflow_node_run_record_id.');
  if (!candidate.temporal_workflow_id) throw new Error('Ledger run is missing temporal_workflow_id.');
  if (!candidate.temporal_run_id) throw new Error('Ledger run is missing temporal_run_id.');
  if (candidate.trigger_code !== 'WORKFLOW') {
    throw new Error(`Expected WORKFLOW trigger; found ${candidate.trigger_code || '(null)'}.`);
  }
  if (!execution) throw new Error('Linked auth.script_execution_log record was not found.');
  if (!workflowRun) throw new Error('Linked worker.workflow_run_records record was not found.');
  if (!workflowNode) throw new Error('Linked worker.workflow_node_run_records record was not found.');

  const executionMetadata = execution.metadata || {};
  const ledgerReference = getToolResultLedgerReference(execution);

  if (String(executionMetadata.launchChannel || '').toUpperCase() !== 'WORKFLOW') {
    throw new Error(`Script execution launchChannel is not WORKFLOW: ${executionMetadata.launchChannel || '(null)'}.`);
  }

  assertEqual(execution.script_name, candidate.tool_code, 'Script execution tool does not match ledger tool');
  assertEqual(executionMetadata.workflowRunRecordId, candidate.workflow_run_record_id, 'Script execution workflow-run reference does not match ledger');
  assertEqual(executionMetadata.workflowNodeRunRecordId, candidate.workflow_node_run_record_id, 'Script execution workflow-node reference does not match ledger');
  assertEqual(workflowNode.workflow_run_record_id, candidate.workflow_run_record_id, 'Workflow node does not belong to the ledger workflow run');
  assertEqual(workflowNode.target_code, candidate.tool_code, 'Workflow node target does not match ingestion tool');
  assertEqual(workflowRun.temporal_workflow_id, candidate.temporal_workflow_id, 'Temporal workflow ID does not match workflow ledger');
  assertEqual(workflowRun.temporal_run_id, candidate.temporal_run_id, 'Temporal run ID does not match workflow ledger');

  if (!ledgerReference?.persisted) {
    throw new Error('Structured ToolResult does not contain a persisted ingestionLedger reference.');
  }
  assertEqual(ledgerReference.ingestionRunId, candidate.ingestion_run_id, 'ToolResult ingestionLedger reference does not match durable ledger run');

  if (Number(itemEvidence.attempts || 0) < 1) {
    throw new Error('Workflow-linked ingestion run contains no durable item-attempt evidence.');
  }

  console.log('\nSkyCommand Phase 16.4.3 workflow ledger linkage proof');
  console.log('------------------------------------------------------------');
  console.log(`Ingestion run: ${candidate.ingestion_run_id}`);
  console.log(`Workflow: ${workflowRun.workflow_code}`);
  console.log(`Workflow run: ${candidate.workflow_run_record_id}`);
  console.log(`Workflow node: ${workflowNode.node_key} (${candidate.workflow_node_run_record_id})`);
  console.log(`Tool: ${candidate.tool_code}`);
  console.log(`Source: ${candidate.source_code}`);
  console.log(`Script execution: ${candidate.script_execution_id}`);
  console.log(`Temporal workflow: ${candidate.temporal_workflow_id}`);
  console.log(`Temporal run: ${candidate.temporal_run_id}`);
  console.log(`Ledger status: ${candidate.status_code}`);
  console.log(`Requested assets: ${candidate.items_requested}`);
  console.log(`Persisted item attempts: ${itemEvidence.attempts}`);
  console.log(`Distinct assets with evidence: ${itemEvidence.assets}`);
  console.log('✅ Workflow → node → tool execution → ingestion run linkage is complete.');
  console.log('✅ Script execution metadata and structured ToolResult point to the same durable ingestion run.');
  console.log('✅ Temporal workflow/run identifiers reconcile with the SkyCommand workflow run record.');
  console.log('✅ Durable per-asset attempt evidence is queryable from PostgreSQL.');

  return {
    candidate,
    execution,
    workflowRun,
    workflowNode,
    itemEvidence,
  };
}

async function main() {
  try {
    await verify(parseArgs());
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (db?.end) await db.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getToolResultLedgerReference,
  loadCandidate,
  parseArgs,
  verify,
};
