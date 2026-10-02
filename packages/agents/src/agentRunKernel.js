const { sha256Digest } = require('./canonical');
const { validateJsonSchema } = require('../../tools/src/jsonSchemaValidator');
const summarySchema = require('../contracts/agent_run_summary.v1.schema.json');

const AGENT_RUN_STATUSES = Object.freeze([
  'ADMITTED',
  'QUEUED',
  'STARTING',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_USER_INPUT',
  'WAITING_FOR_CHILDREN',
  'CLOSING',
  'FINALIZING',
  'COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCEL_REQUESTED',
  'CANCELLING',
  'CANCELED',
  'RECONCILING',
  'RECOVERY_REQUIRED',
]);

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED']);

const ALLOWED_TRANSITIONS = Object.freeze({
  ADMITTED: new Set(['QUEUED', 'STARTING', 'CANCEL_REQUESTED', 'CANCELED', 'RECOVERY_REQUIRED']),
  QUEUED: new Set(['STARTING', 'CANCEL_REQUESTED', 'CANCELED', 'RECOVERY_REQUIRED']),
  STARTING: new Set(['RUNNING', 'CANCEL_REQUESTED', 'CANCELED', 'RECOVERY_REQUIRED']),
  RUNNING: new Set(['WAITING_FOR_APPROVAL', 'WAITING_FOR_USER_INPUT', 'CLOSING', 'CANCEL_REQUESTED', 'CANCELLING', 'RECONCILING', 'FAILED', 'RECOVERY_REQUIRED']),
  WAITING_FOR_APPROVAL: new Set(['RUNNING', 'CANCEL_REQUESTED', 'CANCELLING', 'FAILED', 'RECOVERY_REQUIRED']),
  WAITING_FOR_USER_INPUT: new Set(['RUNNING', 'CANCEL_REQUESTED', 'CANCELLING', 'FAILED', 'RECOVERY_REQUIRED']),
  CLOSING: new Set(['FINALIZING', 'CANCEL_REQUESTED', 'CANCELED', 'RECOVERY_REQUIRED']),
  FINALIZING: new Set(['COMPLETED', 'FAILED', 'CANCELED', 'RECOVERY_REQUIRED']),
  CANCEL_REQUESTED: new Set(['CANCELLING', 'CANCELED', 'RECOVERY_REQUIRED']),
  CANCELLING: new Set(['CANCELED', 'RECOVERY_REQUIRED']),
  RECONCILING: new Set(['CLOSING', 'FINALIZING', 'COMPLETED', 'RECOVERY_REQUIRED', 'CANCELED']),
});

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || '').trim());
}

function canTransition(from, to) {
  if (from === to) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.has(to));
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Agent Run state transition ${from} -> ${to} is not allowed.`);
    error.code = 'AGENT_RUN_STATE_TRANSITION_INVALID';
    throw error;
  }
}


function normalizeUsageForSummary({ usage = null, operationId = null, runtimeKind = null } = {}) {
  const isObject = usage && typeof usage === 'object' && !Array.isArray(usage);
  const canonical = isObject
    && Object.prototype.hasOwnProperty.call(usage, 'availability')
    && Object.prototype.hasOwnProperty.call(usage, 'observationsRef');

  // Provider adapters may retain a small provider-native usage object as durable
  // evidence. The Agent result contract is provider-neutral, so never pass that
  // provider shape directly into agent_run_summary.v1. Preserve the observation
  // through observationsRef and expose provider-specific detail only in the
  // durable provider evidence record.
  if (runtimeKind === 'OPENAI_CODEX_APP_SERVER' && !canonical) {
    const reported = Boolean(isObject);
    return {
      availability: reported ? 'REPORTED' : 'NOT_REPORTED',
      observationsRef: operationId || null,
      scope: 'RUN',
      source: runtimeKind,
      freshness: reported ? 'CURRENT' : 'UNKNOWN',
      measurements: [],
    };
  }

  if (usage) return usage;
  return {
    availability: 'NOT_REPORTED',
    observationsRef: operationId || null,
    scope: 'RUN',
    source: runtimeKind || null,
    freshness: 'UNKNOWN',
    measurements: [],
  };
}

function buildTerminalSummary({
  runId,
  sessionId,
  projectId,
  agentDefinitionId,
  agentRevision,
  runtimeKind,
  rootExecutionId,
  rootAgentRunId,
  initiatingUserId,
  initiatingActor,
  triggerSource,
  status,
  outcome,
  taskOutput = null,
  usage = null,
  operationId = null,
  caseId = null,
  capabilityEffects = [],
  providerEvidence = null,
  stopState = 'NONE',
  errorCode = null,
} = {}) {
  const usageValue = normalizeUsageForSummary({
    usage,
    operationId,
    runtimeKind,
  });
  const summary = {
    runId,
    sessionId,
    projectId,
    agentDefinitionId,
    agentRevision,
    runtimeKind,
    rootExecutionId,
    rootAgentRunId,
    parentAgentRunId: null,
    initiatingUserId: initiatingUserId || null,
    initiatingActor,
    triggerSource,
    status,
    outcome: outcome || null,
    summary: status === 'COMPLETED'
      ? runtimeKind === 'OPENAI_CODEX_APP_SERVER' ? 'Managed Codex Agent Run completed with a validated provider-neutral structured result.' : 'Fake Agent Run completed with a validated structured result.'
      : status === 'CANCELED'
        ? runtimeKind === 'OPENAI_CODEX_APP_SERVER' ? 'Managed Codex Agent Run was canceled after authority revocation.' : 'Fake Agent Run was canceled after authority revocation.'
        : runtimeKind === 'OPENAI_CODEX_APP_SERVER' ? 'Managed Codex Agent Run requires recovery or failed before a successful result.' : 'Fake Agent Run requires recovery or failed before a successful result.',
    taskOutput,
    taskOutputSchema: status === 'COMPLETED' ? runtimeKind === 'OPENAI_CODEX_APP_SERVER' ? 'agent-provider-result.v1' : 'fake-runtime-result.v1' : null,
    artifacts: [],
    changes: [],
    childRuns: [],
    usage: usageValue,
    cost: {
      availability: 'NOT_REPORTED',
      amount: null,
      currency: null,
      scope: 'RUN',
      basis: null,
      reliability: null,
      priceSourceRevision: null,
      observationsRef: null,
    },
    recommendations: [
      ...(errorCode ? [{ text: `Terminal evidence code: ${errorCode}.`, kind: 'RECOVERY', evidenceRef: operationId }] : []),
      ...(stopState !== 'NONE' ? [{ text: `Physical stop evidence is ${stopState}; authority revocation is recorded separately.`, kind: 'CANCELLATION', evidenceRef: operationId }] : []),
    ],
    extensions: {
      fakeRuntime: runtimeKind !== 'OPENAI_CODEX_APP_SERVER',
      caseId,
      operationId,
      stopState,
      capabilityEffects: Array.isArray(capabilityEffects) ? capabilityEffects : [],
      providerEvidence: providerEvidence && typeof providerEvidence === 'object' ? providerEvidence : null,
    },
  };

  validateJsonSchema(summary, summarySchema, { schemaName: 'agent run summary' });
  return summary;
}

function resultDigest(result) {
  return sha256Digest(result);
}

module.exports = {
  AGENT_RUN_STATUSES,
  TERMINAL_STATUSES,
  isTerminalStatus,
  canTransition,
  assertTransition,
  normalizeUsageForSummary,
  buildTerminalSummary,
  resultDigest,
};
