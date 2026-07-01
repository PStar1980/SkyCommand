const { query } = require('../../../../packages/db/src/connection');
const scriptExecutionService = require('./scriptExecutionService');
const temporalService = require('./temporalService');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SUPPORTED_NODE_TYPES = new Set(['TOOL', 'TEMPORAL_WORKFLOW']);
const TERMINAL_SUCCESS_STATUS = 'COMPLETED';
const TERMINAL_FAILURE_STATUS = 'FAILED';

class WorkflowServiceError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = 'WorkflowServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function getPermissionSet(permissions = []) {
  return new Set(
    permissions
      .map((permission) => permission.permissionCode || permission.permission_code)
      .filter(Boolean),
  );
}

function assertPermission({ permissionCode, permissions, action }) {
  if (!permissionCode) {
    return;
  }

  const permissionSet = getPermissionSet(permissions);

  if (!permissionSet.has(permissionCode)) {
    throw new WorkflowServiceError('Permission denied.', 403, {
      action,
      permissionCode,
    });
  }
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function getSafeObject(value, fallback = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function truncateText(value, maxLength = 8000) {
  const text = value === undefined || value === null ? '' : String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n\n[SkyServer Workflow Executor] Output truncated at ${maxLength} characters.`;
}

function normalizeDefinitionRow(row) {
  const item = camelizeRow(row);

  return {
    workflowDefinitionId: item.workflowDefinitionId,
    workflowCode: item.workflowCode,
    displayName: item.displayName,
    description: item.description,
    status: item.status,
    visibleInAdmin: toBoolean(item.visibleInAdmin),
    enabled: toBoolean(item.enabled),
    startPermissionCode: item.startPermissionCode,
    cancelPermissionCode: item.cancelPermissionCode,
    config: item.config || {},
    versionCount: item.versionCount || 0,
    latestVersionNumber: item.latestVersionNumber,
    publishedVersionNumber: item.publishedVersionNumber,
    latestVersionId: item.latestVersionId,
    publishedVersionId: item.publishedVersionId,
    latestNodeCount: item.latestNodeCount || 0,
    latestEdgeCount: item.latestEdgeCount || 0,
    publishedNodeCount: item.publishedNodeCount || 0,
    publishedEdgeCount: item.publishedEdgeCount || 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeNodeRow(row) {
  const item = camelizeRow(row);

  return {
    workflowDefinitionId: item.workflowDefinitionId,
    workflowCode: item.workflowCode,
    workflowDisplayName: item.workflowDisplayName,
    workflowVersionId: item.workflowVersionId,
    versionNumber: item.versionNumber,
    versionStatus: item.versionStatus,
    workflowNodeId: item.workflowNodeId,
    nodeKey: item.nodeKey,
    nodeTypeCode: item.nodeTypeCode,
    nodeTypeDisplayName: item.nodeTypeDisplayName,
    nodeTypeCategory: item.nodeTypeCategory,
    targetKind: item.targetKind,
    displayName: item.displayName,
    description: item.description,
    targetCode: item.targetCode,
    targetRefId: item.targetRefId,
    targetConfig: item.targetConfig || {},
    inputParameters: item.inputParameters || {},
    retryPolicy: item.retryPolicy || {},
    timeoutMs: item.timeoutMs,
    positionX: item.positionX,
    positionY: item.positionY,
    displayOrder: item.displayOrder,
    enabled: toBoolean(item.enabled),
    config: item.config || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeRunRow(row) {
  const item = camelizeRow(row);

  return {
    workflowRunRecordId: item.workflowRunRecordId,
    workflowDefinitionId: item.workflowDefinitionId,
    workflowVersionId: item.workflowVersionId,
    workflowCode: item.workflowCode,
    workflowDisplayName: item.workflowDisplayName,
    versionNumber: item.versionNumber || item.definitionVersionNumber,
    runSource: item.runSource,
    triggerType: item.triggerType,
    status: item.status,
    temporalWorkflowId: item.temporalWorkflowId,
    temporalRunId: item.temporalRunId,
    input: item.input || {},
    requestContext: item.requestContext || {},
    summary: item.summary,
    startedByUserId: item.startedByUserId,
    startedByEmail: item.startedByEmail,
    startedByDisplayName: item.startedByDisplayName,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeNodeRunRow(row) {
  const item = camelizeRow(row);

  return {
    workflowNodeRunRecordId: item.workflowNodeRunRecordId,
    workflowRunRecordId: item.workflowRunRecordId,
    workflowNodeId: item.workflowNodeId,
    nodeKey: item.nodeKey,
    nodeTypeCode: item.nodeTypeCode,
    targetCode: item.targetCode,
    status: item.status,
    attemptCount: item.attemptCount,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    output: item.output || {},
    errorMessage: item.errorMessage,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function listWorkflowDefinitions({ visibleOnly = true, enabledOnly = true } = {}) {
  const clauses = [];

  if (visibleOnly) {
    clauses.push('visible_in_admin = TRUE');
  }

  if (enabledOnly) {
    clauses.push('enabled = TRUE');
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_definitions
      ${whereClause}
      ORDER BY display_name, workflow_code
    `,
  );

  return {
    total: result.rows.length,
    items: result.rows.map(normalizeDefinitionRow),
  };
}

async function getPublishedWorkflowDefinition(workflowCode) {
  const normalizedWorkflowCode = String(workflowCode || '').trim();

  if (!normalizedWorkflowCode) {
    throw new WorkflowServiceError('workflowCode is required.', 400);
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_definitions
      WHERE workflow_code = $1
        AND enabled = TRUE
      LIMIT 1
    `,
    [normalizedWorkflowCode],
  );

  const definition = result.rows[0] ? normalizeDefinitionRow(result.rows[0]) : null;

  if (!definition) {
    throw new WorkflowServiceError('Workflow definition was not found or is disabled.', 404, {
      workflowCode: normalizedWorkflowCode,
    });
  }

  if (!definition.publishedVersionId) {
    throw new WorkflowServiceError('Workflow definition has no published version.', 409, {
      workflowCode: normalizedWorkflowCode,
    });
  }

  return definition;
}

async function getWorkflowNodes(workflowVersionId) {
  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_nodes
      WHERE workflow_version_id = $1
        AND enabled = TRUE
      ORDER BY display_order, node_key
    `,
    [workflowVersionId],
  );

  return result.rows.map(normalizeNodeRow);
}

async function getWorkflowEdges(workflowVersionId) {
  const result = await query(
    `
      SELECT
        e.workflow_edge_id,
        e.workflow_version_id,
        e.edge_key,
        from_node.node_key AS from_node_key,
        to_node.node_key AS to_node_key,
        e.edge_type,
        e.condition_expression,
        e.display_order,
        e.config,
        e.created_at,
        e.updated_at
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes from_node
        ON from_node.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes to_node
        ON to_node.workflow_node_id = e.to_node_id
      WHERE e.workflow_version_id = $1
      ORDER BY e.display_order, e.edge_key
    `,
    [workflowVersionId],
  );

  return result.rows.map((row) => camelizeRow(row));
}

async function getWorkflowDefinition(workflowCode) {
  const definition = await getPublishedWorkflowDefinition(workflowCode);
  const [nodes, edges] = await Promise.all([
    getWorkflowNodes(definition.publishedVersionId),
    getWorkflowEdges(definition.publishedVersionId),
  ]);

  return {
    ...definition,
    nodes,
    edges,
  };
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

async function insertWorkflowRun({ definition, input, user, context }) {
  const result = await query(
    `
      INSERT INTO worker.workflow_run_records (
        workflow_definition_id,
        workflow_version_id,
        workflow_code,
        version_number,
        run_source,
        trigger_type,
        status,
        input,
        request_context,
        started_by_user_id,
        started_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING', $7::jsonb, $8::jsonb, $9, CURRENT_TIMESTAMP, $10::jsonb)
      RETURNING *
    `,
    [
      definition.workflowDefinitionId,
      definition.publishedVersionId,
      definition.workflowCode,
      definition.publishedVersionNumber,
      input.runSource || 'manual',
      input.triggerType || 'MANUAL',
      JSON.stringify(getSafeObject(input)),
      JSON.stringify({
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent || null,
      }),
      user?.userId || null,
      JSON.stringify({
        executor: 'skyserver_workflow_executor_v1',
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
      }),
    ],
  );

  return normalizeRunRow(result.rows[0]);
}

async function updateWorkflowRun({ workflowRunRecordId, status, summary, metadata = {} }) {
  const result = await query(
    `
      UPDATE worker.workflow_run_records
      SET status = $2,
          summary = $3,
          completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          metadata = metadata || $4::jsonb
      WHERE workflow_run_record_id = $1
      RETURNING *
    `,
    [workflowRunRecordId, status, summary || null, JSON.stringify(getSafeObject(metadata))],
  );

  return result.rows[0] ? normalizeRunRow(result.rows[0]) : null;
}

async function insertNodeRun({ workflowRunRecordId, node }) {
  const result = await query(
    `
      INSERT INTO worker.workflow_node_run_records (
        workflow_run_record_id,
        workflow_node_id,
        node_key,
        node_type_code,
        target_code,
        status,
        attempt_count,
        started_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, 'RUNNING', 1, CURRENT_TIMESTAMP, $6::jsonb)
      RETURNING *
    `,
    [
      workflowRunRecordId,
      node.workflowNodeId,
      node.nodeKey,
      node.nodeTypeCode,
      node.targetCode,
      JSON.stringify({
        displayName: node.displayName,
        targetKind: node.targetKind,
        displayOrder: node.displayOrder,
      }),
    ],
  );

  return normalizeNodeRunRow(result.rows[0]);
}

async function updateNodeRun({ nodeRunRecordId, status, output = {}, errorMessage = null, metadata = {} }) {
  const result = await query(
    `
      UPDATE worker.workflow_node_run_records
      SET status = $2,
          completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          output = $3::jsonb,
          error_message = $4,
          metadata = metadata || $5::jsonb
      WHERE workflow_node_run_record_id = $1
      RETURNING *
    `,
    [
      nodeRunRecordId,
      status,
      JSON.stringify(getSafeObject(output)),
      errorMessage,
      JSON.stringify(getSafeObject(metadata)),
    ],
  );

  return result.rows[0] ? normalizeNodeRunRow(result.rows[0]) : null;
}

async function runToolNode({ node, parameters, user, session, permissions, context }) {
  const result = await scriptExecutionService.runTool({
    toolCode: node.targetCode,
    parameters,
    confirmed: true,
    user,
    session,
    permissions,
    context: {
      ...context,
      workflowNodeKey: node.nodeKey,
      workflowNodeType: node.nodeTypeCode,
    },
  });

  const output = {
    kind: 'tool_execution',
    toolCode: node.targetCode,
    executionId: result.executionId,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: result.summary,
    stdoutPreview: truncateText(result.stdout),
    stderrPreview: truncateText(result.stderr),
  };

  if (result.status !== 'SUCCESS') {
    throw new WorkflowServiceError(result.summary || 'Tool node failed.', 500, output);
  }

  return output;
}

async function runTemporalWorkflowNode({ node, parameters, user, context }) {
  const workflowCode = node.targetCode || parameters.workflowCode;

  if (!workflowCode) {
    throw new WorkflowServiceError('Temporal workflow node target_code is required.', 400, {
      nodeKey: node.nodeKey,
    });
  }

  const result = await temporalService.startWorkflowFromDefinition({
    workflowCode,
    body: {
      ...parameters,
      runSource: parameters.runSource || 'skyserver_workflow_node',
    },
    actor: user,
    context,
  });

  return {
    kind: 'temporal_workflow_start',
    workflowCode,
    workflowId: result.workflow?.workflowId,
    runId: result.workflow?.runId,
    workflowType: result.workflow?.workflowType,
    taskQueue: result.workflow?.taskQueue,
    namespace: result.workflow?.namespace,
    runRecordId: result.runRecord?.runRecordId,
    status: result.workflow?.status || 'RUNNING',
    note: 'Temporal workflow was started; v1 executor does not wait for child Temporal completion.',
  };
}

async function executeNode({ node, parameters, user, session, permissions, context }) {
  if (!SUPPORTED_NODE_TYPES.has(node.nodeTypeCode)) {
    throw new WorkflowServiceError(`Unsupported workflow node type in executor v1: ${node.nodeTypeCode}`, 501, {
      nodeKey: node.nodeKey,
      nodeTypeCode: node.nodeTypeCode,
      supportedNodeTypes: [...SUPPORTED_NODE_TYPES],
    });
  }

  if (node.nodeTypeCode === 'TOOL') {
    return runToolNode({ node, parameters, user, session, permissions, context });
  }

  if (node.nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    return runTemporalWorkflowNode({ node, parameters, user, context });
  }

  throw new WorkflowServiceError(`Node type has no executor adapter: ${node.nodeTypeCode}`, 501);
}

async function executeWorkflow({ workflowCode, input = {}, user, session, permissions = [], context = {} } = {}) {
  const definition = await getWorkflowDefinition(workflowCode);

  assertPermission({
    permissionCode: definition.startPermissionCode,
    permissions,
    action: 'start_workflow',
  });

  if (definition.status !== 'ACTIVE') {
    throw new WorkflowServiceError('Workflow definition is not active.', 409, {
      workflowCode: definition.workflowCode,
      status: definition.status,
    });
  }

  if (definition.nodes.length === 0) {
    throw new WorkflowServiceError('Workflow definition has no enabled nodes.', 409, {
      workflowCode: definition.workflowCode,
    });
  }

  const run = await insertWorkflowRun({ definition, input, user, context });
  const nodeRuns = [];
  const startedAtMs = Date.now();

  try {
    for (const node of definition.nodes) {
      const nodeRun = await insertNodeRun({ workflowRunRecordId: run.workflowRunRecordId, node });
      const parameters = buildNodeParameters(node, input);

      try {
        const output = await executeNode({
          node,
          parameters,
          user,
          session,
          permissions,
          context,
        });
        const completedNodeRun = await updateNodeRun({
          nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
          status: TERMINAL_SUCCESS_STATUS,
          output,
          metadata: { parameters },
        });
        nodeRuns.push(completedNodeRun);
      } catch (nodeError) {
        const failedNodeRun = await updateNodeRun({
          nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
          status: TERMINAL_FAILURE_STATUS,
          output: getSafeObject(nodeError.details, {
            error: nodeError.message || String(nodeError),
          }),
          errorMessage: nodeError.message || String(nodeError),
          metadata: { parameters },
        });
        nodeRuns.push(failedNodeRun);
        throw nodeError;
      }
    }

    const summary = `Workflow ${definition.displayName} completed: ${nodeRuns.length}/${definition.nodes.length} node(s) succeeded.`;
    const completedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_SUCCESS_STATUS,
      summary,
      metadata: {
        durationMs: Date.now() - startedAtMs,
        completedNodeCount: nodeRuns.length,
      },
    });

    return {
      ok: true,
      run: completedRun,
      definition,
      nodeRuns,
    };
  } catch (error) {
    const summary = `Workflow ${definition.displayName} failed: ${error.message || String(error)}`;
    const failedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_FAILURE_STATUS,
      summary,
      metadata: {
        durationMs: Date.now() - startedAtMs,
        failedNodeCount: nodeRuns.filter((nodeRun) => nodeRun?.status === TERMINAL_FAILURE_STATUS).length,
        errorMessage: error.message || String(error),
      },
    });

    return {
      ok: false,
      run: failedRun,
      definition,
      nodeRuns,
      error: error.message || String(error),
      details: error.details || undefined,
    };
  }
}

async function listWorkflowRuns(filters = {}) {
  const limit = parseLimit(filters.limit);
  const clauses = [];
  const values = [];
  const status = String(filters.status || '').trim().toUpperCase();
  const workflowCode = String(filters.workflowCode || '').trim();

  if (status) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  if (workflowCode) {
    values.push(workflowCode);
    clauses.push(`workflow_code = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_run_records
      ${whereClause}
      ORDER BY COALESCE(started_at, created_at) DESC, created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );

  return {
    total: result.rows.length,
    limit,
    items: result.rows.map(normalizeRunRow),
  };
}

async function getWorkflowRun(workflowRunRecordId) {
  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_run_records
      WHERE workflow_run_record_id = $1
      LIMIT 1
    `,
    [workflowRunRecordId],
  );

  const run = result.rows[0] ? normalizeRunRow(result.rows[0]) : null;

  if (!run) {
    throw new WorkflowServiceError('Workflow run was not found.', 404, {
      workflowRunRecordId,
    });
  }

  const nodeResult = await query(
    `
      SELECT *
      FROM worker.workflow_node_run_records
      WHERE workflow_run_record_id = $1
      ORDER BY created_at, node_key
    `,
    [workflowRunRecordId],
  );

  return {
    run,
    nodeRuns: nodeResult.rows.map(normalizeNodeRunRow),
  };
}

module.exports = {
  WorkflowServiceError,
  executeWorkflow,
  getWorkflowDefinition,
  getWorkflowRun,
  listWorkflowDefinitions,
  listWorkflowRuns,
};
