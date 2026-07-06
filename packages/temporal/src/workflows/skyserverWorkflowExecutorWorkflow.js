const { ApplicationFailure, executeChild, proxyActivities, sleep, startChild, workflowInfo } = require('@temporalio/workflow');

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
    for (const node of definition.nodes) {
      const parameters = buildNodeParameters(node, requestInput);
      const nodeRun = await ledgerActivities.startSkyserverWorkflowNodeRunActivity({
        workflowRunRecordId,
        node,
        attemptCount: 1,
        metadata: {
          temporalWorkflowId,
          temporalRunId,
        },
      });

      let completedNodeRun;

      if (node.nodeTypeCode === 'WORKFLOW') {
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
          context: input.context || {},
          temporalWorkflowId,
          temporalRunId,
          workflowRunRecordId,
        });
      }

      nodeRuns.push(completedNodeRun);
    }

    const durationMs = Date.now() - startedAtMs;
    const summary = `Workflow ${definition.displayName} completed: ${nodeRuns.length}/${definition.nodes.length} node(s) succeeded.`;
    const completedRun = await ledgerActivities.completeSkyserverWorkflowRunActivity({
      workflowRunRecordId,
      summary,
      metadata: {
        durationMs,
        completedNodeCount: nodeRuns.length,
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
