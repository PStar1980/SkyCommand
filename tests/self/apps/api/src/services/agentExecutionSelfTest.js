const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('packages/db_build/src/migrations/00151__agent_run_kernel.sql');
const seed = read('packages/db_build/src/seeds/00152__agent_run_permissions_and_fake_runtime.sql');
const service = read('apps/api/src/services/agentExecutionService.js');
const dispatcher = read('apps/api/src/services/agentRunDispatcher.js');
const routes = `${read('apps/api/src/routes/agentRun.routes.js')}\n${read('apps/api/src/routes/executionScope.routes.js')}`;
const { projectRuntimeIdentity } = require(path.join(root, 'apps/api/src/services/agentRuntimeProjection.js'));

assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.execution_scopes/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_runs/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_authority_snapshots/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.execution_outbox/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_provider_operations/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_events/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_results/);
assert.match(migration, /agent_authority_snapshots_immutable/);
assert.match(migration, /agent_results_immutable/);
assert.match(migration, /uq_agent_session_active_run_lease/);
assert.match(migration, /INTERNAL_FAKE_FIXTURE/);
assert.doesNotMatch(migration, /DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE/i);

for (const permission of ['AGENT_RUN', 'AGENT_RUN_CANCEL_OWN', 'AGENT_RUN_CANCEL_PROJECT', 'AGENT_ROOT_STOP']) {
  assert.match(seed, new RegExp(`'${permission}'`));
}
assert.match(seed, /FAKE_PERSISTENT/);
assert.match(seed, /FAKE_EPHEMERAL/);
assert.match(seed, /sourceControlledFixture/);
assert.doesNotMatch(seed, /Codex|OpenClaw|Claude|providerCredential/i);

assert.match(service, /normalizePublicRequest/);
assert.match(service, /JOIN core\.agent_runtime_installations i ON i\.installation_id = ar\.installation_id/);
assert.match(service, /JOIN core\.agent_runtimes r ON r\.agent_runtime_id = i\.agent_runtime_id/);
assert.equal(projectRuntimeIdentity({ runtime_code: 'FAKE_PERSISTENT' }), 'FAKE_PERSISTENT');
assert.equal(projectRuntimeIdentity({ runtime_code: 'FAKE_EPHEMERAL' }), 'FAKE_EPHEMERAL');
assert.equal(projectRuntimeIdentity({}), 'UNKNOWN');
assert.match(service, /FORBIDDEN_INPUT_KEYS/);
assert.match(service, /Only source-controlled internal fake runtimes are executable/);
assert.match(service, /AGENT_IDEMPOTENCY_CONFLICT/);
assert.match(service, /executionContext/);
assert.match(service, /agent_authority_snapshots/);
assert.match(service, /auth\.execution_grants/);
assert.match(service, /revocation_epoch/);
assert.match(service, /taskQueue:\s*\{\s*name:\s*getAgentRuntimeTaskQueue\(\),\s*kind:\s*1\s*\},\s*taskQueueType:\s*2/s);
assert.match(service, /AGENT_RUNTIME_WORKER_UNAVAILABLE/);
assert.match(service, /requestedSurfaceModes/);
assert.match(service, /relevantDenials/);
assert.match(dispatcher, /stable_workflow_id/);
assert.match(dispatcher, /agentRunWorkflow/);
assert.match(dispatcher, /dispatch_state IN \('PENDING', 'RECONCILING', 'FAILED'\)/);
assert.match(dispatcher, /dispatch_state = 'DISPATCHING'.*claimed_at <= CURRENT_TIMESTAMP - INTERVAL '30 seconds'/s);
assert.match(read('packages/temporal/src/activities/agentRunActivities.js'), /\['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'\]\.includes\(run\.status\).*skipped/s);
assert.match(routes, /router\.post\(['"]\/:runId\/cancel/);
assert.match(routes, /router\.post\(['"]\/:scopeId\/stop/);

console.log('✅ Phase 19.2A Agent admission, outbox, journal, and API contract self-test passed.');
