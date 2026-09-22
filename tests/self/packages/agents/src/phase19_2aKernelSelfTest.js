const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..');
const { validateJsonSchema } = require(path.join(root, 'packages/tools/src/jsonSchemaValidator'));
const eventSchema = require(path.join(root, 'packages/agents/contracts/agent_event.v1.schema.json'));
const contextSchema = require(path.join(root, 'packages/agents/contracts/execution_context.v1.schema.json'));
const {
  executeFakeRuntime,
  reconcileFakeRuntime,
  resolveFakeRuntimeCase,
} = require(path.join(root, 'packages/agents/src/fakeRuntime'));
const {
  assertTransition,
  buildTerminalSummary,
  canTransition,
} = require(path.join(root, 'packages/agents/src/agentRunKernel'));
const { buildExecutionContext } = require(path.join(root, 'packages/agents/src/executionContext'));
const { getAgentRuntimeTaskQueue } = require(path.join(root, 'packages/agents/src/runtimeWorker'));

function run() {
  const persistent = resolveFakeRuntimeCase('persistent-delayed-usage', 'FAKE_PERSISTENT');
  const ephemeral = resolveFakeRuntimeCase('ephemeral-absent-usage', 'FAKE_EPHEMERAL');
  assert.equal(persistent.sessionModel, 'PERSISTENT');
  assert.equal(ephemeral.sessionModel, 'EPHEMERAL');

  const persistentResult = executeFakeRuntime({
    caseId: persistent.caseId,
    runtimeKind: persistent.runtimeKind,
    operationId: 'operation-persistent',
    runId: 'run-persistent',
    sessionId: 'session-persistent',
    instruction: 'return a deterministic observation',
    workerIdentity: 'fake-worker-persistent',
  });
  assert.equal(persistentResult.sendAcceptance, 'ACKNOWLEDGED');
  assert.equal(persistentResult.usage.availability, 'REPORTED');
  assert.equal(persistentResult.usage.freshness, 'STALE');
  assert.equal(persistentResult.taskOutputCandidate.capabilitiesExecuted.length, 0);
  persistentResult.events.forEach((event) => validateJsonSchema(event, eventSchema, { schemaName: 'persistent fake event' }));

  const ephemeralResult = executeFakeRuntime({
    caseId: ephemeral.caseId,
    runtimeKind: ephemeral.runtimeKind,
    operationId: 'operation-ephemeral',
    runId: 'run-ephemeral',
    sessionId: 'session-ephemeral',
    instruction: 'return a deterministic observation',
    workerIdentity: 'fake-worker-ephemeral',
  });
  assert.equal(ephemeralResult.usage.availability, 'NOT_REPORTED');
  assert.equal(ephemeralResult.usage.freshness, 'UNKNOWN');
  assert.equal(ephemeralResult.usage.measurements.length, 0);

  const ambiguous = executeFakeRuntime({
    caseId: 'ambiguous-send',
    runtimeKind: 'FAKE_PERSISTENT',
    operationId: 'operation-ambiguous',
    runId: 'run-ambiguous',
    sessionId: 'session-ambiguous',
    instruction: 'do not resend this turn',
    workerIdentity: 'fake-worker-persistent',
  });
  assert.equal(ambiguous.sendAcceptance, 'UNKNOWN');
  const recovery = reconcileFakeRuntime({ fixture: ambiguous.fixture, operationId: 'operation-ambiguous' });
  assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
  assert.equal(recovery.safeResubmissionAllowed, false);
  assert.equal(recovery.substantiveResubmissionCount, 0);
  const notStarted = reconcileFakeRuntime({ fixture: ambiguous.fixture, operationId: 'operation-ambiguous', reconciliationOutcome: 'NOT_STARTED_PROVEN' });
  assert.equal(notStarted.safeResubmissionAllowed, true);
  assert.equal(notStarted.substantiveResubmissionCount, 0);

  assert.equal(canTransition('ADMITTED', 'QUEUED'), true);
  assert.equal(canTransition('COMPLETED', 'RUNNING'), false);
  assert.throws(() => assertTransition('COMPLETED', 'RUNNING'), /not allowed/);

  const context = buildExecutionContext({
    contextId: 'execution-context-self-test',
    request: { requestId: 'request-1', traceId: 'trace-1' },
    initiatingUser: { userId: 'user-1', principalId: 'principal-1', displayNameSnapshot: 'Fixture User' },
    initiatingActor: { kind: 'USER', id: 'principal-1', displayNameSnapshot: 'Fixture User' },
    requestingActor: { kind: 'USER', id: 'principal-1', displayNameSnapshot: 'Fixture User' },
    project: { projectId: 'project-1', projectCode: 'PROJECT_1', policyRevision: 'policy-1' },
    agent: { definitionId: 'definition-1', versionId: 'version-1', revision: 1, contentDigest: 'A'.repeat(64) },
    workspace: { projectWorkspaceId: 'workspace-1', environmentCode: 'DEV_LOCAL', workspaceMode: 'READ_ONLY' },
    rootExecutionId: 'root-1',
    sessionId: 'session-1',
    runId: 'run-1',
    triggerSource: 'MANUAL',
    authoritySnapshot: { snapshotId: 'snapshot-1', digest: 'B'.repeat(64) },
    executionSurfacePolicy: {
      contract: 'execution_surface_policy.v1',
      policyRevision: 'policy-1',
      requested: { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }] },
      configured: { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }] },
      granted: { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW' }] },
      permittedTransitions: [],
    },
    runtime: { runtimeKind: 'FAKE_PERSISTENT', installationId: 'installation-1', accountBindingId: 'account-1', capabilityProfileId: 'profile-1', configurationRevision: 'phase19.2a', configurationDigest: 'C'.repeat(64), workerTaskQueue: 'skycommand-agent-runtime-local', workerGeneration: 'fake-worker-persistent' },
    environmentProfile: { environmentCode: 'DEV_LOCAL', profileCode: 'DEV_LOCAL' },
    admission: { admissionRequestId: 'admission-1', submittedIntentDigest: 'D'.repeat(64), resolvedSpecDigest: 'E'.repeat(64) },
  });
  validateJsonSchema(context, contextSchema, { schemaName: 'execution context' });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(getAgentRuntimeTaskQueue({ AGENT_RUNTIME_TASK_QUEUE: 'phase19-2a-test-queue' }), 'phase19-2a-test-queue');
  assert.equal(getAgentRuntimeTaskQueue({}), 'skycommand-agent-runtime-local');

  const summary = buildTerminalSummary({
    runId: 'run-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    agentDefinitionId: 'definition-1',
    agentRevision: 1,
    runtimeKind: 'FAKE_PERSISTENT',
    rootExecutionId: 'root-1',
    rootAgentRunId: 'run-1',
    initiatingUserId: 'user-1',
    initiatingActor: { kind: 'USER', id: 'principal-1', displayNameSnapshot: 'Fixture User' },
    triggerSource: 'MANUAL',
    status: 'COMPLETED',
    outcome: 'SUCCESS',
    taskOutput: persistentResult.taskOutputCandidate,
    usage: persistentResult.usage,
    operationId: 'operation-persistent',
    caseId: persistent.caseId,
  });
  assert.equal(summary.status, 'COMPLETED');
  assert.equal(summary.usage.freshness, 'STALE');

  console.log('✅ Phase 19.2A Agent Run kernel self-test passed.');
}

run();
