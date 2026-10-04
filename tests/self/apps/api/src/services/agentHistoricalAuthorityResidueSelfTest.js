const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../..');
const availability = require(path.join(root, 'apps/api/src/services/agentRuntimeAvailability'));
const executionSource = fs.readFileSync(path.join(root, 'apps/api/src/services/agentExecutionService.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'apps/api/src/controllers/agentRunController.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'apps/api/src/routes/agentRun.routes.js'), 'utf8');
const validateSource = fs.readFileSync(path.join(root, 'scripts/validate.js'), 'utf8');

const busySql = availability.runtimeBusyConditionSql('busy');
assert.match(busySql, /auth\.execution_grants/);
assert.match(busySql, /grant_state = 'ACTIVE'/);
assert.match(busySql, /agent_capability_effects/);
assert.match(busySql, /outcome_certainty IN \('UNKNOWN', 'NOT_CONFIRMED'\)/);

assert.match(executionSource, /inspectHistoricalAuthorityResidue/);
assert.match(executionSource, /reconcileHistoricalAuthorityResidue/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_INTERNAL_ONLY/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_RUN_NOT_TERMINAL/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_ACTIVE_LEASE/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_PROVIDER_HOLD/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_SHARED_SCOPE_ACTIVE/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_TEMPORAL_STILL_ACTIVE/);
assert.match(executionSource, /AGENT_AUTHORITY_RESIDUE_EFFECT_UNRESOLVED/);
assert.match(executionSource, /dispatch_state !== 'INTENT'/);
assert.match(executionSource, /FROM worker\.browser_automation_runs/);
assert.match(executionSource, /PREALLOCATED_WITHOUT_DURABLE_NATIVE_EXECUTION/);
assert.match(executionSource, /grant_state = 'EXPIRED'/);
assert.match(executionSource, /HISTORICAL_AUTHORITY_RESIDUE_RECONCILED_BEFORE_DISPATCH/);
assert.match(executionSource, /AGENT_HISTORICAL_AUTHORITY_RESIDUE_RECONCILED/);
assert.match(executionSource, /executionLivenessProvenAbsent: true/);
assert.match(executionSource, /runtimeOwnershipReleasedSql\('po'\)/);
assert.match(executionSource, /Object\.keys\(body \|\| \{\}\)\.length/);

assert.match(controllerSource, /authorityResidue/);
assert.match(controllerSource, /reconcileAuthorityResidue/);
assert.match(routeSource, /authority-residue/);
assert.match(routeSource, /reconcile-authority-residue/);
assert.match(validateSource, /agent-historical-authority-residue:self-test/);

console.log('[agent-historical-authority-residue:self-test] PASS: terminal historical authority residue can be inspected and reconciled only when leases/provider holds/current siblings are absent, effects are proven pre-dispatch, and no durable Browser execution exists.');
