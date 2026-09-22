
const {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
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
const interactionDecisionSignal = defineSignal('agentInteractionDecision');

const USER_INPUT_CASES = new Set(['user-input-success', 'user-input-restart']);
const APPROVAL_CASES = new Set(['approval-required-success', 'approval-revoked-during-wait', 'approval-expiry']);
const MANAGED_CAPABILITY_CASES = new Set([
  'browser-capability-success',
  'browser-capability-duplicate-retry',
  'browser-capability-revoked-before-dispatch',
  'browser-capability-unknown-dispatch',
  'browser-capability-unknown-send',
  ...APPROVAL_CASES,
]);

function noRuntimeResult(runtimeKind, physicalStopState = 'NOT_REQUESTED') {
  return {
    runtimeKind,
    adapterVersion: 'fake-runtime-adapter.v1',
    sendAcceptance: 'REJECTED_BEFORE_ACCEPTANCE',
    outcomeCertainty: 'REJECTED',
    usage: {
      availability: 'NOT_REPORTED',
      observationsRef: null,
      scope: 'RUN',
      source: runtimeKind,
      freshness: 'UNKNOWN',
      measurements: [],
    },
    physicalStop: {
      state: physicalStopState,
      evidence: physicalStopState === 'CONFIRMED' ? 'authority_revoked_before_runtime_start' : 'interaction_not_applied',
    },
    worker: null,
    events: [],
    capabilityInvocations: [],
    taskOutputCandidate: null,
  };
}

async function waitForInteraction({ interaction, control }) {
  const interactionId = interaction.interactionId;
  const deadline = new Date(interaction.expiresAt).getTime();
  let lastLoaded = interaction;
  while (true) {
    if (control.stopRequested) {
      await controlActivities.cancelAgentInteractionsActivity({ runId: interaction.runId, reason: control.reason || 'RUN_OR_ROOT_STOP_REQUESTED' });
      return { applicationStatus: 'CANCELED', reason: control.reason || 'RUN_OR_ROOT_STOP_REQUESTED', interaction: lastLoaded, capabilityRequest: null, input: null };
    }
    const now = Date.now();
    if (now >= deadline) {
      await controlActivities.expireAgentInteractionActivity({ interactionId });
      return { applicationStatus: 'EXPIRED', reason: 'INTERACTION_EXPIRED', interaction: lastLoaded, capabilityRequest: null, input: null };
    }
    const pollMs = Math.max(1, Math.min(5000, deadline - now));
    await Promise.race([
      condition(() => control.stopRequested || Boolean(control.interactionDecisions[interactionId])),
      sleep(pollMs),
    ]);
    if (control.stopRequested) continue;
    lastLoaded = await controlActivities.loadAgentInteractionActivity({ interactionId });
    if (!lastLoaded) return { applicationStatus: 'BLOCKED', reason: 'INTERACTION_NOT_FOUND', interaction: null, capabilityRequest: null, input: null };
    if (['EXPIRED', 'CANCELED', 'BLOCKED', 'REJECTED'].includes(lastLoaded.status)) {
      return { applicationStatus: lastLoaded.status, reason: lastLoaded.statusReason || lastLoaded.status, interaction: lastLoaded, capabilityRequest: null, input: null };
    }
    const decision = lastLoaded.decision;
    if (!decision) continue;
    await controlActivities.acknowledgeAgentInteractionDeliveryActivity({
      interactionId,
      decisionId: decision.decisionId,
    });
    const applied = await controlActivities.applyAgentInteractionDecisionActivity({
      interactionId,
      decisionId: decision.decisionId,
    });
    if (applied.applicationStatus !== 'PENDING') return applied;
  }
}

async function agentRunWorkflow(input = {}) {
  const control = {
    stopRequested: false,
    reason: null,
    interactionDecisions: {},
  };
  setHandler(cancelSignal, (payload = {}) => {
    control.stopRequested = true;
    control.reason = String(payload.reason || 'run_cancel_requested');
  });
  setHandler(rootStopSignal, (payload = {}) => {
    control.stopRequested = true;
    control.reason = String(payload.reason || 'root_stop_requested');
  });
  setHandler(interactionDecisionSignal, (payload = {}) => {
    const interactionId = String(payload.interactionRequestId || '').trim();
    const decisionId = String(payload.decisionId || '').trim();
    if (interactionId && decisionId) control.interactionDecisions[interactionId] = decisionId;
  });

  const runId = String(input.runId || '').trim();
  if (!runId) throw new Error('Agent Run workflow requires a server-derived runId.');
  const temporalRunId = workflowInfo().runId;
  const context = input.executionContext || {};
  const runtimeCase = input.fakeRuntimeCase || {};
  const runtimeCaseId = String(runtimeCase.caseId || '').trim();
  const managedCapabilityCase = MANAGED_CAPABILITY_CASES.has(runtimeCaseId);
  const userInputCase = USER_INPUT_CASES.has(runtimeCaseId);

  await controlActivities.markAgentRunStateActivity({ runId, status: 'QUEUED', reason: 'temporal_workflow_started' });
  const stateAfterQueue = await controlActivities.getAgentRunStateActivity({ runId });
  if (control.stopRequested || ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(stateAfterQueue?.status) || stateAfterQueue?.scopeStatus !== 'ACTIVE') {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation: null,
      runtimeResult: noRuntimeResult(context.runtime?.runtimeKind || 'FAKE_PERSISTENT', 'CONFIRMED'),
      reconciliation: null,
      interactionOutcome: 'CANCELED',
    });
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
      runtimeResult: noRuntimeResult(context.runtime?.runtimeKind || 'FAKE_PERSISTENT', 'CONFIRMED'),
      reconciliation: null,
      interactionOutcome: 'CANCELED',
    });
  }

  const managedCapability = managedCapabilityCase
    ? await controlActivities.prepareManagedCapabilityEffectActivity({
      runId,
      operationId: operation.operationId,
      turnId: operation.turnId,
      caseId: runtimeCaseId,
    })
    : null;

  let interaction = null;
  let interactionResult = null;
  if (managedCapability?.decision === 'EXPLICIT_APPROVAL_REQUIRED') {
    interaction = await controlActivities.createAgentInteractionActivity({
      runId,
      interactionType: 'APPROVAL',
      operationKind: 'MANAGED_CAPABILITY_APPROVAL',
      operationId: operation.operationId,
      capabilityEffectId: managedCapability.effect?.effectId || null,
      operationKey: managedCapability.effect?.effectKey || operation.operationKey + ':approval',
      inputDigest: managedCapability.effect?.requestDigest || operation.inputDigest,
      safePrompt: 'Approve the bounded read-only managed Browser capability for this Agent Run.',
      policyRevision: managedCapability.effect?.policyRevision || 'agent-policy.v1',
      eligibleResponderScope: { mode: 'INITIATING_USER_OR_PROJECT_READER' },
      authorityEpoch: managedCapability.effect?.authorityEpoch || operation.fenceEpoch,
      ttlMs: runtimeCaseId === 'approval-expiry' ? 1500 : 90 * 1000,
    });
    interactionResult = await waitForInteraction({ interaction: interaction.interaction, control });
    if (interactionResult.applicationStatus !== 'APPLIED') {
      return controlActivities.finalizeAgentRunActivity({
        runId,
        temporalRunId,
        operation,
        runtimeResult: noRuntimeResult(operation.runtimeKind, control.stopRequested ? 'CONFIRMED' : 'NOT_REQUESTED'),
        reconciliation: null,
        capabilityEffects: managedCapability.effect ? [managedCapability.effect] : [],
        interactionOutcome: interactionResult.applicationStatus,
      });
    }
  } else if (userInputCase) {
    interaction = await controlActivities.createAgentInteractionActivity({
      runId,
      interactionType: 'USER_INPUT',
      operationKind: 'FAKE_RUNTIME_USER_INPUT',
      operationId: operation.operationId,
      operationKey: operation.operationKey + ':user-input',
      inputDigest: operation.inputDigest,
      safePrompt: 'Provide the bounded answer required by the fake runtime fixture.',
      policyRevision: 'agent-policy.v1',
      eligibleResponderScope: { mode: 'INITIATING_USER_OR_PROJECT_READER' },
      authorityEpoch: operation.fenceEpoch,
    });
    interactionResult = await waitForInteraction({ interaction: interaction.interaction, control });
    if (interactionResult.applicationStatus !== 'APPLIED') {
      return controlActivities.finalizeAgentRunActivity({
        runId,
        temporalRunId,
        operation,
        runtimeResult: noRuntimeResult(operation.runtimeKind, control.stopRequested ? 'CONFIRMED' : 'NOT_REQUESTED'),
        reconciliation: null,
        interactionOutcome: interactionResult.applicationStatus,
      });
    }
  }

  await controlActivities.markAgentRunStateActivity({ runId, status: 'RUNNING', reason: interaction ? 'durable_interaction_applied' : 'fake_runtime_operation_started' });
  const managedRequest = managedCapability?.capabilityRequest
    ? {
      ...managedCapability.capabilityRequest,
      credential: interactionResult?.capabilityRequest?.credential || managedCapability.capabilityRequest.credential || null,
    }
    : managedCapability?.effect
      ? {
        effectId: managedCapability.effect.effectId,
        effectKey: managedCapability.effect.effectKey,
        audience: null,
        capabilityKind: managedCapability.effect.capabilityKind,
        capabilityCode: managedCapability.effect.capabilityCode,
        capabilityVersion: managedCapability.effect.capabilityVersion,
        requestDigest: managedCapability.effect.requestDigest,
        credential: null,
      }
      : null;
  const runtimeResult = await runtimeActivities.executeFakeRuntimeActivity({
    runId,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    instruction: operation.instruction,
    runtimeKind: operation.runtimeKind,
    caseId: operation.fakeRuntimeCaseId || runtimeCase.caseId,
    cancellationRequested: control.stopRequested,
    managedCapabilityRequest: managedRequest,
    userInput: interactionResult?.input || null,
  });

  const capabilityEffects = [];
  const invocations = Array.isArray(runtimeResult.capabilityInvocations) ? runtimeResult.capabilityInvocations : [];
  if (managedCapability?.effect?.effectId && invocations.length > 0) {
    if (runtimeCaseId === 'browser-capability-revoked-before-dispatch') {
      await controlActivities.revokeManagedCapabilityBeforeDispatchActivity({ runId, effectId: managedCapability.effect.effectId });
      control.stopRequested = true;
    }
    for (const invocation of invocations) {
      capabilityEffects.push(await controlActivities.dispatchManagedCapabilityActivity({
        effectId: invocation.effectId || managedCapability.effect.effectId,
        credential: invocation.credential || interactionResult?.capabilityRequest?.credential || managedCapability.capabilityRequest?.credential || null,
        runtimeWorker: runtimeResult.worker || null,
        simulateUnknownDispatch: runtimeCaseId === 'browser-capability-unknown-dispatch',
      }));
    }
  }

  const redactedCapabilityInvocations = invocations.map((invocation) => ({
    effectId: invocation.effectId || null,
    effectKey: invocation.effectKey || null,
    audience: invocation.audience || null,
    capabilityKind: invocation.capabilityKind || null,
    capabilityCode: invocation.capabilityCode || null,
    capabilityVersion: invocation.capabilityVersion || null,
    requestDigest: invocation.requestDigest || null,
    deliveryIndex: invocation.deliveryIndex || null,
  }));
  const redactedRuntimeResult = {
    ...runtimeResult,
    capabilityInvocations: redactedCapabilityInvocations,
    taskOutputCandidate: runtimeResult.taskOutputCandidate
      ? {
        ...runtimeResult.taskOutputCandidate,
        capabilitiesExecuted: capabilityEffects.map((effect) => ({
          effectId: effect.effectId || null,
          capabilityKind: effect.capabilityKind || null,
          capabilityCode: effect.capabilityCode || null,
          authorityDecision: effect.authorityDecision || null,
          dispatchState: effect.dispatchState || null,
          outcomeCertainty: effect.outcomeCertainty || null,
          browserAutomationRunId: effect.browserAutomationRunId || null,
          nativeBrowserWorkflowId: effect.nativeBrowserWorkflowId || null,
          browserResult: effect.browserResult || null,
          replayed: Boolean(effect.replayed),
          denied: Boolean(effect.denied),
        })),
      }
      : runtimeResult.taskOutputCandidate,
  };

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
    runtimeResult: redactedRuntimeResult,
    reconciliation,
    capabilityEffects,
    interactionOutcome: interactionResult?.applicationStatus === 'APPLIED' ? null : interactionResult?.applicationStatus || null,
  });
}

module.exports = {
  agentRunWorkflow,
};
