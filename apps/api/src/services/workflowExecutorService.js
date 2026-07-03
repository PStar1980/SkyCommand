const { pool, query } = require('../../../../packages/db/src/connection');
const scriptExecutionService = require('./scriptExecutionService');
const temporalService = require('./temporalService');
const toolManifestService = require('./toolManifestService');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SUPPORTED_NODE_TYPES = new Set(['TOOL', 'TEMPORAL_WORKFLOW']);
const TERMINAL_SUCCESS_STATUS = 'COMPLETED';
const TERMINAL_FAILURE_STATUS = 'FAILED';
const DEFAULT_START_PERMISSION = 'WORKFLOW_START';
const DEFAULT_CANCEL_PERMISSION = 'WORKFLOW_CANCEL';

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

function getSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeWorkflowCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeNodeKey(value, fallback = 'node') {
  const normalized = normalizeWorkflowCode(value).replace(/-/g, '_');

  return normalized || fallback;
}

function assertJsonObject(value, fieldName) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new WorkflowServiceError(`${fieldName} must be a JSON object.`, 400, {
      fieldName,
    });
  }

  return value;
}

function buildDefinitionSnapshot({ definition, nodes = [], edges = [], status = 'DRAFT' }) {
  return {
    workflowCode: definition.workflowCode,
    displayName: definition.displayName,
    description: definition.description || null,
    status,
    graphVersion: '1.0',
    nodes: nodes.map((node) => ({
      nodeKey: node.nodeKey,
      nodeTypeCode: node.nodeTypeCode,
      displayName: node.displayName,
      targetCode: node.targetCode || null,
      displayOrder: node.displayOrder,
    })),
    edges,
  };
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

async function listWorkflowDefinitions({ visibleOnly = true, enabledOnly = true, publishedOnly = true, activeOnly = true } = {}) {
  const clauses = [];

  if (visibleOnly) {
    clauses.push('visible_in_admin = TRUE');
  }

  if (enabledOnly) {
    clauses.push('enabled = TRUE');
  }

  if (publishedOnly) {
    clauses.push('published_version_number IS NOT NULL');
  }

  if (activeOnly) {
    clauses.push("status = 'ACTIVE'");
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
        AND status = 'ACTIVE'
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

async function insertWorkflowRun({
  definition,
  input,
  user,
  context,
  status = 'RUNNING',
  metadata = {},
} = {}) {
  const safeInput = getSafeObject(input);
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, CURRENT_TIMESTAMP, $11::jsonb)
      RETURNING *
    `,
    [
      definition.workflowDefinitionId,
      definition.publishedVersionId,
      definition.workflowCode,
      definition.publishedVersionNumber,
      safeInput.runSource || 'manual',
      safeInput.triggerType || 'MANUAL',
      status,
      JSON.stringify(safeInput),
      JSON.stringify({
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent || null,
      }),
      user?.userId || null,
      JSON.stringify({
        executor: 'skyserver_workflow_executor_v1',
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
        ...getSafeObject(metadata),
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

async function linkWorkflowRunToTemporal({
  workflowRunRecordId,
  temporalWorkflowId,
  temporalRunId,
  summary = null,
  metadata = {},
} = {}) {
  const result = await query(
    `
      UPDATE worker.workflow_run_records
      SET temporal_workflow_id = COALESCE($2, temporal_workflow_id),
          temporal_run_id = COALESCE($3, temporal_run_id),
          status = 'RUNNING',
          summary = COALESCE($4, summary),
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          metadata = metadata || $5::jsonb
      WHERE workflow_run_record_id = $1
      RETURNING *
    `,
    [
      workflowRunRecordId,
      temporalWorkflowId || null,
      temporalRunId || null,
      summary || null,
      JSON.stringify(getSafeObject(metadata)),
    ],
  );

  return result.rows[0] ? normalizeRunRow(result.rows[0]) : null;
}

async function insertNodeRun({ workflowRunRecordId, node, attemptCount = 1, metadata = {} }) {
  const existing = await query(
    `
      SELECT *
      FROM worker.workflow_node_run_records
      WHERE workflow_run_record_id = $1
        AND node_key = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [workflowRunRecordId, node.nodeKey],
  );

  if (existing.rows[0]) {
    return normalizeNodeRunRow(existing.rows[0]);
  }

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
      VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, CURRENT_TIMESTAMP, $7::jsonb)
      RETURNING *
    `,
    [
      workflowRunRecordId,
      node.workflowNodeId,
      node.nodeKey,
      node.nodeTypeCode,
      node.targetCode,
      attemptCount,
      JSON.stringify({
        displayName: node.displayName,
        targetKind: node.targetKind,
        displayOrder: node.displayOrder,
        ...getSafeObject(metadata),
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


async function startWorkflowNodeRun({ workflowRunRecordId, node, attemptCount = 1, metadata = {} }) {
  return insertNodeRun({ workflowRunRecordId, node, attemptCount, metadata });
}

async function markWorkflowNodeAttempt({ nodeRunRecordId, attemptCount = 1, metadata = {} }) {
  const result = await query(
    `
      UPDATE worker.workflow_node_run_records
      SET status = 'RUNNING',
          attempt_count = GREATEST(attempt_count, $2),
          metadata = metadata || $3::jsonb
      WHERE workflow_node_run_record_id = $1
      RETURNING *
    `,
    [nodeRunRecordId, attemptCount, JSON.stringify(getSafeObject(metadata))],
  );

  return result.rows[0] ? normalizeNodeRunRow(result.rows[0]) : null;
}

async function completeWorkflowNodeRun({ nodeRunRecordId, output = {}, metadata = {} }) {
  return updateNodeRun({
    nodeRunRecordId,
    status: TERMINAL_SUCCESS_STATUS,
    output,
    metadata,
  });
}

async function failWorkflowNodeRun({ nodeRunRecordId, output = {}, errorMessage = null, metadata = {} }) {
  return updateNodeRun({
    nodeRunRecordId,
    status: TERMINAL_FAILURE_STATUS,
    output,
    errorMessage,
    metadata,
  });
}

async function completeWorkflowRun({ workflowRunRecordId, summary, metadata = {} }) {
  return updateWorkflowRun({
    workflowRunRecordId,
    status: TERMINAL_SUCCESS_STATUS,
    summary,
    metadata,
  });
}

async function failWorkflowRun({ workflowRunRecordId, summary, metadata = {} }) {
  return updateWorkflowRun({
    workflowRunRecordId,
    status: TERMINAL_FAILURE_STATUS,
    summary,
    metadata,
  });
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

async function listBuilderCatalog({ permissions = [] } = {}) {
  const [nodeTypeResult, toolManifest] = await Promise.all([
    query(
      `
        SELECT
          node_type_code,
          display_name,
          description,
          category,
          target_kind,
          icon,
          requires_target,
          enabled,
          config
        FROM worker.workflow_node_types
        WHERE enabled = TRUE
        ORDER BY category, display_name
      `,
    ),
    toolManifestService.listToolsForUser({ permissions }),
  ]);

  const nodeTypes = nodeTypeResult.rows.map((row) => {
    const item = camelizeRow(row);
    const config = item.config || {};

    return {
      nodeTypeCode: item.nodeTypeCode,
      displayName: item.displayName,
      description: item.description,
      category: item.category,
      targetKind: item.targetKind,
      icon: item.icon,
      requiresTarget: toBoolean(item.requiresTarget),
      enabled: toBoolean(item.enabled),
      initiallySupported: toBoolean(config.initiallySupported),
      config,
    };
  });

  const toolTargets = [];

  for (const category of toolManifest.categories || []) {
    for (const tool of category.tools || []) {
      toolTargets.push({
        nodeTypeCode: 'TOOL',
        targetKind: 'core.tools',
        targetCode: tool.toolCode,
        targetRefId: tool.toolId,
        displayName: tool.label || tool.name || tool.toolCode,
        description: tool.description,
        categoryCode: category.categoryCode,
        categoryLabel: category.label,
        permissionCode: tool.permissionCode,
        riskCode: tool.riskCode,
        requiresConfirmation: tool.requiresConfirmation,
        parameters: tool.parameters || [],
      });
    }
  }

  return {
    nodeTypes,
    supportedNodeTypes: nodeTypes.filter((nodeType) => nodeType.initiallySupported),
    toolTargets,
  };
}

function normalizeCreateNodeInput(node, index, seenKeys) {
  const nodeTypeCode = String(node.nodeTypeCode || 'TOOL').trim().toUpperCase();

  if (nodeTypeCode !== 'TOOL') {
    throw new WorkflowServiceError('Workflow Builder v1 only supports TOOL nodes.', 400, {
      nodeTypeCode,
      supportedNodeTypes: ['TOOL'],
    });
  }

  const targetCode = String(node.targetCode || node.toolCode || '').trim();

  if (!targetCode) {
    throw new WorkflowServiceError('Each TOOL node requires targetCode.', 400, {
      index,
    });
  }

  const nodeKeyBase = normalizeNodeKey(node.nodeKey || node.displayName || targetCode, `node_${index + 1}`);
  let nodeKey = nodeKeyBase;
  let suffix = 2;

  while (seenKeys.has(nodeKey)) {
    nodeKey = `${nodeKeyBase}_${suffix}`;
    suffix += 1;
  }

  seenKeys.add(nodeKey);

  return {
    nodeKey,
    nodeTypeCode,
    displayName: String(node.displayName || node.label || targetCode).trim(),
    description: String(node.description || '').trim() || null,
    targetCode,
    inputParameters: getSafeObject(node.inputParameters),
    retryPolicy: getSafeObject(node.retryPolicy),
    timeoutMs: node.timeoutMs ? Number.parseInt(node.timeoutMs, 10) : null,
    positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 80 + index * 280,
    positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 120,
    displayOrder: Number.isFinite(Number(node.displayOrder)) ? Number(node.displayOrder) : (index + 1) * 10,
    enabled: node.enabled !== false,
    config: getSafeObject(node.config, { builderCard: 'tool' }),
  };
}

async function createWorkflowDefinition({ payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'create_workflow',
  });

  const workflowCode = normalizeWorkflowCode(payload.workflowCode || payload.displayName);
  const displayName = String(payload.displayName || '').trim();
  const description = String(payload.description || '').trim() || null;
  const publish = payload.publish !== false;
  const visibleInAdmin = payload.visibleInAdmin !== false;
  const enabled = payload.enabled !== false;
  const nodesInput = getSafeArray(payload.nodes);

  if (!workflowCode) {
    throw new WorkflowServiceError('workflowCode or displayName is required.', 400);
  }

  if (!displayName) {
    throw new WorkflowServiceError('displayName is required.', 400);
  }

  if (nodesInput.length === 0) {
    throw new WorkflowServiceError('At least one TOOL node is required.', 400);
  }

  const seenKeys = new Set();
  const nodes = nodesInput.map((node, index) => normalizeCreateNodeInput(node, index, seenKeys));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `
        SELECT workflow_definition_id
        FROM worker.workflow_definitions
        WHERE workflow_code = $1
        LIMIT 1
      `,
      [workflowCode],
    );

    if (existing.rows[0]) {
      throw new WorkflowServiceError('Workflow code already exists.', 409, {
        workflowCode,
      });
    }

    const toolResult = await client.query(
      `
        SELECT tool_id, tool_code, label, description
        FROM core.tools
        WHERE tool_code = ANY($1::text[])
          AND enabled = TRUE
      `,
      [[...new Set(nodes.map((node) => node.targetCode))]],
    );
    const toolsByCode = new Map(toolResult.rows.map((row) => [row.tool_code, row]));
    const missingTools = nodes
      .map((node) => node.targetCode)
      .filter((targetCode) => !toolsByCode.has(targetCode));

    if (missingTools.length > 0) {
      throw new WorkflowServiceError('One or more tool targets were not found or are disabled.', 400, {
        missingTools,
      });
    }

    const definitionResult = await client.query(
      `
        INSERT INTO worker.workflow_definitions (
          workflow_code,
          display_name,
          description,
          status,
          visible_in_admin,
          enabled,
          start_permission_code,
          cancel_permission_code,
          config,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)
        RETURNING *
      `,
      [
        workflowCode,
        displayName,
        description,
        publish ? 'ACTIVE' : 'INACTIVE',
        visibleInAdmin,
        enabled,
        DEFAULT_START_PERMISSION,
        DEFAULT_CANCEL_PERMISSION,
        JSON.stringify({
          createdBy: 'workflow_builder_v1',
          builderVersion: '10.17',
          supportedNodeTypes: ['TOOL'],
        }),
        user?.userId || null,
      ],
    );
    const definition = normalizeDefinitionRow(definitionResult.rows[0]);

    const versionResult = await client.query(
      `
        INSERT INTO worker.workflow_versions (
          workflow_definition_id,
          version_number,
          version_label,
          status,
          graph_version,
          definition_snapshot,
          created_by_user_id,
          published_by_user_id,
          published_at
        )
        VALUES ($1, 1, $2, $3, '1.0', '{}'::jsonb, $4, $5, CASE WHEN $3 = 'PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END)
        RETURNING *
      `,
      [
        definition.workflowDefinitionId,
        publish ? 'Builder v1 published version' : 'Builder v1 draft version',
        publish ? 'PUBLISHED' : 'DRAFT',
        user?.userId || null,
        publish ? user?.userId || null : null,
      ],
    );
    const workflowVersionId = versionResult.rows[0].workflow_version_id;
    const insertedNodes = [];

    for (const node of nodes) {
      const tool = toolsByCode.get(node.targetCode);
      const nodeResult = await client.query(
        `
          INSERT INTO worker.workflow_nodes (
            workflow_version_id,
            node_key,
            node_type_code,
            display_name,
            description,
            target_code,
            target_ref_id,
            input_parameters,
            retry_policy,
            timeout_ms,
            position_x,
            position_y,
            display_order,
            enabled,
            config
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb)
          RETURNING *
        `,
        [
          workflowVersionId,
          node.nodeKey,
          node.nodeTypeCode,
          node.displayName,
          node.description,
          node.targetCode,
          tool.tool_id,
          JSON.stringify(assertJsonObject(node.inputParameters, `nodes[${insertedNodes.length}].inputParameters`)),
          JSON.stringify(getSafeObject(node.retryPolicy)),
          node.timeoutMs,
          node.positionX,
          node.positionY,
          node.displayOrder,
          node.enabled,
          JSON.stringify(getSafeObject(node.config)),
        ],
      );

      insertedNodes.push(normalizeNodeRow({
        ...nodeResult.rows[0],
        workflow_definition_id: definition.workflowDefinitionId,
        workflow_code: definition.workflowCode,
        workflow_display_name: definition.displayName,
        version_number: 1,
        version_status: publish ? 'PUBLISHED' : 'DRAFT',
        node_type_display_name: 'Run Tool',
        node_type_category: 'ACTION',
        target_kind: 'core.tools',
      }));
    }

    const edges = [];

    for (let index = 0; index < insertedNodes.length - 1; index += 1) {
      const fromNode = insertedNodes[index];
      const toNode = insertedNodes[index + 1];
      const edgeResult = await client.query(
        `
          INSERT INTO worker.workflow_edges (
            workflow_version_id,
            edge_key,
            from_node_id,
            to_node_id,
            edge_type,
            display_order,
            config
          )
          VALUES ($1, $2, $3, $4, 'SEQUENTIAL', $5, $6::jsonb)
          RETURNING *
        `,
        [
          workflowVersionId,
          `${fromNode.nodeKey}_to_${toNode.nodeKey}`,
          fromNode.workflowNodeId,
          toNode.workflowNodeId,
          (index + 1) * 10,
          JSON.stringify({ label: 'then', createdBy: 'workflow_builder_v1' }),
        ],
      );
      edges.push(camelizeRow(edgeResult.rows[0]));
    }

    await client.query(
      `
        UPDATE worker.workflow_versions
        SET definition_snapshot = $2::jsonb
        WHERE workflow_version_id = $1
      `,
      [
        workflowVersionId,
        JSON.stringify(buildDefinitionSnapshot({
          definition,
          nodes: insertedNodes,
          edges,
          status: publish ? 'PUBLISHED' : 'DRAFT',
        })),
      ],
    );

    await client.query('COMMIT');

    return getWorkflowDefinition(workflowCode).catch(() => ({
      ...definition,
      publishedVersionId: publish ? workflowVersionId : null,
      latestVersionId: workflowVersionId,
      nodes: insertedNodes,
      edges,
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


async function getWorkflowDefinitionByCode(workflowCode) {
  const normalizedWorkflowCode = String(workflowCode || '').trim();

  if (!normalizedWorkflowCode) {
    throw new WorkflowServiceError('workflowCode is required.', 400);
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_definitions
      WHERE workflow_code = $1
      LIMIT 1
    `,
    [normalizedWorkflowCode],
  );

  const definition = result.rows[0] ? normalizeDefinitionRow(result.rows[0]) : null;

  if (!definition) {
    throw new WorkflowServiceError('Workflow definition was not found.', 404, {
      workflowCode: normalizedWorkflowCode,
    });
  }

  return definition;
}

async function listWorkflowVersions(workflowDefinitionId) {
  const result = await query(
    `
      SELECT
        v.workflow_version_id,
        v.workflow_definition_id,
        v.version_number,
        v.version_label,
        v.status,
        v.graph_version,
        v.definition_snapshot,
        v.created_by_user_id,
        creator.email AS created_by_email,
        creator.display_name AS created_by_display_name,
        v.published_by_user_id,
        publisher.email AS published_by_email,
        publisher.display_name AS published_by_display_name,
        v.published_at,
        v.created_at,
        v.updated_at,
        COUNT(DISTINCT n.workflow_node_id)::INTEGER AS node_count,
        COUNT(DISTINCT e.workflow_edge_id)::INTEGER AS edge_count
      FROM worker.workflow_versions v
      LEFT JOIN worker.workflow_nodes n
        ON n.workflow_version_id = v.workflow_version_id
      LEFT JOIN worker.workflow_edges e
        ON e.workflow_version_id = v.workflow_version_id
      LEFT JOIN auth.users creator
        ON creator.user_id = v.created_by_user_id
      LEFT JOIN auth.users publisher
        ON publisher.user_id = v.published_by_user_id
      WHERE v.workflow_definition_id = $1
      GROUP BY
        v.workflow_version_id,
        creator.email,
        creator.display_name,
        publisher.email,
        publisher.display_name
      ORDER BY v.version_number DESC
    `,
    [workflowDefinitionId],
  );

  return result.rows.map((row) => {
    const item = camelizeRow(row);

    return {
      workflowVersionId: item.workflowVersionId,
      workflowDefinitionId: item.workflowDefinitionId,
      versionNumber: item.versionNumber,
      versionLabel: item.versionLabel,
      status: item.status,
      graphVersion: item.graphVersion,
      definitionSnapshot: item.definitionSnapshot || {},
      createdByUserId: item.createdByUserId,
      createdByEmail: item.createdByEmail,
      createdByDisplayName: item.createdByDisplayName,
      publishedByUserId: item.publishedByUserId,
      publishedByEmail: item.publishedByEmail,
      publishedByDisplayName: item.publishedByDisplayName,
      publishedAt: item.publishedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      nodeCount: item.nodeCount || 0,
      edgeCount: item.edgeCount || 0,
    };
  });
}

async function getWorkflowVersionGraph(workflowVersionId) {
  if (!workflowVersionId) {
    return null;
  }

  const [nodes, edges] = await Promise.all([
    getWorkflowNodes(workflowVersionId),
    getWorkflowEdges(workflowVersionId),
  ]);

  return {
    workflowVersionId,
    nodes,
    edges,
  };
}

async function getWorkflowDefinitionForManage(workflowCode) {
  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const [versions, latestGraph, publishedGraph] = await Promise.all([
    listWorkflowVersions(definition.workflowDefinitionId),
    getWorkflowVersionGraph(definition.latestVersionId),
    getWorkflowVersionGraph(definition.publishedVersionId),
  ]);

  return {
    ...definition,
    versions,
    latestGraph,
    publishedGraph,
    nodes: publishedGraph?.nodes || latestGraph?.nodes || [],
    edges: publishedGraph?.edges || latestGraph?.edges || [],
  };
}

function normalizeWorkflowStatus(value, fallback = 'ACTIVE') {
  const status = String(value || fallback).trim().toUpperCase();
  const allowed = new Set(['ACTIVE', 'INACTIVE']);

  if (!allowed.has(status)) {
    throw new WorkflowServiceError('Invalid workflow status.', 400, {
      status,
      allowed: [...allowed],
    });
  }

  return status;
}

async function updateWorkflowDefinition({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'update_workflow',
  });

  const existing = await getWorkflowDefinitionByCode(workflowCode);
  const displayName = Object.prototype.hasOwnProperty.call(payload, 'displayName')
    ? String(payload.displayName || '').trim()
    : existing.displayName;

  if (!displayName) {
    throw new WorkflowServiceError('displayName is required.', 400);
  }

  const nextStatus = Object.prototype.hasOwnProperty.call(payload, 'status')
    ? normalizeWorkflowStatus(payload.status, existing.status)
    : existing.status;
  const nextEnabled = nextStatus === 'ACTIVE';
  const nextVisible = true;

  await query(
    `
      UPDATE worker.workflow_definitions
      SET display_name = $2,
          description = $3,
          status = $4,
          enabled = $5,
          visible_in_admin = $6,
          updated_by_user_id = $7,
          config = config || $8::jsonb
      WHERE workflow_code = $1
    `,
    [
      existing.workflowCode,
      displayName,
      Object.prototype.hasOwnProperty.call(payload, 'description')
        ? String(payload.description || '').trim() || null
        : existing.description,
      nextStatus,
      nextEnabled,
      nextVisible,
      user?.userId || null,
      JSON.stringify({ updatedBy: 'workflow_manager_v1' }),
    ],
  );

  return getWorkflowDefinitionForManage(existing.workflowCode);
}

async function archiveWorkflowDefinition({ workflowCode, user, permissions = [] } = {}) {
  return updateWorkflowDefinition({
    workflowCode,
    payload: {
      status: 'INACTIVE',
      enabled: false,
      visibleInAdmin: true,
    },
    user,
    permissions,
  });
}

async function deleteWorkflowDefinition({ workflowCode, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'delete_workflow',
  });

  const existing = await getWorkflowDefinitionByCode(workflowCode);

  const activeRuns = await query(
    `
      SELECT COUNT(*)::INTEGER AS active_count
      FROM worker.workflow_run_records
      WHERE workflow_definition_id = $1
        AND status IN ('QUEUED', 'RUNNING')
    `,
    [existing.workflowDefinitionId],
  );

  if (Number(activeRuns.rows[0]?.active_count || 0) > 0) {
    throw new WorkflowServiceError('Workflow cannot be deleted while it has queued or running executions.', 409, {
      workflowCode: existing.workflowCode,
      activeRuns: Number(activeRuns.rows[0]?.active_count || 0),
    });
  }

  await query(
    `
      DELETE FROM worker.workflow_definitions
      WHERE workflow_definition_id = $1
    `,
    [existing.workflowDefinitionId],
  );

  return {
    workflowCode: existing.workflowCode,
    displayName: existing.displayName,
    deleted: true,
  };
}

function versionNodesToCreateInput(nodes = []) {
  return nodes.map((node) => ({
    nodeKey: node.nodeKey,
    nodeTypeCode: node.nodeTypeCode,
    displayName: node.displayName,
    description: node.description || '',
    targetCode: node.targetCode,
    inputParameters: getSafeObject(node.inputParameters),
    retryPolicy: getSafeObject(node.retryPolicy),
    timeoutMs: node.timeoutMs,
    positionX: node.positionX,
    positionY: node.positionY,
    displayOrder: node.displayOrder,
    enabled: node.enabled !== false,
    config: getSafeObject(node.config, { builderCard: 'tool' }),
  }));
}

async function validateToolTargets(client, nodes) {
  const targetCodes = [...new Set(nodes.map((node) => node.targetCode))];
  const toolResult = await client.query(
    `
      SELECT tool_id, tool_code, label, description
      FROM core.tools
      WHERE tool_code = ANY($1::text[])
        AND enabled = TRUE
    `,
    [targetCodes],
  );
  const toolsByCode = new Map(toolResult.rows.map((row) => [row.tool_code, row]));
  const missingTools = targetCodes.filter((targetCode) => !toolsByCode.has(targetCode));

  if (missingTools.length > 0) {
    throw new WorkflowServiceError('One or more tool targets were not found or are disabled.', 400, {
      missingTools,
    });
  }

  return toolsByCode;
}

async function insertWorkflowVersionGraph({
  client,
  definition,
  versionNumber,
  versionLabel,
  status,
  nodes,
  user,
  existingWorkflowVersionId = null,
} = {}) {
  const publish = status === 'PUBLISHED';
  const toolsByCode = await validateToolTargets(client, nodes);
  let workflowVersionId = existingWorkflowVersionId;

  if (!workflowVersionId) {
    const versionResult = await client.query(
      `
        INSERT INTO worker.workflow_versions (
        workflow_definition_id,
        version_number,
        version_label,
        status,
        graph_version,
        definition_snapshot,
        created_by_user_id,
        published_by_user_id,
        published_at
      )
      VALUES ($1, $2, $3, $4, '1.0', '{}'::jsonb, $5, $6, CASE WHEN $4 = 'PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END)
      RETURNING *
      `,
      [
        definition.workflowDefinitionId,
        versionNumber,
        versionLabel || `Workflow version ${versionNumber}`,
        status,
        user?.userId || null,
        publish ? user?.userId || null : null,
      ],
    );
    workflowVersionId = versionResult.rows[0].workflow_version_id;
  }

  const insertedNodes = [];

  for (const node of nodes) {
    const tool = toolsByCode.get(node.targetCode);
    const nodeResult = await client.query(
      `
        INSERT INTO worker.workflow_nodes (
          workflow_version_id,
          node_key,
          node_type_code,
          display_name,
          description,
          target_code,
          target_ref_id,
          input_parameters,
          retry_policy,
          timeout_ms,
          position_x,
          position_y,
          display_order,
          enabled,
          config
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb)
        RETURNING *
      `,
      [
        workflowVersionId,
        node.nodeKey,
        node.nodeTypeCode,
        node.displayName,
        node.description,
        node.targetCode,
        tool.tool_id,
        JSON.stringify(assertJsonObject(node.inputParameters, `${node.nodeKey}.inputParameters`)),
        JSON.stringify(getSafeObject(node.retryPolicy)),
        node.timeoutMs,
        node.positionX,
        node.positionY,
        node.displayOrder,
        node.enabled,
        JSON.stringify(getSafeObject(node.config)),
      ],
    );

    insertedNodes.push(normalizeNodeRow({
      ...nodeResult.rows[0],
      workflow_definition_id: definition.workflowDefinitionId,
      workflow_code: definition.workflowCode,
      workflow_display_name: definition.displayName,
      version_number: versionNumber,
      version_status: status,
      node_type_display_name: 'Run Tool',
      node_type_category: 'ACTION',
      target_kind: 'core.tools',
    }));
  }

  const edges = [];

  for (let index = 0; index < insertedNodes.length - 1; index += 1) {
    const fromNode = insertedNodes[index];
    const toNode = insertedNodes[index + 1];
    const edgeResult = await client.query(
      `
        INSERT INTO worker.workflow_edges (
          workflow_version_id,
          edge_key,
          from_node_id,
          to_node_id,
          edge_type,
          display_order,
          config
        )
        VALUES ($1, $2, $3, $4, 'SEQUENTIAL', $5, $6::jsonb)
        RETURNING *
      `,
      [
        workflowVersionId,
        `${fromNode.nodeKey}_to_${toNode.nodeKey}`,
        fromNode.workflowNodeId,
        toNode.workflowNodeId,
        (index + 1) * 10,
        JSON.stringify({ label: 'then', createdBy: 'workflow_manager_v1' }),
      ],
    );
    edges.push(camelizeRow(edgeResult.rows[0]));
  }

  await client.query(
    `
      UPDATE worker.workflow_versions
      SET definition_snapshot = $2::jsonb
      WHERE workflow_version_id = $1
    `,
    [
      workflowVersionId,
      JSON.stringify(buildDefinitionSnapshot({
        definition,
        nodes: insertedNodes,
        edges,
        status,
      })),
    ],
  );

  return {
    workflowVersionId,
    nodes: insertedNodes,
    edges,
  };
}


async function replaceWorkflowGraph({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'save_workflow_graph',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const rawNodes = getSafeArray(payload.nodes);

  if (rawNodes.length === 0) {
    throw new WorkflowServiceError('At least one TOOL node is required for a workflow graph.', 400);
  }

  const seenKeys = new Set();
  const normalizedNodes = rawNodes.map((node, index) => normalizeCreateNodeInput(node, index, seenKeys));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const versionResult = await client.query(
      `
        SELECT workflow_version_id, version_number
        FROM worker.workflow_versions
        WHERE workflow_definition_id = $1
        ORDER BY version_number DESC
        LIMIT 1
      `,
      [definition.workflowDefinitionId],
    );

    let workflowVersionId = versionResult.rows[0]?.workflow_version_id || null;
    let versionNumber = Number(versionResult.rows[0]?.version_number || 1);

    if (!workflowVersionId) {
      const createdVersion = await client.query(
        `
          INSERT INTO worker.workflow_versions (
            workflow_definition_id,
            version_number,
            version_label,
            status,
            graph_version,
            definition_snapshot,
            created_by_user_id,
            published_by_user_id,
            published_at
          )
          VALUES ($1, 1, 'Current workflow', 'PUBLISHED', '1.0', '{}'::jsonb, $2, $2, CURRENT_TIMESTAMP)
          RETURNING workflow_version_id, version_number
        `,
        [definition.workflowDefinitionId, user?.userId || null],
      );
      workflowVersionId = createdVersion.rows[0].workflow_version_id;
      versionNumber = Number(createdVersion.rows[0].version_number || 1);
    } else {
      await client.query(
        `
          UPDATE worker.workflow_versions
          SET status = CASE WHEN workflow_version_id = $2 THEN 'PUBLISHED' ELSE 'RETIRED' END,
              version_label = CASE WHEN workflow_version_id = $2 THEN 'Current workflow' ELSE version_label END,
              published_by_user_id = CASE WHEN workflow_version_id = $2 THEN $3 ELSE published_by_user_id END,
              published_at = CASE WHEN workflow_version_id = $2 THEN CURRENT_TIMESTAMP ELSE published_at END
          WHERE workflow_definition_id = $1
        `,
        [definition.workflowDefinitionId, workflowVersionId, user?.userId || null],
      );

      await client.query('DELETE FROM worker.workflow_edges WHERE workflow_version_id = $1', [workflowVersionId]);
      await client.query('DELETE FROM worker.workflow_nodes WHERE workflow_version_id = $1', [workflowVersionId]);
    }

    const graph = await insertWorkflowVersionGraph({
      client,
      definition,
      versionNumber,
      versionLabel: 'Current workflow',
      status: 'PUBLISHED',
      nodes: normalizedNodes,
      user,
      existingWorkflowVersionId: workflowVersionId,
    });

    await client.query(
      `
        UPDATE worker.workflow_definitions
        SET status = CASE WHEN status = 'INACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END,
            enabled = CASE WHEN status = 'INACTIVE' THEN FALSE ELSE TRUE END,
            visible_in_admin = TRUE,
            updated_by_user_id = $2,
            config = config || $3::jsonb
        WHERE workflow_definition_id = $1
      `,
      [
        definition.workflowDefinitionId,
        user?.userId || null,
        JSON.stringify({ graphSavedBy: 'workflow_manager_ui_v2', singleVersionUi: true }),
      ],
    );

    await client.query('COMMIT');
    return getWorkflowDefinitionForManage(definition.workflowCode);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createWorkflowVersion({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'create_workflow_version',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const sourceVersionId = payload.sourceWorkflowVersionId || definition.latestVersionId || definition.publishedVersionId;
  const sourceGraph = sourceVersionId ? await getWorkflowVersionGraph(sourceVersionId) : null;
  const rawNodes = getSafeArray(payload.nodes).length > 0
    ? getSafeArray(payload.nodes)
    : versionNodesToCreateInput(sourceGraph?.nodes || []);

  if (rawNodes.length === 0) {
    throw new WorkflowServiceError('At least one TOOL node is required for a workflow version.', 400);
  }

  const seenKeys = new Set();
  const normalizedNodes = rawNodes.map((node, index) => normalizeCreateNodeInput(node, index, seenKeys));
  const publish = payload.publish !== false;
  const status = publish ? 'PUBLISHED' : 'DRAFT';
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const versionNumberResult = await client.query(
      `
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
        FROM worker.workflow_versions
        WHERE workflow_definition_id = $1
      `,
      [definition.workflowDefinitionId],
    );
    const versionNumber = Number(versionNumberResult.rows[0]?.next_version_number || 1);

    if (publish) {
      await client.query(
        `
          UPDATE worker.workflow_versions
          SET status = 'RETIRED'
          WHERE workflow_definition_id = $1
            AND status = 'PUBLISHED'
        `,
        [definition.workflowDefinitionId],
      );
    }

    await insertWorkflowVersionGraph({
      client,
      definition,
      versionNumber,
      versionLabel: payload.versionLabel || (publish ? `Published v${versionNumber}` : `Draft v${versionNumber}`),
      status,
      nodes: normalizedNodes,
      user,
    });

    await client.query(
      `
        UPDATE worker.workflow_definitions
        SET status = CASE WHEN $2 = TRUE THEN 'ACTIVE' ELSE status END,
            enabled = CASE WHEN $2 = TRUE THEN TRUE ELSE enabled END,
            visible_in_admin = TRUE,
            updated_by_user_id = $3,
            config = config || $4::jsonb
        WHERE workflow_definition_id = $1
      `,
      [
        definition.workflowDefinitionId,
        publish,
        user?.userId || null,
        JSON.stringify({ lastVersionCreatedBy: 'workflow_manager_v1' }),
      ],
    );

    await client.query('COMMIT');
    return getWorkflowDefinitionForManage(definition.workflowCode);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cloneWorkflowDefinition({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_WRITE',
    permissions,
    action: 'clone_workflow',
  });

  const source = await getWorkflowDefinitionForManage(workflowCode);
  const sourceNodes = source.publishedGraph?.nodes || source.latestGraph?.nodes || [];
  const cloneCode = normalizeWorkflowCode(payload.workflowCode || `${source.workflowCode}-copy`);
  const cloneName = String(payload.displayName || `${source.displayName} Copy`).trim();

  if (!cloneCode) {
    throw new WorkflowServiceError('Clone workflowCode is required.', 400);
  }

  if (!cloneName) {
    throw new WorkflowServiceError('Clone displayName is required.', 400);
  }

  return createWorkflowDefinition({
    payload: {
      workflowCode: cloneCode,
      displayName: cloneName,
      description: Object.prototype.hasOwnProperty.call(payload, 'description')
        ? String(payload.description || '').trim()
        : source.description,
      publish: payload.publish !== false,
      visibleInAdmin: true,
      enabled: true,
      nodes: versionNodesToCreateInput(sourceNodes),
    },
    user,
    permissions,
  });
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


async function executeWorkflowNode({ node, parameters, user, session, permissions = [], context = {} }) {
  return executeNode({
    node,
    parameters,
    user,
    session,
    permissions,
    context,
  });
}


async function startWorkflowWithTemporal({
  workflowCode,
  input = {},
  user,
  session,
  permissions = [],
  context = {},
} = {}) {
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

  const run = await insertWorkflowRun({
    definition,
    input,
    user,
    context,
    status: 'QUEUED',
    metadata: {
      executor: 'skyserver_workflow_executor_temporal_v1',
      temporalBacked: true,
      queuedByApi: true,
    },
  });

  try {
    const temporalStart = await temporalService.startSkyserverWorkflowExecutorWorkflow({
      workflowCode: definition.workflowCode,
      workflowRunRecordId: run.workflowRunRecordId,
      input,
      actor: user,
      session,
      permissions,
      context,
    });

    const linkedRun = await linkWorkflowRunToTemporal({
      workflowRunRecordId: run.workflowRunRecordId,
      temporalWorkflowId: temporalStart.workflow.workflowId,
      temporalRunId: temporalStart.workflow.runId,
      summary: `Workflow ${definition.displayName} started through Temporal-backed SkyServer executor.`,
      metadata: {
        executor: 'skyserver_workflow_executor_temporal_v1',
        temporalBacked: true,
        temporalWorkflowType: temporalStart.workflow.workflowType,
        temporalTaskQueue: temporalStart.workflow.taskQueue,
        temporalNamespace: temporalStart.workflow.namespace,
      },
    });

    return {
      ok: true,
      started: true,
      async: true,
      run: linkedRun || run,
      definition,
      nodeRuns: [],
      temporalWorkflow: temporalStart.workflow,
      message: `Workflow ${definition.displayName} started through Temporal. Refresh Workflow History to follow node progress.`,
    };
  } catch (error) {
    const failedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_FAILURE_STATUS,
      summary: `Workflow ${definition.displayName} failed to start in Temporal: ${error.message || String(error)}`,
      metadata: {
        executor: 'skyserver_workflow_executor_temporal_v1',
        temporalBacked: true,
        startFailure: true,
        errorMessage: error.message || String(error),
      },
    });

    throw new WorkflowServiceError('Failed to start Temporal-backed workflow executor.', 500, {
      workflowCode: definition.workflowCode,
      workflowRunRecordId: run.workflowRunRecordId,
      run: failedRun,
      error: error.message || String(error),
    });
  }
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

  let temporalRuntime = null;

  if (run.temporalWorkflowId) {
    try {
      temporalRuntime = await temporalService.getWorkflowRuntimeDetail({
        workflowId: run.temporalWorkflowId,
        runId: run.temporalRunId,
      });
    } catch (error) {
      temporalRuntime = {
        available: false,
        workflowId: run.temporalWorkflowId,
        runId: run.temporalRunId,
        warnings: [error.message || String(error)],
      };
    }
  }

  return {
    run: {
      ...run,
      temporalRuntime,
    },
    nodeRuns: nodeResult.rows.map(normalizeNodeRunRow),
    temporalRuntime,
  };
}

module.exports = {
  WorkflowServiceError,
  completeWorkflowNodeRun,
  completeWorkflowRun,
  archiveWorkflowDefinition,
  cloneWorkflowDefinition,
  deleteWorkflowDefinition,
  createWorkflowDefinition,
  createWorkflowVersion,
  replaceWorkflowGraph,
  executeWorkflow,
  executeWorkflowNode,
  failWorkflowNodeRun,
  failWorkflowRun,
  getWorkflowDefinition,
  getWorkflowDefinitionForManage,
  getWorkflowRun,
  listBuilderCatalog,
  linkWorkflowRunToTemporal,
  listWorkflowDefinitions,
  listWorkflowRuns,
  markWorkflowNodeAttempt,
  startWorkflowNodeRun,
  startWorkflowWithTemporal,
  updateWorkflowDefinition,
};
