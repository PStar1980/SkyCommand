const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function load(relativePath, overrides) {
  const filename = path.resolve(__dirname, '../../..', relativePath);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(filename, 'utf8'))((id) => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const run = {
  agent_run_id: 'run-test', session_id: 'session-test', execution_scope_id: 'scope-test', project_id: 'project-test',
  definition_id: 'definition-test', agent_revision: 1, status: 'RUNNING', scope_status: 'ACTIVE',
  runtime_code: 'OPENAI_CODEX_APP_SERVER', initiating_user_id: null,
  initiating_actor_kind: 'INTERNAL_SERVICE', initiating_actor_id: 'service-test',
  initiating_actor_snapshot: { kind: 'INTERNAL_SERVICE', id: 'service-test' }, trigger_source: 'MANUAL',
};
let statements = [];
const query = async (sql, values = []) => {
  statements.push({ sql, values });
  if (sql.includes('SELECT ar.*')) return { rows: [run], rowCount: 1 };
  if (sql.includes('MAX(event_sequence)')) return { rows: [{ next_sequence: 1 }], rowCount: 1 };
  if (sql.startsWith('INSERT INTO worker.agent_results')) return { rows: [{ agent_result_id: 'result-test' }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const db = { query, pool: { connect: async () => ({ query, release() {} }) } };
const { finalizeAgentRunActivity } = load('packages/temporal/src/activities/agentRunActivities.js', {
  '../../../db/src/connection': db,
  '../../../../apps/api/src/services/agentCapabilityAuthorizationService': {},
  '../../../../apps/api/src/services/agentInteractionService': {},
});
const { continuationBlockReason } = load('apps/api/src/services/agentSessionService.js', {
  '../../../../packages/db/src/connection': db,
});
const operation = { operationId: 'operation-test', turnId: 'turn-test', providerOperationReference: 'owned-operation' };
const completed = {
  providerBacked: true, runtimeKind: 'OPENAI_CODEX_APP_SERVER', adapterVersion: 'codex-app-server-readonly.v1',
  sendAcceptance: 'ACKNOWLEDGED', outcomeCertainty: 'ACKNOWLEDGED', providerTerminalStatus: 'COMPLETED', recoveryRequired: false,
  providerTurnId: 'owned-turn', providerSessionReference: 'owned-tree', providerOperationReference: 'owned-operation',
  taskOutputCandidate: { previous_task_summary: 'Read-only preceding task.' }, worker: {}, events: [],
};

(async () => {
  for (const uncertainty of [
    { outcomeCertainty: 'UNKNOWN', providerTerminalStatus: 'UNKNOWN', recoveryRequired: true },
    { outcomeCertainty: 'UNKNOWN' },
    { providerTerminalStatus: 'UNKNOWN' },
    { recoveryRequired: true },
  ]) {
    statements = [];
    const finalized = await finalizeAgentRunActivity({ runId: run.agent_run_id, operation, runtimeResult: { ...completed, ...uncertainty } });
    assert.equal(finalized.status, 'RECOVERY_REQUIRED', 'Acknowledged submission never implies a confirmed terminal observation');
    assert.equal(finalized.summary.taskOutput, null);
    const provider = statements.find(({ sql }) => sql.startsWith('UPDATE worker.agent_provider_operations'));
    assert.deepEqual(provider.values.slice(1, 3), ['RECOVERY_REQUIRED', 'UNKNOWN']);
    const turn = statements.find(({ sql }) => sql.startsWith('UPDATE worker.agent_turns'));
    assert.equal(turn.values[3], 'RECOVERY_REQUIRED');
    const lease = statements.find(({ sql }) => sql.startsWith('UPDATE worker.agent_resource_leases'));
    assert.equal(lease.values[3], true, 'The provider lease stays quarantined while its outcome is unknown');
    assert.match(lease.sql, /WHEN \$2 = 'UNCONFIRMED' OR \$4::boolean THEN 'QUARANTINED'/);
    const session = statements.find(({ sql }) => sql.startsWith('UPDATE worker.agent_sessions'));
    assert.equal(session.values[1], 'RECOVERY_REQUIRED');
    assert.equal(continuationBlockReason({ status: session.values[1] }), 'SESSION_PROVIDER_CONTINUATION_OUTCOME_UNKNOWN');
    assert.equal(statements.some(({ sql }) => /INSERT INTO worker.agent_provider_operations/.test(sql)), false, 'Finalization does not allocate or replay a provider operation');
  }
  statements = [];
  const terminal = await finalizeAgentRunActivity({ runId: run.agent_run_id, operation, runtimeResult: completed });
  assert.equal(terminal.status, 'COMPLETED');
  assert.equal(statements.find(({ sql }) => sql.startsWith('UPDATE worker.agent_resource_leases')).values[3], false);
  console.log('Phase 19.3B acknowledged provider submission with unknown observation stays in recovery and cannot become resumable.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
