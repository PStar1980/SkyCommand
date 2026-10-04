const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../..');
const availability = require(path.join(root, 'apps/api/src/services/agentRuntimeAvailability'));
const executionSource = fs.readFileSync(path.join(root, 'apps/api/src/services/agentExecutionService.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(root, 'apps/api/src/services/agentSessionService.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'apps/api/src/controllers/agentRunController.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'apps/api/src/routes/agentRun.routes.js'), 'utf8');

const busySql = availability.runtimeBusyConditionSql('busy');
assert.match(busySql, /RECOVERY_REQUIRED/);
assert.match(busySql, /auth\.execution_grants/);
assert.match(busySql, /grant_state = 'ACTIVE'/);
assert.match(busySql, /agent_capability_effects/);
assert.match(busySql, /dispatch_state IN \('INTENT', 'DISPATCHING', 'DISPATCHED', 'RECONCILING'\)/);
assert.match(busySql, /runtimeOwnershipRelease/);
assert.match(busySql, /released/);
assert.throws(() => availability.runtimeBusyConditionSql('bad;alias'));

const marker = availability.releaseMarker({
  previousRuntimeGeneration: 'old-generation',
  currentRuntimeGeneration: 'new-generation',
  sourceCursor: 'runtime-hold:test',
  releasedAt: '2026-10-02T00:00:00.000Z',
});
assert.deepEqual(marker, {
  contract: 'agent_runtime_ownership_release.v1',
  released: true,
  outcomePreservedAsUnknown: true,
  previousRuntimeGeneration: 'old-generation',
  currentRuntimeGeneration: 'new-generation',
  sourceCursor: 'runtime-hold:test',
  releasedAt: '2026-10-02T00:00:00.000Z',
});

assert.match(executionSource, /releaseHistoricalRuntimeHold/);
assert.match(executionSource, /AGENT_RUNTIME_HOLD_RELEASE_INTERNAL_ONLY/);
assert.match(executionSource, /AGENT_RUNTIME_HOLD_RELEASE_GENERATION_UNPROVEN/);
assert.match(executionSource, /AGENT_RUNTIME_HOLD_RELEASE_GENERATION_STILL_CURRENT/);
assert.match(executionSource, /AGENT_RUNTIME_HOLD_RELEASE_EFFECT_UNRESOLVED/);
assert.match(executionSource, /AGENT_RUNTIME_HOLD_TEMPORAL_STILL_ACTIVE/);
assert.match(executionSource, /runtimeOwnershipReleased: true/);
assert.match(executionSource, /providerOutcomePreservedAsUnknown: true/);
assert.match(executionSource, /grant_state = 'REVOKED'/);
assert.match(executionSource, /HISTORICAL_RUNTIME_OWNERSHIP_RELEASED_BEFORE_DISPATCH/);

assert.match(executionSource, /FROM worker\.browser_automation_runs/);
assert.match(executionSource, /managed_effect_id = \$1/);
assert.match(executionSource, /PREALLOCATED_WITHOUT_DURABLE_NATIVE_EXECUTION/);
assert.match(executionSource, /nativeBrowserIdentityDisposition/);
assert.doesNotMatch(executionSource, /native_browser_execution_id IS NULL AND native_browser_workflow_id IS NULL AND browser_automation_run_id IS NULL/);
assert.match(executionSource, /lease_state = 'RELEASED'/);
assert.match(executionSource, /state = 'RECOVERY_REQUIRED'/);
assert.match(executionSource, /AGENT_HISTORICAL_RUNTIME_OWNERSHIP_RELEASED/);
assert.match(executionSource, /runtimeBusyConditionSql\('busy'\)/);
assert.match(sessionSource, /runtimeBusyConditionSql\('occupied'\)/);
assert.match(controllerSource, /releaseRuntimeHold/);
assert.match(routeSource, /release-runtime-hold/);

console.log('[agent-historical-runtime-hold-release:self-test] PASS: unknown outcome is preserved while stale runtime ownership requires generation fencing, authority revocation, effect safety, and lease release.');
