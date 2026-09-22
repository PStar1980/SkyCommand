const {
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} = require('@temporalio/workflow');
const { getAgentRuntimeTaskQueue } = require('../../../agents/src/runtimeWorker');

const controlActivities = proxyActivities({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '15 seconds',
    maximumAttempts: 3,
  },
});

const runtimeActivities = proxyActivities({
  taskQueue: getAgentRuntimeTaskQueue(),
  startToCloseTimeout: '2 minutes',
  scheduleToStartTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
});

const cancelSignal = defineSignal('agentRunCancel');
const rootStopSignal = defineSignal('agentRootStop');

async function agentRunWorkflow(input = {}) {
  const control = { stopRequested: false, reason: null };
  setHandler(cancelSignal, (payload = {}) => {
    control.stopRequested = true;
    control.reason = String(payload.reason || 'run_cancel_requested');
  });
  setHandler(rootStopSignal, (payload = {}) => {
    control.stopRequested = true;
    control.reason = String(payload.reason || 'root_stop_requested');
  });

  const runId = String(input.runId || '').trim();
  if (!runId) throw new Error('Agent Run workflow requires a server-derived runId.');
  const temporalRunId = workflowInfo().runId;
  const context = input.executionContext || {};
  const runtimeCase = input.fakeRuntimeCase || {};

  await controlActivities.markAgentRunStateActivity({ runId, status: 'QUEUED', reason: 'temporal_workflow_started' });
  const stateAfterQueue = await controlActivities.getAgentRunStateActivity({ runId });
  if (control.stopRequested || ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(stateAfterQueue?.status) || stateAfterQueue?.scopeStatus !== 'ACTIVE') {
    return controlActivities.finalizeAgentRunActivity({ runId, temporalRunId, operation: null, runtimeResult: { runtimeKind: context.runtime?.runtimeKind || 'FAKE_PERSISTENT', adapterVersion: 'fake-runtime-adapter.v1', usage: { availability: 'NOT_REPORTED', observationsRef: null, scope: 'RUN', source: context.runtime?.runtimeKind || 'FAKE_PERSISTENT', freshness: 'UNKNOWN', measurements: [] }, physicalStop: { state: 'CONFIRMED', evidence: 'authority_revoked_before_start' }, worker: null, events: [] }, reconciliation: null });
  }

  await controlActivities.markAgentRunStateActivity({ runId, status: 'STARTING', reason: 'agent_run_workflow_starting' });
  const operation = await controlActivities.prepareProviderOperationActivity({
    runId,
    instruction: input.instruction || '',
    deadlineAt: input.deadlineAt || null,
  });
  if (operation.canceled || control.stopRequested) {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation: null,
      runtimeResult: {
        runtimeKind: context.runtime?.runtimeKind || 'FAKE_PERSISTENT',
        adapterVersion: 'fake-runtime-adapter.v1',
        usage: { availability: 'NOT_REPORTED', observationsRef: null, scope: 'RUN', source: context.runtime?.runtimeKind || 'FAKE_PERSISTENT', freshness: 'UNKNOWN', measurements: [] },
        physicalStop: { state: 'CONFIRMED', evidence: 'authority_revoked_before_provider_send' },
        worker: null,
        events: [],
      },
      reconciliation: null,
    });
  }

  await controlActivities.markAgentRunStateActivity({ runId, status: 'RUNNING', reason: 'fake_runtime_operation_started' });
  const runtimeResult = await runtimeActivities.executeFakeRuntimeActivity({
    runId,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    instruction: operation.instruction,
    runtimeKind: operation.runtimeKind,
    caseId: operation.fakeRuntimeCaseId || runtimeCase.caseId,
    cancellationRequested: control.stopRequested,
  });

  let reconciliation = null;
  if (runtimeResult.sendAcceptance === 'UNKNOWN') {
    await controlActivities.markAgentRunStateActivity({ runId, status: 'RECONCILING', reason: 'provider_send_acceptance_unknown' });
    reconciliation = await runtimeActivities.reconcileFakeRuntimeActivity({
      runId,
      operationId: operation.operationId,
      caseId: operation.fakeRuntimeCaseId || runtimeCase.caseId,
      runtimeKind: operation.runtimeKind,
    });
  }

  if (!control.stopRequested && reconciliation?.disposition !== 'RECOVERY_REQUIRED') {
    await controlActivities.markAgentRunStateActivity({ runId, status: 'CLOSING', reason: 'fake_runtime_evidence_received' });
    await controlActivities.markAgentRunStateActivity({ runId, status: 'FINALIZING', reason: 'validating_fake_runtime_result' });
  }

  return controlActivities.finalizeAgentRunActivity({
    runId,
    temporalRunId,
    operation,
    runtimeResult,
    reconciliation,
  });
}

module.exports = {
  agentRunWorkflow,
};
