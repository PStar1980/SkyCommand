
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

function noRuntimeResult(runtimeKind, physicalStopState = 'NOT_REQUESTED', runtimeDescriptor = {}) {
  const providerBacked = runtimeDescriptor.providerBacked === true;
  const runtimeMode = runtimeDescriptor.runtimeMode || (providerBacked ? 'PROVIDER_BACKED' : 'FIXTURE');
  return {
    runtimeKind,
    runtimeMode,
    providerBacked,
    adapterVersion: runtimeDescriptor.adapterVersion || (providerBacked ? 'provider-runtime-adapter.v1' : 'fake-runtime-adapter.v1'),
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

function validDurableTerminalObservation(value, recovery = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 'AGENT_PROVIDER_TERMINAL_OBSERVATION_V1'
    || value.providerBacked !== true
    || value.sendAcceptance !== 'ACKNOWLEDGED'
    || !['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'INTERRUPTED'].includes(String(value.providerTerminalStatus || '').toUpperCase())
    || !value.providerTurnId) return false;
  if (recovery.providerTurnId && value.providerTurnId !== recovery.providerTurnId) return false;
  if (recovery.providerSessionReference && value.providerSessionReference !== recovery.providerSessionReference) return false;
  if (recovery.providerOperationReference && value.providerOperationReference !== recovery.providerOperationReference) return false;
  return true;
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

async function recoverProviderOperation(input, temporalRunId) {
  const recovery = input.recovery || {};
  const runId = String(input.runId || '').trim();
  const currentState = await controlActivities.getAgentRunStateActivity({ runId });
  if (!currentState) throw new Error('Agent Run not found while recovering provider operation.');
  if (['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED'].includes(currentState.status)) {
    return { runId, status: currentState.status, idempotent: true, recoveryStarted: false };
  }

  // Recovery observes the already-admitted operation. It must not replay the
  // normal workflow-start QUEUED transition, which is invalid once the run is
  // already RUNNING/JOURNALED and would itself obscure provider uncertainty.
  const runtimeKind = String(recovery.runtimeKind || '').trim();
  if (!runtimeKind) throw new Error('Agent runtime identity is required while recovering a provider operation.');
  const operation = {
    operationId: String(recovery.operationId || '').trim(),
    turnId: String(recovery.turnId || '').trim(),
    sessionId: String(recovery.sessionId || '').trim(),
    runId,
    runtimeKind,
    runtimeMode: recovery.runtimeMode === 'PROVIDER_BACKED' ? 'PROVIDER_BACKED' : 'FIXTURE',
    providerBacked: recovery.providerBacked === true,
    recoverySupported: recovery.recoverySupported === true,
    adapterVersion: recovery.adapterVersion || null,
    providerOperationReference: String(recovery.providerOperationReference || '').trim(),
    providerModel: recovery.providerModel || null,
    providerReasoningEffort: recovery.providerReasoningEffort || null,
    fakeRuntimeCaseId: null,
    deadlineAt: recovery.deadlineAt || null,
  };
  const runtimeInput = {
    runId,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    runtimeKind: operation.runtimeKind,
    runtimeMode: operation.runtimeMode,
    providerBacked: operation.providerBacked,
    adapterVersion: operation.adapterVersion,
    providerTurnId: String(recovery.providerTurnId || '').trim(),
    providerSessionReference: String(recovery.providerSessionReference || '').trim(),
    threadId: String(recovery.threadId || '').trim(),
    providerOperationReference: operation.providerOperationReference,
    providerModel: operation.providerModel,
    providerReasoningEffort: operation.providerReasoningEffort,
    deadlineAt: operation.deadlineAt,
    timeoutMs: Number.isInteger(recovery.timeoutMs) ? recovery.timeoutMs : 120000,
    runtimeEvidenceBoundary: recovery.runtimeEvidenceBoundary || null,
  };

  let runtimeResult;
  const durableTerminalObservation = recovery.durableTerminalObservation || null;
  if (validDurableTerminalObservation(durableTerminalObservation, recovery)) {
    runtimeResult = {
      ...durableTerminalObservation,
      runtimeMode: operation.runtimeMode,
      providerBacked: operation.providerBacked,
      capabilityDispatchMode: operation.providerBacked ? 'RUNTIME' : 'CONTROL',
      providerOperationReference: durableTerminalObservation.providerOperationReference || operation.providerOperationReference,
      recoveryRequired: false,
    };
  } else {
    try {
      const observed = await runtimeActivities.observeRuntimeActivity(runtimeInput);
      runtimeResult = observed.runtimeResult || observed;
    } catch (error) {
      runtimeResult = {
        ...noRuntimeResult(operation.runtimeKind, 'NOT_REQUESTED', operation),
        sendAcceptance: 'UNKNOWN',
        outcomeCertainty: 'UNKNOWN',
        runtimeMode: operation.runtimeMode,
        providerBacked: operation.providerBacked,
        capabilityDispatchMode: operation.providerBacked ? 'RUNTIME' : 'CONTROL',
        providerTurnId: runtimeInput.providerTurnId || null,
        providerSessionReference: runtimeInput.providerSessionReference || null,
        threadId: runtimeInput.threadId || null,
        providerOperationReference: operation.providerOperationReference,
        recoveryRequired: true,
        providerErrorCode: String(error?.code || 'RUNTIME_OPERATION_OBSERVATION_UNKNOWN'),
      };
    }
  }

  if (runtimeResult?.providerBacked === true && runtimeResult?.providerTerminalStatus && runtimeResult.providerTerminalStatus !== 'UNKNOWN') {
    await controlActivities.recordProviderObservationActivity({
      runId,
      operationId: operation.operationId,
      turnId: operation.turnId,
      runtimeResult,
    });
  }

  let reconciliation = null;
  if (runtimeResult.sendAcceptance === 'UNKNOWN') {
    try {
      reconciliation = await runtimeActivities.reconcileRuntimeActivity(runtimeInput);
    } catch (error) {
      reconciliation = {
        disposition: 'RECOVERY_REQUIRED',
        operationReference: operation.providerOperationReference,
        providerTurnId: runtimeInput.providerTurnId || null,
        providerSessionReference: runtimeInput.providerSessionReference || null,
        reason: String(error?.code || 'RUNTIME_OPERATION_RECONCILIATION_UNKNOWN'),
      };
    }
  }

  const capabilityEffects = await controlActivities.getManagedCapabilityEffectsActivity({ runId });
  return controlActivities.finalizeAgentRunActivity({
    runId,
    temporalRunId,
    operation,
    runtimeResult,
    reconciliation,
    capabilityEffects,
    interactionOutcome: null,
  });
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
  if (input.recovery?.mode === 'OBSERVE_PROVIDER_OPERATION') {
    return recoverProviderOperation(input, temporalRunId);
  }
  const context = input.executionContext || {};
  const runtimeCase = input.fakeRuntimeCase || {};
  const runtimeCaseId = String(runtimeCase.caseId || '').trim();
  let providerBacked = context.runtime?.providerBacked === true;
  let managedCapabilityCase = MANAGED_CAPABILITY_CASES.has(runtimeCaseId) ? runtimeCaseId : null;
  const userInputCase = USER_INPUT_CASES.has(runtimeCaseId);

  await controlActivities.markAgentRunStateActivity({ runId, status: 'QUEUED', reason: 'temporal_workflow_started' });
  const stateAfterQueue = await controlActivities.getAgentRunStateActivity({ runId });
  if (control.stopRequested || ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(stateAfterQueue?.status) || stateAfterQueue?.scopeStatus !== 'ACTIVE') {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation: null,
      runtimeResult: noRuntimeResult(context.runtime?.runtimeKind || 'FAKE_PERSISTENT', 'CONFIRMED', context.runtime),
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
  managedCapabilityCase = operation.managedCapabilityCase || managedCapabilityCase;
  providerBacked = operation.providerBacked === true;
  if (operation.canceled || control.stopRequested) {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation: null,
      runtimeResult: noRuntimeResult(context.runtime?.runtimeKind || 'FAKE_PERSISTENT', 'CONFIRMED', context.runtime),
      reconciliation: null,
      interactionOutcome: 'CANCELED',
    });
  }

  const managedCapability = managedCapabilityCase
    ? await controlActivities.prepareManagedCapabilityEffectActivity({
      runId,
      operationId: operation.operationId,
      turnId: operation.turnId,
      caseId: managedCapabilityCase,
    })
    : null;

  if (providerBacked && managedCapability?.decision !== 'ALLOW') {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation,
      runtimeResult: noRuntimeResult(operation.runtimeKind, control.stopRequested ? 'CONFIRMED' : 'NOT_REQUESTED', operation),
      reconciliation: null,
      capabilityEffects: managedCapability?.effect ? [managedCapability.effect] : [],
      interactionOutcome: 'BLOCKED',
    });
  }

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
        runtimeResult: noRuntimeResult(operation.runtimeKind, control.stopRequested ? 'CONFIRMED' : 'NOT_REQUESTED', operation),
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
        runtimeResult: noRuntimeResult(operation.runtimeKind, control.stopRequested ? 'CONFIRMED' : 'NOT_REQUESTED', operation),
        reconciliation: null,
        interactionOutcome: interactionResult.applicationStatus,
      });
    }
  }

  if (control.stopRequested) {
    return controlActivities.finalizeAgentRunActivity({
      runId,
      temporalRunId,
      operation,
      runtimeResult: noRuntimeResult(operation.runtimeKind, 'CONFIRMED', operation),
      reconciliation: null,
      capabilityEffects: managedCapability?.effect ? [managedCapability.effect] : [],
      interactionOutcome: 'CANCELED',
    });
  }
  await controlActivities.markAgentRunStateActivity({ runId, status: 'RUNNING', reason: providerBacked ? 'managed_runtime_operation_starting' : interaction ? 'durable_interaction_applied' : 'fake_runtime_operation_started' });
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
  const runtimeInput = {
    runId,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    instruction: operation.instruction,
    runtimeKind: operation.runtimeKind,
    runtimeMode: operation.runtimeMode,
    providerBacked: operation.providerBacked,
    adapterVersion: operation.adapterVersion,
    providerOperationReference: operation.providerOperationReference,
    deadlineAt: operation.deadlineAt,
    providerModel: operation.providerModel,
    providerReasoningEffort: operation.providerReasoningEffort,
    managedCapabilityRequest: managedRequest,
    caseId: operation.fakeRuntimeCaseId || runtimeCase.caseId,
    cancellationRequested: control.stopRequested,
    userInput: interactionResult?.input || null,
  };
  let runtimeResult;
  {
    const startResponse = await runtimeActivities.startRuntimeActivity(runtimeInput);
    if (startResponse.observationRequired === true) {
      await controlActivities.recordProviderAcceptanceActivity({
        runId,
        operationId: operation.operationId,
        turnId: operation.turnId,
        providerTurnId: startResponse.providerTurnId,
        providerSessionReference: startResponse.providerSessionReference,
        providerOperationReference: startResponse.providerOperationReference || operation.providerOperationReference,
        threadId: startResponse.threadId,
        runtimeEvidenceBoundary: startResponse.runtimeEvidenceBoundary || null,
      });
      const observationInput = {
        ...runtimeInput,
        providerTurnId: startResponse.providerTurnId,
        providerSessionReference: startResponse.providerSessionReference,
        providerOperationReference: startResponse.providerOperationReference || operation.providerOperationReference,
        threadId: startResponse.threadId,
        runtimeEvidenceBoundary: startResponse.runtimeEvidenceBoundary || null,
      };
      const observePromise = runtimeActivities.observeRuntimeActivity(observationInput);
      const stopWinner = control.stopRequested
        ? { kind: 'STOP' }
        : await Promise.race([
          observePromise.then((value) => ({ kind: 'OBSERVED', value })),
          condition(() => control.stopRequested).then(() => ({ kind: 'STOP' })),
        ]);
      if (stopWinner.kind === 'STOP') {
        await controlActivities.markAgentRunStateActivity({ runId, status: 'CANCELLING', reason: control.reason || 'provider_turn_stop_requested' });
        let interrupt = null;
        let terminalObservation = null;
        try {
          interrupt = await runtimeActivities.interruptRuntimeActivity(observationInput);
          terminalObservation = await runtimeActivities.observeRuntimeActivity({
            ...observationInput,
            timeoutMs: 15000,
            deadlineAt: new Date(Date.now() + 15000).toISOString(),
          });
        } catch (_error) {
          terminalObservation = null;
        }
        const observed = terminalObservation?.runtimeResult || null;
        runtimeResult = {
          ...(observed || startResponse),
          runtimeMode: startResponse.runtimeMode || operation.runtimeMode,
          providerBacked: startResponse.providerBacked === true,
          physicalStop: interrupt?.physicalStop || observed?.physicalStop || { state: 'UNCONFIRMED', evidence: 'provider_stop_confirmation_unavailable' },
          terminalConfirmation: observed?.outcomeCertainty === 'CANCELED' ? 'CONFIRMED' : 'UNKNOWN',
          recoveryRequired: observed?.outcomeCertainty !== 'CANCELED',
        };
        control.stopRequested = true;
      } else {
        runtimeResult = stopWinner.value?.runtimeResult || stopWinner.value;
      }
    } else {
      runtimeResult = startResponse.runtimeResult || startResponse;
    }
  }

  if (runtimeResult?.providerBacked === true && runtimeResult?.providerTerminalStatus && runtimeResult.providerTerminalStatus !== 'UNKNOWN') {
    await controlActivities.recordProviderObservationActivity({
      runId,
      operationId: operation.operationId,
      turnId: operation.turnId,
      runtimeResult,
    });
  }

  const capabilityEffects = [];
  const invocations = Array.isArray(runtimeResult.capabilityInvocations) ? runtimeResult.capabilityInvocations : [];
  if (runtimeResult.capabilityDispatchMode !== 'RUNTIME' && managedCapability?.effect?.effectId && invocations.length > 0) {
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
  if (runtimeResult.capabilityDispatchMode === 'RUNTIME' && managedCapability?.effect?.effectId && invocations.length > 0) {
    capabilityEffects.push(...await controlActivities.getManagedCapabilityEffectsActivity({ runId }));
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
  if (runtimeResult.policyViolation) {
    redactedRuntimeResult.sendAcceptance = 'REJECTED_BEFORE_ACCEPTANCE';
    redactedRuntimeResult.outcomeCertainty = 'REJECTED';
    redactedRuntimeResult.taskOutputCandidate = null;
  }

  let reconciliation = null;
  if (runtimeResult.sendAcceptance === 'UNKNOWN') {
    await controlActivities.markAgentRunStateActivity({ runId, status: 'RECONCILING', reason: 'runtime_send_acceptance_unknown' });
    reconciliation = await runtimeActivities.reconcileRuntimeActivity({
      runId,
      operationId: operation.operationId,
      providerTurnId: runtimeResult.providerTurnId,
      providerSessionReference: runtimeResult.providerSessionReference,
      providerOperationReference: runtimeResult.providerOperationReference || operation.providerOperationReference,
      providerModel: operation.providerModel,
      providerReasoningEffort: operation.providerReasoningEffort,
      runtimeKind: operation.runtimeKind,
      runtimeMode: operation.runtimeMode,
      providerBacked: operation.providerBacked,
      caseId: operation.fakeRuntimeCaseId || runtimeCase.caseId,
    });
  }

  if (!control.stopRequested && reconciliation?.disposition !== 'RECOVERY_REQUIRED') {
    await controlActivities.markAgentRunStateActivity({ runId, status: 'CLOSING', reason: runtimeResult.providerBacked ? 'managed_provider_evidence_received' : 'fake_runtime_evidence_received' });
    await controlActivities.markAgentRunStateActivity({ runId, status: 'FINALIZING', reason: runtimeResult.providerBacked ? 'validating_managed_provider_result' : 'validating_fake_runtime_result' });
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
