const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexAppServerClient } = require('../../../apps/codex-agent-runtime-worker/src/appServerClient');
const { startRuntimeActivity } = require('../../../apps/agent-runtime-worker/src/activities');

const binding = {
  mode: 'CONTINUE',
  priorRunId: 'dbde87ed-3a27-4f52-9c37-2fdc1804b667',
  providerConversation: { conversationReference: 'owned-thread', providerSessionReference: 'owned-tree' },
  adapterVersion: 'codex-app-server-readonly.v1',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'low',
};
const instruction = 'Continue from the preceding conversation task and run the single allowed capability.';
const request = { instruction, model: binding.model, reasoningEffort: binding.reasoningEffort, operationReference: 'new-operation', sessionBinding: binding };

function protocolClient(handler) {
  const client = new CodexAppServerClient({ executionEnabled: true });
  const requests = [];
  client.initialized = true;
  client.process = { exitCode: null, stdin: { write(value) {
    const message = JSON.parse(value);
    requests.push(message);
    const result = handler(message, client);
    if (result?.throwWrite) throw new Error('transport unavailable');
    queueMicrotask(() => client.handleProtocolMessage({ id: message.id, ...(result?.error ? { error: result.error } : { result: result || {} }) }));
    return true;
  } } };
  return { client, requests };
}

function completeTurn(client, turnId, message) {
  client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'owned-thread', turnId, delta: message } });
  client.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'owned-thread', turnId, status: 'completed', model: binding.model, effort: binding.reasoningEffort } });
}

const providerThread = { id: 'owned-thread', sessionId: 'owned-tree', status: { type: 'idle' }, ephemeral: false, model: binding.model, reasoningEffort: binding.reasoningEffort, turns: [{ id: 'old-turn', status: 'completed' }] };
const capabilityResult = { ok: true, effectId: 'effect-new', dispatchState: 'COMPLETED', outcomeCertainty: 'ACKNOWLEDGED', browserAutomationRunId: 'browser-new' };

(async () => {
  const first = protocolClient(({ method }) => method === 'thread/start' ? { thread: { id: 'first-thread', sessionId: 'first-tree' } } : { turn: { id: 'first-turn' } });
  await first.client.submitManagedTurn({ instruction: 'first task' });
  assert.deepEqual(first.requests.map(({ method }) => method), ['thread/start', 'turn/start']);
  assert.equal(first.requests[1].params.outputSchema, undefined, 'A1 first-turn output behavior stays compatible');

  const resumed = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'new-turn' } });
  const accepted = await resumed.client.submitManagedTurn(request);
  assert.equal(accepted.sendAcceptance, 'ACKNOWLEDGED');
  assert.equal(accepted.threadId, binding.providerConversation.conversationReference);
  assert.equal(accepted.providerSessionReference, binding.providerConversation.providerSessionReference);
  assert.equal(accepted.providerOperationReference, 'new-operation');
  assert.deepEqual(resumed.requests.map(({ method }) => method), ['thread/resume', 'turn/start']);
  assert.deepEqual(resumed.requests[0].params, { threadId: 'owned-thread', model: binding.model });
  assert.equal(resumed.requests[1].params.threadId, 'owned-thread');
  assert.equal(resumed.requests[1].params.input[0].text, instruction, 'Prior instruction is not embedded in continuation input');
  assert.ok(resumed.requests[1].params.outputSchema.required.includes('previous_task_summary'));
  completeTurn(resumed.client, 'new-turn', JSON.stringify({ previous_task_summary: 'The preceding task requested a read-only status snapshot.', capability_result: capabilityResult }));
  const observed = await resumed.client.observeManagedTurn({ providerTurnId: 'new-turn', providerSessionReference: 'owned-tree', threadId: 'owned-thread', model: binding.model, reasoningEffort: binding.reasoningEffort, timeoutMs: 1000 });
  assert.equal(observed.providerTerminalFailure, false);
  assert.equal(observed.taskOutputCandidate.previous_task_summary, 'The preceding task requested a read-only status snapshot.');
  assert.deepEqual(observed.taskOutputCandidate.capability_result, capabilityResult);

  // R5D: provisional and final assistant items must remain item-scoped. The
  // final structured result cannot be concatenated with the pre-tool message.
  const multi = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'multi-turn' } });
  await multi.client.submitManagedTurn(request);
  const provisional = JSON.stringify({
    previous_task_summary: 'The preceding task requested a read-only status snapshot.',
    capability_result: { ok: false, effectId: '', dispatchState: 'PENDING', outcomeCertainty: 'PENDING', browserAutomationRunId: '' },
  });
  const finalResult = JSON.stringify({
    previous_task_summary: 'The preceding task requested the governed read-only status snapshot.',
    capability_result: capabilityResult,
  });
  multi.client.handleProtocolMessage({ method: 'item/started', params: { threadId: 'owned-thread', turnId: 'multi-turn', item: { id: 'msg-provisional', type: 'agentMessage' } } });
  multi.client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'owned-thread', turnId: 'multi-turn', itemId: 'msg-provisional', delta: provisional } });
  multi.client.handleProtocolMessage({ method: 'item/completed', params: { threadId: 'owned-thread', turnId: 'multi-turn', item: { id: 'msg-provisional', type: 'agentMessage' } } });
  multi.client.handleProtocolMessage({ method: 'item/started', params: { threadId: 'owned-thread', turnId: 'multi-turn', item: { id: 'msg-final', type: 'agentMessage' } } });
  multi.client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'owned-thread', turnId: 'multi-turn', itemId: 'msg-final', delta: finalResult } });
  multi.client.handleProtocolMessage({ method: 'item/completed', params: { threadId: 'owned-thread', turnId: 'multi-turn', item: { id: 'msg-final', type: 'agentMessage' } } });
  multi.client.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'owned-thread', turnId: 'multi-turn', status: 'completed', model: binding.model, effort: binding.reasoningEffort } });
  const multiObserved = await multi.client.observeManagedTurn({ providerTurnId: 'multi-turn', providerSessionReference: 'owned-tree', threadId: 'owned-thread', model: binding.model, reasoningEffort: binding.reasoningEffort, timeoutMs: 1000 });
  assert.equal(multiObserved.providerTerminalFailure, false);
  assert.equal(multiObserved.taskOutputCandidate.message, finalResult);
  assert.equal(multiObserved.taskOutputCandidate.previous_task_summary, 'The preceding task requested the governed read-only status snapshot.');
  assert.deepEqual(multiObserved.taskOutputCandidate.capability_result, capabilityResult);
  for (const change of [{ model: 'unapproved-effective-model', effort: binding.reasoningEffort }, { model: binding.model, effort: 'high' }]) {
    const drift = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'drift-turn' } });
    await drift.client.submitManagedTurn(request);
    drift.client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'owned-thread', turnId: 'drift-turn', delta: JSON.stringify({ previous_task_summary: 'Read-only snapshot.', capability_result: capabilityResult }) } });
    drift.client.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'owned-thread', turnId: 'drift-turn', status: 'completed', ...change } });
    const terminalDrift = await drift.client.observeManagedTurn({ providerTurnId: 'drift-turn', timeoutMs: 1000 });
    assert.equal(terminalDrift.sendAcceptance, 'ACKNOWLEDGED');
    assert.equal(terminalDrift.providerTerminalFailure, true);
    assert.equal(terminalDrift.providerErrorCode, 'CODEX_SESSION_MODEL_INCOMPATIBLE');
    assert.equal(drift.requests.filter(({ method }) => method === 'turn/start').length, 1);
  }
  const reroute = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'reroute-turn' } });
  await reroute.client.submitManagedTurn(request);
  reroute.client.handleProtocolMessage({ method: 'model/rerouted', params: { threadId: 'owned-thread', turnId: 'reroute-turn', toModel: 'unapproved-rerouted-model', reason: 'unavailable' } });
  reroute.client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'owned-thread', turnId: 'reroute-turn', delta: JSON.stringify({ previous_task_summary: 'Read-only snapshot.', capability_result: capabilityResult }) } });
  reroute.client.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'owned-thread', turnId: 'reroute-turn', status: 'completed' } });
  const reroutedResult = await reroute.client.observeManagedTurn({ providerTurnId: 'reroute-turn', timeoutMs: 1000 });
  assert.equal(reroutedResult.observedModel, 'unapproved-rerouted-model');
  assert.equal(reroutedResult.providerTerminalFailure, true);
  assert.equal(reroutedResult.providerErrorCode, 'CODEX_SESSION_MODEL_INCOMPATIBLE');

  // A fresh process has no old in-memory Turn. It reattaches the exact durable
  // conversation, then admits one new provider Turn.
  const restarted = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'restart-turn' } });
  assert.equal(restarted.client.providerTurns.size, 0);
  await restarted.client.submitManagedTurn({ ...request, operationReference: 'restart-operation' });
  assert.deepEqual(restarted.requests.map(({ method }) => method), ['thread/resume', 'turn/start']);
  const uncertainBefore = restarted.requests.length;
  assert.equal((await restarted.client.reconcileManagedTurn({ providerTurnId: 'unknown-prior-turn', providerSessionReference: 'owned-tree', operationReference: 'uncertain-prior-operation' })).disposition, 'RECOVERY_REQUIRED');
  assert.equal(restarted.requests.length, uncertainBefore, 'Unknown operation reconciliation never sends another Turn');

  for (const badThread of [
    { ...providerThread, id: 'different-thread' },
    { ...providerThread, sessionId: 'different-tree' },
    { ...providerThread, sessionId: null },
    { ...providerThread, model: 'unapproved-model' },
    { ...providerThread, reasoningEffort: 'high' },
    { ...providerThread, turns: [{ id: 'still-active', status: 'inProgress' }] },
    { ...providerThread, status: { type: 'active', activeFlags: [] } },
    { ...providerThread, status: { type: 'systemError' } },
    { ...providerThread, ephemeral: true },
  ]) {
    const denied = protocolClient(() => ({ thread: badThread }));
    await assert.rejects(denied.client.submitManagedTurn(request), (error) => ['CODEX_SESSION_BINDING_MISMATCH', 'CODEX_SESSION_MODEL_INCOMPATIBLE', 'CODEX_SESSION_PROVIDER_TURN_ACTIVE', 'CODEX_SESSION_RESUME_UNAVAILABLE'].includes(error.code));
    assert.deepEqual(denied.requests.map(({ method }) => method), ['thread/resume']);
  }
  const missing = protocolClient(() => ({ error: { code: -32602, message: 'unknown thread' } }));
  await assert.rejects(missing.client.submitManagedTurn(request), { code: 'CODEX_SESSION_RESUME_UNAVAILABLE' });
  assert.deepEqual(missing.requests.map(({ method }) => method), ['thread/resume'], 'Resume denial cannot silently create a replacement thread');
  const badSelection = protocolClient(() => { throw new Error('must not make RPC'); });
  await assert.rejects(badSelection.client.submitManagedTurn({ ...request, model: 'unapproved-model' }), { code: 'CODEX_SESSION_MODEL_INCOMPATIBLE' });
  assert.equal(badSelection.requests.length, 0);

  const noTurnReference = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: {} });
  const noReference = await noTurnReference.client.submitManagedTurn(request);
  assert.equal(noReference.sendAcceptance, 'UNKNOWN');
  assert.equal(noReference.recoveryRequired, true);
  assert.equal(noReference.providerErrorCode, 'CODEX_TURN_REFERENCE_MISSING');
  assert.equal(noTurnReference.requests.filter(({ method }) => method === 'turn/start').length, 1);

  const lostResponse = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { throwWrite: true });
  const lost = await lostResponse.client.submitManagedTurn(request);
  assert.equal(lost.sendAcceptance, 'UNKNOWN');
  assert.equal(lost.recoveryRequired, true);
  assert.equal(lost.providerErrorCode, 'CODEX_RPC_WRITE_FAILED');
  assert.equal(lostResponse.client.pending.size, 0);
  assert.equal(lostResponse.requests.filter(({ method }) => method === 'turn/start').length, 1);

  const definiteRejection = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { error: { code: -32602, message: 'unsupported turn' } });
  await assert.rejects(definiteRejection.client.submitManagedTurn(request), { code: 'CODEX_RPC_ERROR' });
  assert.equal(definiteRejection.requests.filter(({ method }) => method === 'turn/start').length, 1);

  const invalidResult = protocolClient(({ method }) => method === 'thread/resume' ? { thread: providerThread } : { turn: { id: 'invalid-result-turn' } });
  await invalidResult.client.submitManagedTurn(request);
  completeTurn(invalidResult.client, 'invalid-result-turn', 'Missing the required structured continuation summary.');
  const invalid = await invalidResult.client.observeManagedTurn({ providerTurnId: 'invalid-result-turn', timeoutMs: 1000 });
  assert.equal(invalid.sendAcceptance, 'ACKNOWLEDGED', 'Invalid result does not erase provider acceptance');
  assert.equal(invalid.providerTerminalFailure, true);
  assert.equal(invalid.providerErrorCode, 'CODEX_CONTINUATION_RESULT_INVALID');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-continuation-test-'));
  const tokenPath = path.join(scratch, 'bridge-test-token');
  fs.writeFileSync(tokenPath, 'x'.repeat(64));
  const originalTokenPath = process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE;
  const originalRuntimeTokenPath = process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE;
  const originalFetch = global.fetch;
  process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE = tokenPath;
  process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE = tokenPath;
  let bridgeBody;
  global.fetch = async (_url, options) => {
    bridgeBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, result: { sendAcceptance: 'ACKNOWLEDGED', providerTurnId: 'bridge-turn' } }) };
  };
  try {
    await startRuntimeActivity({ runtimeKind: 'OPENAI_CODEX_APP_SERVER', instruction, sessionBinding: binding, providerModel: binding.model, providerReasoningEffort: binding.reasoningEffort });
    assert.deepEqual(bridgeBody.sessionBinding, binding, 'Provider-neutral runtime activity preserves the admission binding');
    const { observeCodexRuntime } = require('../../../apps/codex-agent-runtime-worker/src/index');
    const runtimeClient = {
      executionEnabled: true,
      identity: () => ({ runtimeGeneration: 'test-generation' }),
      observeManagedTurn: async () => observed,
      readRateLimits: async () => null,
      readUsage: async () => null,
      events: [],
    };
    let canonical = { ...capabilityResult, denied: false };
    global.fetch = async (url) => ({ ok: true, json: async () => url.endsWith('/context/result') ? { ok: true, invocation: canonical } : {} });
    const matched = await observeCodexRuntime({ providerTurnId: 'new-turn' }, runtimeClient);
    assert.equal(matched.providerTerminalFailure, false);
    canonical = { ...canonical, effectId: 'different-effect' };
    const mismatch = await observeCodexRuntime({ providerTurnId: 'new-turn' }, runtimeClient);
    assert.equal(mismatch.sendAcceptance, 'ACKNOWLEDGED');
    assert.equal(mismatch.providerTerminalFailure, true);
    assert.equal(mismatch.providerErrorCode, 'CODEX_CONTINUATION_CAPABILITY_RESULT_MISMATCH');
  } finally {
    global.fetch = originalFetch;
    if (originalTokenPath === undefined) delete process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE;
    else process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE = originalTokenPath;
    if (originalRuntimeTokenPath === undefined) delete process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE;
    else process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE = originalRuntimeTokenPath;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log('Phase 19.3B managed Codex continuation, restart reattach, structured result and unknown acceptance self-test passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
