const assert = require('node:assert/strict');

const {
  CodexAppServerClient,
  REAL_EXECUTION_RPC_METHODS,
  SAFE_RPC_METHODS,
  safeAdditionalDetails,
  safeModelCatalog,
  safeMcpServerStatus,
  safeRpcDiagnostic,
} = require('../../../apps/codex-agent-runtime-worker/src/appServerClient');
const {
  observeRuntimeActivity,
  startRuntimeActivity,
} = require('../../../apps/agent-runtime-worker/src/activities');
const { buildManagedMcpContextUrl } = require('../../../apps/codex-agent-runtime-worker/src/index');

assert.equal(SAFE_RPC_METHODS.has('thread/start'), false);
assert.equal(SAFE_RPC_METHODS.has('model/list'), true);
assert.equal(SAFE_RPC_METHODS.has('mcpServerStatus/list'), true);
assert.equal(REAL_EXECUTION_RPC_METHODS.has('thread/start'), true);
assert.equal(safeRpcDiagnostic({
  method: 'turn/start',
  requestId: 1,
  rpcCode: null,
  outcome: 'TIMEOUT',
  observedAt: new Date().toISOString(),
}), null);
assert.equal(safeRpcDiagnostic({
  method: 'turn/start',
  requestId: 1,
  rpcCode: null,
  outcome: 'TIMEOUT',
  observedAt: new Date().toISOString(),
}, { allowRealExecution: true })?.stage, 'TURN_START');
assert.equal(
  buildManagedMcpContextUrl('/context/bind', 'http://skycommand-codex-mcp-gateway:3981/mcp'),
  'http://skycommand-codex-mcp-gateway:3981/context/bind',
);

const safeDetails = safeAdditionalDetails({
  reason: 'MODEL_UNAVAILABLE',
  nested: { statusCode: 400, token: 'test-additional-details-token-placeholder', kind: 'BAD_REQUEST' },
});
assert.equal(safeDetails.kind, 'OBJECT');
assert.ok(safeDetails.safeCodes.includes('MODEL_UNAVAILABLE'));
assert.ok(safeDetails.safeCodes.includes('BAD_REQUEST'));
assert.ok(safeDetails.httpStatusCodes.includes(400));
assert.equal(safeDetails.fieldNames.includes('token'), false);
assert.equal(JSON.stringify(safeDetails).includes('test-additional-details-token-placeholder'), false);

const catalog = safeModelCatalog({
  data: [{ model: 'gpt-6-sol', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }], inputModalities: ['text'] }],
}, { requestedModel: 'gpt-6-sol', requestedReasoningEffort: 'low' });
assert.equal(catalog.semantics, 'APP_SERVER_CATALOG_NOT_ENTITLEMENT_PROOF');
assert.equal(catalog.requestedModelListed, true);
assert.equal(catalog.requestedReasoningEffortListed, true);

const mcpStatus = safeMcpServerStatus({ data: [{ name: 'skycommand', status: 'ready', authStatus: 'notRequired', tools: { skycommand_browser_automation_run: { description: 'ignored' } } }] });
assert.equal(mcpStatus.serverCount, 1);
assert.equal(mcpStatus.servers[0].name, 'skycommand');
assert.deepEqual(mcpStatus.servers[0].toolNames, ['skycommand_browser_automation_run']);

assert.throws(
  () => buildManagedMcpContextUrl('/context/bind', 'http://skycommand-codex-mcp-gateway:3981/not-mcp'),
  (error) => error?.code === 'CODEX_MCP_ENDPOINT_INVALID',
);

const client = new CodexAppServerClient({ executionEnabled: true });
client.initialized = true;
client.providerTurns.set('turn-1', {
  threadId: 'thread-1',
  turnId: 'turn-1',
  providerSessionReference: 'session-1',
  status: 'IN_PROGRESS',
  message: '',
  capabilityInvocations: [],
  usage: null,
});
client.handleProtocolMessage({ method: 'turn/started', params: { threadId: 'thread-1', turnId: 'turn-1', model: 'gpt-6-sol', effort: 'low' } });
client.handleProtocolMessage({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'status snapshot' } });
client.handleProtocolMessage({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'mcpToolCall', server: 'skycommand', tool: 'skycommand_browser_automation_run', status: 'completed', result: { ok: true } } } });
client.handleProtocolMessage({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', usage: { totalTokens: 12 } } });
client.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'thread-1', turnId: 'turn-1', status: 'completed', model: 'gpt-6-sol', effort: 'low' } });

(async () => {
const observed = await client.observeManagedTurn({
    providerTurnId: 'turn-1',
    providerSessionReference: 'session-1',
    threadId: 'thread-1',
    operationReference: 'codex:operation-1',
    model: 'gpt-6-sol',
    reasoningEffort: 'low',
    timeoutMs: 1000,
  });
  assert.equal(observed.sendAcceptance, 'ACKNOWLEDGED');
  assert.equal(observed.outcomeCertainty, 'ACKNOWLEDGED');
  assert.equal(observed.observedModel, 'gpt-6-sol');
  assert.equal(observed.observedReasoningEffort, 'low');
  assert.equal(observed.capabilityInvocations.length, 1);
  assert.equal(observed.taskOutputCandidate.mcpCapabilityCount, 1);

  const errorClient = new CodexAppServerClient({ executionEnabled: true });
  errorClient.initialized = true;
  errorClient.providerTurns.set('turn-error', {
    threadId: 'thread-error',
    turnId: 'turn-error',
    providerSessionReference: 'session-error',
    status: 'IN_PROGRESS',
    message: '',
    capabilityInvocations: [],
    usage: null,
  });
  errorClient.handleProtocolMessage({
    method: 'error',
    params: {
      threadId: 'thread-error',
      turnId: 'turn-error',
      error: {
        codexErrorInfo: { type: 'UsageLimitExceeded' },
        message: 'provider quota details must never be retained',
        additionalDetails: { reason: 'MODEL_UNAVAILABLE', token: 'test-provider-error-token-placeholder', httpStatusCode: 400 },
      },
    },
  });
  const providerErrorEvent = errorClient.events.find((event) => event.type === 'provider-error');
  assert.ok(providerErrorEvent);
  assert.equal(providerErrorEvent.kind, 'UsageLimitExceeded');
  assert.equal(providerErrorEvent.messageClass, 'RATE_LIMITED');
  assert.equal(Object.prototype.hasOwnProperty.call(providerErrorEvent, 'message'), false);
  assert.equal(JSON.stringify(errorClient.events).includes('provider quota details'), false);
  assert.equal(JSON.stringify(errorClient.events).includes('test-provider-error-token-placeholder'), false);
  assert.ok(providerErrorEvent.additionalDetails.safeCodes.includes('MODEL_UNAVAILABLE'));
  assert.ok(providerErrorEvent.additionalDetails.httpStatusCodes.includes(400));


  errorClient.handleProtocolMessage({ method: 'model/rerouted', params: { threadId: 'thread-error', turnId: 'turn-error', fromModel: 'gpt-6-sol', toModel: 'gpt-6.1-sol', reason: 'model unavailable for request' } });
  errorClient.handleProtocolMessage({ method: 'model/verification', params: { threadId: 'thread-error', turnId: 'turn-error', verifications: [{ type: 'ACCOUNT_VERIFICATION' }] } });
  errorClient.handleProtocolMessage({ method: 'warning', params: { threadId: 'thread-error', message: 'model warning details' } });
  assert.ok(errorClient.events.some((event) => event.type === 'provider-model-rerouted' && event.toModel === 'gpt-6.1-sol'));
  assert.ok(errorClient.events.some((event) => event.type === 'provider-model-verification' && event.verificationCount === 1));
  assert.ok(errorClient.events.some((event) => event.type === 'provider-warning' && event.messageDigest));
  assert.equal(JSON.stringify(errorClient.events).includes('model warning details'), false);


  const terminalFailureClient = new CodexAppServerClient({ executionEnabled: true });
  terminalFailureClient.initialized = true;
  terminalFailureClient.providerTurns.set('turn-failed', {
    threadId: 'thread-failed',
    turnId: 'turn-failed',
    providerSessionReference: 'session-failed',
    status: 'IN_PROGRESS',
    message: '',
    capabilityInvocations: [],
    usage: null,
  });
  terminalFailureClient.handleProtocolMessage({ method: 'turn/started', params: { threadId: 'thread-failed', turnId: 'turn-failed', model: 'gpt-6-sol', effort: 'low' } });
  terminalFailureClient.handleProtocolMessage({ method: 'error', params: { threadId: 'thread-failed', turnId: 'turn-failed', error: { message: 'sanitized terminal provider failure' } } });
  terminalFailureClient.handleProtocolMessage({ method: 'turn/completed', params: { threadId: 'thread-failed', turnId: 'turn-failed', status: 'failed' } });
  const terminalFailure = await terminalFailureClient.observeManagedTurn({
    providerTurnId: 'turn-failed',
    providerSessionReference: 'session-failed',
    threadId: 'thread-failed',
    operationReference: 'codex:operation-failed',
    model: 'gpt-6-sol',
    reasoningEffort: 'low',
    timeoutMs: 1000,
  });
  assert.equal(terminalFailure.sendAcceptance, 'ACKNOWLEDGED');
  assert.equal(terminalFailure.providerTerminalStatus, 'FAILED');
  assert.equal(terminalFailure.providerTerminalFailure, true);
  assert.equal(terminalFailure.outcomeCertainty, 'ACKNOWLEDGED');

  const fakeStart = await startRuntimeActivity({
    runtimeKind: 'FAKE_PERSISTENT',
    caseId: 'persistent-delayed-usage',
    instruction: 'fixture',
  });
  assert.equal(fakeStart.disposition, 'COMPLETED');
  assert.equal(fakeStart.runtimeMode, 'FIXTURE');
  assert.equal(fakeStart.observationRequired, false);
  assert.equal(fakeStart.runtimeResult.providerBacked, false);
  assert.equal(fakeStart.runtimeResult.capabilityDispatchMode, 'CONTROL');

  const fakeObservation = await observeRuntimeActivity({ runtimeKind: 'FAKE_PERSISTENT', runtimeResult: fakeStart.runtimeResult });
  assert.equal(fakeObservation.runtimeResult.capabilityDispatchMode, 'CONTROL');
  console.log('Phase 19.3A1 managed Codex adapter and provider-neutral runtime activity self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
