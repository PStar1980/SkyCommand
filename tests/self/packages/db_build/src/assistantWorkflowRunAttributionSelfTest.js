const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function normalizeSql(sql) {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function statements(sql) {
  return normalizeSql(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function checkValues(sql, column) {
  const match = sql.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  assert.ok(match, `Missing ${column} check constraint.`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
}

function run() {
  const legacyRunSources = ['manual', 'api', 'scheduler', 'listener', 'child_workflow', 'system'];
  const legacyTriggerTypes = ['MANUAL', 'API', 'SCHEDULER', 'LISTENER', 'CHILD_WORKFLOW', 'SYSTEM'];
  const assistantRunSources = [...legacyRunSources, 'assistant'];
  const assistantTriggerTypes = [...legacyTriggerTypes, 'ASSISTANT'];

  const migration = read('packages/db_build/src/migrations/00128__assistant_workflow_run_attribution.sql');
  const migrationStatements = statements(migration);
  assert.deepEqual(migrationStatements, [
    'BEGIN',
    'ALTER TABLE worker.workflow_run_records DROP CONSTRAINT IF EXISTS workflow_run_records_run_source_check',
    "ALTER TABLE worker.workflow_run_records ADD CONSTRAINT workflow_run_records_run_source_check CHECK (run_source IN ( 'manual', 'api', 'scheduler', 'listener', 'child_workflow', 'system', 'assistant' ))",
    'ALTER TABLE worker.workflow_run_records DROP CONSTRAINT IF EXISTS workflow_run_records_trigger_type_check',
    "ALTER TABLE worker.workflow_run_records ADD CONSTRAINT workflow_run_records_trigger_type_check CHECK (trigger_type IN ( 'MANUAL', 'API', 'SCHEDULER', 'LISTENER', 'CHILD_WORKFLOW', 'SYSTEM', 'ASSISTANT' ))",
    'COMMIT',
  ]);
  assert.deepEqual(checkValues(migration, 'run_source'), assistantRunSources);
  assert.deepEqual(checkValues(migration, 'trigger_type'), assistantTriggerTypes);
  assert.deepEqual(assistantRunSources.slice(0, legacyRunSources.length), legacyRunSources);
  assert.deepEqual(assistantTriggerTypes.slice(0, legacyTriggerTypes.length), legacyTriggerTypes);
  assert.equal(assistantRunSources.at(-1), 'assistant');
  assert.equal(assistantTriggerTypes.at(-1), 'ASSISTANT');

  const canonicalTable = read('scripts/db/tables/worker.workflow_run_records.sql');
  assert.deepEqual(checkValues(canonicalTable, 'run_source'), assistantRunSources);
  assert.deepEqual(checkValues(canonicalTable, 'trigger_type'), assistantTriggerTypes);

  const historicalMigration = read('packages/db_build/src/migrations/00038__workflow_builder_foundation.sql');
  assert.deepEqual(checkValues(historicalMigration, 'run_source'), legacyRunSources);
  assert.deepEqual(checkValues(historicalMigration, 'trigger_type'), legacyTriggerTypes);

  const assistantService = read('apps/api/src/services/assistantIntegrationService.js');
  const promotionInputStart = assistantService.indexOf('const finalizationWorkflowRunId =');
  const promotionInputEnd = assistantService.indexOf('const result = await workflowAgentExecution.startWorkflow', promotionInputStart);
  assert.ok(promotionInputStart >= 0 && promotionInputEnd > promotionInputStart);
  const promotionInput = assistantService.slice(promotionInputStart, promotionInputEnd);
  assert.match(promotionInput, /triggerSource:\s*DEVELOPMENT_PROMOTION_TRIGGER_SOURCE/);
  assert.match(promotionInput, /triggerType:\s*DEVELOPMENT_PROMOTION_TRIGGER_TYPE/);
  assert.match(promotionInput, /finalizationWorkflowRunId/);
  assert.match(promotionInput, /idempotencyKey/);
  assert.match(assistantService, /const DEVELOPMENT_PROMOTION_TRIGGER_TYPE = 'ASSISTANT'/);
  assert.doesNotMatch(promotionInput, /runSource:\s*'assistant'/);
  assert.doesNotMatch(promotionInput, /runSource:\s*'api'/);
  assert.doesNotMatch(promotionInput, /triggerType:\s*'API'/);

  console.log('[assistant-workflow-run-attribution:self-test] PASS');
}

run();
