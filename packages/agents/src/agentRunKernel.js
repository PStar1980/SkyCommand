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
  RUNNING: new Set(['CLOSING', 'CANCEL_REQUESTED', 'CANCELLING', 'RECONCILING', 'FAILED', 'RECOVERY_REQUIRED']),
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
  stopState = 'NONE',
  errorCode = null,
} = {}) {
  const usageValue = usage || {
    availability: 'NOT_REPORTED',
    observationsRef: operationId,
    scope: 'RUN',
    source: runtimeKind,
    freshness: 'UNKNOWN',
    measurements: [],
  };
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
      ? 'Fake Agent Run completed with a validated structured result.'
      : status === 'CANCELED'
        ? 'Fake Agent Run was canceled after authority revocation.'
        : 'Fake Agent Run requires recovery or failed before a successful result.',
    taskOutput,
    taskOutputSchema: status === 'COMPLETED' ? 'fake-runtime-result.v1' : null,
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
      fakeRuntime: true,
      caseId,
      operationId,
      stopState,
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
  buildTerminalSummary,
  resultDigest,
};
