const workflowExecutorService = require('../../../../apps/api/src/services/workflowExecutorService');

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

async function loadSkyserverWorkflowDefinitionActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Loading workflow definition ${input.workflowCode}`);
  return workflowExecutorService.getWorkflowDefinition(input.workflowCode);
}

async function linkSkyserverWorkflowRunToTemporalActivity(input = {}) {
  console.log(`[Temporal:SkyWorkflow] Linked run ${input.workflowRunRecordId} to Temporal ${input.temporalWorkflowId}/${input.temporalRunId}`);
  return workflowExecutorService.linkWorkflowRunToTemporal({
    workflowRunRecordId: input.workflowRunRecordId,
    temporalWorkflowId: input.temporalWorkflowId,
    temporalRunId: input.temporalRunId,
    summary: input.summary || 'Workflow execution accepted by Temporal-backed SkyServer executor.',
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
  console.log(`[Temporal:SkyWorkflow] Completed node run ${input.nodeRunRecordId}`);
  return workflowExecutorService.completeWorkflowNodeRun({
    nodeRunRecordId: input.nodeRunRecordId,
    output: input.output || {},
    metadata: {
      temporalBacked: true,
      temporalActivity: 'completeSkyserverWorkflowNodeRunActivity',
      ...(input.metadata || {}),
    },
  });
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

module.exports = {
  completeSkyserverWorkflowNodeRunActivity,
  completeSkyserverWorkflowRunActivity,
  executeSkyserverWorkflowNodeActivity,
  failSkyserverWorkflowNodeRunActivity,
  failSkyserverWorkflowRunActivity,
  linkSkyserverWorkflowRunToTemporalActivity,
  loadSkyserverWorkflowDefinitionActivity,
  markSkyserverWorkflowNodeAttemptActivity,
  startChildSkyserverWorkflowRunActivity,
  startSkyserverWorkflowNodeRunActivity,
};
