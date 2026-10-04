const fs = require('node:fs');
const os = require('node:os');
const { executeFakeRuntime, reconcileFakeRuntime, resolveFakeRuntimeCase } = require('../../../packages/agents/src/fakeRuntime');
const { getAgentRuntimeTaskQueue } = require('../../../packages/agents/src/runtimeWorker');

function workerIdentity() {
  return String(process.env.AGENT_RUNTIME_WORKER_IDENTITY || `agent-runtime-worker:${os.hostname()}:${process.pid}`).trim();
}

function workerGeneration() {
  return String(process.env.AGENT_RUNTIME_WORKER_GENERATION || `local-${process.pid}`).trim();
}

function containmentProfile() {
  return {
    liveCheckoutMount: false,
    arbitraryHostFilesystem: false,
    dockerSocket: false,
    githubCredentials: false,
    hostAgentCredentials: false,
    supervisorCredentials: false,
    apiControlPlaneSecrets: false,
    providerCredentials: false,
    browserState: false,
    directGit: false,
  };
}

function readBridgeToken() {
  const tokenPath = process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE || '/run/codex-api-bridge/api-bridge-token';
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (token.length < 40) throw Object.assign(new Error('Codex control bridge credential is invalid.'), { code: 'CODEX_CONTROL_BRIDGE_CREDENTIAL_INVALID' });
  return token;
}

async function callCodexBridge(pathname, body = {}) {
  const base = String(process.env.CODEX_CONTROL_BRIDGE_URL || 'http://codex-control-bridge-api-control:4220').replace(/\/+$/, '');
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${readBridgeToken()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(125000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    const error = new Error('The bounded Codex runtime operation did not complete.');
    error.code = typeof payload.code === 'string' ? payload.code : 'CODEX_RUNTIME_OPERATION_FAILED';
    error.details = payload.details || {};
    throw error;
  }
  return payload.result || payload;
}

async function executeCodexRuntimeActivity(input = {}) {
  if (input.runtimeKind !== 'OPENAI_CODEX_APP_SERVER') throw new Error('Codex runtime activity received a non-Codex runtime.');
  return callCodexBridge('/v1/runtime/execute', {
    runId: input.runId,
    operationId: input.operationId,
    sessionId: input.sessionId,
    instruction: input.instruction,
    model: input.providerModel || null,
    reasoningEffort: input.providerReasoningEffort || null,
    deadlineAt: input.deadlineAt || null,
    providerOperationReference: input.providerOperationReference || null,
    managedCapabilityRequest: input.managedCapabilityRequest || null,
    sessionBinding: input.sessionBinding || null,
  });
}

async function reconcileCodexRuntimeActivity(input = {}) {
  if (input.runtimeKind !== 'OPENAI_CODEX_APP_SERVER') throw new Error('Codex runtime reconciliation received a non-Codex runtime.');
  return callCodexBridge('/v1/runtime/reconcile', {
    operationId: input.operationId,
    providerTurnId: input.providerTurnId,
    providerSessionReference: input.providerSessionReference,
    providerOperationReference: input.providerOperationReference,
    model: input.providerModel || null,
    reasoningEffort: input.providerReasoningEffort || null,
    runtimeEvidenceBoundary: input.runtimeEvidenceBoundary || null,
  });
}

async function interruptCodexRuntimeActivity(input = {}) {
  if (input.runtimeKind !== 'OPENAI_CODEX_APP_SERVER') throw new Error('Codex runtime interruption received a non-Codex runtime.');
  return callCodexBridge('/v1/runtime/interrupt', { providerTurnId: input.providerTurnId, threadId: input.threadId });
}

async function startRuntimeActivity(input = {}) {
  if (input.runtimeKind === 'OPENAI_CODEX_APP_SERVER') {
    const result = await callCodexBridge('/v1/runtime/start', {
      runId: input.runId,
      operationId: input.operationId,
      sessionId: input.sessionId,
      instruction: input.instruction,
      model: input.providerModel || null,
      reasoningEffort: input.providerReasoningEffort || null,
      deadlineAt: input.deadlineAt || null,
      providerOperationReference: input.providerOperationReference || null,
      managedCapabilityRequest: input.managedCapabilityRequest || null,
      sessionBinding: input.sessionBinding || null,
    });
    return {
      ...result,
      runtimeMode: 'PROVIDER_BACKED',
      providerBacked: true,
      observationRequired: result.sendAcceptance === 'ACKNOWLEDGED' && Boolean(result.providerTurnId),
    };
  }
  const runtimeResult = {
    ...(await executeFakeRuntimeActivity(input)),
    runtimeMode: 'FIXTURE',
    providerBacked: false,
    capabilityDispatchMode: 'CONTROL',
  };
  return {
    disposition: 'COMPLETED',
    runtimeMode: 'FIXTURE',
    providerBacked: false,
    observationRequired: false,
    runtimeResult,
  };
}

async function observeRuntimeActivity(input = {}) {
  if (input.runtimeKind === 'OPENAI_CODEX_APP_SERVER') {
    const runtimeResult = await callCodexBridge('/v1/runtime/observe', {
      operationId: input.operationId,
      providerTurnId: input.providerTurnId,
      providerSessionReference: input.providerSessionReference || null,
      threadId: input.threadId || null,
      providerOperationReference: input.providerOperationReference || null,
      model: input.providerModel || null,
      reasoningEffort: input.providerReasoningEffort || null,
      deadlineAt: input.deadlineAt || null,
      timeoutMs: input.timeoutMs || 120000,
      runtimeEvidenceBoundary: input.runtimeEvidenceBoundary || null,
    });
    return {
      disposition: 'COMPLETED',
      runtimeMode: 'PROVIDER_BACKED',
      providerBacked: true,
      runtimeResult: { ...runtimeResult, runtimeMode: 'PROVIDER_BACKED', providerBacked: true },
    };
  }
  return {
    disposition: 'COMPLETED',
    runtimeMode: 'FIXTURE',
    providerBacked: false,
    runtimeResult: input.runtimeResult ? { ...input.runtimeResult, runtimeMode: 'FIXTURE', providerBacked: false } : null,
  };
}

async function reconcileRuntimeActivity(input = {}) {
  if (input.runtimeKind === 'OPENAI_CODEX_APP_SERVER') return reconcileCodexRuntimeActivity(input);
  return reconcileFakeRuntimeActivity(input);
}

async function interruptRuntimeActivity(input = {}) {
  if (input.runtimeKind === 'OPENAI_CODEX_APP_SERVER') return interruptCodexRuntimeActivity(input);
  return {
    physicalStop: {
      state: 'CONFIRMED',
      evidence: 'fake_runtime_cooperative_stop',
    },
  };
}

async function executeFakeRuntimeActivity(input = {}) {
  const result = executeFakeRuntime({
    ...input,
    workerIdentity: workerIdentity(),
  });
  return {
    ...result,
    worker: {
      ...(result.worker || {}),
      identity: workerIdentity(),
      generation: workerGeneration(),
      taskQueue: getAgentRuntimeTaskQueue(),
      processId: process.pid,
      hostname: os.hostname(),
    },
    containmentProfile: containmentProfile(),
  };
}

async function reconcileFakeRuntimeActivity(input = {}) {
  const fixture = resolveFakeRuntimeCase(input.caseId, input.runtimeKind);
  return reconcileFakeRuntime({
    ...input,
    fixture,
    workerIdentity: workerIdentity(),
  });
}

module.exports = {
  executeCodexRuntimeActivity,
  executeFakeRuntimeActivity,
  interruptCodexRuntimeActivity,
  reconcileCodexRuntimeActivity,
  reconcileFakeRuntimeActivity,
  startRuntimeActivity,
  observeRuntimeActivity,
  reconcileRuntimeActivity,
  interruptRuntimeActivity,
};
