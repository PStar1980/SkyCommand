const workflowExecutorService = require('../../../../apps/api/src/services/workflowExecutorService');
const temporalService = require('../../../../apps/api/src/services/temporalService');

function getSafeObject(value, fallback = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function normalizeError(error) {
  return {
    message: error?.message || String(error),
    name: error?.name || 'Error',
    statusCode: error?.statusCode || null,
    details: getSafeObject(error?.details, {}),
    stack: error?.stack || null,
  };
}


async function loadTemporalWorkflowDefinitionActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Loading Temporal workflow template ${input.workflowCode}`);
  return temporalService.getWorkflowDefinition(input.workflowCode);
}

async function loadSkyserverWorkflowDefinitionActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Loading workflow definition ${input.workflowCode}${input.workflowVersionId ? ` version ${input.workflowVersionId}` : ''}`);
  return workflowExecutorService.getWorkflowDefinitionForVersion(
    input.workflowCode,
    input.workflowVersionId || null,
  );
}

async function loadSkyserverWorkflowNodeRecoveryStateActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Loading recovery state for run ${input.workflowRunRecordId} node ${input.nodeKey}`);
  return workflowExecutorService.getWorkflowNodeRecoveryState({
    workflowRunRecordId: input.workflowRunRecordId,
    nodeKey: input.nodeKey,
  });
}

async function linkSkyserverWorkflowRunToTemporalActivity(input = {}) {
  const productIdentity = input.metadata?.productIdentity === 'SkyCommand' ? 'SkyCommand' : 'SkyServer';

  console.log(`[Temporal:SkyWorkflow] Linked run ${input.workflowRunRecordId} to Temporal ${input.temporalWorkflowId}/${input.temporalRunId}`);
  return workflowExecutorService.linkWorkflowRunToTemporal({
    workflowRunRecordId: input.workflowRunRecordId,
    temporalWorkflowId: input.temporalWorkflowId,
    temporalRunId: input.temporalRunId,
    summary:
      input.summary ||
      `Workflow execution accepted by Temporal-backed ${productIdentity} executor.`,
    metadata: {
      executor: 'skyserver_workflow_executor_temporal_v1',
      temporalBacked: true,
      linkedByActivity: true,
      linkedAt: new Date().toISOString(),
      ...(input.metadata || {}),
    },
  });
}


async function startChildSkyserverWorkflowRunActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Preparing child workflow ${input.childWorkflowCode} from node ${input.parentNodeKey}`);
  return workflowExecutorService.createChildWorkflowRun({
    parentWorkflowRunRecordId: input.parentWorkflowRunRecordId,
    parentWorkflowCode: input.parentWorkflowCode,
    parentNodeKey: input.parentNodeKey,
    childWorkflowCode: input.childWorkflowCode,
    input: input.input || {},
    user: input.user || null,
    context: input.context || {},
    permissions: input.permissions || [],
  });
}

async function startSkyserverWorkflowNodeRunActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Starting node ${input.node?.nodeKey} (${input.node?.nodeTypeCode} -> ${input.node?.targetCode})`);
  return workflowExecutorService.startWorkflowNodeRun({
    workflowRunRecordId: input.workflowRunRecordId,
    node: input.node,
    attemptCount: input.attemptCount || 1,
    metadata: {
      temporalBacked: true,
      temporalActivity: 'startSkyserverWorkflowNodeRunActivity',
      ...(input.metadata || {}),
    },
  });
}

async function markSkyserverWorkflowNodeAttemptActivity(input = {}) {
  return workflowExecutorService.markWorkflowNodeAttempt({
    nodeRunRecordId: input.nodeRunRecordId,
    attemptCount: input.attemptCount || 1,
    metadata: {
      temporalBacked: true,
      temporalActivity: 'markSkyserverWorkflowNodeAttemptActivity',
      ...(input.metadata || {}),
    },
  });
}

async function executeSkyserverWorkflowNodeActivity(input = {}) {
  try {
    console.log(`[Temporal:SkyWorkflow] Executing node ${input.node?.nodeKey} (${input.node?.nodeTypeCode} -> ${input.node?.targetCode})`);
    return await workflowExecutorService.executeWorkflowNode({
      node: input.node,
      parameters: input.parameters || {},
      user: input.user || null,
      session: input.session || null,
      permissions: input.permissions || [],
      context: {
        ...(input.context || {}),
        temporalBacked: true,
        temporalWorkflowId: input.temporalWorkflowId || null,
        temporalRunId: input.temporalRunId || null,
        workflowRunRecordId: input.workflowRunRecordId || null,
        workflowNodeRunRecordId: input.nodeRunRecordId || null,
      },
    });
  } catch (error) {
    const normalizedError = normalizeError(error);
    const activityError = new Error(normalizedError.message);

    activityError.name = normalizedError.name;
    activityError.details = normalizedError.details;
    activityError.statusCode = normalizedError.statusCode;
    throw activityError;
  }
}

async function completeSkyserverWorkflowNodeRunActivity(input = {}) {
  const completedNodeRun = await workflowExecutorService.completeWorkflowNodeRun({
    nodeRunRecordId: input.nodeRunRecordId,
    output: input.output || {},
    metadata: {
      temporalBacked: true,
      temporalActivity: 'completeSkyserverWorkflowNodeRunActivity',
      ...(input.metadata || {}),
    },
  });

  console.log(`[Temporal:SkyWorkflow] Completed node run ${input.nodeRunRecordId}`);
  return completedNodeRun;
}

async function failSkyserverWorkflowNodeRunActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Failed node run ${input.nodeRunRecordId}: ${input.errorMessage || 'Workflow node failed.'}`);
  return workflowExecutorService.failWorkflowNodeRun({
    nodeRunRecordId: input.nodeRunRecordId,
    output: input.output || {},
    errorMessage: input.errorMessage || 'Workflow node failed.',
    metadata: {
      temporalBacked: true,
      temporalActivity: 'failSkyserverWorkflowNodeRunActivity',
      ...(input.metadata || {}),
    },
  });
}

async function completeSkyserverWorkflowRunActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Completed workflow run ${input.workflowRunRecordId}`);
  return workflowExecutorService.completeWorkflowRun({
    workflowRunRecordId: input.workflowRunRecordId,
    summary: input.summary,
    metadata: {
      temporalBacked: true,
      temporalActivity: 'completeSkyserverWorkflowRunActivity',
      ...(input.metadata || {}),
    },
  });
}

async function failSkyserverWorkflowRunActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Failed workflow run ${input.workflowRunRecordId}: ${input.summary || 'Workflow failed.'}`);
  return workflowExecutorService.failWorkflowRun({
    workflowRunRecordId: input.workflowRunRecordId,
    summary: input.summary,
    metadata: {
      temporalBacked: true,
      temporalActivity: 'failSkyserverWorkflowRunActivity',
      ...(input.metadata || {}),
    },
  });
}


async function createSkyserverWorkflowApprovalRequestActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Creating approval request for node ${input.node?.nodeKey}`);
  return workflowExecutorService.createWorkflowApprovalRequest({
    workflowRunRecordId: input.workflowRunRecordId,
    workflowNodeRunRecordId: input.workflowNodeRunRecordId || input.nodeRunRecordId,
    node: input.node || {},
    parameters: input.parameters || {},
    user: input.user || null,
    context: input.context || {},
    temporalWorkflowId: input.temporalWorkflowId || null,
    temporalRunId: input.temporalRunId || null,
  });
}

async function resolveSkyserverWorkflowApprovalRequestActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Resolving approval request ${input.approvalRequestId}: ${input.decision}`);
  return workflowExecutorService.resolveWorkflowApprovalRequest({
    approvalRequestId: input.approvalRequestId,
    decision: input.decision,
    decisionNote: input.decisionNote || null,
    user: input.user || null,
    metadata: {
      temporalBacked: true,
      temporalActivity: 'resolveSkyserverWorkflowApprovalRequestActivity',
      ...(input.metadata || {}),
    },
  });
}

module.exports = {
  // Stable activity names retained because they are persisted in Temporal histories.
  completeSkyserverWorkflowNodeRunActivity,
  completeSkyserverWorkflowRunActivity,
  createSkyserverWorkflowApprovalRequestActivity,
  executeSkyserverWorkflowNodeActivity,
  failSkyserverWorkflowNodeRunActivity,
  failSkyserverWorkflowRunActivity,
  resolveSkyserverWorkflowApprovalRequestActivity,
  linkSkyserverWorkflowRunToTemporalActivity,
  loadSkyserverWorkflowDefinitionActivity,
  loadSkyserverWorkflowNodeRecoveryStateActivity,
  loadTemporalWorkflowDefinitionActivity,
  markSkyserverWorkflowNodeAttemptActivity,
  startChildSkyserverWorkflowRunActivity,
  startSkyserverWorkflowNodeRunActivity,
  // Canonical source-level aliases are available without changing persisted activity types.
  completeSkyCommandWorkflowNodeRunActivity: completeSkyserverWorkflowNodeRunActivity,
  completeSkyCommandWorkflowRunActivity: completeSkyserverWorkflowRunActivity,
  createSkyCommandWorkflowApprovalRequestActivity: createSkyserverWorkflowApprovalRequestActivity,
  executeSkyCommandWorkflowNodeActivity: executeSkyserverWorkflowNodeActivity,
  failSkyCommandWorkflowNodeRunActivity: failSkyserverWorkflowNodeRunActivity,
  failSkyCommandWorkflowRunActivity: failSkyserverWorkflowRunActivity,
  resolveSkyCommandWorkflowApprovalRequestActivity: resolveSkyserverWorkflowApprovalRequestActivity,
  linkSkyCommandWorkflowRunToTemporalActivity: linkSkyserverWorkflowRunToTemporalActivity,
  loadSkyCommandWorkflowDefinitionActivity: loadSkyserverWorkflowDefinitionActivity,
  loadSkyCommandWorkflowNodeRecoveryStateActivity: loadSkyserverWorkflowNodeRecoveryStateActivity,
  markSkyCommandWorkflowNodeAttemptActivity: markSkyserverWorkflowNodeAttemptActivity,
  startChildSkyCommandWorkflowRunActivity: startChildSkyserverWorkflowRunActivity,
  startSkyCommandWorkflowNodeRunActivity: startSkyserverWorkflowNodeRunActivity,
};
