#!/usr/bin/env node
// Phase 19.3B: one explicitly authorized continuation, with a stable admission key.
// Baseline/verify are read-only; execute uses the normal authenticated Session API.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { pool } = require('../packages/db/src/connection');

const A1_RUN = 'b374b95c-c064-4158-899b-f713339e801d';
const SESSION = '2a510df0-e0bb-4e78-8566-50cc0496cc6b';
const DIRECTORY = path.resolve(__dirname, '../artifacts/browser/tests/phase19-3b');
const BASELINE = path.join(DIRECTORY, 'a1-baseline.json');
const ACCEPTANCE = path.join(DIRECTORY, 'continuation-admission.json');
const VERIFICATION = path.join(DIRECTORY, 'continuation-verification.json');
const INSTRUCTION = 'Continue this existing SkyCommand Session. First return a brief safe summary of what the immediately preceding user task in this provider conversation asked you to do, using only conversation context available through the resumed provider Session. Then execute the single allowlisted read-only Browser Automation capability available to this Agent profile and return the registered structured result. Do not use shell, Git, Docker, filesystem writes, database access, external messaging, spawning, plugins/apps, alternate tools, or any unregistered capability.';
const IDEMPOTENCY_KEY = 'phase19-3b-real-continuation-20261002-' + SESSION;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save = (file, value) => { fs.mkdirSync(DIRECTORY, { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };

async function api(route, body) {
  const response = await fetch('http://127.0.0.1:7171/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-skycommand-internal-token': process.env.SKYCOMMAND_INTERNAL_API_TOKEN, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.code || value.details?.code || 'API_REQUEST_FAILED'); error.code = value.code || value.details?.code; error.status = response.status; throw error; }
  return value;
}

async function evidence(runId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = {};
    for (const [table, order] of [
      ['agent_runs', 'agent_run_id'], ['agent_turns', 'agent_turn_id'],
      ['agent_provider_operations', 'provider_operation_id'], ['agent_results', 'agent_run_id'],
      ['agent_capability_effects', 'agent_capability_effect_id'],
    ]) {
      // The table names/order expressions above are fixed source constants.
      const rows = await client.query(`SELECT to_jsonb(t) AS value FROM worker.${table} t WHERE agent_run_id=$1 ORDER BY ${order}`, [runId]);
      result[table] = { count: rows.rowCount, digest: digest(rows.rows.map((row) => row.value)) };
    }
    await client.query('ROLLBACK');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function baseline() {
  const original = await api('/agent-runs/' + A1_RUN);
  assert.equal(original.sessionId, SESSION);
  assert.equal(original.status, 'COMPLETED');
  const historical = await evidence(A1_RUN);
  if (fs.existsSync(BASELINE)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(BASELINE)).evidence, historical, 'Historical A1 evidence changed');
  } else save(BASELINE, { capturedAt: new Date().toISOString(), originalRunId: A1_RUN, sessionId: SESSION, evidence: historical });
  console.log(JSON.stringify({ step: 'baseline', originalRunId: A1_RUN, sessionId: SESSION, evidence: historical }));
}

async function execute() {
  assert.ok(fs.existsSync(BASELINE), 'Capture baseline before admitting a provider Turn');
  assert.deepEqual(await evidence(A1_RUN), JSON.parse(fs.readFileSync(BASELINE)).evidence);
  if (fs.existsSync(ACCEPTANCE)) {
    console.log(JSON.stringify({ step: 'admission-already-recorded', ...JSON.parse(fs.readFileSync(ACCEPTANCE)) }));
    return;
  }
  const session = await api('/agent-sessions/' + SESSION);
  const detail = session.session || session;
  assert.equal(detail.continuationEligible, true, detail.continuationBlockReason || 'Session not eligible');
  assert.equal(detail.activeRunId, null);
  const admission = await api('/agent-sessions/' + SESSION + '/runs', { instruction: INSTRUCTION, idempotencyKey: IDEMPOTENCY_KEY });
  const runId = admission.runId || admission.run?.runId;
  assert.ok(runId && runId !== A1_RUN, 'Continuation must create a new Run');
  const packet = { acceptedAt: new Date().toISOString(), sessionId: SESSION, originalRunId: A1_RUN, newRunId: runId, idempotencyKey: IDEMPOTENCY_KEY, instructionDigest: digest(INSTRUCTION) };
  save(ACCEPTANCE, packet);
  console.log(JSON.stringify({ step: 'admission', ...packet }));
}

async function verify() {
  const accepted = JSON.parse(fs.readFileSync(ACCEPTANCE));
  const run = await api('/agent-runs/' + accepted.newRunId);
  if (!['COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'RECOVERY_REQUIRED'].includes(run.status)) {
    console.log(JSON.stringify({ step: 'waiting', newRunId: accepted.newRunId, status: run.status }));
    return;
  }
  const old = await api('/agent-runs/' + A1_RUN);
  assert.deepEqual(await evidence(A1_RUN), JSON.parse(fs.readFileSync(BASELINE)).evidence, 'Original A1 evidence is immutable');
  assert.equal(run.sessionId, SESSION);
  const client = await pool.connect();
  let proof;
  try {
    await client.query('BEGIN READ ONLY');
    const turns = await client.query('SELECT agent_run_id,agent_turn_id,provider_turn_id,provider_session_reference,status FROM worker.agent_turns WHERE agent_run_id=ANY($1::uuid[]) ORDER BY created_at', [[A1_RUN, accepted.newRunId]]);
    const oldTurn = turns.rows.find((row) => row.agent_run_id === A1_RUN);
    const newTurns = turns.rows.filter((row) => row.agent_run_id === accepted.newRunId);
    const operations = await client.query('SELECT provider_operation_id,state,outcome_certainty FROM worker.agent_provider_operations WHERE agent_run_id=$1', [accepted.newRunId]);
    const leases = await client.query("SELECT lease_state FROM worker.agent_resource_leases WHERE session_id=$1 AND lease_kind='SESSION_RUN' AND lease_state IN ('ACTIVE','QUARANTINED')", [SESSION]);
    const grants = await client.query('SELECT execution_grant_id,grant_kind,grant_state,credential_expires_at,revoked_at FROM auth.execution_grants WHERE agent_run_id=$1', [accepted.newRunId]);
    const events = await client.query("SELECT agent_run_id,payload FROM worker.agent_events WHERE agent_run_id=ANY($1::uuid[]) AND event_type='PROVIDER_OPERATION_ACCEPTED' ORDER BY event_sequence", [[A1_RUN, accepted.newRunId]]);
    const oldAcceptance = events.rows.find((row) => row.agent_run_id === A1_RUN)?.payload;
    const newAcceptance = events.rows.find((row) => row.agent_run_id === accepted.newRunId)?.payload;
    const artifacts = await client.query('SELECT COUNT(*)::int AS count FROM worker.agent_capability_effects ce JOIN worker.browser_automation_artifacts ba ON ba.browser_automation_run_id=ce.browser_automation_run_id WHERE ce.agent_run_id=$1', [accepted.newRunId]);
    const oldGrants = await client.query('SELECT execution_grant_id,grant_state FROM auth.execution_grants WHERE agent_run_id=$1', [A1_RUN]);
    const binding = await client.query('SELECT execution_context FROM worker.agent_runs WHERE agent_run_id=$1', [accepted.newRunId]);
    const pinnedConversation = binding.rows[0].execution_context?.sessionBinding?.providerConversation;
    proof = { sameProviderConversation: !!oldAcceptance?.threadId && oldAcceptance.threadId === newAcceptance?.threadId,
      conversationPinMatches: pinnedConversation?.conversationReference === oldAcceptance?.threadId && pinnedConversation?.providerSessionReference === oldTurn.provider_session_reference,
      sameProviderSessionReference: newTurns.length === 1 && oldTurn.provider_session_reference === newTurns[0].provider_session_reference,
      conversationReferenceSha256: digest(oldAcceptance?.threadId || null),
      providerReferenceSha256: digest(oldTurn.provider_session_reference), originalTurnId: oldTurn.provider_turn_id,
      newTurns: newTurns.map(({ provider_session_reference, ...row }) => row), providerOperations: operations.rows,
      blockingLeaseCount: leases.rowCount, grants: grants.rows, originalGrants: oldGrants.rows,
      freshGrantIdentities: grants.rows.every((grant) => !oldGrants.rows.some((oldGrant) => oldGrant.execution_grant_id === grant.execution_grant_id)),
      browserArtifactCount: artifacts.rows[0].count };
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  const session = await api('/agent-sessions/' + SESSION);
  const detail = session.session || session;
  const taskOutput = run.result?.result?.taskOutput || null;
  const packet = { verifiedAt: new Date().toISOString(), ...accepted, status: run.status, proof,
    originalEvidenceUnchanged: true, originalInstruction: old.instruction || null,
    taskOutput, capabilityEffects: (run.capabilityEffects || []).map((effect) => ({ effectId: effect.effectId, capabilityCode: effect.capabilityCode,
      dispatchState: effect.dispatchState, outcomeCertainty: effect.outcomeCertainty, browserAutomationRunId: effect.browserAutomationRunId,
      nativeBrowserExecutionId: effect.nativeBrowserExecutionId })), session: { status: detail.status, runCount: detail.runCount,
      continuationEligible: detail.continuationEligible, continuationBlockReason: detail.continuationBlockReason,
      timelineRunIds: (detail.runs || []).map((entry) => entry.runId) } };
  save(VERIFICATION, packet);
  console.log(JSON.stringify({ step: 'terminal', ...packet }));
  assert.equal(run.status, 'COMPLETED');
  assert.equal(proof.sameProviderConversation, true);
  assert.equal(proof.sameProviderSessionReference, true);
  assert.equal(proof.conversationPinMatches, true);
  assert.equal(proof.freshGrantIdentities, true);
  assert.ok(proof.grants.length > 0);
  assert.ok(proof.grants.every((grant) => grant.grant_state !== 'ACTIVE'));
  assert.equal(proof.browserArtifactCount, 1);
  assert.equal(proof.newTurns.length, 1);
  assert.notEqual(proof.originalTurnId, proof.newTurns[0].provider_turn_id);
  assert.equal(proof.providerOperations.length, 1);
  assert.equal(proof.blockingLeaseCount, 0);
  assert.equal(detail.continuationEligible, true);
  assert.equal(packet.capabilityEffects.length, 1);
  assert.equal(packet.capabilityEffects[0].capabilityCode, 'command-center-status-snapshot');
  assert.equal(packet.capabilityEffects[0].dispatchState, 'COMPLETED');
  assert.ok(packet.capabilityEffects[0].browserAutomationRunId);
  assert.ok(taskOutput?.previous_task_summary);
}

async function redeliver() {
  const accepted = JSON.parse(fs.readFileSync(ACCEPTANCE));
  const before = await evidence(accepted.newRunId);
  const replay = await api('/agent-sessions/' + SESSION + '/runs', { instruction: INSTRUCTION, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(replay.runId || replay.run?.runId, accepted.newRunId);
  let conflict = false;
  try { await api('/agent-sessions/' + SESSION + '/runs', { instruction: INSTRUCTION + ' Changed input.', idempotencyKey: IDEMPOTENCY_KEY }); }
  catch (error) { assert.equal(error.status, 409); assert.match(error.code, /IDEMPOTENCY_CONFLICT/); conflict = true; }
  assert.equal(conflict, true);
  assert.deepEqual(await evidence(accepted.newRunId), before, 'Redelivery cannot create another Turn/effect/result');
  const packet = { newRunId: accepted.newRunId, duplicateReturnedOriginalRun: true, changedInputConflict: true, immutableExecutionUnchanged: true };
  save(path.join(DIRECTORY, 'continuation-idempotency.json'), packet);
  console.log(JSON.stringify(packet));
}

const command = process.argv[2];
const operation = { baseline, execute, verify, redeliver }[command];
if (!operation) throw new Error('Use baseline, execute, or verify. Execute is the single authorized live acceptance.');
operation().catch((error) => { console.error(JSON.stringify({ error: error.code || error.message, status: error.status || null })); process.exitCode = 1; }).finally(() => pool.end());
