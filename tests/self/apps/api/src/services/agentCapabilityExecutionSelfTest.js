const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const grantSchema = read('packages/db_build/src/migrations/00151__agent_run_kernel.sql');
const migration = read('packages/db_build/src/migrations/00153__agent_capability_effects.sql');
const seed = read('packages/db_build/src/seeds/00154__agent_browser_capability_fixture.sql');
const authorization = read('apps/api/src/services/agentCapabilityAuthorizationService.js');
const browser = read('apps/api/src/services/browserAutomationExecutionService.js');
const workflow = read('packages/temporal/src/workflows/agentRunWorkflow.js');
const activities = read('packages/temporal/src/activities/agentRunActivities.js');
const fakeRuntime = require(path.join(root, 'packages/agents/src/fakeRuntime.js'));
const credentialService = require(path.join(root, 'apps/api/src/services/agentCapabilityAuthorizationService.js'));

assert.match(migration, /CREATE TABLE IF NOT EXISTS worker\.agent_capability_effects/);
assert.match(migration, /MANAGED_CAPABILITY/);
assert.match(migration, /credential_hash/);
assert.match(migration, /grant_metadata/);
for (const marker of ['execution_grant_id', 'granted_at', 'revoked_at', 'authority_snapshot_id', 'revocation_epoch']) {
  assert.match(grantSchema, new RegExp(marker));
}
assert.match(migration, /native_browser_workflow_id/);
assert.match(migration, /UNIQUE \(agent_run_id, effect_key\)/);
assert.match(migration, /CREATE OR REPLACE VIEW worker\.vw_browser_automation_runs/);
assert.doesNotMatch(migration, /credential\s+TEXT\s+NOT NULL/i);

assert.match(seed, /command-center-status-snapshot/);
assert.match(seed, /PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE/);
assert.match(seed, /managedCapabilities/);
assert.match(seed, /MANAGED_BROWSER_AUTOMATION_ONLY/);

for (const marker of [
  'MANAGED_CREDENTIAL_AUDIENCE',
  'BROWSER_AUTOMATION',
  'prepareManagedCapabilityEffect',
  'revokeBeforeDispatch',
  'dispatchManagedCapability',
  'PREALLOCATED_BEFORE_DISPATCH',
  'REVOCATION_EPOCH_CHANGED_BEFORE_DISPATCH',
  'simulatedUnknownDispatch',
]) assert.match(authorization, new RegExp(marker));
assert.match(authorization, /hashCredential\(credential\)/);
assert.match(authorization, /credential_hash/);
assert.match(authorization, /credentialReference/);
assert.match(authorization, /credentialFingerprint/);
assert.match(authorization, /issuedAt/);
assert.match(authorization, /revokedAt/);
assert.match(authorization, /isManagedCredentialValid/);
assert.match(authorization, /credential\s*:\s*managedCredential/);
assert.match(authorization, /WHERE e\.agent_capability_effect_id = \$1/);
assert.match(browser, /managedBrowserAccessClause/);
assert.match(browser, /managed_effect_id IS NULL/);
assert.match(browser, /managedContext/);
assert.match(browser, /preallocatedExecution/);
assert.match(workflow, /prepareManagedCapabilityEffectActivity/);
assert.match(workflow, /revokeManagedCapabilityBeforeDispatchActivity/);
assert.match(workflow, /dispatchManagedCapabilityActivity/);
assert.match(workflow, /redactedCapabilityInvocations/);
assert.match(activities, /prepareManagedCapabilityEffectActivity/);
assert.match(activities, /grant_state = 'EXPIRED'/);
assert.match(activities, /AGENT_CAPABILITY_EFFECT_RECORDED/);

const managed = fakeRuntime.executeFakeRuntime({
  caseId: 'browser-capability-duplicate-retry',
  runtimeKind: 'FAKE_PERSISTENT',
  operationId: 'operation-capability',
  runId: 'run-capability',
  sessionId: 'session-capability',
  instruction: 'invoke the bounded fake Browser capability',
  workerIdentity: 'agent-runtime-worker:test-generation',
  managedCapabilityRequest: {
    effectId: 'effect-1',
    effectKey: 'browser:command-center-status-snapshot:browser-capability-duplicate-retry',
    credential: 'raw-test-credential',
    audience: 'SKYCOMMAND_MANAGED_AGENT_CAPABILITY',
    capabilityKind: 'BROWSER_AUTOMATION',
    capabilityCode: 'command-center-status-snapshot',
    capabilityVersion: 'registered.v1',
    requestDigest: 'A'.repeat(64),
  },
});
assert.equal(managed.capabilityInvocations.length, 2);
assert.equal(managed.events.filter((event) => event.eventType === 'CAPABILITY_INVOCATION_REQUESTED').length, 2);
assert.ok(managed.capabilityInvocations.every((invocation) => invocation.credential === 'raw-test-credential'));
assert.ok(managed.events.every((event) => !JSON.stringify(event).includes('raw-test-credential')));
assert.equal(fakeRuntime.resolveFakeRuntimeCase('browser-capability-unknown-send', 'FAKE_PERSISTENT').sendAcceptance, 'UNKNOWN');

const rawCredential = 'raw-test-credential';
const grantId = '00000000-0000-4000-8000-000000000001';
const issuedAt = new Date(Date.now() - 1000).toISOString();
const expiresAt = new Date(Date.now() + 60_000).toISOString();
const grant = {
  execution_grant_id: grantId,
  grant_audience: credentialService.MANAGED_CREDENTIAL_AUDIENCE,
  credential_hash: credentialService.hashCredential(rawCredential),
  credential_expires_at: expiresAt,
  grant_state: 'ACTIVE',
  granted_at: issuedAt,
  revoked_at: null,
  revocation_epoch: 7,
  grant_metadata: { credentialReference: `grant:${grantId}` },
};
const effect = {
  managed_credential_reference: `grant:${grantId}`,
  authority_epoch: 7,
};
const run = { scope_revocation_epoch: 7 };
const safeCredential = credentialService.safeManagedCredential(effect, grant);
assert.equal(safeCredential.grantId, grantId);
assert.equal(safeCredential.reference, `grant:${grantId}`);
assert.equal(safeCredential.credentialFingerprint, grant.credential_hash);
assert.equal(safeCredential.issuedAt, issuedAt);
assert.equal(safeCredential.expiresAt, expiresAt);
assert.equal(safeCredential.state, 'ACTIVE');
assert.equal(credentialService.isManagedCredentialValid({ grant, credential: rawCredential, run, effect }), true);
assert.equal(credentialService.isManagedCredentialValid({ grant: { ...grant, grant_state: 'REVOKED' }, credential: rawCredential, run, effect }), false);
assert.equal(credentialService.isManagedCredentialValid({ grant: { ...grant, credential_expires_at: issuedAt }, credential: rawCredential, run, effect }), false);
assert.equal(credentialService.isManagedCredentialValid({ grant, credential: rawCredential, run: { scope_revocation_epoch: 8 }, effect }), false);
assert.equal(credentialService.isManagedCredentialValid({ grant, credential: 'wrong-credential', run, effect }), false);
assert.notEqual(safeCredential.credentialFingerprint, rawCredential);
assert.doesNotMatch(JSON.stringify(safeCredential), /raw-test-credential/);

console.log('✅ Phase 19.2B managed capability authorization/effect contract self-test passed.');
