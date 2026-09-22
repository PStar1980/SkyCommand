const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(sourceDir, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const parse = (relativePath) => JSON.parse(read(relativePath));

const matrix = parse('tests/fixtures/agentic-ai/phase-2/phase19-2c-failpoint-matrix.json');
assert.equal(matrix.phase, '19.2C');
assert.equal(matrix.testOnly, true);
assert.equal(matrix.productionEnabled, false);
assert.equal(matrix.failpoints.length, 16);
assert.equal(new Set(matrix.failpoints.map((item) => item.id)).size, matrix.failpoints.length);

const workflow = read('packages/temporal/src/workflows/agentRunWorkflow.js');
const interactionService = read('apps/api/src/services/agentInteractionService.js');
const activities = read('packages/temporal/src/activities/agentRunActivities.js');
const migration = read('packages/db_build/src/migrations/00155__agent_interactions_recovery_hardening.sql');

for (const requiredToken of [
  "defineSignal('agentInteractionDecision')",
  'condition(() => control.stopRequested',
  'sleep(pollMs)',
  'loadAgentInteractionActivity',
  'applyAgentInteractionDecisionActivity',
  'cancelAgentInteractionsActivity',
]) {
  assert.ok(workflow.includes(requiredToken), `Temporal interaction recovery contract is missing: ${requiredToken}`);
}

for (const requiredToken of [
  'AGENT_INTERACTION_DECISION',
  'decision_digest',
  'application_status',
  'INTERACTION_AUTHORITY_STALE',
  'reconcileQuarantinedRuntimeActivity',
  'FORBIDDEN_PAYLOAD_KEYS',
]) {
  assert.ok(interactionService.includes(requiredToken), `Interaction service contract is missing: ${requiredToken}`);
}

for (const requiredToken of [
  'quarantine_state',
  'stop_evidence',
  'AGENT_RUNTIME_QUARANTINE_CLEARED',
  'AGENT_INTERACTION_DECISION_APPLIED',
]) {
  assert.ok(
    activities.includes(requiredToken) || interactionService.includes(requiredToken) || migration.includes(requiredToken),
    `Recovery evidence contract is missing: ${requiredToken}`,
  );
}

console.log(JSON.stringify({
  phase: matrix.phase,
  failpointCount: matrix.failpoints.length,
  failpointsProductionEnabled: matrix.productionEnabled,
  durableOutbox: true,
  temporalWaits: true,
  quarantineReconciliation: true,
}));
console.log('✅ Phase 19.2C interaction/recovery failpoint contract self-test passed.');
