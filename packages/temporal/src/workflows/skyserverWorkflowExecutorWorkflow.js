const { ApplicationFailure, condition, defineSignal, executeChild, proxyActivities, setHandler, sleep, startChild, workflowInfo } = require('@temporalio/workflow');

const definitionActivities = proxyActivities({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 3,
  },
});

const ledgerActivities = proxyActivities({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
    maximumAttempts: 5,
  },
});

const nodeExecutionActivities = proxyActivities({
  startToCloseTimeout: '90 minutes',
  retry: {
    maximumAttempts: 1,
  },
});

const DEFAULT_WAIT_DURATION_MS = 1000;
const MAX_WAIT_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_HUMAN_APPROVAL_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const HUMAN_APPROVAL_DECISION_SIGNAL = 'humanApprovalDecision';
const humanApprovalDecisionSignal = defineSignal(HUMAN_APPROVAL_DECISION_SIGNAL);
const WAIT_UNIT_MULTIPLIERS_MS = {
  MILLISECONDS: 1,
  SECONDS: 1000,
  MINUTES: 60 * 1000,
  HOURS: 60 * 60 * 1000,
};
const HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS = {
  MINUTES: 60 * 1000,
  HOURS: 60 * 60 * 1000,
  DAYS: 24 * 60 * 60 * 1000,
};

function getSafeObject(value, fallback = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeWorkflowIdPart(value, fallback = 'workflow') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180);

  return normalized || fallback;
}

function buildNodeParameters(node, requestInput = {}) {
  const input = getSafeObject(requestInput);
  const nodeInputs = getSafeObject(input.nodeInputs);
  const parameterOverrides = getSafeObject(input.parameterOverrides);
  const nodeOverride = getSafeObject(nodeInputs[node.nodeKey] || parameterOverrides[node.nodeKey]);

  return {
    ...getSafeObject(node.inputParameters),
    ...nodeOverride,
  };
}

function normalizePositiveInteger(value, fallback, max = 10) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function getNodeRetryPolicy(node = {}) {
  const retryPolicy = getSafeObject(node.retryPolicy);
  const maximumAttempts = normalizePositiveInteger(
    retryPolicy.maximumAttempts || retryPolicy.maximum_attempts,
    1,
    10,
  );
  const initialIntervalSeconds = normalizePositiveInteger(
    retryPolicy.initialIntervalSeconds || retryPolicy.initial_interval_seconds,
    5,
    3600,
  );

  return {
    maximumAttempts,
    initialIntervalSeconds,
  };
}

function serializeError(error) {
  return {
    message: error?.message || String(error),
    name: error?.name || 'Error',
    details: getSafeObject(error?.details, {}),
  };
}


function getPermissionSet(permissions = []) {
  return new Set(
    getSafeArray(permissions)
      .map((permission) => permission.permissionCode || permission.permission_code)
      .filter(Boolean),
  );
}

function assertWorkflowPermission({ permissionCode, permissions, action }) {
  if (!permissionCode) {
    return;
  }

  const permissionSet = getPermissionSet(permissions);

  if (!permissionSet.has(permissionCode)) {
    throw ApplicationFailure.create({
      message: `Permission denied for ${action || 'workflow action'}.`,
      type: 'SkyServerWorkflowPermissionError',
      nonRetryable: true,
      details: [{ permissionCode, action }],
    });
  }
}

function normalizeStringArray(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[,\s]+/)
      .map((item) => item.trim());
  const seen = new Set();
  const output = [];

  for (const rawValue of rawValues) {
    const normalized = String(rawValue || '').trim().toUpperCase();

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }

  return output;
}

function normalizeTemplatePositiveInteger(value, fallback, max = 100) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function buildTemporalTemplateInput({ template, parameters, workflowId }) {
  const safeParameters = getSafeObject(parameters);
  const input = {
    ...safeParameters,
    workflowId: safeParameters.workflowId || workflowId,
    workflowCode: template.workflowCode,
    runSource: safeParameters.runSource || 'skyserver_workflow_node',
  };

  if (Object.prototype.hasOwnProperty.call(input, 'indicators')) {
    input.indicators = normalizeStringArray(input.indicators);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'concurrency') || template.defaultConcurrency) {
    input.concurrency = normalizeTemplatePositiveInteger(
      input.concurrency || input.batchSize,
      template.defaultConcurrency || 3,
      template.maxConcurrency || 10,
    );
  }

  if (Object.prototype.hasOwnProperty.call(input, 'timeoutMs') || template.defaultTimeoutMs) {
    input.timeoutMs = normalizeTemplatePositiveInteger(
      input.timeoutMs,
      template.defaultTimeoutMs || 1800000,
      template.maxTimeoutMs || 86400000,
    );
  }

  return input;
}

function buildTemporalResultPreview(value, maxLength = 4000) {
  try {
    const text = JSON.stringify(value || {}, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n[SkyServer Workflow Executor] Temporal result preview truncated.` : text;
  } catch (error) {
    const text = String(value || '');
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }
}

function isBlankValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function createWaitInputFailure(message, details = {}) {
  return ApplicationFailure.create({
    message,
    type: 'SkyServerWaitNodeInputError',
    nonRetryable: true,
    details: [details],
  });
}

function normalizeWaitUnit(value) {
  const normalized = String(value || 'SECONDS')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    MS: 'MILLISECONDS',
    MILLISECOND: 'MILLISECONDS',
    MILLISECONDS: 'MILLISECONDS',
    SECOND: 'SECONDS',
    SECONDS: 'SECONDS',
    SEC: 'SECONDS',
    S: 'SECONDS',
    MINUTE: 'MINUTES',
    MINUTES: 'MINUTES',
    MIN: 'MINUTES',
    M: 'MINUTES',
    HOUR: 'HOURS',
    HOURS: 'HOURS',
    HR: 'HOURS',
    H: 'HOURS',
  };
  const unit = aliases[normalized] || normalized;

  if (!Object.prototype.hasOwnProperty.call(WAIT_UNIT_MULTIPLIERS_MS, unit)) {
    throw createWaitInputFailure('Unsupported WAIT duration unit.', {
      unit: value,
      allowed: Object.keys(WAIT_UNIT_MULTIPLIERS_MS),
    });
  }

  return unit;
}

function parseWaitDurationMs(parameters = {}) {
  const input = getSafeObject(parameters);
  const rawDurationMs = input.durationMs ?? input.waitMs ?? input.delayMs;

  if (!isBlankValue(rawDurationMs)) {
    const parsedDurationMs = Number(rawDurationMs);

    if (!Number.isFinite(parsedDurationMs) || parsedDurationMs <= 0) {
      throw createWaitInputFailure('WAIT durationMs must be a positive number.', {
        durationMs: rawDurationMs,
      });
    }

    return Math.round(parsedDurationMs);
  }

  const unit = normalizeWaitUnit(input.unit || input.durationUnit || 'SECONDS');
  const rawDuration = input.duration ?? input.waitDuration ?? input.delayDuration ?? DEFAULT_WAIT_DURATION_MS / WAIT_UNIT_MULTIPLIERS_MS[unit];
  const parsedDuration = Number(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    throw createWaitInputFailure('WAIT duration must be a positive number.', {
      duration: rawDuration,
    });
  }

  return Math.round(parsedDuration * WAIT_UNIT_MULTIPLIERS_MS[unit]);
}

function normalizeWaitParameters(parameters = {}) {
  const input = getSafeObject(parameters);
  const unit = normalizeWaitUnit(input.unit || input.durationUnit || 'SECONDS');
  const durationMs = parseWaitDurationMs({ ...input, unit });

  if (durationMs > MAX_WAIT_DURATION_MS) {
    throw createWaitInputFailure('WAIT nodes are capped at 24 hours.', {
      durationMs,
      maxDurationMs: MAX_WAIT_DURATION_MS,
    });
  }

  const duration = !isBlankValue(input.duration)
    ? Number(input.duration)
    : durationMs / WAIT_UNIT_MULTIPLIERS_MS[unit];

  return {
    ...input,
    duration,
    unit,
    durationMs,
    reason: String(input.reason || input.note || '').trim().slice(0, 500),
  };
}

function buildWaitNodeOutput({ node, waitParameters, startedAtMs, completedAtMs }) {
  const actualDurationMs = Math.max(0, completedAtMs - startedAtMs);
  const reason = waitParameters.reason || null;

  return {
    kind: 'wait_delay',
    status: 'SUCCESS',
    nodeKey: node.nodeKey,
    duration: waitParameters.duration,
    unit: waitParameters.unit,
    requestedDurationMs: waitParameters.durationMs,
    actualDurationMs,
    reason,
    summary: `Waited ${waitParameters.durationMs} ms${reason ? ` (${reason})` : ''}; continuing workflow.`,
  };
}

async function executeWaitNode({ node, parameters, nodeRun }) {
  let waitParameters = null;

  try {
    await ledgerActivities.markSkyserverWorkflowNodeAttemptActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      attemptCount: 1,
      metadata: {
        waitNode: true,
      },
    });

    waitParameters = normalizeWaitParameters(parameters);
    const startedAtMs = Date.now();

    await sleep(waitParameters.durationMs);

    const output = buildWaitNodeOutput({
      node,
      waitParameters,
      startedAtMs,
      completedAtMs: Date.now(),
    });

    return await ledgerActivities.completeSkyserverWorkflowNodeRunActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      output,
      metadata: {
        parameters,
        waitNode: true,
        waitDurationMs: waitParameters.durationMs,
      },
    });
  } catch (error) {
    const normalizedError = serializeError(error);

    await ledgerActivities.failSkyserverWorkflowNodeRunActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      output: normalizedError.details || {},
      errorMessage: normalizedError.message,
      metadata: {
        parameters,
        waitNode: true,
        waitDurationMs: waitParameters?.durationMs || null,
        errorName: normalizedError.name,
      },
    });

    throw ApplicationFailure.create({
      message: normalizedError.message,
      type: normalizedError.name || 'SkyServerWaitNodeFailure',
      nonRetryable: true,
      details: [normalizedError],
    });
  }
}

function normalizeConditionOnFalseAction(value) {
  const normalized = String(value || 'STOP_SUCCESS')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    '': 'STOP_SUCCESS',
    STOP: 'STOP_SUCCESS',
    STOP_SUCCESS: 'STOP_SUCCESS',
    SKIP_REMAINING: 'STOP_SUCCESS',
    FAIL: 'FAIL_WORKFLOW',
    FAIL_WORKFLOW: 'FAIL_WORKFLOW',
    CONTINUE: 'CONTINUE',
    CONTINUE_ANYWAY: 'CONTINUE',
  };

  return aliases[normalized] || normalized;
}

function buildConditionStopSummary({ definition, output, completedNodeCount, totalNodeCount }) {
  const skippedNodeCount = Math.max(0, Number(totalNodeCount || 0) - Number(completedNodeCount || 0));

  return `Workflow ${definition.displayName} stopped successfully by condition gate: ${output?.summary || 'condition returned false'} (${skippedNodeCount} remaining node(s) skipped).`;
}

function normalizeConditionBranchTargetNodeKey(value) {
  return String(value || '').trim();
}

function getConditionBranchTargetKeyFromOutput(output = {}) {
  return normalizeConditionBranchTargetNodeKey(output.branchTargetNodeKey || output.nextNodeKey || output.targetNodeKey);
}

function buildWorkflowExecutionPlan(nodes = []) {
  const orderedNodes = getSafeArray(nodes);
  const nodeIndexByKey = new Map();

  orderedNodes.forEach((node, index) => {
    nodeIndexByKey.set(node.nodeKey, index);
  });

  return {
    nodes: orderedNodes,
    nodeIndexByKey,
  };
}

function createConditionBranchFailure(message, details = {}) {
  return ApplicationFailure.create({
    message,
    type: 'SkyServerWorkflowConditionBranchError',
    nonRetryable: true,
    details: [details],
  });
}

function resolveConditionBranchIndex({ output, currentIndex, executionPlan }) {
  const branchTargetNodeKey = getConditionBranchTargetKeyFromOutput(output);

  if (!branchTargetNodeKey) {
    return null;
  }

  const targetIndex = executionPlan.nodeIndexByKey.get(branchTargetNodeKey);

  if (!Number.isInteger(targetIndex)) {
    throw createConditionBranchFailure('Condition branch target was not found in the workflow graph.', {
      branchTargetNodeKey,
      output,
    });
  }

  if (targetIndex <= currentIndex) {
    throw createConditionBranchFailure('Condition branch target must point to a later node in the sequential lane.', {
      branchTargetNodeKey,
      currentIndex,
      targetIndex,
    });
  }

  return targetIndex;
}


function createHumanApprovalInputFailure(message, details = {}) {
  return ApplicationFailure.create({
    message,
    type: 'SkyServerHumanApprovalInputError',
    nonRetryable: true,
    details: [details],
  });
}

function normalizeHumanApprovalAction(value, fallback = 'STOP_SUCCESS') {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    '': fallback,
    STOP: 'STOP_SUCCESS',
    STOP_SUCCESS: 'STOP_SUCCESS',
    SKIP_REMAINING: 'STOP_SUCCESS',
    FAIL: 'FAIL_WORKFLOW',
    FAIL_WORKFLOW: 'FAIL_WORKFLOW',
    CONTINUE: 'CONTINUE',
    CONTINUE_ANYWAY: 'CONTINUE',
  };
  const action = aliases[normalized] || normalized;

  if (!['STOP_SUCCESS', 'FAIL_WORKFLOW', 'CONTINUE'].includes(action)) {
    throw createHumanApprovalInputFailure('Unsupported HUMAN_APPROVAL continuation action.', {
      action: value,
    });
  }

  return action;
}

function normalizeHumanApprovalTimeoutUnit(value) {
  const normalized = String(value || 'HOURS')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    MINUTE: 'MINUTES',
    MINUTES: 'MINUTES',
    MIN: 'MINUTES',
    HOUR: 'HOURS',
    HOURS: 'HOURS',
    HR: 'HOURS',
    DAY: 'DAYS',
    DAYS: 'DAYS',
  };
  const unit = aliases[normalized] || normalized;

  if (!Object.prototype.hasOwnProperty.call(HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS, unit)) {
    throw createHumanApprovalInputFailure('Unsupported HUMAN_APPROVAL timeout unit.', {
      unit: value,
      allowed: Object.keys(HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS),
    });
  }

  return unit;
}

function parseHumanApprovalTimeoutMs(parameters = {}) {
  const input = getSafeObject(parameters);
  const rawTimeoutMs = input.timeoutMs ?? input.approvalTimeoutMs;

  if (!isBlankValue(rawTimeoutMs)) {
    const parsedTimeoutMs = Number(rawTimeoutMs);

    if (!Number.isFinite(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
      throw createHumanApprovalInputFailure('HUMAN_APPROVAL timeoutMs must be a positive number or blank.', {
        timeoutMs: rawTimeoutMs,
      });
    }

    return Math.round(parsedTimeoutMs);
  }

  const rawDuration = input.timeoutDuration ?? input.duration;

  if (isBlankValue(rawDuration)) {
    return null;
  }

  const unit = normalizeHumanApprovalTimeoutUnit(input.timeoutUnit || input.unit || 'HOURS');
  const parsedDuration = Number(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    throw createHumanApprovalInputFailure('HUMAN_APPROVAL timeout duration must be a positive number or blank.', {
      timeoutDuration: rawDuration,
    });
  }

  return Math.round(parsedDuration * HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS[unit]);
}

function normalizeHumanApprovalParameters(parameters = {}, node = {}) {
  const input = getSafeObject(parameters);
  const approvalTitle = String(input.approvalTitle || input.title || node.displayName || 'Approval required').trim();
  const approvalKey = normalizeWorkflowIdPart(input.approvalKey || node.nodeKey || 'approval', 'approval').replace(/-/g, '_');
  const timeoutMs = parseHumanApprovalTimeoutMs(input);

  if (!approvalTitle) {
    throw createHumanApprovalInputFailure('HUMAN_APPROVAL nodes require approvalTitle.', {
      fieldName: 'approvalTitle',
    });
  }

  if (timeoutMs && timeoutMs > MAX_HUMAN_APPROVAL_TIMEOUT_MS) {
    throw createHumanApprovalInputFailure('HUMAN_APPROVAL timeout is capped at 30 days.', {
      timeoutMs,
      maxTimeoutMs: MAX_HUMAN_APPROVAL_TIMEOUT_MS,
    });
  }

  return {
    ...input,
    approvalTitle,
    approvalKey,
    instructions: String(input.instructions || input.prompt || '').trim().slice(0, 4000),
    requiredRoleCode: String(input.requiredRoleCode || input.requiredRole || '').trim().toUpperCase() || null,
    onReject: normalizeHumanApprovalAction(input.onReject || input.rejectAction || 'STOP_SUCCESS', 'STOP_SUCCESS'),
    onTimeout: normalizeHumanApprovalAction(input.onTimeout || input.timeoutAction || 'FAIL_WORKFLOW', 'FAIL_WORKFLOW'),
    timeoutMs,
    timeoutDuration: input.timeoutDuration ?? input.duration ?? null,
    timeoutUnit: timeoutMs ? normalizeHumanApprovalTimeoutUnit(input.timeoutUnit || input.unit || 'HOURS') : null,
  };
}

function normalizeApprovalDecision(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    APPROVE: 'APPROVED',
    APPROVED: 'APPROVED',
    YES: 'APPROVED',
    REJECT: 'REJECTED',
    REJECTED: 'REJECTED',
    NO: 'REJECTED',
    TIMEOUT: 'TIMED_OUT',
    TIMED_OUT: 'TIMED_OUT',
  };
  const decision = aliases[normalized] || normalized;

  if (!['APPROVED', 'REJECTED', 'TIMED_OUT'].includes(decision)) {
    throw createHumanApprovalInputFailure('Unsupported approval decision.', {
      decision: value,
    });
  }

  return decision;
}

function getApprovalActionForDecision(decision, approvalParameters = {}) {
  if (decision === 'APPROVED') {
    return 'CONTINUE';
  }

  if (decision === 'REJECTED') {
    return normalizeHumanApprovalAction(approvalParameters.onReject || 'STOP_SUCCESS', 'STOP_SUCCESS');
  }

  if (decision === 'TIMED_OUT') {
    return normalizeHumanApprovalAction(approvalParameters.onTimeout || 'FAIL_WORKFLOW', 'FAIL_WORKFLOW');
  }

  return 'FAIL_WORKFLOW';
}

function getApprovalDecisionLookupKeys(payload = {}) {
  const item = getSafeObject(payload);

  return [
    item.approvalRequestId,
    item.workflowNodeRunRecordId,
    item.nodeKey,
    item.approvalKey,
  ]
    .map((key) => String(key || '').trim())
    .filter(Boolean);
}

function buildHumanApprovalOutput({ approval, approvalParameters, decisionPayload = {}, timedOut = false } = {}) {
  const decision = normalizeApprovalDecision(decisionPayload.decision || (timedOut ? 'TIMED_OUT' : 'REJECTED'));
  const action = getApprovalActionForDecision(decision, approvalParameters || approval || {});
  const actor = getSafeObject(decisionPayload.actor, {});
  const actorName = actor.displayName || actor.email || approval?.decidedByDisplayName || approval?.decidedByEmail || null;
  const title = approval?.approvalTitle || approvalParameters?.approvalTitle || 'Approval required';
  const decisionNote = decisionPayload.decisionNote || approval?.decisionNote || null;
  const summary = decision === 'APPROVED'
    ? `Approval granted for ${title}${actorName ? ` by ${actorName}` : ''}; continuing workflow.`
    : decision === 'REJECTED'
      ? `Approval rejected for ${title}${actorName ? ` by ${actorName}` : ''}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`
      : `Approval timed out for ${title}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`;

  return {
    kind: 'human_approval',
    status: decision,
    approved: decision === 'APPROVED',
    rejected: decision === 'REJECTED',
    timedOut: timedOut || decision === 'TIMED_OUT',
    decision,
    action,
    approvalRequestId: approval?.approvalRequestId || decisionPayload.approvalRequestId || null,
    approvalKey: approval?.approvalKey || approvalParameters?.approvalKey || decisionPayload.approvalKey || null,
    approvalTitle: title,
    instructions: approval?.instructions || approvalParameters?.instructions || null,
    requiredRoleCode: approval?.requiredRoleCode || approvalParameters?.requiredRoleCode || null,
    temporalWorkflowId: approval?.temporalWorkflowId || null,
    temporalRunId: approval?.temporalRunId || null,
    decisionNote,
    decidedByDisplayName: actorName,
    decidedAt: decisionPayload.decidedAt || approval?.decidedAt || null,
    summary,
  };
}

function buildHumanApprovalStopSummary({ definition, output, completedNodeCount, totalNodeCount }) {
  const skippedNodeCount = Math.max(0, Number(totalNodeCount || 0) - Number(completedNodeCount || 0));

  return `Workflow ${definition.displayName} stopped successfully by human approval gate: ${output?.summary || 'approval did not continue'} (${skippedNodeCount} remaining node(s) skipped).`;
}

async function executeHumanApprovalNode({
  node,
  parameters,
  nodeRun,
  user,
  context,
  approvalDecisions,
  temporalWorkflowId,
  temporalRunId,
  workflowRunRecordId,
}) {
  let approvalParameters = null;
  let approval = null;

  try {
    await ledgerActivities.markSkyserverWorkflowNodeAttemptActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      attemptCount: 1,
      metadata: {
        humanApprovalNode: true,
      },
    });

    approvalParameters = normalizeHumanApprovalParameters(parameters, node);
    approval = await ledgerActivities.createSkyserverWorkflowApprovalRequestActivity({
      workflowRunRecordId,
      workflowNodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      node,
      parameters: approvalParameters,
      user,
      context,
      temporalWorkflowId,
      temporalRunId,
    });

    const waitKeys = [
      approval?.approvalRequestId,
      approval?.workflowNodeRunRecordId,
      approval?.nodeKey,
      approval?.approvalKey,
      nodeRun.workflowNodeRunRecordId,
      node.nodeKey,
      approvalParameters.approvalKey,
    ]
      .map((key) => String(key || '').trim())
      .filter(Boolean);
    const hasDecision = () => waitKeys.some((key) => Boolean(approvalDecisions[key]));
    let completedBySignal = true;

    if (approvalParameters.timeoutMs) {
      completedBySignal = await condition(hasDecision, approvalParameters.timeoutMs);
    } else {
      await condition(hasDecision);
    }

    const receivedDecision = waitKeys.map((key) => approvalDecisions[key]).find(Boolean);
    const decisionPayload = completedBySignal && receivedDecision
      ? getSafeObject(receivedDecision)
      : {
        approvalRequestId: approval?.approvalRequestId,
        workflowRunRecordId,
        workflowNodeRunRecordId: nodeRun.workflowNodeRunRecordId,
        nodeKey: node.nodeKey,
        approvalKey: approvalParameters.approvalKey,
        decision: 'TIMED_OUT',
        decisionNote: 'Approval request timed out.',
        actor: null,
      };
    const decision = normalizeApprovalDecision(decisionPayload.decision);
    const resolvedApproval = await ledgerActivities.resolveSkyserverWorkflowApprovalRequestActivity({
      approvalRequestId: approval.approvalRequestId,
      decision,
      decisionNote: decisionPayload.decisionNote || null,
      user: getSafeObject(decisionPayload.actor, {}),
      metadata: {
        humanApprovalNode: true,
        resolvedByWorkflow: true,
        timedOut: decision === 'TIMED_OUT',
      },
    });
    const output = buildHumanApprovalOutput({
      approval: resolvedApproval || approval,
      approvalParameters,
      decisionPayload,
      timedOut: decision === 'TIMED_OUT',
    });

    return await ledgerActivities.completeSkyserverWorkflowNodeRunActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      output,
      metadata: {
        parameters,
        humanApprovalNode: true,
        approvalRequestId: approval.approvalRequestId,
        approvalStatus: output.status,
        approvalAction: output.action,
      },
    });
  } catch (error) {
    const normalizedError = serializeError(error);

    await ledgerActivities.failSkyserverWorkflowNodeRunActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      output: normalizedError.details || {},
      errorMessage: normalizedError.message,
      metadata: {
        parameters,
        humanApprovalNode: true,
        approvalRequestId: approval?.approvalRequestId || null,
        errorName: normalizedError.name,
      },
    });

    throw ApplicationFailure.create({
      message: normalizedError.message,
      type: normalizedError.name || 'SkyServerHumanApprovalNodeFailure',
      nonRetryable: true,
      details: [normalizedError],
    });
  }
}


async function executeChildWorkflowNodeWithRetries({
  definition,
  node,
  parameters,
  nodeRun,
  user,
  session,
  permissions,
  context,
  temporalWorkflowId,
  temporalRunId,
  workflowRunRecordId,
  taskQueue,
}) {
  const retryPolicy = getNodeRetryPolicy(node);
  const childWorkflowCode = String(parameters.workflowCode || node.targetCode || '').trim();
  const baseWorkflowStack = getSafeArray(context.workflowStack).includes(definition.workflowCode)
    ? getSafeArray(context.workflowStack)
    : [...getSafeArray(context.workflowStack), definition.workflowCode];
  let lastError = null;

  if (!childWorkflowCode) {
    throw ApplicationFailure.create({
      message: 'Child workflow target is required.',
      type: 'SkyServerChildWorkflowInputError',
      nonRetryable: true,
    });
  }

  for (let attempt = 1; attempt <= retryPolicy.maximumAttempts; attempt += 1) {
    await ledgerActivities.markSkyserverWorkflowNodeAttemptActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      attemptCount: attempt,
      metadata: {
        retryPolicy,
        childWorkflowCode,
      },
    });

    try {
      const parentContext = {
        ...getSafeObject(context),
        workflowStack: baseWorkflowStack,
      };
      const childContext = {
        ...parentContext,
        parentWorkflowCode: definition.workflowCode,
        parentWorkflowRunRecordId: workflowRunRecordId,
        parentNodeKey: node.nodeKey,
        workflowStack: [...baseWorkflowStack, childWorkflowCode],
      };
      const childInput = {
        ...getSafeObject(parameters),
        runSource: 'child_workflow',
        triggerType: 'CHILD_WORKFLOW',
        parentWorkflowRunRecordId: workflowRunRecordId,
        parentWorkflowCode: definition.workflowCode,
        parentNodeKey: node.nodeKey,
      };
      const childRun = await ledgerActivities.startChildSkyserverWorkflowRunActivity({
        parentWorkflowRunRecordId: workflowRunRecordId,
        parentWorkflowCode: definition.workflowCode,
        parentNodeKey: node.nodeKey,
        childWorkflowCode,
        input: childInput,
        user,
        context: parentContext,
        permissions,
      });
      const childWorkflowId = normalizeWorkflowIdPart(
        `${temporalWorkflowId}-${node.nodeKey}-child-${attempt}`,
        `child-${node.nodeKey}`,
      );

      const childResult = await executeChild(skyserverWorkflowExecutorWorkflow, {
        workflowId: childWorkflowId,
        taskQueue: taskQueue || undefined,
        args: [{
          workflowCode: childRun.definition.workflowCode,
          workflowRunRecordId: childRun.run.workflowRunRecordId,
          input: childInput,
          user,
          session,
          permissions,
          context: childContext,
          taskQueue,
        }],
      });

      const output = {
        kind: 'child_workflow_execution',
        status: 'SUCCESS',
        workflowCode: childRun.definition.workflowCode,
        workflowDisplayName: childRun.definition.displayName,
        workflowRunRecordId: childRun.run.workflowRunRecordId,
        temporalWorkflowId: childResult.temporalWorkflowId,
        temporalRunId: childResult.temporalRunId,
        childSummary: childResult.summary,
        childNodeCount: childResult.nodeRuns?.length || 0,
        summary: `Child workflow ${childRun.definition.displayName} completed successfully.`,
      };

      const completedNodeRun = await ledgerActivities.completeSkyserverWorkflowNodeRunActivity({
        nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
        output,
        metadata: {
          parameters,
          attemptCount: attempt,
          retryPolicy,
          childWorkflowCode,
          childWorkflowRunRecordId: childRun.run.workflowRunRecordId,
        },
      });

      return completedNodeRun;
    } catch (error) {
      lastError = error;

      if (attempt < retryPolicy.maximumAttempts) {
        await sleep(retryPolicy.initialIntervalSeconds * 1000 * attempt);
      }
    }
  }

  const normalizedError = serializeError(lastError);
  await ledgerActivities.failSkyserverWorkflowNodeRunActivity({
    nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
    output: normalizedError.details || {},
    errorMessage: normalizedError.message,
    metadata: {
      parameters,
      retryPolicy,
      childWorkflowCode,
      attemptCount: retryPolicy.maximumAttempts,
      errorName: normalizedError.name,
    },
  });

  throw ApplicationFailure.create({
    message: normalizedError.message,
    type: normalizedError.name || 'SkyServerChildWorkflowFailure',
    nonRetryable: true,
    details: [normalizedError],
  });
}

async function executeTemporalWorkflowTemplateNodeWithRetries({
  node,
  parameters,
  nodeRun,
  permissions,
  temporalWorkflowId,
  workflowRunRecordId,
  taskQueue,
}) {
  const retryPolicy = getNodeRetryPolicy(node);
  const templateWorkflowCode = String(parameters.workflowCode || node.targetCode || '').trim();
  let lastError = null;

  if (!templateWorkflowCode) {
    throw ApplicationFailure.create({
      message: 'Temporal workflow template node target is required.',
      type: 'SkyServerTemporalWorkflowInputError',
      nonRetryable: true,
    });
  }

  for (let attempt = 1; attempt <= retryPolicy.maximumAttempts; attempt += 1) {
    await ledgerActivities.markSkyserverWorkflowNodeAttemptActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      attemptCount: attempt,
      metadata: {
        retryPolicy,
        templateWorkflowCode,
      },
    });

    try {
      const template = await definitionActivities.loadTemporalWorkflowDefinitionActivity({
        workflowCode: templateWorkflowCode,
      });

      assertWorkflowPermission({
        permissionCode: template.startPermissionCode,
        permissions,
        action: 'start_temporal_workflow_template_node',
      });

      const childWorkflowId = normalizeWorkflowIdPart(
        `${temporalWorkflowId}-${node.nodeKey}-temporal-${attempt}`,
        `temporal-${node.nodeKey}`,
      );
      const childInput = buildTemporalTemplateInput({
        template,
        parameters,
        workflowId: childWorkflowId,
      });
      const childHandle = await startChild(template.workflowType, {
        workflowId: childWorkflowId,
        taskQueue: template.taskQueue || taskQueue || undefined,
        args: [childInput],
      });
      const childRunId = await childHandle.firstExecutionRunId;
      const childResult = await childHandle.result();

      if (childResult && childResult.ok === false) {
        throw ApplicationFailure.create({
          message: `Temporal workflow template ${template.displayName || template.workflowCode} completed with a failed result.`,
          type: 'SkyServerTemporalWorkflowTemplateFailedResult',
          nonRetryable: true,
          details: [{ templateWorkflowCode, childResult }],
        });
      }

      const output = {
        kind: 'temporal_workflow_execution',
        status: 'SUCCESS',
        workflowCode: template.workflowCode,
        workflowType: template.workflowType,
        workflowDisplayName: template.displayName,
        temporalWorkflowId: childHandle.workflowId,
        temporalRunId: childRunId,
        taskQueue: template.taskQueue || taskQueue || null,
        namespace: template.namespace || null,
        resultOk: childResult?.ok !== false,
        resultSummary: childResult?.summary || null,
        resultPreview: buildTemporalResultPreview(childResult),
        summary: `Temporal workflow template ${template.displayName || template.workflowCode} completed successfully.`,
      };

      const completedNodeRun = await ledgerActivities.completeSkyserverWorkflowNodeRunActivity({
        nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
        output,
        metadata: {
          parameters,
          attemptCount: attempt,
          retryPolicy,
          templateWorkflowCode,
          temporalTemplateWorkflowId: childHandle.workflowId,
          temporalTemplateRunId: childRunId,
          workflowRunRecordId,
        },
      });

      return completedNodeRun;
    } catch (error) {
      lastError = error;

      if (attempt < retryPolicy.maximumAttempts) {
        await sleep(retryPolicy.initialIntervalSeconds * 1000 * attempt);
      }
    }
  }

  const normalizedError = serializeError(lastError);
  await ledgerActivities.failSkyserverWorkflowNodeRunActivity({
    nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
    output: normalizedError.details || {},
    errorMessage: normalizedError.message,
    metadata: {
      parameters,
      retryPolicy,
      templateWorkflowCode,
      attemptCount: retryPolicy.maximumAttempts,
      errorName: normalizedError.name,
    },
  });

  throw ApplicationFailure.create({
    message: normalizedError.message,
    type: normalizedError.name || 'SkyServerTemporalWorkflowTemplateFailure',
    nonRetryable: true,
    details: [normalizedError],
  });
}

async function executeNodeWithRetries({
  node,
  parameters,
  nodeRun,
  user,
  session,
  permissions,
  context,
  temporalWorkflowId,
  temporalRunId,
  workflowRunRecordId,
}) {
  const retryPolicy = getNodeRetryPolicy(node);
  let lastError = null;

  for (let attempt = 1; attempt <= retryPolicy.maximumAttempts; attempt += 1) {
    await ledgerActivities.markSkyserverWorkflowNodeAttemptActivity({
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      attemptCount: attempt,
      metadata: {
        retryPolicy,
      },
    });

    try {
      const output = await nodeExecutionActivities.executeSkyserverWorkflowNodeActivity({
        node,
        parameters,
        user,
        session,
        permissions,
        context,
        temporalWorkflowId,
        temporalRunId,
        workflowRunRecordId,
        nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      });

      const completedNodeRun = await ledgerActivities.completeSkyserverWorkflowNodeRunActivity({
        nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
        output,
        metadata: {
          parameters,
          attemptCount: attempt,
          retryPolicy,
        },
      });

      return completedNodeRun;
    } catch (error) {
      lastError = error;

      if (attempt < retryPolicy.maximumAttempts) {
        await sleep(retryPolicy.initialIntervalSeconds * 1000 * attempt);
      }
    }
  }

  const normalizedError = serializeError(lastError);
  await ledgerActivities.failSkyserverWorkflowNodeRunActivity({
    nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
    output: normalizedError.details || {},
    errorMessage: normalizedError.message,
    metadata: {
      parameters,
      retryPolicy,
      attemptCount: retryPolicy.maximumAttempts,
      errorName: normalizedError.name,
    },
  });

  throw ApplicationFailure.create({
    message: normalizedError.message,
    type: normalizedError.name || 'SkyServerWorkflowNodeFailure',
    nonRetryable: true,
    details: [normalizedError],
  });
}

async function skyserverWorkflowExecutorWorkflow(input = {}) {
  const startedAtMs = Date.now();
  const info = workflowInfo();
  const temporalWorkflowId = info.workflowId;
  const temporalRunId = info.runId;
  const workflowCode = input.workflowCode;
  const workflowRunRecordId = input.workflowRunRecordId;
  const requestInput = getSafeObject(input.input);
  const nodeRuns = [];
  const nodeOutputsByKey = {};
  let previousNodeOutput = null;
  let conditionStop = null;
  let approvalStop = null;
  const approvalDecisions = {};

  setHandler(humanApprovalDecisionSignal, (payload = {}) => {
    const safePayload = getSafeObject(payload);

    for (const key of getApprovalDecisionLookupKeys(safePayload)) {
      approvalDecisions[key] = safePayload;
    }
  });

  if (!workflowCode) {
    throw ApplicationFailure.create({
      message: 'workflowCode is required.',
      type: 'SkyServerWorkflowInputError',
      nonRetryable: true,
    });
  }

  if (!workflowRunRecordId) {
    throw ApplicationFailure.create({
      message: 'workflowRunRecordId is required.',
      type: 'SkyServerWorkflowInputError',
      nonRetryable: true,
    });
  }

  const definition = await definitionActivities.loadSkyserverWorkflowDefinitionActivity({ workflowCode });

  await ledgerActivities.linkSkyserverWorkflowRunToTemporalActivity({
    workflowRunRecordId,
    temporalWorkflowId,
    temporalRunId,
    summary: `Workflow ${definition.displayName} is running through Temporal-backed SkyServer executor.`,
    metadata: {
      workflowCode,
      nodeCount: definition.nodes.length,
      edgeCount: definition.edges.length,
      temporalWorkflowType: 'skyserverWorkflowExecutorWorkflow',
    },
  });

  try {
    const executionPlan = buildWorkflowExecutionPlan(definition.nodes);
    const conditionBranchRoutes = [];
    let currentNodeIndex = 0;

    while (currentNodeIndex < executionPlan.nodes.length) {
      const node = executionPlan.nodes[currentNodeIndex];
      const parameters = buildNodeParameters(node, requestInput);
      const nodeContext = {
        ...getSafeObject(input.context),
        conditionEvaluation: {
          input: requestInput,
          nodes: nodeOutputsByKey,
          previous: previousNodeOutput,
          currentNodeKey: node.nodeKey,
        },
      };
      const nodeRun = await ledgerActivities.startSkyserverWorkflowNodeRunActivity({
        workflowRunRecordId,
        node,
        attemptCount: 1,
        metadata: {
          temporalWorkflowId,
          temporalRunId,
        },
      });
      let nextNodeIndex = currentNodeIndex + 1;
      let completedNodeRun;

      if (node.nodeTypeCode === 'WAIT') {
        completedNodeRun = await executeWaitNode({
          node,
          parameters,
          nodeRun,
        });
      } else if (node.nodeTypeCode === 'HUMAN_APPROVAL') {
        completedNodeRun = await executeHumanApprovalNode({
          node,
          parameters,
          nodeRun,
          user: input.user || null,
          context: nodeContext,
          approvalDecisions,
          temporalWorkflowId,
          temporalRunId,
          workflowRunRecordId,
        });
      } else if (node.nodeTypeCode === 'WORKFLOW') {
        completedNodeRun = await executeChildWorkflowNodeWithRetries({
          definition,
          node,
          parameters,
          nodeRun,
          user: input.user || null,
          session: input.session || null,
          permissions: input.permissions || [],
          context: input.context || {},
          temporalWorkflowId,
          temporalRunId,
          workflowRunRecordId,
          taskQueue: input.taskQueue,
        });
      } else if (node.nodeTypeCode === 'TEMPORAL_WORKFLOW') {
        completedNodeRun = await executeTemporalWorkflowTemplateNodeWithRetries({
          node,
          parameters,
          nodeRun,
          permissions: input.permissions || [],
          temporalWorkflowId,
          workflowRunRecordId,
          taskQueue: input.taskQueue,
        });
      } else {
        completedNodeRun = await executeNodeWithRetries({
          node,
          parameters,
          nodeRun,
          user: input.user || null,
          session: input.session || null,
          permissions: input.permissions || [],
          context: nodeContext,
          temporalWorkflowId,
          temporalRunId,
          workflowRunRecordId,
        });
      }

      nodeRuns.push(completedNodeRun);
      nodeOutputsByKey[node.nodeKey] = completedNodeRun?.output || {};
      previousNodeOutput = completedNodeRun?.output || {};

      if (node.nodeTypeCode === 'CONDITION') {
        const branchTargetIndex = resolveConditionBranchIndex({
          output: completedNodeRun?.output || {},
          currentIndex: currentNodeIndex,
          executionPlan,
        });

        if (Number.isInteger(branchTargetIndex)) {
          conditionBranchRoutes.push({
            nodeKey: node.nodeKey,
            branchLabel: completedNodeRun.output.branchLabel || (completedNodeRun.output.passed ? 'TRUE' : 'FALSE'),
            targetNodeKey: completedNodeRun.output.branchTargetNodeKey,
          });
          nextNodeIndex = branchTargetIndex;
        } else if (completedNodeRun?.output?.passed === false) {
          const onFalse = normalizeConditionOnFalseAction(completedNodeRun.output.onFalse);

          if (onFalse === 'FAIL_WORKFLOW') {
            throw ApplicationFailure.create({
              message: completedNodeRun.output.summary || 'Workflow condition failed.',
              type: 'SkyServerWorkflowConditionFailed',
              nonRetryable: true,
              details: [{ nodeKey: node.nodeKey, output: completedNodeRun.output }],
            });
          }

          if (onFalse === 'STOP_SUCCESS') {
            conditionStop = { nodeKey: node.nodeKey, output: completedNodeRun.output };
            break;
          }
        }
      }

      if (node.nodeTypeCode === 'HUMAN_APPROVAL' && completedNodeRun?.output?.status !== 'APPROVED') {
        const action = completedNodeRun.output.action || 'FAIL_WORKFLOW';

        if (action === 'FAIL_WORKFLOW') {
          throw ApplicationFailure.create({
            message: completedNodeRun.output.summary || 'Workflow human approval gate failed.',
            type: 'SkyServerWorkflowApprovalFailed',
            nonRetryable: true,
            details: [{ nodeKey: node.nodeKey, output: completedNodeRun.output }],
          });
        }

        if (action === 'STOP_SUCCESS') {
          approvalStop = { nodeKey: node.nodeKey, output: completedNodeRun.output };
          break;
        }
      }

      currentNodeIndex = nextNodeIndex;
    }

    const durationMs = Date.now() - startedAtMs;
    const summary = conditionStop
      ? buildConditionStopSummary({
        definition,
        output: conditionStop.output,
        completedNodeCount: nodeRuns.length,
        totalNodeCount: definition.nodes.length,
      })
      : approvalStop
        ? buildHumanApprovalStopSummary({
          definition,
          output: approvalStop.output,
          completedNodeCount: nodeRuns.length,
          totalNodeCount: definition.nodes.length,
        })
        : `Workflow ${definition.displayName} completed: ${nodeRuns.length}/${definition.nodes.length} node(s) succeeded.`;
    const completedRun = await ledgerActivities.completeSkyserverWorkflowRunActivity({
      workflowRunRecordId,
      summary,
      metadata: {
        durationMs,
        completedNodeCount: nodeRuns.length,
        skippedNodeCount: Math.max(0, definition.nodes.length - nodeRuns.length),
        conditionStopNodeKey: conditionStop?.nodeKey || null,
        approvalStopNodeKey: approvalStop?.nodeKey || null,
        conditionBranchRoutes,
        temporalWorkflowId,
        temporalRunId,
      },
    });

    return {
      ok: true,
      workflowRunRecordId,
      workflowCode,
      workflowDisplayName: definition.displayName,
      temporalWorkflowId,
      temporalRunId,
      summary,
      run: completedRun,
      nodeRuns,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const normalizedError = serializeError(error);
    const summary = `Workflow ${definition.displayName} failed: ${normalizedError.message}`;

    await ledgerActivities.failSkyserverWorkflowRunActivity({
      workflowRunRecordId,
      summary,
      metadata: {
        durationMs,
        failedNodeCount: nodeRuns.filter((nodeRun) => nodeRun?.status === 'FAILED').length || 1,
        errorMessage: normalizedError.message,
        errorName: normalizedError.name,
        temporalWorkflowId,
        temporalRunId,
      },
    });

    throw ApplicationFailure.create({
      message: normalizedError.message,
      type: normalizedError.name || 'SkyServerWorkflowFailure',
      nonRetryable: true,
      details: [normalizedError],
    });
  }
}

module.exports = {
  skyserverWorkflowExecutorWorkflow,
};
