const axios = require('axios');
const { pool, query } = require('../../../../packages/db/src/connection');
const {
  buildConditionNodeLookup: buildStructuredConditionNodeLookup,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs: buildStructuredSummaryKeyOutputs,
  createLegacyToolResult,
  getToolResultDomainOutput,
  isToolResult,
} = require('../../../../packages/tools/src');
const authService = require('./authService');
const scriptExecutionService = require('./scriptExecutionService');
const temporalService = require('./temporalService');
const toolManifestService = require('./toolManifestService');
const {
  evaluateConditionNode,
  normalizeConditionBranchTargetNodeKey,
  normalizeConditionOnFalse,
  normalizeConditionParameters,
  resolveConditionBranchIndex,
} = require('./workflowConditionService');
const { WorkflowServiceError } = require('./workflowServiceError');
const { assertWorkflowExecutionTargetsAvailable } = require('./workflowExecutionPreflightService');
const { isBlankValue } = require('./workflowParameterUtils');
const { buildWhitelistedOrderBy } = require('./tableSortUtils');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_WORKFLOW_RUNTIME_PARAMETERS = 10;
const PROFILE_CODE =
  process.env.SKYCOMMAND_CONFIG_PROFILE || process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE || process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const SUPPORTED_NODE_TYPES = new Set([
  'TOOL',
  'API_CALL',
  'WORKFLOW',
  'TEMPORAL_WORKFLOW',
  'CONDITION',
  'WAIT',
  'HUMAN_APPROVAL',
  'SUMMARY',
]);
const TERMINAL_SUCCESS_STATUS = 'COMPLETED';
const TERMINAL_FAILURE_STATUS = 'FAILED';
const DEFAULT_START_PERMISSION = 'WORKFLOW_RUN';
const DEFAULT_CANCEL_PERMISSION = 'WORKFLOW_RUN';
const DEFAULT_WORKFLOW_CATEGORY_CODE = 'GENERAL';
const WORKFLOW_CREATE_PERMISSION = 'WORKFLOW_CREATE';
const WORKFLOW_RUN_PERMISSION = 'WORKFLOW_RUN';
const WORKFLOW_CHANGE_PERMISSION = 'WORKFLOW_CHANGE';
const DEFAULT_CONDITION_ON_FALSE = 'STOP_SUCCESS';
const DEFAULT_WAIT_DURATION_MS = 1000;
const MAX_WAIT_DURATION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HUMAN_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING']);
const RETRYABLE_RUN_STATUSES = new Set(['FAILED', 'CANCELED', 'TERMINATED']);
const MAX_HUMAN_APPROVAL_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;
const HUMAN_APPROVAL_DECISION_SIGNAL = 'humanApprovalDecision';
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

async function recordWorkflowAuditEvent({
  user,
  context = {},
  eventType,
  resourceType,
  resourceId = null,
  action,
  success = true,
  message,
  metadata = {},
} = {}) {
  try {
    await authService.recordAuditEvent({
      userId: user?.userId || null,
      eventType,
      resourceType,
      resourceId,
      action,
      success,
      message,
      metadata,
      ipAddress: context?.ipAddress || null,
      userAgent: context?.userAgent || null,
    });
  } catch (auditError) {
    console.error(
      `[SkyCommand API] Failed to record ${eventType || 'workflow'} audit event:`,
      auditError,
    );
  }
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function parseOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

function normalizeWorkflowCategoryCode(value, fallback = DEFAULT_WORKFLOW_CATEGORY_CODE) {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return normalized || fallback;
}

function normalizeWorkflowCategoryRow(row) {
  const item = camelizeRow(row);

  return {
    workflowCategoryId: item.workflowCategoryId,
    categoryCode: item.categoryCode,
    displayName: item.displayName,
    description: item.description || null,
    displayOrder: Number(item.displayOrder || 0),
    enabled: toBoolean(item.enabled),
    config: item.config || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function resolveWorkflowCategory(client, categoryCode, { enabledOnly = true } = {}) {
  const normalizedCategoryCode = normalizeWorkflowCategoryCode(categoryCode);
  const result = await client.query(
    `
      SELECT
        workflow_category_id,
        category_code,
        display_name,
        description,
        display_order,
        enabled,
        config,
        created_at,
        updated_at
      FROM worker.workflow_categories
      WHERE category_code = $1
        ${enabledOnly ? 'AND enabled = TRUE' : ''}
      LIMIT 1
    `,
    [normalizedCategoryCode],
  );

  if (!result.rows[0]) {
    throw new WorkflowServiceError('Workflow category was not found or is disabled.', 400, {
      categoryCode: normalizedCategoryCode,
    });
  }

  return normalizeWorkflowCategoryRow(result.rows[0]);
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
    categoryCode: definition.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
    categoryDisplayName: definition.categoryDisplayName || 'General',
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

  return `${text.slice(0, maxLength)}\n\n[SkyCommand Workflow Executor] Output truncated at ${maxLength} characters.`;
}

function truncateJsonPreview(value, maxLength = 8000) {
  let text = '';

  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch (error) {
      text = String(value);
    }
  }

  return truncateText(text, maxLength);
}

function parseJsonText(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new WorkflowServiceError(`${fieldName} must be valid JSON.`, 400, {
      fieldName,
      parseError: error.message,
    });
  }
}

function parseSuccessCodes(value) {
  if (Array.isArray(value)) {
    return value.map((item) => Number.parseInt(item, 10)).filter((item) => Number.isFinite(item));
  }

  const raw =
    value === undefined || value === null || value === '' ? '200,201,202,204' : String(value);
  const codes = raw
    .split(/[,\s]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item >= 100 && item <= 599);

  return codes.length > 0 ? codes : [200, 201, 202, 204];
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
    throw new WorkflowServiceError('Unsupported WAIT duration unit.', 400, {
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
      throw new WorkflowServiceError('WAIT durationMs must be a positive number.', 400, {
        durationMs: rawDurationMs,
      });
    }

    return Math.round(parsedDurationMs);
  }

  const unit = normalizeWaitUnit(input.unit || input.durationUnit || 'SECONDS');
  const rawDuration =
    input.duration ??
    input.waitDuration ??
    input.delayDuration ??
    DEFAULT_WAIT_DURATION_MS / WAIT_UNIT_MULTIPLIERS_MS[unit];
  const parsedDuration = Number(rawDuration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    throw new WorkflowServiceError('WAIT duration must be a positive number.', 400, {
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
    throw new WorkflowServiceError('WAIT nodes are capped at 24 hours.', 400, {
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
    reason: String(input.reason || input.note || '')
      .trim()
      .slice(0, 500),
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

async function runWaitNode({ node, parameters }) {
  const waitParameters = normalizeWaitParameters(parameters);
  const startedAtMs = Date.now();

  await new Promise((resolve) => {
    setTimeout(resolve, waitParameters.durationMs);
  });

  return buildWaitNodeOutput({
    node,
    waitParameters,
    startedAtMs,
    completedAtMs: Date.now(),
  });
}

function normalizeHumanApprovalAction(value, fieldName = 'approval action') {
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
  const action = aliases[normalized] || normalized;
  const allowed = new Set(['STOP_SUCCESS', 'FAIL_WORKFLOW', 'CONTINUE']);

  if (!allowed.has(action)) {
    throw new WorkflowServiceError(`Unsupported HUMAN_APPROVAL ${fieldName}.`, 400, {
      action: value,
      allowed: [...allowed],
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
    throw new WorkflowServiceError('Unsupported HUMAN_APPROVAL timeout unit.', 400, {
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
      throw new WorkflowServiceError(
        'HUMAN_APPROVAL timeoutMs must be a positive number or blank.',
        400,
        {
          timeoutMs: rawTimeoutMs,
        },
      );
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
    throw new WorkflowServiceError(
      'HUMAN_APPROVAL timeout duration must be a positive number or blank.',
      400,
      {
        timeoutDuration: rawDuration,
      },
    );
  }

  return Math.round(parsedDuration * HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS[unit]);
}

function normalizeHumanApprovalParameters(parameters = {}, node = {}) {
  const input = getSafeObject(parameters);
  const approvalTitle = String(
    input.approvalTitle || input.title || node.displayName || 'Approval required',
  ).trim();
  const approvalKey = normalizeNodeKey(input.approvalKey || node.nodeKey || 'approval', 'approval');
  const timeoutMs = parseHumanApprovalTimeoutMs(input);

  if (!approvalTitle) {
    throw new WorkflowServiceError('HUMAN_APPROVAL nodes require approvalTitle.', 400, {
      fieldName: 'approvalTitle',
    });
  }

  if (timeoutMs && timeoutMs > MAX_HUMAN_APPROVAL_TIMEOUT_MS) {
    throw new WorkflowServiceError('HUMAN_APPROVAL timeout is capped at 30 days.', 400, {
      timeoutMs,
      maxTimeoutMs: MAX_HUMAN_APPROVAL_TIMEOUT_MS,
    });
  }

  return {
    ...input,
    approvalTitle,
    title: approvalTitle,
    instructions: String(input.instructions || input.prompt || '')
      .trim()
      .slice(0, 4000),
    approvalKey,
    requiredRoleCode: normalizeRoleCode(input.requiredRoleCode || input.requiredRole) || null,
    onReject: normalizeHumanApprovalAction(
      input.onReject || input.rejectAction || 'STOP_SUCCESS',
      'onReject action',
    ),
    rejectTargetNodeKey: normalizeConditionBranchTargetNodeKey(
      input.rejectTargetNodeKey || input.rejectionTargetNodeKey,
    ),
    onTimeout: normalizeHumanApprovalAction(
      input.onTimeout || input.timeoutAction || 'FAIL_WORKFLOW',
      'onTimeout action',
    ),
    timeoutMs,
    timeoutDuration: input.timeoutDuration ?? input.duration ?? null,
    timeoutUnit: timeoutMs
      ? normalizeHumanApprovalTimeoutUnit(input.timeoutUnit || input.unit || 'HOURS')
      : null,
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
  const allowed = new Set(['APPROVED', 'REJECTED', 'TIMED_OUT']);

  if (!allowed.has(decision)) {
    throw new WorkflowServiceError('Unsupported approval decision.', 400, {
      decision: value,
      allowed: [...allowed],
    });
  }

  return decision;
}

function getApprovalActionForDecision(decision, approvalParameters = {}) {
  if (decision === 'APPROVED') {
    return 'CONTINUE';
  }

  if (decision === 'REJECTED') {
    return normalizeHumanApprovalAction(
      approvalParameters.onReject || 'STOP_SUCCESS',
      'onReject action',
    );
  }

  if (decision === 'TIMED_OUT') {
    return normalizeHumanApprovalAction(
      approvalParameters.onTimeout || 'FAIL_WORKFLOW',
      'onTimeout action',
    );
  }

  return 'FAIL_WORKFLOW';
}

function normalizeApprovalRow(row) {
  const item = camelizeRow(row);

  return {
    approvalRequestId: item.approvalRequestId,
    workflowRunRecordId: item.workflowRunRecordId,
    workflowNodeRunRecordId: item.workflowNodeRunRecordId,
    workflowNodeId: item.workflowNodeId,
    workflowCode: item.workflowCode,
    workflowDisplayName: item.workflowDisplayName,
    workflowCategoryCode: item.workflowCategoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
    workflowCategoryDisplayName: item.workflowCategoryDisplayName || 'General',
    workflowCategorySource: item.workflowCategorySource || 'DEFAULT',
    nodeKey: item.nodeKey,
    nodeDisplayName: item.nodeDisplayName,
    nodeTypeCode: item.nodeTypeCode,
    approvalKey: item.approvalKey,
    approvalTitle: item.approvalTitle,
    instructions: item.instructions,
    status: item.status,
    requiredRoleCode: item.requiredRoleCode,
    onReject: item.onReject,
    rejectTargetNodeKey: item.metadata?.rejectTargetNodeKey || null,
    onTimeout: item.onTimeout,
    timeoutMs: item.timeoutMs,
    temporalWorkflowId: item.temporalWorkflowId,
    temporalRunId: item.temporalRunId,
    signalName: item.signalName || HUMAN_APPROVAL_DECISION_SIGNAL,
    requestedByUserId: item.requestedByUserId,
    requestedByEmail: item.requestedByEmail,
    requestedByDisplayName: item.requestedByDisplayName,
    decidedByUserId: item.decidedByUserId,
    decidedByEmail: item.decidedByEmail,
    decidedByDisplayName: item.decidedByDisplayName,
    decisionNote: item.decisionNote,
    requestedAt: item.requestedAt,
    decidedAt: item.decidedAt,
    expiresAt: item.expiresAt,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeRoleCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseGrantedRoleCodes(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(parseGrantedRoleCodes);
  }

  return String(value)
    .split(',')
    .map((role) => normalizeRoleCode(role.replace(/[{}"']/g, '')))
    .filter(Boolean);
}

function getRoleSetFromPermissions(permissions = []) {
  const roleSet = new Set();

  for (const permission of permissions || []) {
    const roles = parseGrantedRoleCodes(
      permission.grantedThroughRoles || permission.granted_through_roles,
    );

    for (const role of roles) {
      roleSet.add(role);
    }
  }

  return roleSet;
}

function assertApprovalRole({ requiredRoleCode, permissions = [] } = {}) {
  const normalizedRole = normalizeRoleCode(requiredRoleCode);

  if (!normalizedRole) {
    return;
  }

  const roleSet = getRoleSetFromPermissions(permissions);

  if (!roleSet.has(normalizedRole) && !roleSet.has('SUPER_ADMIN')) {
    throw new WorkflowServiceError(
      'Approval requires a role the current user does not have.',
      403,
      {
        requiredRoleCode: normalizedRole,
      },
    );
  }
}

function buildHumanApprovalOutput({
  approval,
  decision,
  decisionNote = null,
  actor = null,
  timedOut = false,
} = {}) {
  const normalizedDecision = normalizeApprovalDecision(decision);
  const action = getApprovalActionForDecision(normalizedDecision, approval);
  const actorName =
    actor?.displayName ||
    actor?.email ||
    approval?.decidedByDisplayName ||
    approval?.decidedByEmail ||
    null;
  const title = approval?.approvalTitle || approval?.title || 'Approval required';
  const rejectTargetNodeKey = normalizedDecision === 'REJECTED'
    ? normalizeConditionBranchTargetNodeKey(
        approval?.rejectTargetNodeKey || approval?.metadata?.rejectTargetNodeKey,
      )
    : '';
  const summary =
    normalizedDecision === 'APPROVED'
      ? `Approval granted for ${title}${actorName ? ` by ${actorName}` : ''}; continuing workflow.`
      : normalizedDecision === 'REJECTED'
        ? rejectTargetNodeKey
          ? `Approval rejected for ${title}${actorName ? ` by ${actorName}` : ''}; routing to ${rejectTargetNodeKey}.`
          : `Approval rejected for ${title}${actorName ? ` by ${actorName}` : ''}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`
        : `Approval timed out for ${title}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`;

  return {
    kind: 'human_approval',
    status: normalizedDecision,
    approved: normalizedDecision === 'APPROVED',
    rejected: normalizedDecision === 'REJECTED',
    timedOut: timedOut || normalizedDecision === 'TIMED_OUT',
    decision: normalizedDecision,
    action,
    branchTaken: Boolean(rejectTargetNodeKey),
    branchLabel: rejectTargetNodeKey ? 'REJECTED' : null,
    branchTargetNodeKey: rejectTargetNodeKey || null,
    approvalRequestId: approval?.approvalRequestId || null,
    approvalKey: approval?.approvalKey || null,
    approvalTitle: title,
    instructions: approval?.instructions || null,
    requiredRoleCode: approval?.requiredRoleCode || null,
    temporalWorkflowId: approval?.temporalWorkflowId || null,
    temporalRunId: approval?.temporalRunId || null,
    decisionNote: decisionNote || approval?.decisionNote || null,
    decidedByDisplayName: actorName,
    decidedAt: approval?.decidedAt || new Date().toISOString(),
    summary,
  };
}

async function runHumanApprovalNodeInline() {
  throw new WorkflowServiceError(
    'HUMAN_APPROVAL nodes require Temporal-backed execution so SkyCommand can wait for an approval signal durably.',
    409,
    {
      nodeTypeCode: 'HUMAN_APPROVAL',
      requiredExecutorMode: 'temporal',
    },
  );
}

function normalizeApiAuthMode(value) {
  const normalized = String(value || 'AUTO')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    '': 'AUTO',
    AUTO: 'AUTO',
    AUTOMATIC: 'AUTO',
    NO_AUTH: 'NONE',
    NONE: 'NONE',
    INTERNAL: 'SKYCOMMAND_INTERNAL',
    INTERNAL_SERVICE: 'SKYCOMMAND_INTERNAL',
    SKY_COMMAND_INTERNAL: 'SKYCOMMAND_INTERNAL',
    SKYCOMMAND_INTERNAL: 'SKYCOMMAND_INTERNAL',
    SKY_SERVER_INTERNAL: 'SKYCOMMAND_INTERNAL',
    SKYSERVER_INTERNAL: 'SKYCOMMAND_INTERNAL',
  };

  const authMode = aliases[normalized] || normalized;
  const allowed = new Set(['AUTO', 'NONE', 'SKYCOMMAND_INTERNAL']);

  if (!allowed.has(authMode)) {
    throw new WorkflowServiceError('Unsupported API_CALL auth mode.', 400, {
      authMode: value,
      allowed: [...allowed],
    });
  }

  return authMode;
}

function getInternalApiToken() {
  return String(
    process.env.SKYCOMMAND_INTERNAL_API_TOKEN ||
      process.env.SKYSERVER_INTERNAL_API_TOKEN ||
      '',
  ).trim();
}

function isLocalSkyCommandUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return false;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const containerHostAlias = String(process.env.SKYCOMMAND_CONTAINER_HOST_ALIAS || '')
    .trim()
    .toLowerCase();
  if (containerHostAlias) {
    allowedHosts.add(containerHostAlias);
  }

  if (!allowedHosts.has(host)) {
    return false;
  }

  const apiPort = String(process.env.API_PORT || process.env.ADMIN_PORT || 7171);
  const parsedPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

  return parsedPort === apiPort;
}

function applyApiAuthHeaders({ headers, authMode, url }) {
  const outputHeaders = { ...(headers || {}) };

  if (authMode === 'NONE') {
    return outputHeaders;
  }

  if (authMode === 'AUTO') {
    const token = getInternalApiToken();

    if (token && isLocalSkyCommandUrl(url)) {
      outputHeaders['x-skycommand-internal-token'] = token;
    }

    return outputHeaders;
  }

  if (authMode === 'SKYCOMMAND_INTERNAL') {
    if (!isLocalSkyCommandUrl(url)) {
      throw new WorkflowServiceError(
        'SkyCommand internal API auth can only be used for the local SkyCommand API.',
        400,
        {
          url,
          authMode,
        },
      );
    }

    const token = getInternalApiToken();

    if (!token) {
      throw new WorkflowServiceError(
        'SKYCOMMAND_INTERNAL_API_TOKEN is required for SkyCommand internal API auth.',
        500,
        {
          authMode,
          envVar: 'SKYCOMMAND_INTERNAL_API_TOKEN',
          legacyEnvVar: 'SKYSERVER_INTERNAL_API_TOKEN',
        },
      );
    }

    outputHeaders['x-skycommand-internal-token'] = token;
    return outputHeaders;
  }

  return outputHeaders;
}

function normalizeHttpMethod(value) {
  const method = String(value || 'GET')
    .trim()
    .toUpperCase();
  const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

  if (!allowed.has(method)) {
    throw new WorkflowServiceError('Unsupported API_CALL HTTP method.', 400, {
      method,
      allowed: [...allowed],
    });
  }

  return method;
}

function normalizeApiUrl(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    throw new WorkflowServiceError('API_CALL url is required.', 400);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new WorkflowServiceError('API_CALL url must be a valid absolute URL.', 400, {
      url: raw,
      parseError: error.message,
    });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new WorkflowServiceError('API_CALL only supports http and https URLs.', 400, {
      protocol: parsed.protocol,
    });
  }

  return parsed.toString();
}

function translateLocalApiUrlForRuntime(value) {
  const normalized = normalizeApiUrl(value);
  const hostAlias = String(process.env.SKYCOMMAND_CONTAINER_HOST_ALIAS || '').trim();
  const runtime = String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase();

  if (runtime !== 'docker' || !hostAlias) {
    return normalized;
  }

  const parsed = new URL(normalized);
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) {
    parsed.hostname = hostAlias;
  }

  return parsed.toString();
}

function normalizePositiveNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeWorkflowNodeRetryPolicy(value = {}) {
  const retryPolicy = getSafeObject(value);
  const hasRetryPolicy =
    Object.prototype.hasOwnProperty.call(retryPolicy, 'maximumAttempts') ||
    Object.prototype.hasOwnProperty.call(retryPolicy, 'maximum_attempts') ||
    Object.prototype.hasOwnProperty.call(retryPolicy, 'initialIntervalSeconds') ||
    Object.prototype.hasOwnProperty.call(retryPolicy, 'initial_interval_seconds');

  if (!hasRetryPolicy) {
    return {};
  }

  const maximumAttempts = normalizePositiveNumber(
    retryPolicy.maximumAttempts || retryPolicy.maximum_attempts,
    1,
    10,
  );
  const initialIntervalSeconds = normalizePositiveNumber(
    retryPolicy.initialIntervalSeconds || retryPolicy.initial_interval_seconds,
    5,
    3600,
  );

  return {
    maximumAttempts,
    initialIntervalSeconds,
  };
}

function normalizeWorkflowNodeTimeoutMs(value) {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 86400000) {
    throw new WorkflowServiceError(
      'Workflow node timeoutMs must be blank or a positive number up to 24 hours.',
      400,
      {
        timeoutMs: value,
        maxTimeoutMs: 86400000,
      },
    );
  }

  return parsed;
}

function getNodeDisplayNameForType(nodeTypeCode, fallback = 'Workflow node') {
  const map = {
    API_CALL: 'Call API',
    CONDITION: 'Evaluate Condition',
    HUMAN_APPROVAL: 'Human Approval',
    SUMMARY: 'Generate Run Summary',
    WAIT: 'Wait / Delay',
    TEMPORAL_WORKFLOW: 'Start Temporal Workflow',
    TOOL: 'Run Tool',
    WORKFLOW: 'Run Child Workflow',
  };

  return map[nodeTypeCode] || fallback;
}

function getNodeTargetKindForType(nodeTypeCode) {
  const map = {
    API_CALL: 'api.endpoint',
    CONDITION: null,
    HUMAN_APPROVAL: null,
    SUMMARY: null,
    WAIT: null,
    TEMPORAL_WORKFLOW: 'worker.temporal_workflow_definitions',
    TOOL: 'core.tools',
    WORKFLOW: 'worker.workflow_definitions',
  };

  return map[nodeTypeCode] || null;
}

function getNodeCategoryForType(nodeTypeCode) {
  const map = {
    API_CALL: 'INTEGRATION',
    CONDITION: 'CONTROL',
    HUMAN_APPROVAL: 'HUMAN',
    SUMMARY: 'CONTROL',
    WAIT: 'CONTROL',
    TEMPORAL_WORKFLOW: 'WORKFLOW',
    TOOL: 'ACTION',
    WORKFLOW: 'WORKFLOW',
  };

  return map[nodeTypeCode] || 'ACTION';
}

function normalizeDefinitionRow(row) {
  const item = camelizeRow(row);

  return {
    workflowDefinitionId: item.workflowDefinitionId,
    workflowCategoryId: item.workflowCategoryId,
    categoryCode: item.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
    categoryDisplayName: item.categoryDisplayName || 'General',
    categoryDescription: item.categoryDescription || null,
    categoryDisplayOrder: Number(item.categoryDisplayOrder || 0),
    categoryEnabled: item.categoryEnabled === undefined ? true : toBoolean(item.categoryEnabled),
    workflowCode: item.workflowCode,
    displayName: item.displayName,
    description: item.description,
    status: item.status,
    visibleInAdmin: toBoolean(item.visibleInAdmin),
    enabled: toBoolean(item.enabled),
    startPermissionCode: item.startPermissionCode,
    cancelPermissionCode: item.cancelPermissionCode,
    config: item.config || {},
    runtimeParameters: normalizeWorkflowParameterDefinitions(
      getParameterSchemaFromConfig(item.config || {}),
    ),
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

function getRunParentWorkflowRunRecordId(run = {}) {
  return run?.input?.parentWorkflowRunRecordId || run?.metadata?.parentWorkflowRunRecordId || null;
}

function getRunParentNodeKey(run = {}) {
  return run?.input?.parentNodeKey || run?.metadata?.parentNodeKey || null;
}

function normalizeRunRow(row) {
  const item = camelizeRow(row);
  const input = item.input || {};
  const metadata = item.metadata || {};
  const parentWorkflowRunRecordId = getRunParentWorkflowRunRecordId({ input, metadata });
  const parentNodeKey = getRunParentNodeKey({ input, metadata });
  const childWorkflow =
    item.runSource === 'child_workflow' ||
    item.triggerType === 'CHILD_WORKFLOW' ||
    metadata.childWorkflow === true ||
    Boolean(parentWorkflowRunRecordId);

  return {
    workflowRunRecordId: item.workflowRunRecordId,
    workflowDefinitionId: item.workflowDefinitionId,
    workflowVersionId: item.workflowVersionId,
    workflowCode: item.workflowCode,
    workflowDisplayName: item.workflowDisplayName,
    workflowCategoryCode:
      item.workflowCategoryCode || metadata.workflowCategoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
    workflowCategoryDisplayName:
      item.workflowCategoryDisplayName || metadata.workflowCategoryDisplayName || 'General',
    workflowCategorySource: item.workflowCategorySource || (metadata.workflowCategoryCode ? 'SNAPSHOT' : 'DEFAULT'),
    versionNumber: item.versionNumber || item.definitionVersionNumber,
    runSource: item.runSource,
    triggerType: item.triggerType,
    status: item.status,
    temporalWorkflowId: item.temporalWorkflowId,
    temporalRunId: item.temporalRunId,
    input,
    requestContext: item.requestContext || {},
    summary: item.summary,
    startedByUserId: item.startedByUserId,
    startedByEmail: item.startedByEmail,
    startedByDisplayName: item.startedByDisplayName,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    metadata,
    parentWorkflowRunRecordId,
    parentNodeKey,
    childWorkflow,
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

function normalizeNodeOutputRow(row) {
  const item = camelizeRow(row);

  return {
    workflowRunNodeOutputId: item.workflowRunNodeOutputId,
    workflowRunRecordId: item.workflowRunRecordId,
    workflowCode: item.workflowCode,
    workflowStatus: item.workflowStatus,
    workflowNodeRunRecordId: item.workflowNodeRunRecordId,
    workflowNodeId: item.workflowNodeId,
    nodeKey: item.nodeKey,
    nodeTypeCode: item.nodeTypeCode,
    targetCode: item.targetCode,
    outputKey: item.outputKey,
    outputType: item.outputType,
    inputSnapshot: item.inputSnapshotJson || {},
    output: item.outputJson,
    outputSummary: item.outputSummary,
    status: item.status,
    attemptCount: item.attemptCount || 0,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function normalizeWorkflowContextValueRow(row) {
  const item = camelizeRow(row);

  return {
    workflowRunContextValueId: item.workflowRunContextValueId,
    workflowRunRecordId: item.workflowRunRecordId,
    workflowCode: item.workflowCode,
    workflowStatus: item.workflowStatus,
    contextKey: item.contextKey,
    value: item.valueJson,
    valueType: item.valueType,
    sourceNodeKey: item.sourceNodeKey,
    sourceNodeRunRecordId: item.sourceNodeRunRecordId,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function getJsonValueType(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  const type = typeof value;

  if (['string', 'number', 'boolean'].includes(type)) {
    return type;
  }

  if (type === 'object') {
    return 'object';
  }

  return 'unknown';
}

function toJsonbValue(value) {
  if (value === undefined) {
    return null;
  }

  return value;
}

function cloneJsonCompatible(value) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
}

function normalizeContextKey(value, fallback = 'value') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);

  return normalized || fallback;
}

function getWorkflowRuntimeParams(input = {}) {
  const safeInput = getSafeObject(input);

  return getSafeObject(
    safeInput.params ||
      safeInput.runtimeParameters ||
      safeInput.workflowParameters ||
      safeInput.parameters,
  );
}

function getParameterSchemaFromConfig(config = {}) {
  const safeConfig = getSafeObject(config);
  const nestedSchema = getSafeObject(safeConfig.parameterSchema);

  return getSafeArray(
    safeConfig.runtimeParameters || nestedSchema.runtimeParameters || nestedSchema.parameters,
  );
}

function normalizeRuntimeParameterOptions(options = []) {
  return getSafeArray(options)
    .map((option) => {
      if (option && typeof option === 'object') {
        const value = option.value ?? option.optionValue ?? option.key ?? option.id ?? '';
        const label = option.label ?? option.displayName ?? option.name ?? value;

        return {
          value: String(value),
          label: String(label || value),
        };
      }

      return {
        value: String(option),
        label: String(option),
      };
    })
    .filter((option) => option.value !== '');
}

function normalizeWorkflowParameterDefinitions(parameters = []) {
  return getSafeArray(parameters)
    .slice(0, MAX_WORKFLOW_RUNTIME_PARAMETERS)
    .map((parameter, index) => {
      const raw = getSafeObject(parameter);
      const key = normalizeContextKey(
        raw.key || raw.parameterName || raw.name || raw.paramName || `param_${index + 1}`,
        `param_${index + 1}`,
      );
      const requestedType = String(raw.type || raw.paramTypeCode || raw.parameterType || 'string')
        .trim()
        .toLowerCase();
      const type = requestedType === 'repository' ? 'repo' : requestedType;
      const allowedType = ['string', 'number', 'boolean', 'select', 'date', 'json', 'repo'].includes(type)
        ? type
        : 'string';

      return {
        key,
        parameterName: key,
        label: String(raw.label || raw.displayName || key).trim() || key,
        type: allowedType,
        paramTypeCode: allowedType,
        required: toBoolean(raw.required),
        defaultValue: raw.defaultValue ?? raw.default ?? null,
        description: raw.description || raw.prompt || '',
        prompt: raw.prompt || raw.description || '',
        options: normalizeRuntimeParameterOptions(raw.options || raw.allowedValues || raw.values),
        optionSourceCode: raw.optionSourceCode || (allowedType === 'repo' ? 'repositories' : null),
        maxLength: Number.isFinite(Number(raw.maxLength)) ? Number(raw.maxLength) : null,
        displayOrder: Number.isFinite(Number(raw.displayOrder))
          ? Number(raw.displayOrder)
          : index * 10 + 10,
      };
    })
    .filter((parameter) => Boolean(parameter.key))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || a.key.localeCompare(b.key));
}

function assertWorkflowParameterDefinitionLimit(parameters = []) {
  const count = getSafeArray(parameters).length;

  if (count > MAX_WORKFLOW_RUNTIME_PARAMETERS) {
    throw new WorkflowServiceError(
      `Workflows can define up to ${MAX_WORKFLOW_RUNTIME_PARAMETERS} runtime parameters.`,
      400,
      {
        suppliedCount: count,
        maxRuntimeParameters: MAX_WORKFLOW_RUNTIME_PARAMETERS,
      },
    );
  }
}

function getDefinitionRuntimeParameters(definition = {}) {
  return normalizeWorkflowParameterDefinitions(getParameterSchemaFromConfig(definition.config));
}

function isBlankRuntimeParameterValue(value) {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

function parseRuntimeJsonParameter(value, parameter) {
  if (isBlankRuntimeParameterValue(value)) {
    return null;
  }

  if (typeof value === 'object') {
    return cloneJsonCompatible(value);
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new WorkflowServiceError(
      `Runtime parameter ${parameter.label || parameter.key} must be valid JSON.`,
      400,
      {
        parameterKey: parameter.key,
        error: error.message || String(error),
      },
    );
  }
}

function coerceRuntimeParameterValue(value, parameter) {
  if (isBlankRuntimeParameterValue(value)) {
    if (!isBlankRuntimeParameterValue(parameter.defaultValue)) {
      return coerceRuntimeParameterValue(parameter.defaultValue, {
        ...parameter,
        defaultValue: null,
      });
    }

    return parameter.type === 'boolean' ? false : null;
  }

  if (parameter.type === 'number') {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new WorkflowServiceError(
        `Runtime parameter ${parameter.label || parameter.key} must be a number.`,
        400,
        {
          parameterKey: parameter.key,
          value,
        },
      );
    }

    return numericValue;
  }

  if (parameter.type === 'boolean') {
    return toBoolean(value);
  }

  if (parameter.type === 'json') {
    return parseRuntimeJsonParameter(value, parameter);
  }

  const stringValue = String(value);

  if (parameter.maxLength && stringValue.length > parameter.maxLength) {
    throw new WorkflowServiceError(
      `Runtime parameter ${parameter.label || parameter.key} exceeds max length ${parameter.maxLength}.`,
      400,
      {
        parameterKey: parameter.key,
        maxLength: parameter.maxLength,
      },
    );
  }

  if (parameter.type === 'select' && parameter.options.length > 0) {
    const allowedValues = new Set(parameter.options.map((option) => String(option.value)));

    if (!allowedValues.has(stringValue)) {
      throw new WorkflowServiceError(
        `Runtime parameter ${parameter.label || parameter.key} must use an allowed option.`,
        400,
        {
          parameterKey: parameter.key,
          value: stringValue,
          allowedValues: [...allowedValues],
        },
      );
    }
  }

  return stringValue;
}

async function resolveRepositoryRuntimeParameterValue(value, parameter = {}) {
  const requestedValue = String(value || '').trim();
  const result = await query(
    `
      SELECT
        repo_code,
        repo_name,
        display_order
      FROM core.vw_repository_paths
      WHERE profile_code = $1
        AND (
          LOWER(repo_code) = LOWER($2)
          OR LOWER(repo_name) = LOWER($2)
        )
      ORDER BY display_order, repo_code
      LIMIT 1
    `,
    [PROFILE_CODE, requestedValue],
  );

  if (result.rows.length === 0) {
    throw new WorkflowServiceError(
      `Runtime parameter ${parameter.label || parameter.key} must reference an active configured repository.`,
      400,
      {
        parameterKey: parameter.key,
        value: requestedValue,
        optionSourceCode: 'repositories',
      },
    );
  }

  return result.rows[0].repo_code;
}

async function validateWorkflowRuntimeInput(definition = {}, input = {}) {
  const safeInput = getSafeObject(input);
  const parameters = getDefinitionRuntimeParameters(definition);
  const suppliedParams = getWorkflowRuntimeParams(safeInput);
  const normalizedParams = {};

  for (const parameter of parameters) {
    const supplied = Object.prototype.hasOwnProperty.call(suppliedParams, parameter.key)
      ? suppliedParams[parameter.key]
      : suppliedParams[parameter.parameterName];

    if (
      parameter.required &&
      isBlankRuntimeParameterValue(supplied) &&
      isBlankRuntimeParameterValue(parameter.defaultValue)
    ) {
      throw new WorkflowServiceError(
        `Runtime parameter ${parameter.label || parameter.key} is required.`,
        400,
        {
          parameterKey: parameter.key,
          parameter,
        },
      );
    }

    let coercedValue = coerceRuntimeParameterValue(supplied, parameter);

    if (parameter.type === 'repo' && !isBlankRuntimeParameterValue(coercedValue)) {
      coercedValue = await resolveRepositoryRuntimeParameterValue(coercedValue, parameter);
    }

    if (!isBlankRuntimeParameterValue(coercedValue) || parameter.type === 'boolean') {
      normalizedParams[parameter.key] = coercedValue;
    }
  }

  for (const [key, value] of Object.entries(suppliedParams)) {
    if (
      !Object.prototype.hasOwnProperty.call(normalizedParams, key) &&
      !parameters.some((parameter) => parameter.key === key)
    ) {
      normalizedParams[normalizeContextKey(key)] = cloneJsonCompatible(value);
    }
  }

  return {
    ...safeInput,
    params: normalizedParams,
    runtimeParameters: normalizedParams,
  };
}

function getPathValue(source = {}, path = '') {
  const parts = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  let cursor = source;

  for (const part of parts) {
    if (cursor === undefined || cursor === null) {
      return undefined;
    }

    if (Array.isArray(cursor) && /^\d+$/.test(part)) {
      cursor = cursor[Number(part)];
    } else {
      cursor = cursor[part];
    }
  }

  return cursor;
}

function buildTemplateResolutionScope({ input = {}, context = {} } = {}) {
  const workflowContext = getSafeObject(context.workflowContext || context.context || context);

  return {
    input: getSafeObject(input),
    params: getSafeObject(
      context.params || workflowContext.params || getWorkflowRuntimeParams(input),
    ),
    context: workflowContext,
    workflowContext,
    workflow: getSafeObject(workflowContext.workflow),
    nodes: getSafeObject(context.nodes || workflowContext.nodes),
    last: getSafeObject(workflowContext.last),
    previousOutput: context.previousOutput || null,
    previousOutputs: getSafeObject(context.previousOutputs),
  };
}

function resolveTemplateString(value, scope = {}) {
  const text = String(value);
  const exactMatch = text.match(/^\s*{{\s*([^}]+?)\s*}}\s*$/);

  if (exactMatch) {
    const resolved = getPathValue(scope, exactMatch[1]);

    return resolved === undefined ? '' : cloneJsonCompatible(resolved);
  }

  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_match, path) => {
    const resolved = getPathValue(scope, path);

    if (resolved === undefined || resolved === null) {
      return '';
    }

    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }

    return String(resolved);
  });
}

function resolveRuntimeTemplates(value, scope = {}) {
  if (typeof value === 'string') {
    return resolveTemplateString(value, scope);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveRuntimeTemplates(item, scope));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        resolveRuntimeTemplates(nestedValue, scope),
      ]),
    );
  }

  return value;
}

function setNestedContextValue(target, contextKey, value) {
  const parts = String(contextKey || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return target;
  }

  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = cloneJsonCompatible(value);
      return;
    }

    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }

    cursor = cursor[part];
  });

  return target;
}

function buildContextObjectFromPatch(patch = {}) {
  return Object.entries(getSafeObject(patch)).reduce((accumulator, [contextKey, value]) => {
    setNestedContextValue(accumulator, contextKey, value);
    return accumulator;
  }, {});
}

function buildContextObjectFromRows(contextValues = []) {
  return contextValues.reduce((accumulator, item) => {
    setNestedContextValue(accumulator, item.contextKey, item.value);
    return accumulator;
  }, {});
}

function mergeContextObjects(base = {}, patchObject = {}) {
  const output = { ...getSafeObject(base) };

  for (const [key, value] of Object.entries(getSafeObject(patchObject))) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeContextObjects(output[key], value);
    } else {
      output[key] = cloneJsonCompatible(value);
    }
  }

  return output;
}

function applyContextPatch(runtimeContext = {}, patch = {}) {
  return mergeContextObjects(runtimeContext, buildContextObjectFromPatch(patch));
}

function buildInitialWorkflowContextPatch({ run = {}, definition = {}, input = {} } = {}) {
  const safeInput = getSafeObject(input);
  const runtimeParams = getWorkflowRuntimeParams(safeInput);

  return {
    'workflow.workflowRunRecordId': run.workflowRunRecordId || null,
    'workflow.workflowCode': definition.workflowCode || run.workflowCode || null,
    'workflow.workflowDisplayName': definition.displayName || run.workflowDisplayName || null,
    'workflow.versionNumber': definition.publishedVersionNumber || run.versionNumber || null,
    'workflow.runSource': safeInput.runSource || run.runSource || 'manual',
    'workflow.triggerType': safeInput.triggerType || run.triggerType || 'MANUAL',
    'workflow.input': safeInput,
    params: runtimeParams,
  };
}

function buildConditionNodeLookup(runtimeNodes = {}, nodeOutputsByKey = {}) {
  return buildStructuredConditionNodeLookup(runtimeNodes, nodeOutputsByKey);
}

function buildWorkflowExecutionContext({
  baseContext = {},
  runtimeContext = {},
  input = {},
  nodeOutputsByKey = {},
  previousNodeOutput = null,
  currentNodeKey = null,
} = {}) {
  const safeRuntimeContext = getSafeObject(runtimeContext);
  const params = getSafeObject(safeRuntimeContext.params || getWorkflowRuntimeParams(input));
  const previousOutputs = getSafeObject(nodeOutputsByKey);
  const previousResult = getSafeObject(previousNodeOutput);
  const previousOutput = cloneJsonCompatible(getToolResultDomainOutput(previousResult));
  const conditionNodes = buildConditionNodeLookup(safeRuntimeContext.nodes, previousOutputs);

  return {
    ...getSafeObject(baseContext),
    workflowContext: safeRuntimeContext,
    params,
    nodes: getSafeObject(safeRuntimeContext.nodes),
    previousOutputs,
    previousResult,
    previousOutput,
    conditionEvaluation: {
      input,
      workflow: getSafeObject(safeRuntimeContext.workflow),
      context: safeRuntimeContext,
      workflowContext: safeRuntimeContext,
      params,
      nodes: conditionNodes,
      nodeOutputs: previousOutputs,
      previousOutputs,
      previous: previousOutput,
      previousResult,
      previousOutput,
      last: getSafeObject(safeRuntimeContext.last),
      currentNodeKey,
    },
  };
}

function extractContextUpdatesFromOutput(output = {}) {
  const safeOutput = getSafeObject(output);
  const nestedOutput = getSafeObject(safeOutput.output);

  return {
    ...getSafeObject(safeOutput.contextUpdates),
    ...getSafeObject(nestedOutput.contextUpdates),
  };
}

function buildNodeContextPatch(nodeRun = {}) {
  if (!nodeRun?.nodeKey) {
    return {};
  }

  const result = getSafeObject(nodeRun.output);
  const output = cloneJsonCompatible(getToolResultDomainOutput(result));
  const nodeKey = normalizeContextKey(nodeRun.nodeKey, 'node');
  const patch = {
    [`nodes.${nodeKey}.nodeKey`]: nodeRun.nodeKey,
    [`nodes.${nodeKey}.nodeTypeCode`]: nodeRun.nodeTypeCode || null,
    [`nodes.${nodeKey}.targetCode`]: nodeRun.targetCode || null,
    [`nodes.${nodeKey}.status`]: nodeRun.status || null,
    [`nodes.${nodeKey}.attemptCount`]: nodeRun.attemptCount ?? 0,
    [`nodes.${nodeKey}.startedAt`]: nodeRun.startedAt || null,
    [`nodes.${nodeKey}.completedAt`]: nodeRun.completedAt || null,
    [`nodes.${nodeKey}.result`]: result,
    [`nodes.${nodeKey}.output`]: output,
    [`nodes.${nodeKey}.warnings`]: isToolResult(result) ? getSafeArray(result.warnings) : [],
    [`nodes.${nodeKey}.error`]: isToolResult(result) ? result.error || null : null,
    [`nodes.${nodeKey}.metadata`]: isToolResult(result) ? getSafeObject(result.metadata) : {},
    [`nodes.${nodeKey}.summary`]: getNodeOutputPersistenceSummary(result),
    'last.nodeKey': nodeRun.nodeKey,
    'last.status': nodeRun.status || null,
    'last.result': result,
    'last.output': output,
    'last.completedAt': nodeRun.completedAt || new Date().toISOString(),
  };

  const durationMs =
    normalizeTelemetryDurationMs(nodeRun.durationMs) ??
    normalizeTelemetryDurationMs(output.durationMs) ??
    getTelemetryDurationBetween(nodeRun.startedAt || nodeRun.createdAt, nodeRun.completedAt);

  if (durationMs !== null) {
    patch[`nodes.${nodeKey}.durationMs`] = durationMs;
    patch['last.durationMs'] = durationMs;
  }

  const saveOutputAs = normalizeContextKey(
    nodeRun.metadata?.parameters?.saveOutputAs ||
      nodeRun.metadata?.parameters?.outputKey ||
      nodeRun.metadata?.saveOutputAs ||
      result.saveOutputAs ||
      getSafeObject(result.output).saveOutputAs,
    '',
  );

  if (saveOutputAs) {
    patch[saveOutputAs] = output;
  }

  for (const [contextKey, value] of Object.entries(extractContextUpdatesFromOutput(output))) {
    patch[normalizeContextKey(contextKey)] = value;
  }

  return patch;
}

async function persistWorkflowContextPatch({
  workflowRunRecordId,
  patch = {},
  sourceNodeKey = null,
  sourceNodeRunRecordId = null,
  metadata = {},
} = {}) {
  if (!workflowRunRecordId) {
    return [];
  }

  const entries = Object.entries(getSafeObject(patch));
  const persisted = [];

  for (const [rawContextKey, rawValue] of entries) {
    const contextKey = normalizeContextKey(rawContextKey);
    const value = toJsonbValue(rawValue);

    try {
      const result = await query(
        `
          INSERT INTO worker.workflow_run_context_values (
            workflow_run_record_id,
            context_key,
            value_json,
            value_type,
            source_node_key,
            source_node_run_record_id,
            metadata
          )
          VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb)
          ON CONFLICT (workflow_run_record_id, context_key)
          DO UPDATE SET
            value_json = EXCLUDED.value_json,
            value_type = EXCLUDED.value_type,
            source_node_key = EXCLUDED.source_node_key,
            source_node_run_record_id = EXCLUDED.source_node_run_record_id,
            metadata = worker.workflow_run_context_values.metadata || EXCLUDED.metadata
          RETURNING *
        `,
        [
          workflowRunRecordId,
          contextKey,
          JSON.stringify(value),
          getJsonValueType(value),
          sourceNodeKey || null,
          sourceNodeRunRecordId || null,
          JSON.stringify({
            persistedBy: 'skycommand_workflow_context_store_v1',
            persistedAt: new Date().toISOString(),
            ...getSafeObject(metadata),
          }),
        ],
      );

      persisted.push(normalizeWorkflowContextValueRow(result.rows[0]));
    } catch (error) {
      if (isOptionalWorkflowPersistenceMissing(error)) {
        return persisted;
      }

      throw error;
    }
  }

  return persisted;
}

async function seedWorkflowRunContext({ run = {}, definition = {}, input = {} } = {}) {
  return persistWorkflowContextPatch({
    workflowRunRecordId: run.workflowRunRecordId,
    patch: buildInitialWorkflowContextPatch({ run, definition, input }),
    metadata: {
      contextPhase: 'initial_workflow_context',
      workflowCode: definition.workflowCode || run.workflowCode || null,
    },
  });
}

async function persistWorkflowNodeContext(nodeRun = {}) {
  if (!nodeRun?.workflowRunRecordId || !nodeRun?.workflowNodeRunRecordId || !nodeRun?.nodeKey) {
    return [];
  }

  return persistWorkflowContextPatch({
    workflowRunRecordId: nodeRun.workflowRunRecordId,
    patch: buildNodeContextPatch(nodeRun),
    sourceNodeKey: nodeRun.nodeKey,
    sourceNodeRunRecordId: nodeRun.workflowNodeRunRecordId,
    metadata: {
      contextPhase: 'node_output_context',
      nodeTypeCode: nodeRun.nodeTypeCode || null,
      targetCode: nodeRun.targetCode || null,
    },
  });
}

function isOptionalWorkflowPersistenceMissing(error) {
  return ['42P01', '42703', '42883'].includes(String(error?.code || ''));
}

function normalizeOutputKey(value, fallback = 'result') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  return normalized || fallback;
}

function getNodeOutputPersistenceSummary(output = {}) {
  return summarizeWorkflowNodeOutput(output) || output?.summary || output?.message || '';
}

function buildNodeOutputPersistenceRecords(nodeRun = {}) {
  const output = toJsonbValue(nodeRun.output || {});
  const safeOutput = getSafeObject(output);

  return [
    {
      outputKey: 'result',
      output,
      outputType: isToolResult(safeOutput) ? safeOutput.outputType : getJsonValueType(output),
      outputSummary: getNodeOutputPersistenceSummary(output || {}),
    },
  ];
}

async function persistWorkflowNodeOutput(nodeRun = {}) {
  if (!nodeRun?.workflowRunRecordId || !nodeRun?.workflowNodeRunRecordId || !nodeRun?.nodeKey) {
    return [];
  }

  const inputSnapshot = getSafeObject(nodeRun.metadata?.parameters);
  const outputRecords = buildNodeOutputPersistenceRecords(nodeRun);
  const persisted = [];

  for (const record of outputRecords) {
    try {
      const output = toJsonbValue(record.output);
      const result = await query(
        `
          INSERT INTO worker.workflow_run_node_outputs (
            workflow_run_record_id,
            workflow_node_run_record_id,
            workflow_node_id,
            node_key,
            node_type_code,
            target_code,
            output_key,
            output_type,
            input_snapshot_json,
            output_json,
            output_summary,
            status,
            attempt_count,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb)
          ON CONFLICT (workflow_node_run_record_id, output_key)
          DO UPDATE SET
            workflow_run_record_id = EXCLUDED.workflow_run_record_id,
            workflow_node_id = EXCLUDED.workflow_node_id,
            node_key = EXCLUDED.node_key,
            node_type_code = EXCLUDED.node_type_code,
            target_code = EXCLUDED.target_code,
            output_type = EXCLUDED.output_type,
            input_snapshot_json = EXCLUDED.input_snapshot_json,
            output_json = EXCLUDED.output_json,
            output_summary = EXCLUDED.output_summary,
            status = EXCLUDED.status,
            attempt_count = EXCLUDED.attempt_count,
            metadata = worker.workflow_run_node_outputs.metadata || EXCLUDED.metadata
          RETURNING *
        `,
        [
          nodeRun.workflowRunRecordId,
          nodeRun.workflowNodeRunRecordId,
          nodeRun.workflowNodeId || null,
          nodeRun.nodeKey,
          nodeRun.nodeTypeCode || null,
          nodeRun.targetCode || null,
          normalizeOutputKey(record.outputKey),
          record.outputType || getJsonValueType(output),
          JSON.stringify(inputSnapshot),
          JSON.stringify(output),
          record.outputSummary || null,
          nodeRun.status || null,
          Number.parseInt(nodeRun.attemptCount, 10) || 0,
          JSON.stringify({
            persistedBy: 'skycommand_workflow_output_persistence_v1',
            persistedAt: new Date().toISOString(),
            source: nodeRun.metadata?.temporalBacked
              ? 'temporal_workflow_activity'
              : 'inline_workflow_executor',
          }),
        ],
      );

      persisted.push(normalizeNodeOutputRow(result.rows[0]));
    } catch (error) {
      if (isOptionalWorkflowPersistenceMissing(error)) {
        return persisted;
      }

      throw error;
    }
  }

  return persisted;
}

async function getWorkflowNodeOutputsForRun(workflowRunRecordId) {
  if (!workflowRunRecordId) {
    return [];
  }

  try {
    const result = await query(
      `
        SELECT *
        FROM worker.vw_workflow_run_node_outputs
        WHERE workflow_run_record_id = $1
        ORDER BY created_at, node_key, output_key
      `,
      [workflowRunRecordId],
    );

    return result.rows.map(normalizeNodeOutputRow);
  } catch (error) {
    if (isOptionalWorkflowPersistenceMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function getWorkflowContextValuesForRun(workflowRunRecordId) {
  if (!workflowRunRecordId) {
    return [];
  }

  try {
    const result = await query(
      `
        SELECT *
        FROM worker.vw_workflow_run_context_values
        WHERE workflow_run_record_id = $1
        ORDER BY context_key
      `,
      [workflowRunRecordId],
    );

    return result.rows.map(normalizeWorkflowContextValueRow);
  } catch (error) {
    if (isOptionalWorkflowPersistenceMissing(error)) {
      return [];
    }

    throw error;
  }
}

async function listWorkflowCategories({ enabledOnly = true } = {}) {
  const result = await query(
    `
      SELECT
        workflow_category_id,
        category_code,
        display_name,
        description,
        display_order,
        enabled,
        config,
        created_at,
        updated_at
      FROM worker.workflow_categories
      ${enabledOnly ? 'WHERE enabled = TRUE' : ''}
      ORDER BY display_order, display_name, category_code
    `,
  );

  return {
    total: result.rows.length,
    items: result.rows.map(normalizeWorkflowCategoryRow),
  };
}

async function listWorkflowDefinitions({
  visibleOnly = true,
  enabledOnly = true,
  publishedOnly = true,
  activeOnly = true,
  categoryCode = '',
} = {}) {
  const clauses = [];
  const params = [];

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

  if (String(categoryCode || '').trim()) {
    params.push(normalizeWorkflowCategoryCode(categoryCode));
    clauses.push(`category_code = $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_definitions
      ${whereClause}
      ORDER BY display_name, workflow_code
    `,
    params,
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

async function getWorkflowDefinitionForVersion(workflowCode, workflowVersionId) {
  if (!workflowVersionId) {
    return getWorkflowDefinition(workflowCode);
  }

  const [definition, graph] = await Promise.all([
    getWorkflowDefinitionByCode(workflowCode),
    getWorkflowVersionGraph(workflowVersionId),
  ]);

  if (!graph) {
    throw new WorkflowServiceError('Workflow version was not found.', 404, {
      workflowCode,
      workflowVersionId,
    });
  }

  if (graph.workflowDefinitionId !== definition.workflowDefinitionId) {
    throw new WorkflowServiceError('Workflow version does not belong to the requested workflow.', 409, {
      workflowCode,
      workflowVersionId,
      workflowDefinitionId: definition.workflowDefinitionId,
      versionWorkflowDefinitionId: graph.workflowDefinitionId,
    });
  }

  return {
    ...definition,
    publishedVersionId: graph.workflowVersionId,
    publishedVersionNumber: graph.versionNumber,
    publishedVersionStatus: graph.versionStatus,
    nodes: graph.nodes || [],
    edges: graph.edges || [],
  };
}

function buildNodeParameters(node, requestInput = {}, executionContext = {}) {
  const input = getSafeObject(requestInput);
  const nodeInputs = getSafeObject(input.nodeInputs);
  const parameterOverrides = getSafeObject(input.parameterOverrides);
  const nodeOverride = getSafeObject(nodeInputs[node.nodeKey] || parameterOverrides[node.nodeKey]);
  const mergedParameters = {
    ...getSafeObject(node.inputParameters),
    ...nodeOverride,
  };

  return resolveRuntimeTemplates(
    mergedParameters,
    buildTemplateResolutionScope({
      input,
      context: executionContext,
    }),
  );
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
        executor: 'skycommand_workflow_executor_v1',
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
        workflowCategoryCode: definition.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
        workflowCategoryDisplayName: definition.categoryDisplayName || 'General',
        ...getSafeObject(metadata),
      }),
    ],
  );

  const run = normalizeRunRow(result.rows[0]);

  await seedWorkflowRunContext({
    run,
    definition,
    input: safeInput,
  });

  return run;
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
          completed_at = NULL,
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
    const existingNodeRun = normalizeNodeRunRow(existing.rows[0]);

    if (metadata?.manualNodeRecovery === true) {
      const resetResult = await query(
        `
          UPDATE worker.workflow_node_run_records
          SET status = 'RUNNING',
              attempt_count = GREATEST(attempt_count, $2),
              started_at = CURRENT_TIMESTAMP,
              completed_at = NULL,
              output = '{}'::jsonb,
              error_message = NULL,
              metadata = metadata || $3::jsonb
          WHERE workflow_node_run_record_id = $1
          RETURNING *
        `,
        [
          existingNodeRun.workflowNodeRunRecordId,
          attemptCount,
          JSON.stringify({
            ...getSafeObject(metadata),
            recoveryResetAt: new Date().toISOString(),
          }),
        ],
      );

      try {
        await query(
          `
            DELETE FROM worker.workflow_run_node_outputs
            WHERE workflow_node_run_record_id = $1
          `,
          [existingNodeRun.workflowNodeRunRecordId],
        );
        await query(
          `
            DELETE FROM worker.workflow_run_context_values
            WHERE workflow_run_record_id = $1
              AND source_node_key = $2
          `,
          [workflowRunRecordId, node.nodeKey],
        );
      } catch (error) {
        if (!isOptionalWorkflowPersistenceMissing(error)) {
          throw error;
        }
      }

      return resetResult.rows[0] ? normalizeNodeRunRow(resetResult.rows[0]) : existingNodeRun;
    }

    return existingNodeRun;
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

async function updateNodeRun({
  nodeRunRecordId,
  status,
  output = {},
  errorMessage = null,
  metadata = {},
}) {
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

  if (!result.rows[0]) {
    return null;
  }

  const nodeRun = normalizeNodeRunRow(result.rows[0]);

  if (
    ['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED'].includes(
      String(status || '').toUpperCase(),
    )
  ) {
    await persistWorkflowNodeOutput(nodeRun);
    await persistWorkflowNodeContext(nodeRun);
  }

  return nodeRun;
}

async function startWorkflowNodeRun({
  workflowRunRecordId,
  node,
  attemptCount = 1,
  metadata = {},
}) {
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

async function failWorkflowNodeRun({
  nodeRunRecordId,
  output = {},
  errorMessage = null,
  metadata = {},
}) {
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

function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(
    String(status || '')
      .trim()
      .toUpperCase(),
  );
}

function isRetryableRunStatus(status) {
  return RETRYABLE_RUN_STATUSES.has(
    String(status || '')
      .trim()
      .toUpperCase(),
  );
}

function isTemporalWorkflowNotFoundError(error) {
  const text = String(error?.message || error || '').toLowerCase();

  return (
    text.includes('not found') ||
    text.includes('workflow not found') ||
    text.includes('workflow execution already completed')
  );
}

function buildRunControlSummary({ action, run, reason, temporalWarning }) {
  const normalizedAction = String(action || '').toLowerCase();
  const label = normalizedAction === 'terminate' ? 'terminated' : 'canceled';
  const parts = [
    `Workflow ${run.workflowDisplayName || run.workflowCode} ${label} from SkyCommand Workflow History.`,
  ];

  if (reason) {
    parts.push(`Reason: ${reason}`);
  }

  if (temporalWarning) {
    parts.push(`Temporal warning: ${temporalWarning}`);
  }

  return parts.join(' ');
}

async function cancelPendingWorkflowApprovalsForRun({
  workflowRunRecordId,
  user,
  reason,
  metadata = {},
}) {
  const result = await query(
    `
      UPDATE worker.workflow_approval_requests
      SET status = 'CANCELED',
          decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP),
          decided_by_user_id = COALESCE($2, decided_by_user_id),
          decision_note = COALESCE(NULLIF($3, ''), decision_note),
          metadata = metadata || $4::jsonb
      WHERE workflow_run_record_id = $1
        AND status = 'PENDING'
      RETURNING *
    `,
    [
      workflowRunRecordId,
      user?.userId || null,
      reason || 'Run control action canceled the pending approval request.',
      JSON.stringify(getSafeObject(metadata)),
    ],
  );

  return result.rows.map((row) => camelizeRow(row));
}

async function finalizeActiveNodeRunsForRun({
  workflowRunRecordId,
  status,
  summary,
  metadata = {},
}) {
  const result = await query(
    `
      UPDATE worker.workflow_node_run_records
      SET status = $2,
          completed_at = CURRENT_TIMESTAMP,
          error_message = COALESCE(error_message, $3),
          metadata = metadata || $4::jsonb
      WHERE workflow_run_record_id = $1
        AND status IN ('QUEUED', 'RUNNING')
      RETURNING *
    `,
    [workflowRunRecordId, status, summary || null, JSON.stringify(getSafeObject(metadata))],
  );

  const nodeRuns = result.rows.map(normalizeNodeRunRow);

  await Promise.all(nodeRuns.map((nodeRun) => persistWorkflowNodeOutput(nodeRun)));

  return nodeRuns;
}

async function requestWorkflowRunControlAction({
  workflowRunRecordId,
  action,
  reason = '',
  user,
  permissions = [],
  context = {},
} = {}) {
  const normalizedAction = String(action || '')
    .trim()
    .toLowerCase();

  assertPermission({
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: `${normalizedAction || 'control'}_workflow_run`,
  });

  if (!['cancel', 'terminate'].includes(normalizedAction)) {
    throw new WorkflowServiceError('Unsupported workflow run control action.', 400, {
      action,
      allowed: ['cancel', 'terminate'],
    });
  }

  const run = await getWorkflowRunById(workflowRunRecordId);

  if (!run) {
    throw new WorkflowServiceError('Workflow run was not found.', 404, {
      workflowRunRecordId,
    });
  }

  if (!isActiveRunStatus(run.status)) {
    throw new WorkflowServiceError('Only queued or running workflow runs can be controlled.', 409, {
      workflowRunRecordId,
      status: run.status,
      action: normalizedAction,
    });
  }

  const requestedAt = new Date().toISOString();
  const normalizedReason = String(reason || '')
    .trim()
    .slice(0, 1000);
  let temporalResult = null;
  let temporalWarning = null;

  if (run.temporalWorkflowId) {
    try {
      temporalResult =
        normalizedAction === 'terminate'
          ? await temporalService.terminateWorkflow({
              workflowId: run.temporalWorkflowId,
              runId: run.temporalRunId,
              reason:
                normalizedReason || 'Terminated from SkyCommand Workflow History run controls.',
              actor: user,
            })
          : await temporalService.cancelWorkflow({
              workflowId: run.temporalWorkflowId,
              runId: run.temporalRunId,
              actor: user,
            });
    } catch (error) {
      if (!isTemporalWorkflowNotFoundError(error)) {
        throw new WorkflowServiceError(`Temporal ${normalizedAction} request failed.`, 502, {
          workflowRunRecordId,
          temporalWorkflowId: run.temporalWorkflowId,
          temporalRunId: run.temporalRunId,
          error: error.message || String(error),
        });
      }

      temporalWarning = `Temporal execution was not found; SkyCommand ledger was updated locally. ${error.message || String(error)}`;
    }
  } else {
    temporalWarning =
      'Run has no linked Temporal workflow ID; SkyCommand ledger was updated locally.';
  }

  const finalStatus = normalizedAction === 'terminate' ? 'TERMINATED' : 'CANCELED';
  const controlMetadata = {
    runControlAction: normalizedAction,
    runControlStatus: finalStatus,
    runControlRequestedAt: requestedAt,
    runControlRequestedByUserId: user?.userId || null,
    runControlRequestedByDisplayName: user?.displayName || user?.email || null,
    runControlReason: normalizedReason || null,
    temporalWorkflowId: run.temporalWorkflowId || null,
    temporalRunId: run.temporalRunId || null,
    temporalControlWarning: temporalWarning,
    temporalControlResult: temporalResult
      ? {
          action: temporalResult.action,
          workflowId: temporalResult.workflowId,
          runId: temporalResult.runId,
          requestedAt: temporalResult.requestedAt,
          namespace: temporalResult.namespace,
        }
      : null,
  };
  const summary = buildRunControlSummary({
    action: normalizedAction,
    run,
    reason: normalizedReason,
    temporalWarning,
  });
  const [nodeRuns, approvals] = await Promise.all([
    finalizeActiveNodeRunsForRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: finalStatus,
      summary,
      metadata: controlMetadata,
    }),
    cancelPendingWorkflowApprovalsForRun({
      workflowRunRecordId: run.workflowRunRecordId,
      user,
      reason: summary,
      metadata: controlMetadata,
    }),
  ]);
  const updatedRun = await updateWorkflowRun({
    workflowRunRecordId: run.workflowRunRecordId,
    status: finalStatus,
    summary,
    metadata: controlMetadata,
  });

  await recordWorkflowAuditEvent({
    user,
    context,
    eventType: 'WORKFLOW_RUN_CONTROLLED',
    resourceType: 'worker.workflow_run_records',
    resourceId: run.workflowRunRecordId,
    action: `${normalizedAction}_workflow_run`,
    success: true,
    message: summary,
    metadata: {
      workflowCode: run.workflowCode,
      workflowDisplayName: run.workflowDisplayName,
      previousStatus: run.status,
      status: finalStatus,
      reason: normalizedReason || null,
      temporalWorkflowId: run.temporalWorkflowId || null,
      temporalRunId: run.temporalRunId || null,
      temporalWarning,
    },
  });

  return {
    ok: true,
    action: normalizedAction,
    run: updatedRun,
    nodeRuns,
    approvals,
    temporalResult,
    warning: temporalWarning,
    message: summary,
  };
}

function buildRetryAttemptOffsetByNodeKey(nodeRuns = []) {
  return nodeRuns.reduce((accumulator, nodeRun) => {
    const nodeKey = String(nodeRun?.nodeKey || '').trim();
    const attemptCount = Number.parseInt(nodeRun?.attemptCount, 10);

    if (nodeKey && Number.isFinite(attemptCount) && attemptCount > 0) {
      accumulator[nodeKey] = Math.max(accumulator[nodeKey] || 0, attemptCount);
    }

    return accumulator;
  }, {});
}

function getNextManualRetryAttemptNumber(run = {}) {
  const metadata = getSafeObject(run.metadata);
  const input = getSafeObject(run.input);
  const current = Number.parseInt(metadata.retryAttemptNumber || input.retryAttemptNumber || 1, 10);

  return Number.isFinite(current) && current > 0 ? current + 1 : 2;
}

async function retryWorkflowRun({
  workflowRunRecordId,
  user,
  session,
  permissions = [],
  context = {},
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: 'retry_workflow_run',
  });

  const run = await getWorkflowRunById(workflowRunRecordId);

  if (!run) {
    throw new WorkflowServiceError('Workflow run was not found.', 404, {
      workflowRunRecordId,
    });
  }

  if (!isRetryableRunStatus(run.status)) {
    throw new WorkflowServiceError(
      'Only failed, canceled, or terminated workflow runs can be retried.',
      409,
      {
        workflowRunRecordId,
        status: run.status,
      },
    );
  }

  const previousNodeRuns = await getWorkflowNodeRunsForRun(run.workflowRunRecordId);
  const retryAttemptOffsetByNodeKey = buildRetryAttemptOffsetByNodeKey(previousNodeRuns);
  const retryAttemptNumber = getNextManualRetryAttemptNumber(run);
  const retryRequestedAt = new Date().toISOString();
  const retryInput = {
    ...getSafeObject(run.input),
    runSource: 'manual',
    triggerType: 'MANUAL',
    retryOfWorkflowRunRecordId: run.workflowRunRecordId,
    retryOfWorkflowCode: run.workflowCode,
    retryOfStatus: run.status,
    retryAttemptNumber,
    retryAttemptOffsetByNodeKey,
    retryRequestedAt,
  };

  delete retryInput.parentWorkflowRunRecordId;
  delete retryInput.parentWorkflowCode;
  delete retryInput.parentNodeKey;

  const result = await startWorkflowWithTemporal({
    workflowCode: run.workflowCode,
    input: retryInput,
    user,
    session,
    permissions,
    context,
  });

  let retryRun = result.run;

  if (retryRun?.workflowRunRecordId) {
    retryRun = await updateWorkflowRun({
      workflowRunRecordId: retryRun.workflowRunRecordId,
      status: retryRun.status || 'RUNNING',
      summary: `${retryRun.summary || result.message || 'Workflow retry started.'} Retry of run ${run.workflowRunRecordId}.`,
      metadata: {
        retryOfWorkflowRunRecordId: run.workflowRunRecordId,
        retryOfWorkflowCode: run.workflowCode,
        retryOfStatus: run.status,
        retryRequestedByUserId: user?.userId || null,
        retryAttemptNumber,
        retryAttemptOffsetByNodeKey,
        retryRequestedAt,
      },
    });
  }

  await recordWorkflowAuditEvent({
    user,
    context,
    eventType: 'WORKFLOW_RUN_RETRIED',
    resourceType: 'worker.workflow_run_records',
    resourceId: retryRun?.workflowRunRecordId || result.run?.workflowRunRecordId || null,
    action: 'retry_workflow_run',
    success: true,
    message: `Retry started for ${run.workflowDisplayName || run.workflowCode}.`,
    metadata: {
      workflowCode: run.workflowCode,
      workflowDisplayName: run.workflowDisplayName,
      originalWorkflowRunRecordId: run.workflowRunRecordId,
      originalStatus: run.status,
      retryAttemptNumber,
      retryWorkflowRunRecordId:
        retryRun?.workflowRunRecordId || result.run?.workflowRunRecordId || null,
    },
  });

  return {
    ...result,
    retried: true,
    originalRun: run,
    run: retryRun || result.run,
    message: `Retry started for ${run.workflowDisplayName || run.workflowCode}.`,
  };
}

async function getWorkflowNodeRecoveryState({ workflowRunRecordId, nodeKey } = {}) {
  const normalizedNodeKey = String(nodeKey || '').trim();

  if (!workflowRunRecordId || !normalizedNodeKey) {
    throw new WorkflowServiceError('Workflow node recovery requires a run ID and node key.', 400, {
      workflowRunRecordId,
      nodeKey: normalizedNodeKey || null,
    });
  }

  const run = await getWorkflowRunById(workflowRunRecordId);

  if (!run) {
    throw new WorkflowServiceError('Workflow run was not found.', 404, {
      workflowRunRecordId,
    });
  }

  const [nodeRuns, contextValues, definitionGraph] = await Promise.all([
    getWorkflowNodeRunsForRun(workflowRunRecordId),
    getWorkflowContextValuesForRun(workflowRunRecordId),
    getWorkflowVersionGraph(run.workflowVersionId),
  ]);
  const nodeRunIndex = nodeRuns.findIndex((nodeRun) => nodeRun.nodeKey === normalizedNodeKey);
  const nodeRun = nodeRunIndex >= 0 ? nodeRuns[nodeRunIndex] : null;
  const definitionNode = definitionGraph?.nodes?.find((node) => node.nodeKey === normalizedNodeKey) || null;

  if (!nodeRun || !definitionNode) {
    throw new WorkflowServiceError('Workflow node was not found in the selected run.', 404, {
      workflowRunRecordId,
      nodeKey: normalizedNodeKey,
    });
  }

  const laterExecutedNodeRuns = nodeRuns.slice(nodeRunIndex + 1).filter((item) =>
    ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED'].includes(
      String(item?.status || '').toUpperCase(),
    ),
  );

  return {
    run,
    nodeRun,
    definitionNode,
    priorNodeRuns: nodeRuns
      .slice(0, nodeRunIndex)
      .filter((item) => String(item?.status || '').toUpperCase() === TERMINAL_SUCCESS_STATUS),
    laterExecutedNodeRuns,
    contextValues: contextValues.filter((item) => item.sourceNodeKey !== normalizedNodeKey),
    workflowVersionId: run.workflowVersionId,
  };
}

async function retryWorkflowNode({
  workflowRunRecordId,
  nodeKey,
  user,
  session,
  permissions = [],
  context = {},
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: 'retry_workflow_node',
  });

  const recoveryState = await getWorkflowNodeRecoveryState({ workflowRunRecordId, nodeKey });
  const { run, nodeRun, definitionNode, laterExecutedNodeRuns } = recoveryState;
  const normalizedRunStatus = String(run.status || '').toUpperCase();
  const normalizedNodeStatus = String(nodeRun.status || '').toUpperCase();

  if (normalizedRunStatus !== TERMINAL_FAILURE_STATUS) {
    throw new WorkflowServiceError(
      'Failed-node recovery is available only when the workflow run is failed and no longer active.',
      409,
      {
        workflowRunRecordId,
        status: run.status,
        nodeKey: definitionNode.nodeKey,
      },
    );
  }

  if (normalizedNodeStatus !== TERMINAL_FAILURE_STATUS) {
    throw new WorkflowServiceError('Only failed workflow nodes can be manually retried.', 409, {
      workflowRunRecordId,
      nodeKey: definitionNode.nodeKey,
      nodeStatus: nodeRun.status,
    });
  }

  if (laterExecutedNodeRuns.length > 0) {
    throw new WorkflowServiceError(
      'Only the most recently executed failed node can resume this workflow safely.',
      409,
      {
        workflowRunRecordId,
        nodeKey: definitionNode.nodeKey,
        laterNodeKeys: laterExecutedNodeRuns.map((item) => item.nodeKey),
      },
    );
  }

  const definition = await getWorkflowDefinitionForVersion(run.workflowCode, run.workflowVersionId);
  const recoveryNodeIndex = definition.nodes.findIndex(
    (item) => item.nodeKey === definitionNode.nodeKey,
  );
  const recoveryDefinition = {
    ...definition,
    nodes: recoveryNodeIndex >= 0 ? definition.nodes.slice(recoveryNodeIndex) : definition.nodes,
  };

  await assertWorkflowExecutionTargetsAvailable(recoveryDefinition);

  const retryAttemptOffsetByNodeKey = buildRetryAttemptOffsetByNodeKey(
    await getWorkflowNodeRunsForRun(workflowRunRecordId),
  );
  const previousRecoveryAttempt = Number.parseInt(run.metadata?.nodeRecoveryAttemptNumber, 10);
  const nodeRecoveryAttemptNumber =
    Number.isFinite(previousRecoveryAttempt) && previousRecoveryAttempt > 0
      ? previousRecoveryAttempt + 1
      : 1;
  const requestedAt = new Date().toISOString();
  const workflowId = `skycommand-recovery-${run.workflowCode}-${String(run.workflowRunRecordId).slice(0, 8)}-${definitionNode.nodeKey}-${Date.now()}`;
  const nodeRecovery = {
    active: true,
    mode: 'FAILED_NODE_RETRY',
    nodeKey: definitionNode.nodeKey,
    nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
    nodeTypeCode: definitionNode.nodeTypeCode,
    targetCode: definitionNode.targetCode || null,
    requestedAt,
    requestedByUserId: user?.userId || null,
    requestedByDisplayName: user?.displayName || user?.email || null,
    recoveryAttemptNumber: nodeRecoveryAttemptNumber,
    previousTemporalWorkflowId: run.temporalWorkflowId || null,
    previousTemporalRunId: run.temporalRunId || null,
  };
  const recoveryInput = {
    ...getSafeObject(run.input),
    workflowId,
    workflowVersionId: run.workflowVersionId,
    retryAttemptOffsetByNodeKey,
    nodeRecovery,
  };

  let temporalStart;

  try {
    temporalStart = await temporalService.startSkyCommandWorkflowExecutorWorkflow({
      workflowCode: run.workflowCode,
      workflowRunRecordId: run.workflowRunRecordId,
      input: recoveryInput,
      actor: user,
      session,
      permissions,
      context,
    });
  } catch (error) {
    await recordWorkflowAuditEvent({
      user,
      context,
      eventType: 'WORKFLOW_NODE_RETRY_FAILED_TO_START',
      resourceType: 'worker.workflow_node_run_records',
      resourceId: nodeRun.workflowNodeRunRecordId,
      action: 'retry_workflow_node',
      success: false,
      message: `Failed to start recovery for ${definitionNode.displayName || definitionNode.nodeKey}.`,
      metadata: {
        workflowRunRecordId: run.workflowRunRecordId,
        workflowCode: run.workflowCode,
        nodeKey: definitionNode.nodeKey,
        error: error.message || String(error),
      },
    });
    throw new WorkflowServiceError('Failed to start failed-node recovery in Temporal.', 500, {
      workflowRunRecordId: run.workflowRunRecordId,
      nodeKey: definitionNode.nodeKey,
      error: error.message || String(error),
    });
  }

  const recoveryHistory = [
    ...getSafeArray(run.metadata?.nodeRecoveryHistory),
    {
      nodeKey: definitionNode.nodeKey,
      nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      requestedAt,
      requestedByUserId: user?.userId || null,
      recoveryAttemptNumber: nodeRecoveryAttemptNumber,
      previousTemporalWorkflowId: run.temporalWorkflowId || null,
      previousTemporalRunId: run.temporalRunId || null,
      temporalWorkflowId: temporalStart.workflow.workflowId || null,
      temporalRunId: temporalStart.workflow.runId || null,
    },
  ].slice(-25);
  const summary = `Retrying failed node ${definitionNode.displayName || definitionNode.nodeKey}; completed workflow nodes are preserved and execution will continue from this checkpoint.`;
  const linkedRun = await linkWorkflowRunToTemporal({
    workflowRunRecordId: run.workflowRunRecordId,
    temporalWorkflowId: temporalStart.workflow.workflowId,
    temporalRunId: temporalStart.workflow.runId,
    summary,
    metadata: {
      manualNodeRecovery: true,
      nodeRecoveryActive: true,
      nodeRecoveryNodeKey: definitionNode.nodeKey,
      nodeRecoveryNodeRunRecordId: nodeRun.workflowNodeRunRecordId,
      nodeRecoveryAttemptNumber,
      nodeRecoveryRequestedAt: requestedAt,
      nodeRecoveryRequestedByUserId: user?.userId || null,
      previousTemporalWorkflowId: run.temporalWorkflowId || null,
      previousTemporalRunId: run.temporalRunId || null,
      nodeRecoveryHistory: recoveryHistory,
      errorMessage: null,
      errorName: null,
    },
  });

  await recordWorkflowAuditEvent({
    user,
    context,
    eventType: 'WORKFLOW_NODE_RETRIED',
    resourceType: 'worker.workflow_node_run_records',
    resourceId: nodeRun.workflowNodeRunRecordId,
    action: 'retry_workflow_node',
    success: true,
    message: summary,
    metadata: {
      workflowRunRecordId: run.workflowRunRecordId,
      workflowCode: run.workflowCode,
      workflowDisplayName: run.workflowDisplayName,
      workflowVersionId: run.workflowVersionId,
      nodeKey: definitionNode.nodeKey,
      nodeTypeCode: definitionNode.nodeTypeCode,
      targetCode: definitionNode.targetCode || null,
      previousAttemptCount: nodeRun.attemptCount || 0,
      recoveryAttemptNumber: nodeRecoveryAttemptNumber,
      temporalWorkflowId: temporalStart.workflow.workflowId || null,
      temporalRunId: temporalStart.workflow.runId || null,
    },
  });

  return {
    ok: true,
    recoveryStarted: true,
    run: linkedRun || run,
    nodeRun,
    node: definitionNode,
    temporalWorkflow: temporalStart.workflow,
    message: summary,
  };
}

async function runToolNode({ node, parameters, user, session, permissions, context }) {
  const result = await scriptExecutionService.runTool({
    toolCode: node.targetCode,
    parameters,
    confirmationMode: 'WORKFLOW_AUTOMATION',
    user,
    session,
    permissions,
    context: {
      ...context,
      workflowNodeKey: node.nodeKey,
      workflowNodeType: node.nodeTypeCode,
      workflowAuthorization: {
        source: 'PUBLISHED_WORKFLOW_EXECUTION',
        interactiveConfirmationBypassed: true,
      },
    },
  });

  const toolResult =
    result.toolResult ||
    createLegacyToolResult({
      success: result.status === 'SUCCESS',
      message: result.summary,
      executionId: result.executionId,
      toolCode: node.targetCode,
      status: result.status,
      durationMs: result.durationMs,
      structuredOutputStatus: result.toolResultContract?.status || null,
      structuredOutputExpectedType: result.toolResultContract?.expectedOutputType || null,
      structuredOutputError:
        result.toolResultContract?.error?.message ||
        result.toolResultContract?.configurationWarning?.message ||
        null,
    });
  const output = {
    ...toolResult,
    kind: 'tool_execution',
    toolCode: node.targetCode,
    executionId: result.executionId,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary: toolResult.message || result.summary,
    metadata: {
      ...getSafeObject(toolResult.metadata),
      executionId: result.executionId,
      toolCode: node.targetCode,
      structuredOutputAvailable: Boolean(result.toolResult),
      resultContract: result.toolResultContract || null,
    },
  };

  if (result.status !== 'SUCCESS' || toolResult.success === false) {
    throw new WorkflowServiceError(
      toolResult.error?.message || toolResult.message || result.summary || 'Tool node failed.',
      500,
      output,
    );
  }

  return output;
}

async function runApiCallNode({ node, parameters }) {
  const method = normalizeHttpMethod(parameters.method);
  const url = translateLocalApiUrlForRuntime(parameters.url || node.targetCode);
  const authMode = normalizeApiAuthMode(parameters.authMode || 'AUTO');
  const configuredHeaders = parseJsonText(
    parameters.headersJson ?? parameters.headers,
    {},
    'headersJson',
  );
  const headers = applyApiAuthHeaders({ headers: configuredHeaders, authMode, url });
  const body = parseJsonText(parameters.bodyJson ?? parameters.body, null, 'bodyJson');
  const successCodes = parseSuccessCodes(parameters.successCodes);
  const timeoutMs = normalizePositiveNumber(parameters.timeoutMs || node.timeoutMs, 30000, 300000);
  const maxResponseBytes = normalizePositiveNumber(parameters.maxResponseBytes, 32768, 1048576);
  const startedAtMs = Date.now();

  const requestConfig = {
    method,
    url,
    headers,
    timeout: timeoutMs,
    maxContentLength: maxResponseBytes,
    maxBodyLength: maxResponseBytes,
    validateStatus: () => true,
  };

  if (!['GET', 'HEAD'].includes(method) && body !== null) {
    requestConfig.data = body;
  }

  let response;
  try {
    response = await axios(requestConfig);
  } catch (error) {
    const details = {
      kind: 'api_call',
      method,
      url,
      authMode,
      status: 'FAILED',
      durationMs: Date.now() - startedAtMs,
      errorCode: error.code || null,
      message: error.message || String(error),
    };

    throw new WorkflowServiceError(`API call failed: ${details.message}`, 500, details);
  }

  const durationMs = Date.now() - startedAtMs;
  const responsePreview = truncateJsonPreview(response.data, maxResponseBytes);
  const responseSizeBytes = Buffer.byteLength(responsePreview || '', 'utf8');
  const success = successCodes.includes(response.status);
  const output = {
    kind: 'api_call',
    method,
    url,
    authMode,
    status: success ? 'SUCCESS' : 'FAILED',
    statusCode: response.status,
    statusText: response.statusText,
    durationMs,
    responseSizeBytes,
    successCodes,
    summary: `API ${method} ${url} returned ${response.status} in ${durationMs} ms`,
    responsePreview,
  };

  if (!success) {
    throw new WorkflowServiceError(
      `API call returned unexpected status ${response.status}.`,
      response.status >= 400 ? response.status : 500,
      output,
    );
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
      runSource: parameters.runSource || 'skycommand_workflow_node',
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
  const [
    nodeTypeResult,
    toolManifest,
    workflowToolVisibilityResult,
    workflowTargetResult,
    temporalWorkflowTargetResult,
    approvalRoleResult,
    repositoryResult,
  ] = await Promise.all([
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
    query(
      `
        SELECT
          tool.tool_code,
          ARRAY_AGG(visibility.channel_code ORDER BY visibility.channel_code) AS visibility_channels
        FROM core.tools tool
        JOIN core.tool_visibility visibility
          ON visibility.tool_id = tool.tool_id
        WHERE tool.enabled = TRUE
        GROUP BY tool.tool_code
      `,
    ),
    query(
      `
        SELECT
          workflow_definition_id,
          workflow_code,
          display_name,
          description,
          category_code,
          category_display_name,
          category_display_order,
          status,
          published_node_count,
          published_edge_count
        FROM worker.vw_workflow_definitions
        WHERE enabled = TRUE
          AND visible_in_admin = TRUE
          AND status = 'ACTIVE'
          AND published_version_id IS NOT NULL
        ORDER BY display_name, workflow_code
      `,
    ),
    temporalService.listWorkflowDefinitions().catch(() => ({ items: [] })),
    query(
      `
        SELECT
          r.role_id,
          r.role_code,
          r.role_name,
          r.description,
          r.is_system_role,
          r.active,
          app.app_code,
          app.title AS app_title
        FROM auth.roles r
        JOIN core.applications app
          ON app.app_id = r.app_id
        WHERE app.app_code = 'SKYSERVER_ADMIN'
          AND app.active = TRUE
          AND r.active = TRUE
        ORDER BY r.is_system_role DESC, r.role_code
      `,
    ),
    query(
      `
        SELECT
          repo_code,
          repo_name,
          display_order
        FROM core.vw_repository_paths
        WHERE profile_code = $1
        ORDER BY display_order, repo_name, repo_code
      `,
      [PROFILE_CODE],
    ),
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

  const workflowVisibilityByToolCode = new Map(
    workflowToolVisibilityResult.rows.map((row) => [
      row.tool_code,
      new Set(getSafeArray(row.visibility_channels).map((channel) => String(channel))),
    ]),
  );
  const toolTargets = [];

  for (const category of toolManifest.categories || []) {
    for (const tool of category.tools || []) {
      const visibilityChannels = workflowVisibilityByToolCode.get(tool.toolCode) || new Set();

      if (!visibilityChannels.has('api')) {
        continue;
      }

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
        visibilityChannels: [...visibilityChannels],
        workflowEligible: true,
        parameters: tool.parameters || [],
      });
    }
  }

  const workflowTargets = workflowTargetResult.rows.map((row) => {
    const item = camelizeRow(row);

    return {
      nodeTypeCode: 'WORKFLOW',
      targetKind: 'worker.workflow_definitions',
      targetCode: item.workflowCode,
      targetRefId: item.workflowDefinitionId,
      displayName: item.displayName,
      description: item.description,
      categoryCode: item.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
      categoryDisplayName: item.categoryDisplayName || 'General',
      categoryDisplayOrder: Number(item.categoryDisplayOrder || 0),
      status: item.status,
      nodeCount: item.publishedNodeCount || 0,
      edgeCount: item.publishedEdgeCount || 0,
    };
  });

  const temporalWorkflowTargets = (temporalWorkflowTargetResult.items || []).map((definition) => ({
    nodeTypeCode: 'TEMPORAL_WORKFLOW',
    targetKind: 'worker.temporal_workflow_definitions',
    targetCode: definition.workflowCode,
    targetRefId: definition.definitionId || null,
    displayName: definition.displayName,
    description: definition.description,
    workflowType: definition.workflowType,
    taskQueue: definition.taskQueue,
    namespace: definition.namespace || null,
    defaultConcurrency: definition.defaultConcurrency,
    maxConcurrency: definition.maxConcurrency,
    defaultTimeoutMs: definition.defaultTimeoutMs,
    maxTimeoutMs: definition.maxTimeoutMs,
    permissionCode: definition.startPermissionCode,
    parameters: definition.parameters || [],
    config: definition.config || {},
  }));

  const approvalRoleTargets = approvalRoleResult.rows.map((row) => {
    const item = camelizeRow(row);

    return {
      roleId: item.roleId,
      roleCode: item.roleCode,
      roleName: item.roleName,
      displayName: item.roleName || item.roleCode,
      description: item.description,
      isSystemRole: toBoolean(item.isSystemRole),
      appCode: item.appCode,
      appTitle: item.appTitle,
    };
  });

  const repositoryOptions = repositoryResult.rows.map((row) => {
    const item = camelizeRow(row);

    return {
      value: item.repoCode,
      label: item.repoName || item.repoCode,
      repoCode: item.repoCode,
      repoName: item.repoName || item.repoCode,
      displayOrder: item.displayOrder || 0,
    };
  });

  return {
    nodeTypes,
    supportedNodeTypes: nodeTypes.filter((nodeType) => nodeType.initiallySupported),
    toolTargets,
    workflowTargets,
    temporalWorkflowTargets,
    approvalRoleTargets,
    repositoryOptions,
  };
}

function normalizeCreateNodeInput(node, index, seenKeys) {
  const nodeTypeCode = String(node.nodeTypeCode || 'TOOL')
    .trim()
    .toUpperCase();

  if (!SUPPORTED_NODE_TYPES.has(nodeTypeCode)) {
    throw new WorkflowServiceError(
      'Workflow Builder currently supports TOOL, API_CALL, WORKFLOW, TEMPORAL_WORKFLOW, CONDITION, WAIT, HUMAN_APPROVAL, and SUMMARY nodes.',
      400,
      {
        nodeTypeCode,
        supportedNodeTypes: [
          'TOOL',
          'API_CALL',
          'WORKFLOW',
          'TEMPORAL_WORKFLOW',
          'CONDITION',
          'WAIT',
          'HUMAN_APPROVAL',
          'SUMMARY',
        ],
      },
    );
  }

  let inputParameters = getSafeObject(node.inputParameters);
  const targetCode = String(
    node.targetCode ||
      node.toolCode ||
      node.workflowCode ||
      node.temporalWorkflowCode ||
      (nodeTypeCode === 'API_CALL' ? inputParameters.url || node.url || '' : ''),
  ).trim();

  if (nodeTypeCode === 'TOOL' && !targetCode) {
    throw new WorkflowServiceError('Each TOOL node requires targetCode.', 400, {
      index,
    });
  }

  if (nodeTypeCode === 'WORKFLOW' && !targetCode) {
    throw new WorkflowServiceError(
      'Each WORKFLOW node requires a child workflow targetCode.',
      400,
      {
        index,
      },
    );
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW' && !targetCode) {
    throw new WorkflowServiceError(
      'Each TEMPORAL_WORKFLOW node requires an approved Temporal workflow template targetCode.',
      400,
      {
        index,
      },
    );
  }

  if (nodeTypeCode === 'API_CALL') {
    normalizeApiUrl(inputParameters.url || targetCode);
    normalizeHttpMethod(inputParameters.method || 'GET');
    normalizeApiAuthMode(inputParameters.authMode || 'AUTO');
    parseJsonText(
      inputParameters.headersJson ?? inputParameters.headers,
      {},
      `nodes[${index}].headersJson`,
    );
    parseJsonText(
      inputParameters.bodyJson ?? inputParameters.body,
      null,
      `nodes[${index}].bodyJson`,
    );
  }

  if (nodeTypeCode === 'CONDITION') {
    normalizeConditionParameters(inputParameters);
  }

  if (nodeTypeCode === 'WAIT') {
    normalizeWaitParameters(inputParameters);
  }

  if (nodeTypeCode === 'HUMAN_APPROVAL') {
    normalizeHumanApprovalParameters(inputParameters, node);
  }

  if (nodeTypeCode === 'SUMMARY') {
    inputParameters = normalizeSummaryParameters(inputParameters);
  }

  const nodeKeyBase = normalizeNodeKey(
    node.nodeKey || node.displayName || targetCode || `${nodeTypeCode.toLowerCase()}_${index + 1}`,
    `node_${index + 1}`,
  );
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
    displayName: String(
      node.displayName || node.label || targetCode || getNodeDisplayNameForType(nodeTypeCode),
    ).trim(),
    description: String(node.description || '').trim() || null,
    targetCode: targetCode || null,
    inputParameters,
    retryPolicy: normalizeWorkflowNodeRetryPolicy(node.retryPolicy),
    timeoutMs: normalizeWorkflowNodeTimeoutMs(node.timeoutMs),
    positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 80 + index * 280,
    positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 120,
    displayOrder: Number.isFinite(Number(node.displayOrder))
      ? Number(node.displayOrder)
      : (index + 1) * 10,
    enabled: node.enabled !== false,
    config: getSafeObject(node.config, {
      builderCard:
        nodeTypeCode === 'API_CALL'
          ? 'api'
          : nodeTypeCode === 'WORKFLOW'
            ? 'workflow'
            : nodeTypeCode === 'TEMPORAL_WORKFLOW'
              ? 'temporal'
              : nodeTypeCode === 'CONDITION'
                ? 'condition'
                : nodeTypeCode === 'WAIT'
                  ? 'wait'
                  : nodeTypeCode === 'HUMAN_APPROVAL'
                    ? 'human_approval'
                    : nodeTypeCode === 'SUMMARY'
                      ? 'summary'
                      : 'tool',
    }),
  };
}

async function insertWorkflowEdges({
  client,
  workflowVersionId,
  insertedNodes = [],
  createdBy = 'workflow_builder_v1',
} = {}) {
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
        JSON.stringify({ label: 'then', createdBy }),
      ],
    );
    edges.push(camelizeRow(edgeResult.rows[0]));
  }

  const nodesByKey = new Map(insertedNodes.map((node) => [node.nodeKey, node]));

  for (let index = 0; index < insertedNodes.length; index += 1) {
    const fromNode = insertedNodes[index];

    if (fromNode.nodeTypeCode !== 'CONDITION') {
      continue;
    }

    const parameters = normalizeConditionParameters(fromNode.inputParameters || {});
    const branchTargets = [
      { branchLabel: 'TRUE', targetNodeKey: parameters.trueTargetNodeKey },
      { branchLabel: 'FALSE', targetNodeKey: parameters.falseTargetNodeKey },
    ].filter((branch) => Boolean(branch.targetNodeKey));

    for (const branch of branchTargets) {
      const toNode = nodesByKey.get(branch.targetNodeKey);

      if (!toNode) {
        continue;
      }

      const edgeResult = await client.query(
        `
          INSERT INTO worker.workflow_edges (
            workflow_version_id,
            edge_key,
            from_node_id,
            to_node_id,
            edge_type,
            condition_expression,
            display_order,
            config
          )
          VALUES ($1, $2, $3, $4, 'CONDITIONAL', $5, $6, $7::jsonb)
          RETURNING *
        `,
        [
          workflowVersionId,
          `${fromNode.nodeKey}_${branch.branchLabel.toLowerCase()}_to_${toNode.nodeKey}`,
          fromNode.workflowNodeId,
          toNode.workflowNodeId,
          branch.branchLabel,
          (index + 1) * 10 + (branch.branchLabel === 'TRUE' ? 1 : 2),
          JSON.stringify({
            label: `${branch.branchLabel.toLowerCase()} branch`,
            branch: branch.branchLabel,
            conditionNodeKey: fromNode.nodeKey,
            createdBy,
          }),
        ],
      );
      edges.push(camelizeRow(edgeResult.rows[0]));
    }
  }

  return edges;
}

function getCloneableWorkflowConfig(config = {}) {
  const sourceConfig = { ...getSafeObject(config) };

  // These fields describe the source definition's authoring lifecycle rather than
  // executable workflow behavior. The clone receives fresh provenance below.
  delete sourceConfig.createdBy;
  delete sourceConfig.updatedBy;
  delete sourceConfig.lastVersionCreatedBy;
  delete sourceConfig.clonedFromWorkflowCode;
  delete sourceConfig.runtimeParameters;

  return sourceConfig;
}

async function createWorkflowDefinition({
  payload = {},
  user,
  permissions = [],
  definitionDefaults = {},
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CREATE_PERMISSION,
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
  assertWorkflowParameterDefinitionLimit(payload.runtimeParameters);
  const runtimeParameters = normalizeWorkflowParameterDefinitions(payload.runtimeParameters);
  const baseDefinitionConfig = getSafeObject(definitionDefaults.config);
  const categoryCode = normalizeWorkflowCategoryCode(
    payload.categoryCode || definitionDefaults.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
  );
  const startPermissionCode =
    String(definitionDefaults.startPermissionCode || DEFAULT_START_PERMISSION).trim() ||
    DEFAULT_START_PERMISSION;
  const cancelPermissionCode =
    String(definitionDefaults.cancelPermissionCode || DEFAULT_CANCEL_PERMISSION).trim() ||
    DEFAULT_CANCEL_PERMISSION;

  if (!workflowCode) {
    throw new WorkflowServiceError('workflowCode or displayName is required.', 400);
  }

  if (!displayName) {
    throw new WorkflowServiceError('displayName is required.', 400);
  }

  if (nodesInput.length === 0) {
    throw new WorkflowServiceError('At least one supported workflow node is required.', 400);
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

    const category = await resolveWorkflowCategory(client, categoryCode);
    const { toolsByCode, workflowDefinitionsByCode, temporalDefinitionsByCode } =
      await validateWorkflowTargets(client, nodes, { parentWorkflowCode: workflowCode });

    const definitionResult = await client.query(
      `
        INSERT INTO worker.workflow_definitions (
          workflow_category_id,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
        RETURNING *
      `,
      [
        category.workflowCategoryId,
        workflowCode,
        displayName,
        description,
        publish ? 'ACTIVE' : 'INACTIVE',
        visibleInAdmin,
        enabled,
        startPermissionCode,
        cancelPermissionCode,
        JSON.stringify({
          ...baseDefinitionConfig,
          createdBy: definitionDefaults.clonedFromWorkflowCode
            ? 'workflow_clone_v1'
            : 'workflow_builder_v1',
          builderVersion: '10.25',
          supportedNodeTypes: [
            'TOOL',
            'API_CALL',
            'WORKFLOW',
            'TEMPORAL_WORKFLOW',
            'CONDITION',
            'WAIT',
            'HUMAN_APPROVAL',
            'SUMMARY',
          ],
          ...(definitionDefaults.clonedFromWorkflowCode
            ? { clonedFromWorkflowCode: definitionDefaults.clonedFromWorkflowCode }
            : {}),
          runtimeParameters,
        }),
        user?.userId || null,
      ],
    );
    const definition = {
      ...normalizeDefinitionRow(definitionResult.rows[0]),
      categoryCode: category.categoryCode,
      categoryDisplayName: category.displayName,
      categoryDescription: category.description,
      categoryDisplayOrder: category.displayOrder,
      categoryEnabled: category.enabled,
    };

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
      const tool = node.nodeTypeCode === 'TOOL' ? toolsByCode.get(node.targetCode) : null;
      const childWorkflow =
        node.nodeTypeCode === 'WORKFLOW' ? workflowDefinitionsByCode.get(node.targetCode) : null;
      const temporalDefinition =
        node.nodeTypeCode === 'TEMPORAL_WORKFLOW'
          ? temporalDefinitionsByCode.get(node.targetCode)
          : null;
      const targetRefId =
        tool?.tool_id ||
        childWorkflow?.workflow_definition_id ||
        temporalDefinition?.definition_id ||
        null;
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
          targetRefId,
          JSON.stringify(
            assertJsonObject(
              node.inputParameters,
              `nodes[${insertedNodes.length}].inputParameters`,
            ),
          ),
          JSON.stringify(getSafeObject(node.retryPolicy)),
          node.timeoutMs,
          node.positionX,
          node.positionY,
          node.displayOrder,
          node.enabled,
          JSON.stringify(getSafeObject(node.config)),
        ],
      );

      insertedNodes.push(
        normalizeNodeRow({
          ...nodeResult.rows[0],
          workflow_definition_id: definition.workflowDefinitionId,
          workflow_code: definition.workflowCode,
          workflow_display_name: definition.displayName,
          version_number: 1,
          version_status: publish ? 'PUBLISHED' : 'DRAFT',
          node_type_display_name: getNodeDisplayNameForType(node.nodeTypeCode),
          node_type_category: getNodeCategoryForType(node.nodeTypeCode),
          target_kind: getNodeTargetKindForType(node.nodeTypeCode),
        }),
      );
    }

    const edges = await insertWorkflowEdges({
      client,
      workflowVersionId,
      insertedNodes,
      createdBy: 'workflow_builder_v1',
    });

    await client.query(
      `
        UPDATE worker.workflow_versions
        SET definition_snapshot = $2::jsonb
        WHERE workflow_version_id = $1
      `,
      [
        workflowVersionId,
        JSON.stringify(
          buildDefinitionSnapshot({
            definition,
            nodes: insertedNodes,
            edges,
            status: publish ? 'PUBLISHED' : 'DRAFT',
          }),
        ),
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

async function getWorkflowVersionMeta(workflowVersionId) {
  if (!workflowVersionId) {
    return null;
  }

  const result = await query(
    `
      SELECT
        workflow_version_id,
        workflow_definition_id,
        version_number,
        version_label,
        status,
        graph_version,
        definition_snapshot,
        created_by_user_id,
        published_by_user_id,
        published_at,
        created_at,
        updated_at
      FROM worker.workflow_versions
      WHERE workflow_version_id = $1
      LIMIT 1
    `,
    [workflowVersionId],
  );

  return result.rows[0] ? camelizeRow(result.rows[0]) : null;
}

async function getWorkflowVersionGraph(workflowVersionId) {
  if (!workflowVersionId) {
    return null;
  }

  const [version, nodes, edges] = await Promise.all([
    getWorkflowVersionMeta(workflowVersionId),
    getWorkflowNodes(workflowVersionId),
    getWorkflowEdges(workflowVersionId),
  ]);

  if (!version) {
    return null;
  }

  return {
    workflowVersionId: version.workflowVersionId,
    workflowDefinitionId: version.workflowDefinitionId,
    versionNumber: version.versionNumber,
    versionLabel: version.versionLabel,
    versionStatus: version.status,
    graphVersion: version.graphVersion,
    definitionSnapshot: version.definitionSnapshot || {},
    publishedAt: version.publishedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    nodes,
    edges,
  };
}

async function getLatestDraftWorkflowVersion(workflowDefinitionId) {
  const result = await query(
    `
      SELECT workflow_version_id
      FROM worker.workflow_versions
      WHERE workflow_definition_id = $1
        AND status = 'DRAFT'
      ORDER BY version_number DESC
      LIMIT 1
    `,
    [workflowDefinitionId],
  );

  return result.rows[0]?.workflow_version_id || null;
}

async function getWorkflowEditGuardrails(workflowDefinitionId) {
  const [runResult, approvalResult, scheduleResult] = await Promise.all([
    query(
      `
        SELECT COUNT(*)::INTEGER AS active_count
        FROM worker.workflow_run_records
        WHERE workflow_definition_id = $1
          AND status IN ('QUEUED', 'RUNNING')
      `,
      [workflowDefinitionId],
    ),
    query(
      `
        SELECT COUNT(*)::INTEGER AS pending_count
        FROM worker.workflow_approval_requests
        WHERE workflow_definition_id = $1
          AND status = 'PENDING'
      `,
      [workflowDefinitionId],
    ).catch(() => ({ rows: [{ pending_count: 0 }] })),
    query(
      `
        SELECT COUNT(*)::INTEGER AS active_count
        FROM worker.schedules s
        JOIN core.tools t
          ON t.tool_id = s.tool_id
        JOIN worker.workflow_definitions d
          ON d.workflow_code = COALESCE(NULLIF(s.parameters ->> 'workflowCode', ''), NULLIF(s.parameters ->> 'workflow_code', ''))
        WHERE d.workflow_definition_id = $1
          AND t.tool_code = 'skyserver_workflow_start'
          AND s.enabled = TRUE
      `,
      [workflowDefinitionId],
    ).catch(() => ({ rows: [{ active_count: 0 }] })),
  ]);

  const activeRuns = Number(runResult.rows[0]?.active_count || 0);
  const pendingApprovals = Number(approvalResult.rows[0]?.pending_count || 0);
  const activeSchedules = Number(scheduleResult.rows[0]?.active_count || 0);

  return {
    activeRuns,
    pendingApprovals,
    activeSchedules,
    hasWarnings: activeRuns > 0 || pendingApprovals > 0 || activeSchedules > 0,
    warnings: [
      activeRuns > 0 ? `${activeRuns} active workflow run(s) are still queued or running.` : null,
      pendingApprovals > 0
        ? `${pendingApprovals} pending approval request(s) are waiting for a decision.`
        : null,
      activeSchedules > 0 ? `${activeSchedules} active schedule(s) can start this workflow.` : null,
    ].filter(Boolean),
  };
}

async function getWorkflowDefinitionForManage(workflowCode) {
  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const draftVersionId = await getLatestDraftWorkflowVersion(definition.workflowDefinitionId);
  const [versions, latestGraph, publishedGraph, draftGraph, guardrails] = await Promise.all([
    listWorkflowVersions(definition.workflowDefinitionId),
    getWorkflowVersionGraph(definition.latestVersionId),
    getWorkflowVersionGraph(definition.publishedVersionId),
    getWorkflowVersionGraph(draftVersionId),
    getWorkflowEditGuardrails(definition.workflowDefinitionId),
  ]);
  const editGraph = draftGraph || publishedGraph || latestGraph;

  return {
    ...definition,
    versions,
    latestGraph,
    publishedGraph,
    draftGraph,
    editGraph,
    guardrails,
    editing: {
      mode: draftGraph ? 'DRAFT' : 'PUBLISHED_READONLY',
      isDraft: Boolean(draftGraph),
      workflowVersionId: editGraph?.workflowVersionId || null,
      versionNumber: editGraph?.versionNumber || null,
      versionStatus: editGraph?.versionStatus || null,
      updatedAt: editGraph?.updatedAt || null,
      publishedVersionId: publishedGraph?.workflowVersionId || null,
      publishedVersionNumber: publishedGraph?.versionNumber || null,
      draftVersionId: draftGraph?.workflowVersionId || null,
      draftVersionNumber: draftGraph?.versionNumber || null,
    },
    nodes: editGraph?.nodes || [],
    edges: editGraph?.edges || [],
  };
}

function normalizeWorkflowStatus(value, fallback = 'ACTIVE') {
  const status = String(value || fallback)
    .trim()
    .toUpperCase();
  const allowed = new Set(['ACTIVE', 'INACTIVE']);

  if (!allowed.has(status)) {
    throw new WorkflowServiceError('Invalid workflow status.', 400, {
      status,
      allowed: [...allowed],
    });
  }

  return status;
}

async function updateWorkflowDefinition({
  workflowCode,
  payload = {},
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
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
  const nextCategory = Object.prototype.hasOwnProperty.call(payload, 'categoryCode')
    ? await resolveWorkflowCategory(pool, payload.categoryCode)
    : null;
  const configPatch = { updatedBy: 'workflow_manager_v1' };

  if (Object.prototype.hasOwnProperty.call(payload, 'runtimeParameters')) {
    assertWorkflowParameterDefinitionLimit(payload.runtimeParameters);
    configPatch.runtimeParameters = normalizeWorkflowParameterDefinitions(
      payload.runtimeParameters,
    );
  }

  await query(
    `
      UPDATE worker.workflow_definitions
      SET display_name = $2,
          description = $3,
          status = $4,
          enabled = $5,
          visible_in_admin = $6,
          workflow_category_id = COALESCE($7, workflow_category_id),
          updated_by_user_id = $8,
          config = config || $9::jsonb
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
      nextCategory?.workflowCategoryId || null,
      user?.userId || null,
      JSON.stringify(configPatch),
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
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
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
    throw new WorkflowServiceError(
      'Workflow cannot be deleted while it has queued or running executions.',
      409,
      {
        workflowCode: existing.workflowCode,
        activeRuns: Number(activeRuns.rows[0]?.active_count || 0),
      },
    );
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

function validateConditionBranchTargets(nodes = []) {
  const nodeKeyToIndex = new Map();

  nodes.forEach((node, index) => {
    nodeKeyToIndex.set(node.nodeKey, index);
  });

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    if (node.nodeTypeCode !== 'CONDITION') {
      continue;
    }

    const parameters = normalizeConditionParameters(node.inputParameters || {});
    const trueTargetNodeKey = normalizeConditionBranchTargetNodeKey(parameters.trueTargetNodeKey);
    const falseTargetNodeKey = normalizeConditionBranchTargetNodeKey(parameters.falseTargetNodeKey);
    const branchTargets = [
      ['TRUE', trueTargetNodeKey],
      ['FALSE', falseTargetNodeKey],
    ].filter(([, targetNodeKey]) => Boolean(targetNodeKey));

    if (trueTargetNodeKey && falseTargetNodeKey && trueTargetNodeKey === falseTargetNodeKey) {
      throw new WorkflowServiceError(
        'Condition true and false branches must target different nodes in Branching v1.',
        400,
        {
          nodeKey: node.nodeKey,
          targetNodeKey: trueTargetNodeKey,
        },
      );
    }

    for (const [branchLabel, targetNodeKey] of branchTargets) {
      if (!nodeKeyToIndex.has(targetNodeKey)) {
        throw new WorkflowServiceError(
          'Condition branch target node was not found in this workflow graph.',
          400,
          {
            nodeKey: node.nodeKey,
            branchLabel,
            targetNodeKey,
          },
        );
      }

      const targetIndex = nodeKeyToIndex.get(targetNodeKey);

      if (targetIndex <= index) {
        throw new WorkflowServiceError(
          'Condition branch targets must point to later nodes in the sequential lane.',
          400,
          {
            nodeKey: node.nodeKey,
            branchLabel,
            targetNodeKey,
            currentDisplayOrder: index + 1,
            targetDisplayOrder: targetIndex + 1,
          },
        );
      }
    }
  }
}

function validateHumanApprovalBranchTargets(nodes = []) {
  const nodeKeyToIndex = new Map();

  nodes.forEach((node, index) => {
    nodeKeyToIndex.set(node.nodeKey, index);
  });

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    if (node.nodeTypeCode !== 'HUMAN_APPROVAL') {
      continue;
    }

    const targetNodeKey = normalizeConditionBranchTargetNodeKey(
      node.inputParameters?.rejectTargetNodeKey || node.inputParameters?.rejectionTargetNodeKey,
    );

    if (!targetNodeKey) {
      continue;
    }

    if (!nodeKeyToIndex.has(targetNodeKey)) {
      throw new WorkflowServiceError(
        'Human approval rejection branch target node was not found in this workflow graph.',
        400,
        {
          nodeKey: node.nodeKey,
          targetNodeKey,
        },
      );
    }

    const targetIndex = nodeKeyToIndex.get(targetNodeKey);

    if (targetIndex <= index) {
      throw new WorkflowServiceError(
        'Human approval rejection branch targets must point to later nodes in the sequential lane.',
        400,
        {
          nodeKey: node.nodeKey,
          targetNodeKey,
          currentDisplayOrder: index + 1,
          targetDisplayOrder: targetIndex + 1,
        },
      );
    }
  }
}

async function validateWorkflowTargets(client, nodes, { parentWorkflowCode = null } = {}) {
  validateConditionBranchTargets(nodes);
  validateHumanApprovalBranchTargets(nodes);

  const toolTargetCodes = [
    ...new Set(nodes.filter((node) => node.nodeTypeCode === 'TOOL').map((node) => node.targetCode)),
  ];
  const workflowTargetCodes = [
    ...new Set(
      nodes.filter((node) => node.nodeTypeCode === 'WORKFLOW').map((node) => node.targetCode),
    ),
  ];
  const temporalWorkflowTargetCodes = [
    ...new Set(
      nodes
        .filter((node) => node.nodeTypeCode === 'TEMPORAL_WORKFLOW')
        .map((node) => node.targetCode),
    ),
  ];
  const approvalRoleCodes = [
    ...new Set(
      nodes
        .filter((node) => node.nodeTypeCode === 'HUMAN_APPROVAL')
        .map((node) =>
          normalizeRoleCode(
            node.inputParameters?.requiredRoleCode || node.inputParameters?.requiredRole,
          ),
        )
        .filter(Boolean),
    ),
  ];
  const normalizedParentWorkflowCode = String(parentWorkflowCode || '').trim();

  if (normalizedParentWorkflowCode && workflowTargetCodes.includes(normalizedParentWorkflowCode)) {
    throw new WorkflowServiceError(
      'A workflow cannot directly contain itself as a child workflow node.',
      400,
      {
        workflowCode: normalizedParentWorkflowCode,
      },
    );
  }

  let toolsByCode = new Map();
  let workflowDefinitionsByCode = new Map();
  let temporalDefinitionsByCode = new Map();

  if (toolTargetCodes.length > 0) {
    const toolResult = await client.query(
      `
        SELECT
          tool.tool_id,
          tool.tool_code,
          tool.label,
          tool.description,
          COALESCE(BOOL_OR(visibility.channel_code = 'admin-web'), FALSE) AS visible_in_admin_web,
          COALESCE(BOOL_OR(visibility.channel_code = 'api'), FALSE) AS visible_in_api
        FROM core.tools tool
        LEFT JOIN core.tool_visibility visibility
          ON visibility.tool_id = tool.tool_id
        WHERE tool.tool_code = ANY($1::text[])
          AND tool.enabled = TRUE
        GROUP BY tool.tool_id, tool.tool_code, tool.label, tool.description
      `,
      [toolTargetCodes],
    );
    toolsByCode = new Map(toolResult.rows.map((row) => [row.tool_code, row]));
    const missingTools = toolTargetCodes.filter((targetCode) => !toolsByCode.has(targetCode));

    if (missingTools.length > 0) {
      throw new WorkflowServiceError(
        'One or more tool targets were not found or are disabled.',
        400,
        {
          missingTools,
        },
      );
    }

    const workflowIneligibleTools = toolTargetCodes.filter((targetCode) => {
      const tool = toolsByCode.get(targetCode);
      return !toBoolean(tool?.visible_in_admin_web) || !toBoolean(tool?.visible_in_api);
    });

    if (workflowIneligibleTools.length > 0) {
      throw new WorkflowServiceError(
        'One or more tool targets are not visible in both Admin-Web and API, so they cannot be used in workflows.',
        400,
        {
          workflowIneligibleTools,
          requiredVisibilityChannels: ['admin-web', 'api'],
        },
      );
    }
  }

  if (workflowTargetCodes.length > 0) {
    const workflowResult = await client.query(
      `
        SELECT workflow_definition_id, workflow_code
        FROM worker.vw_workflow_definitions
        WHERE workflow_code = ANY($1::text[])
          AND enabled = TRUE
          AND visible_in_admin = TRUE
          AND status = 'ACTIVE'
          AND published_version_id IS NOT NULL
      `,
      [workflowTargetCodes],
    );
    workflowDefinitionsByCode = new Map(workflowResult.rows.map((row) => [row.workflow_code, row]));
    const missingWorkflows = workflowTargetCodes.filter(
      (targetCode) => !workflowDefinitionsByCode.has(targetCode),
    );

    if (missingWorkflows.length > 0) {
      throw new WorkflowServiceError(
        'One or more child workflow targets were not found, inactive, or unpublished.',
        400,
        {
          missingWorkflows,
        },
      );
    }

    if (normalizedParentWorkflowCode) {
      const cycleResult = await client.query(
        `
          WITH RECURSIVE workflow_walk AS (
            SELECT
              d.workflow_code,
              ARRAY[d.workflow_code]::text[] AS path
            FROM worker.vw_workflow_definitions d
            WHERE d.workflow_code = ANY($1::text[])
              AND d.enabled = TRUE
              AND d.visible_in_admin = TRUE
              AND d.status = 'ACTIVE'
              AND d.published_version_id IS NOT NULL

            UNION ALL

            SELECT
              child.workflow_code,
              workflow_walk.path || child.workflow_code
            FROM workflow_walk
            JOIN worker.vw_workflow_definitions parent
              ON parent.workflow_code = workflow_walk.workflow_code
            JOIN worker.workflow_nodes node
              ON node.workflow_version_id = parent.published_version_id
             AND node.node_type_code = 'WORKFLOW'
             AND node.enabled = TRUE
            JOIN worker.vw_workflow_definitions child
              ON child.workflow_code = node.target_code
             AND child.enabled = TRUE
             AND child.visible_in_admin = TRUE
             AND child.status = 'ACTIVE'
             AND child.published_version_id IS NOT NULL
            WHERE NOT child.workflow_code = ANY(workflow_walk.path)
          )
          SELECT workflow_code, path
          FROM workflow_walk
          WHERE workflow_code = $2
          LIMIT 1
        `,
        [workflowTargetCodes, normalizedParentWorkflowCode],
      );

      if (cycleResult.rowCount > 0) {
        throw new WorkflowServiceError(
          'Child workflow relationship would create a workflow cycle.',
          400,
          {
            workflowCode: normalizedParentWorkflowCode,
            childWorkflowTargets: workflowTargetCodes,
            cyclePath: cycleResult.rows[0].path,
          },
        );
      }
    }
  }

  if (temporalWorkflowTargetCodes.length > 0) {
    const temporalResult = await client.query(
      `
        SELECT definition_id, workflow_code, workflow_type, display_name
        FROM worker.vw_temporal_workflow_definitions
        WHERE workflow_code = ANY($1::text[])
          AND enabled = TRUE
          AND visible_in_admin = TRUE
      `,
      [temporalWorkflowTargetCodes],
    );
    temporalDefinitionsByCode = new Map(temporalResult.rows.map((row) => [row.workflow_code, row]));
    const missingTemporalWorkflows = temporalWorkflowTargetCodes.filter(
      (targetCode) => !temporalDefinitionsByCode.has(targetCode),
    );

    if (missingTemporalWorkflows.length > 0) {
      throw new WorkflowServiceError(
        'One or more Temporal workflow template targets were not found, disabled, or hidden.',
        400,
        {
          missingTemporalWorkflows,
        },
      );
    }
  }

  if (approvalRoleCodes.length > 0) {
    const approvalRoleResult = await client.query(
      `
        SELECT r.role_code
        FROM auth.roles r
        JOIN core.applications app
          ON app.app_id = r.app_id
        WHERE app.app_code = 'SKYSERVER_ADMIN'
          AND app.active = TRUE
          AND r.active = TRUE
          AND r.role_code = ANY($1::text[])
      `,
      [approvalRoleCodes],
    );
    const approvalRolesByCode = new Map(approvalRoleResult.rows.map((row) => [row.role_code, row]));
    const missingApprovalRoles = approvalRoleCodes.filter(
      (roleCode) => !approvalRolesByCode.has(roleCode),
    );

    if (missingApprovalRoles.length > 0) {
      throw new WorkflowServiceError(
        'One or more human approval roles were not found or are inactive.',
        400,
        {
          missingApprovalRoles,
        },
      );
    }
  }

  return {
    toolsByCode,
    workflowDefinitionsByCode,
    temporalDefinitionsByCode,
  };
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
  const { toolsByCode, workflowDefinitionsByCode, temporalDefinitionsByCode } =
    await validateWorkflowTargets(client, nodes, { parentWorkflowCode: definition.workflowCode });
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
    const tool = node.nodeTypeCode === 'TOOL' ? toolsByCode.get(node.targetCode) : null;
    const childWorkflow =
      node.nodeTypeCode === 'WORKFLOW' ? workflowDefinitionsByCode.get(node.targetCode) : null;
    const temporalDefinition =
      node.nodeTypeCode === 'TEMPORAL_WORKFLOW'
        ? temporalDefinitionsByCode.get(node.targetCode)
        : null;
    const targetRefId =
      tool?.tool_id ||
      childWorkflow?.workflow_definition_id ||
      temporalDefinition?.definition_id ||
      null;
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
        targetRefId,
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

    insertedNodes.push(
      normalizeNodeRow({
        ...nodeResult.rows[0],
        workflow_definition_id: definition.workflowDefinitionId,
        workflow_code: definition.workflowCode,
        workflow_display_name: definition.displayName,
        version_number: versionNumber,
        version_status: status,
        node_type_display_name: getNodeDisplayNameForType(node.nodeTypeCode),
        node_type_category: getNodeCategoryForType(node.nodeTypeCode),
        target_kind: getNodeTargetKindForType(node.nodeTypeCode),
      }),
    );
  }

  const edges = await insertWorkflowEdges({
    client,
    workflowVersionId,
    insertedNodes,
    createdBy: 'workflow_manager_v1',
  });

  await client.query(
    `
      UPDATE worker.workflow_versions
      SET definition_snapshot = $2::jsonb
      WHERE workflow_version_id = $1
    `,
    [
      workflowVersionId,
      JSON.stringify(
        buildDefinitionSnapshot({
          definition,
          nodes: insertedNodes,
          edges,
          status,
        }),
      ),
    ],
  );

  return {
    workflowVersionId,
    nodes: insertedNodes,
    edges,
  };
}

function assertWorkflowVersionMatchesDefinition(version, definition, action) {
  if (!version || version.workflowDefinitionId !== definition.workflowDefinitionId) {
    throw new WorkflowServiceError(
      'Workflow version does not belong to this workflow definition.',
      404,
      {
        action,
        workflowCode: definition.workflowCode,
        workflowVersionId: version?.workflowVersionId,
      },
    );
  }
}

function assertVersionFresh({ version, payload = {}, action }) {
  const expectedVersionId = String(
    payload.baseWorkflowVersionId || payload.workflowVersionId || '',
  ).trim();

  if (expectedVersionId && expectedVersionId !== version.workflowVersionId) {
    throw new WorkflowServiceError(
      'Workflow version changed before this request was saved. Refresh before editing.',
      409,
      {
        action,
        expectedVersionId,
        currentVersionId: version.workflowVersionId,
      },
    );
  }

  if (payload.baseUpdatedAt && version.updatedAt) {
    const expectedTime = new Date(payload.baseUpdatedAt).getTime();
    const currentTime = new Date(version.updatedAt).getTime();

    if (
      Number.isFinite(expectedTime) &&
      Number.isFinite(currentTime) &&
      currentTime > expectedTime + 1000
    ) {
      throw new WorkflowServiceError(
        'Workflow draft changed since you opened it. Refresh before saving.',
        409,
        {
          action,
          baseUpdatedAt: payload.baseUpdatedAt,
          currentUpdatedAt: version.updatedAt,
        },
      );
    }
  }
}

async function createWorkflowDraftVersion({
  workflowCode,
  payload = {},
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
    permissions,
    action: 'create_workflow_draft',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const existingDraftVersionId = await getLatestDraftWorkflowVersion(
    definition.workflowDefinitionId,
  );

  if (existingDraftVersionId && payload.reuseExisting !== false) {
    const managed = await getWorkflowDefinitionForManage(definition.workflowCode);
    return {
      ...managed,
      draftReused: true,
      message: `Existing draft v${managed.editing?.draftVersionNumber || ''} is ready for editing.`,
    };
  }

  const sourceVersionId =
    payload.sourceWorkflowVersionId || definition.publishedVersionId || definition.latestVersionId;
  const sourceGraph = sourceVersionId ? await getWorkflowVersionGraph(sourceVersionId) : null;
  const rawNodes = versionNodesToCreateInput(sourceGraph?.nodes || []);

  if (rawNodes.length === 0) {
    throw new WorkflowServiceError(
      'Cannot create a draft because the source workflow version has no nodes.',
      400,
      {
        workflowCode: definition.workflowCode,
        sourceVersionId,
      },
    );
  }

  const seenKeys = new Set();
  const normalizedNodes = rawNodes.map((node, index) =>
    normalizeCreateNodeInput(node, index, seenKeys),
  );
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (existingDraftVersionId && payload.reuseExisting === false) {
      await client.query(
        `
          DELETE FROM worker.workflow_versions
          WHERE workflow_version_id = $1
            AND workflow_definition_id = $2
            AND status = 'DRAFT'
        `,
        [existingDraftVersionId, definition.workflowDefinitionId],
      );
    }

    const versionNumberResult = await client.query(
      `
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version_number
        FROM worker.workflow_versions
        WHERE workflow_definition_id = $1
      `,
      [definition.workflowDefinitionId],
    );
    const versionNumber = Number(versionNumberResult.rows[0]?.next_version_number || 1);

    await insertWorkflowVersionGraph({
      client,
      definition,
      versionNumber,
      versionLabel: payload.versionLabel || `Draft v${versionNumber}`,
      status: 'DRAFT',
      nodes: normalizedNodes,
      user,
    });

    await client.query(
      `
        UPDATE worker.workflow_definitions
        SET updated_by_user_id = $2,
            config = config || $3::jsonb
        WHERE workflow_definition_id = $1
      `,
      [
        definition.workflowDefinitionId,
        user?.userId || null,
        JSON.stringify({ lastDraftCreatedBy: 'workflow_manager_guardrails_v1' }),
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

async function saveWorkflowDraftGraph({
  workflowCode,
  workflowVersionId,
  payload = {},
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
    permissions,
    action: 'save_workflow_draft_graph',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const draftVersion = await getWorkflowVersionMeta(workflowVersionId);
  assertWorkflowVersionMatchesDefinition(draftVersion, definition, 'save_workflow_draft_graph');

  if (draftVersion.status !== 'DRAFT') {
    throw new WorkflowServiceError(
      'Published workflow versions are read-only. Create a draft before editing the graph.',
      409,
      {
        workflowCode: definition.workflowCode,
        workflowVersionId,
        versionStatus: draftVersion.status,
      },
    );
  }

  assertVersionFresh({ version: draftVersion, payload, action: 'save_workflow_draft_graph' });

  const rawNodes = getSafeArray(payload.nodes);
  if (rawNodes.length === 0) {
    throw new WorkflowServiceError(
      'At least one supported workflow node is required for a workflow draft.',
      400,
    );
  }

  const seenKeys = new Set();
  const normalizedNodes = rawNodes.map((node, index) =>
    normalizeCreateNodeInput(node, index, seenKeys),
  );
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        SELECT workflow_version_id
        FROM worker.workflow_versions
        WHERE workflow_version_id = $1
          AND workflow_definition_id = $2
          AND status = 'DRAFT'
        FOR UPDATE
      `,
      [workflowVersionId, definition.workflowDefinitionId],
    );

    await client.query('DELETE FROM worker.workflow_edges WHERE workflow_version_id = $1', [
      workflowVersionId,
    ]);
    await client.query('DELETE FROM worker.workflow_nodes WHERE workflow_version_id = $1', [
      workflowVersionId,
    ]);

    await insertWorkflowVersionGraph({
      client,
      definition,
      versionNumber: draftVersion.versionNumber,
      versionLabel:
        payload.versionLabel || draftVersion.versionLabel || `Draft v${draftVersion.versionNumber}`,
      status: 'DRAFT',
      nodes: normalizedNodes,
      user,
      existingWorkflowVersionId: workflowVersionId,
    });

    await client.query(
      `
        UPDATE worker.workflow_versions
        SET version_label = COALESCE(NULLIF($2, ''), version_label),
            updated_at = CURRENT_TIMESTAMP
        WHERE workflow_version_id = $1
      `,
      [workflowVersionId, payload.versionLabel || null],
    );

    await client.query(
      `
        UPDATE worker.workflow_definitions
        SET updated_by_user_id = $2,
            config = config || $3::jsonb
        WHERE workflow_definition_id = $1
      `,
      [
        definition.workflowDefinitionId,
        user?.userId || null,
        JSON.stringify({ draftGraphSavedBy: 'workflow_manager_guardrails_v1' }),
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

async function publishWorkflowDraftVersion({
  workflowCode,
  workflowVersionId,
  payload = {},
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
    permissions,
    action: 'publish_workflow_draft',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const draftVersion = await getWorkflowVersionMeta(workflowVersionId);
  assertWorkflowVersionMatchesDefinition(draftVersion, definition, 'publish_workflow_draft');

  if (draftVersion.status !== 'DRAFT') {
    throw new WorkflowServiceError('Only draft workflow versions can be published.', 409, {
      workflowCode: definition.workflowCode,
      workflowVersionId,
      versionStatus: draftVersion.status,
    });
  }

  assertVersionFresh({ version: draftVersion, payload, action: 'publish_workflow_draft' });

  const guardrails = await getWorkflowEditGuardrails(definition.workflowDefinitionId);
  const changeNote = String(payload.changeNote || payload.publishNote || '').trim() || null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE worker.workflow_versions
        SET status = 'RETIRED'
        WHERE workflow_definition_id = $1
          AND status = 'PUBLISHED'
      `,
      [definition.workflowDefinitionId],
    );

    await client.query(
      `
        UPDATE worker.workflow_versions
        SET status = 'PUBLISHED',
            version_label = COALESCE(NULLIF($3, ''), version_label, $4),
            published_by_user_id = $2,
            published_at = CURRENT_TIMESTAMP,
            definition_snapshot = definition_snapshot || $5::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE workflow_version_id = $1
      `,
      [
        workflowVersionId,
        user?.userId || null,
        payload.versionLabel || null,
        `Published v${draftVersion.versionNumber}`,
        JSON.stringify({
          publishedBy: 'workflow_manager_guardrails_v1',
          changeNote,
          guardrailsAtPublish: guardrails,
        }),
      ],
    );

    await client.query(
      `
        UPDATE worker.workflow_definitions
        SET status = 'ACTIVE',
            enabled = TRUE,
            visible_in_admin = TRUE,
            updated_by_user_id = $2,
            config = config || $3::jsonb
        WHERE workflow_definition_id = $1
      `,
      [
        definition.workflowDefinitionId,
        user?.userId || null,
        JSON.stringify({
          lastPublishedBy: 'workflow_manager_guardrails_v1',
          lastPublishNote: changeNote,
        }),
      ],
    );

    await client.query('COMMIT');
    const managed = await getWorkflowDefinitionForManage(definition.workflowCode);
    return {
      ...managed,
      guardrailsAtPublish: guardrails,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function discardWorkflowDraftVersion({
  workflowCode,
  workflowVersionId,
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
    permissions,
    action: 'discard_workflow_draft',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const draftVersion = await getWorkflowVersionMeta(workflowVersionId);
  assertWorkflowVersionMatchesDefinition(draftVersion, definition, 'discard_workflow_draft');

  if (draftVersion.status !== 'DRAFT') {
    throw new WorkflowServiceError('Only draft workflow versions can be discarded.', 409, {
      workflowCode: definition.workflowCode,
      workflowVersionId,
      versionStatus: draftVersion.status,
    });
  }

  await query(
    `
      DELETE FROM worker.workflow_versions
      WHERE workflow_version_id = $1
        AND workflow_definition_id = $2
        AND status = 'DRAFT'
    `,
    [workflowVersionId, definition.workflowDefinitionId],
  );

  await query(
    `
      UPDATE worker.workflow_definitions
      SET updated_by_user_id = $2,
          config = config || $3::jsonb
      WHERE workflow_definition_id = $1
    `,
    [
      definition.workflowDefinitionId,
      user?.userId || null,
      JSON.stringify({ draftDiscardedBy: 'workflow_manager_guardrails_v1' }),
    ],
  );

  return getWorkflowDefinitionForManage(definition.workflowCode);
}

async function replaceWorkflowGraph({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  const workflowVersionId = payload.workflowVersionId || payload.baseWorkflowVersionId;

  if (!workflowVersionId) {
    throw new WorkflowServiceError(
      'Published workflow versions are read-only. Create a draft before saving graph edits.',
      409,
      {
        workflowCode,
        requiredAction: 'CREATE_DRAFT',
      },
    );
  }

  return saveWorkflowDraftGraph({
    workflowCode,
    workflowVersionId,
    payload,
    user,
    permissions,
  });
}

async function createWorkflowVersion({ workflowCode, payload = {}, user, permissions = [] } = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CHANGE_PERMISSION,
    permissions,
    action: 'create_workflow_version',
  });

  const definition = await getWorkflowDefinitionByCode(workflowCode);
  const sourceVersionId =
    payload.sourceWorkflowVersionId || definition.latestVersionId || definition.publishedVersionId;
  const sourceGraph = sourceVersionId ? await getWorkflowVersionGraph(sourceVersionId) : null;
  const rawNodes =
    getSafeArray(payload.nodes).length > 0
      ? getSafeArray(payload.nodes)
      : versionNodesToCreateInput(sourceGraph?.nodes || []);

  if (rawNodes.length === 0) {
    throw new WorkflowServiceError(
      'At least one supported workflow node is required for a workflow version.',
      400,
    );
  }

  const seenKeys = new Set();
  const normalizedNodes = rawNodes.map((node, index) =>
    normalizeCreateNodeInput(node, index, seenKeys),
  );
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
      versionLabel:
        payload.versionLabel ||
        (publish ? `Published v${versionNumber}` : `Draft v${versionNumber}`),
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

async function cloneWorkflowDefinition({
  workflowCode,
  payload = {},
  user,
  permissions = [],
} = {}) {
  assertPermission({
    permissionCode: WORKFLOW_CREATE_PERMISSION,
    permissions,
    action: 'clone_workflow',
  });

  const source = await getWorkflowDefinitionForManage(workflowCode);
  const sourceNodes = source.publishedGraph?.nodes || source.latestGraph?.nodes || [];
  const sourceRuntimeParameters = normalizeWorkflowParameterDefinitions(
    source.runtimeParameters || getParameterSchemaFromConfig(source.config || {}),
  );
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
      categoryCode: payload.categoryCode || source.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE,
      runtimeParameters: sourceRuntimeParameters,
      nodes: versionNodesToCreateInput(sourceNodes),
    },
    definitionDefaults: {
      config: getCloneableWorkflowConfig(source.config),
      startPermissionCode: source.startPermissionCode,
      cancelPermissionCode: source.cancelPermissionCode,
      clonedFromWorkflowCode: source.workflowCode,
    },
    user,
    permissions,
  });
}

async function createChildWorkflowRun({
  parentWorkflowRunRecordId,
  parentWorkflowCode,
  parentNodeKey,
  childWorkflowCode,
  input = {},
  user,
  context = {},
  permissions = [],
} = {}) {
  const normalizedChildWorkflowCode = String(childWorkflowCode || '').trim();
  const workflowStack = Array.isArray(context.workflowStack) ? context.workflowStack : [];

  if (!normalizedChildWorkflowCode) {
    throw new WorkflowServiceError('Child workflowCode is required.', 400);
  }

  if (normalizedChildWorkflowCode === String(parentWorkflowCode || '').trim()) {
    throw new WorkflowServiceError(
      'A workflow cannot directly run itself as a child workflow.',
      400,
      {
        parentWorkflowCode,
        childWorkflowCode: normalizedChildWorkflowCode,
        parentNodeKey,
      },
    );
  }

  if (workflowStack.includes(normalizedChildWorkflowCode)) {
    throw new WorkflowServiceError('Child workflow cycle detected.', 400, {
      workflowStack,
      childWorkflowCode: normalizedChildWorkflowCode,
      parentNodeKey,
    });
  }

  const definition = await getWorkflowDefinition(normalizedChildWorkflowCode);

  assertPermission({
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: 'start_child_workflow',
  });
  assertPermission({
    permissionCode: definition.startPermissionCode,
    permissions,
    action: 'start_child_workflow',
  });

  await assertWorkflowExecutionTargetsAvailable(definition);

  const childInput = {
    ...getSafeObject(input),
    runSource: 'child_workflow',
    triggerType: 'CHILD_WORKFLOW',
    parentWorkflowRunRecordId,
    parentWorkflowCode: parentWorkflowCode || null,
    parentNodeKey: parentNodeKey || null,
  };

  const run = await insertWorkflowRun({
    definition,
    input: childInput,
    user,
    context,
    status: 'QUEUED',
    metadata: {
      executor: 'skycommand_workflow_executor_temporal_v1',
      temporalBacked: true,
      childWorkflow: true,
      parentWorkflowRunRecordId: parentWorkflowRunRecordId || null,
      parentWorkflowCode: parentWorkflowCode || null,
      parentNodeKey: parentNodeKey || null,
    },
  });

  return {
    definition,
    run,
    input: childInput,
  };
}

async function runChildWorkflowNode({ node, parameters, user, session, permissions, context }) {
  const childWorkflowCode = String(parameters.workflowCode || node.targetCode || '').trim();

  if (!childWorkflowCode) {
    throw new WorkflowServiceError('Child workflow node target_code is required.', 400, {
      nodeKey: node.nodeKey,
    });
  }

  const result = await startWorkflowWithTemporal({
    workflowCode: childWorkflowCode,
    input: {
      ...parameters,
      runSource: 'child_workflow',
      triggerType: 'CHILD_WORKFLOW',
      parentWorkflowRunRecordId: context?.workflowRunRecordId || null,
      parentNodeKey: node.nodeKey,
    },
    user,
    session,
    permissions,
    context,
  });

  return {
    kind: 'child_workflow_start',
    workflowCode: childWorkflowCode,
    workflowRunRecordId: result.run?.workflowRunRecordId,
    temporalWorkflowId: result.temporalWorkflow?.workflowId,
    temporalRunId: result.temporalWorkflow?.runId,
    status: result.run?.status || 'RUNNING',
    summary: `Started child SkyCommand workflow ${childWorkflowCode}.`,
    note: 'Inline fallback starts child workflows asynchronously. Temporal-backed parent workflows wait for child completion.',
  };
}

async function executeNode({ node, parameters, user, session, permissions, context }) {
  if (!SUPPORTED_NODE_TYPES.has(node.nodeTypeCode)) {
    throw new WorkflowServiceError(
      `Unsupported workflow node type in executor v1: ${node.nodeTypeCode}`,
      501,
      {
        nodeKey: node.nodeKey,
        nodeTypeCode: node.nodeTypeCode,
        supportedNodeTypes: [...SUPPORTED_NODE_TYPES],
      },
    );
  }

  if (node.nodeTypeCode === 'TOOL') {
    return runToolNode({ node, parameters, user, session, permissions, context });
  }

  if (node.nodeTypeCode === 'API_CALL') {
    return runApiCallNode({ node, parameters, user, session, permissions, context });
  }

  if (node.nodeTypeCode === 'WORKFLOW') {
    return runChildWorkflowNode({ node, parameters, user, session, permissions, context });
  }

  if (node.nodeTypeCode === 'CONDITION') {
    return evaluateConditionNode({ node, parameters, context });
  }

  if (node.nodeTypeCode === 'WAIT') {
    return runWaitNode({ node, parameters, context });
  }

  if (node.nodeTypeCode === 'HUMAN_APPROVAL') {
    return runHumanApprovalNodeInline({ node, parameters, user, context });
  }

  if (node.nodeTypeCode === 'TEMPORAL_WORKFLOW') {
    return runTemporalWorkflowNode({ node, parameters, user, context });
  }

  if (node.nodeTypeCode === 'SUMMARY') {
    return buildWorkflowRunSummaryOutput({ node, parameters, context });
  }

  throw new WorkflowServiceError(`Node type has no executor adapter: ${node.nodeTypeCode}`, 501);
}

async function executeWorkflowNode({
  node,
  parameters,
  user,
  session,
  permissions = [],
  context = {},
}) {
  return executeNode({
    node,
    parameters,
    user,
    session,
    permissions,
    context,
  });
}

function getConditionOnFalseFromOutput(output = {}) {
  return normalizeConditionOnFalse(output.onFalse || DEFAULT_CONDITION_ON_FALSE);
}

function buildConditionStopSummary({ definition, output, completedNodeCount, totalNodeCount }) {
  const skippedNodeCount = Math.max(
    0,
    Number(totalNodeCount || 0) - Number(completedNodeCount || 0),
  );

  return `Workflow ${definition.displayName} stopped successfully by condition gate: ${output.summary || 'condition returned false'} (${skippedNodeCount} remaining node(s) skipped).`;
}

function normalizeSummaryParameters(parameters = {}) {
  const input = getSafeObject(parameters);

  return {
    title: String(input.title || '').trim(),
    summaryTemplate: String(input.summaryTemplate || input.template || '').trim(),
    technicalDetailsTemplate: String(
      input.technicalDetailsTemplate || input.technicalTemplate || '',
    ).trim(),
    recommendedNextActions: String(input.recommendedNextActions || '').trim(),
    includeKeyOutputs: input.includeKeyOutputs !== false && input.includeKeyOutputs !== 'false',
    includeWarnings: input.includeWarnings !== false && input.includeWarnings !== 'false',
    includeTimings: input.includeTimings !== false && input.includeTimings !== 'false',
  };
}

function splitSummaryActions(value) {
  return String(value || '')
    .split(/[;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function countRunNodeStatuses(nodeRuns = []) {
  return getSafeArray(nodeRuns).reduce(
    (accumulator, nodeRun) => {
      const status =
        String(nodeRun?.status || 'UNKNOWN')
          .trim()
          .toUpperCase() || 'UNKNOWN';
      accumulator[status] = (accumulator[status] || 0) + 1;
      accumulator.total += 1;
      return accumulator;
    },
    {
      total: 0,
      COMPLETED: 0,
      FAILED: 0,
      RUNNING: 0,
      SKIPPED: 0,
      PENDING_APPROVAL: 0,
    },
  );
}

function getWorkflowRunSummaryOutput(nodeOutputsByKey = {}) {
  for (const [nodeKey, rawOutput] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const output = getSafeObject(rawOutput);

    if (output.kind === 'workflow_run_summary') {
      return {
        ...output,
        nodeKey,
      };
    }

    const nestedOutput = getSafeObject(output.output);
    if (nestedOutput.kind === 'workflow_run_summary') {
      return {
        ...nestedOutput,
        nodeKey,
      };
    }
  }

  return null;
}

function renderSummaryTemplate(template, scope, fallback = '') {
  const text = String(template || '').trim();

  if (!text) {
    return fallback;
  }

  const rendered = resolveRuntimeTemplates(text, scope);
  if (typeof rendered === 'string') {
    return rendered.trim();
  }

  return truncateJsonPreview(rendered, 4000);
}

function buildSummaryKeyOutputs(nodeOutputsByKey = {}) {
  return buildStructuredSummaryKeyOutputs(nodeOutputsByKey);
}

function buildWorkflowRunSummaryOutput({ node = {}, parameters = {}, context = {} } = {}) {
  const rawNodeParameters = getSafeObject(node.inputParameters);
  const summaryParameters = normalizeSummaryParameters({
    ...getSafeObject(parameters),
    summaryTemplate:
      rawNodeParameters.summaryTemplate ?? rawNodeParameters.template ?? parameters.summaryTemplate,
    technicalDetailsTemplate:
      rawNodeParameters.technicalDetailsTemplate ??
      rawNodeParameters.technicalTemplate ??
      parameters.technicalDetailsTemplate,
  });
  const workflowContext = getSafeObject(context.workflowContext || context.context);
  const workflowInfo = getSafeObject(workflowContext.workflow);
  const definition = getSafeObject(context.definition);
  const nodeRuns = getSafeArray(context.nodeRuns);
  const nodeOutputsByKey = getSafeObject(context.previousOutputs);
  const counts = countRunNodeStatuses(nodeRuns);
  const totalNodeCount = Number(
    context.totalNodeCount || getSafeArray(definition.nodes).length || counts.total || 0,
  );
  const summaryRunAlreadyPresent = nodeRuns.some(
    (nodeRun) =>
      (nodeRun.nodeKey && nodeRun.nodeKey === node.nodeKey) ||
      (node.workflowNodeId && nodeRun.workflowNodeId === node.workflowNodeId),
  );
  const currentSummaryNodeCount =
    node.nodeTypeCode === 'SUMMARY' && !summaryRunAlreadyPresent ? 1 : 0;
  const observedNodeCount = counts.total + currentSummaryNodeCount;
  const completedNodeCount = counts.COMPLETED + currentSummaryNodeCount;
  const skippedNodeCount = Math.max(0, totalNodeCount - observedNodeCount);
  const workflowName =
    summaryParameters.title ||
    definition.displayName ||
    workflowInfo.workflowDisplayName ||
    workflowInfo.workflowCode ||
    'Workflow';
  const now = new Date().toISOString();
  const durationMs = Number.isFinite(Number(context.startedAtMs))
    ? Math.max(0, Date.now() - Number(context.startedAtMs))
    : null;
  const keyOutputs = summaryParameters.includeKeyOutputs
    ? buildSummaryKeyOutputs(nodeOutputsByKey)
    : {};
  const structuredResults = buildStructuredResultRollup(nodeOutputsByKey);
  const macroIngestion = structuredResults.macroIngestion;
  const gitPromotion = structuredResults.gitPromotion;
  const databaseSynchronization = structuredResults.databaseSynchronization;
  const scope = buildTemplateResolutionScope({
    input: workflowInfo.input || {},
    context: {
      ...getSafeObject(context),
      workflowContext,
      context: workflowContext,
      params: getSafeObject(context.params || workflowContext.params),
      previousOutputs: nodeOutputsByKey,
      nodes: getSafeObject(context.nodes || workflowContext.nodes),
      structuredResults,
      macroIngestion,
      gitPromotion,
      databaseSynchronization,
      keyOutputs,
    },
  });
  const warnings = [];
  const errors = [];

  for (const nodeRun of nodeRuns) {
    if (nodeRun?.status === TERMINAL_FAILURE_STATUS || nodeRun?.errorMessage) {
      errors.push({
        nodeKey: nodeRun.nodeKey || null,
        status: nodeRun.status || null,
        message: nodeRun.errorMessage || getSafeObject(nodeRun.output).message || 'Node failed.',
      });
    }
  }

  if (counts.FAILED > 0) {
    warnings.push(`${counts.FAILED} node(s) failed before the summary node executed.`);
  }

  if (skippedNodeCount > 0) {
    warnings.push(`${skippedNodeCount} node(s) did not run before the summary node executed.`);
  }

  const macroSummary = macroIngestion
    ? ` Macro ingestion: ${macroIngestion.sourceCount} source(s), ${macroIngestion.totals.indicatorsRequested} indicator(s), ${macroIngestion.totals.indicatorsUpdated} updated, ${macroIngestion.totals.indicatorsUnchanged} unchanged, ${macroIngestion.totals.indicatorsFailed} failed, ${macroIngestion.totals.rowsInserted} row(s) inserted.`
    : '';
  const promotionApproval = gitPromotion?.approval?.decision
    ? ` Approval ${String(gitPromotion.approval.decision).toLowerCase()}${gitPromotion.approval.decidedByDisplayName ? ` by ${gitPromotion.approval.decidedByDisplayName}` : ''}.`
    : '';
  const promotionSummary = gitPromotion
    ? ` Development promotion: ${gitPromotion.repositoryCode || gitPromotion.repositoryName || 'repository'} ${gitPromotion.pullRequestDirection || ''}${gitPromotion.synchronizationDirection ? `; synchronized ${gitPromotion.synchronizationDirection}` : ''}${gitPromotion.synchronizedHeadSha ? ` at ${gitPromotion.synchronizedHeadSha.slice(0, 12)}` : ''}. ${promotionApproval}`
    : '';
  const databaseSynchronizationSummary = databaseSynchronization
    ? ` Database validation: ${databaseSynchronization.build?.targetDatabase || databaseSynchronization.comparison?.databaseB || 'target database'} ${String(databaseSynchronization.outcome || 'UNKNOWN').toLowerCase()}${databaseSynchronization.comparison ? `; ${Number(databaseSynchronization.comparison.matchedObjectCount || 0)} matched object(s), ${Number(databaseSynchronization.comparison.totalDifferenceCount || 0)} difference(s)` : ''}.`
    : '';
  const defaultSummary = `Workflow ${workflowName} summarized: ${completedNodeCount}/${totalNodeCount || observedNodeCount} node(s) completed${counts.FAILED ? `, ${counts.FAILED} failed` : ''}${skippedNodeCount ? `, ${skippedNodeCount} not run` : ''}.${macroSummary}${promotionSummary}${databaseSynchronizationSummary}`;
  const summary =
    renderSummaryTemplate(summaryParameters.summaryTemplate, scope, defaultSummary) ||
    defaultSummary;
  const technicalDetails = renderSummaryTemplate(
    summaryParameters.technicalDetailsTemplate,
    scope,
    '',
  );
  const recommendedNextActions = splitSummaryActions(summaryParameters.recommendedNextActions);
  const status = errors.length > 0 ? 'WARNING' : 'SUCCESS';

  return {
    kind: 'workflow_run_summary',
    title: workflowName,
    status,
    summary,
    message: summary,
    technicalDetails,
    recommendedNextActions,
    keyOutputs,
    structuredResults,
    macroIngestion,
    gitPromotion,
    databaseSynchronization,
    warnings: summaryParameters.includeWarnings ? warnings : [],
    errors: summaryParameters.includeWarnings ? errors : [],
    counts: {
      totalNodes: totalNodeCount || observedNodeCount,
      completedNodes: completedNodeCount,
      failedNodes: counts.FAILED,
      runningNodes: counts.RUNNING,
      skippedNodes: skippedNodeCount,
    },
    timings: summaryParameters.includeTimings
      ? {
          durationMs,
          generatedAt: now,
          startedAt: workflowInfo.startedAt || null,
          completedAt: null,
        }
      : {},
    output: {
      title: workflowName,
      summary,
      status,
      keyOutputs,
      structuredResults,
      macroIngestion,
      gitPromotion,
      databaseSynchronization,
      recommendedNextActions,
    },
    contextUpdates: {
      'summary.title': workflowName,
      'summary.text': summary,
      'summary.status': status,
      'summary.generatedAt': now,
      'summary.nodeKey': node.nodeKey || null,
      'summary.keyOutputs': keyOutputs,
      'summary.structuredResults': structuredResults,
      'summary.macroIngestion': macroIngestion,
      'summary.gitPromotion': gitPromotion,
      'summary.databaseSynchronization': databaseSynchronization,
    },
  };
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
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: 'start_workflow',
  });
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

  await assertWorkflowExecutionTargetsAvailable(definition);

  const normalizedInput = await validateWorkflowRuntimeInput(definition, input);

  const run = await insertWorkflowRun({
    definition,
    input: normalizedInput,
    user,
    context,
    status: 'QUEUED',
    metadata: {
      executor: 'skycommand_workflow_executor_temporal_v1',
      temporalBacked: true,
      queuedByApi: true,
    },
  });

  try {
    const temporalStart = await temporalService.startSkyCommandWorkflowExecutorWorkflow({
      workflowCode: definition.workflowCode,
      workflowRunRecordId: run.workflowRunRecordId,
      input: normalizedInput,
      actor: user,
      session,
      permissions,
      context,
    });

    const linkedRun = await linkWorkflowRunToTemporal({
      workflowRunRecordId: run.workflowRunRecordId,
      temporalWorkflowId: temporalStart.workflow.workflowId,
      temporalRunId: temporalStart.workflow.runId,
      summary: `Workflow ${definition.displayName} started through Temporal-backed SkyCommand executor.`,
      metadata: {
        executor: 'skycommand_workflow_executor_temporal_v1',
        temporalBacked: true,
        temporalWorkflowType: temporalStart.workflow.workflowType,
        temporalTaskQueue: temporalStart.workflow.taskQueue,
        temporalNamespace: temporalStart.workflow.namespace,
      },
    });

    const startedRun = linkedRun || run;
    const message = `Workflow ${definition.displayName} started through Temporal. Refresh Workflow History to follow node progress.`;

    await recordWorkflowAuditEvent({
      user,
      context,
      eventType: 'WORKFLOW_RUN_STARTED',
      resourceType: 'worker.workflow_run_records',
      resourceId: startedRun.workflowRunRecordId,
      action: 'start_workflow',
      success: true,
      message,
      metadata: {
        workflowCode: definition.workflowCode,
        workflowDisplayName: definition.displayName,
        workflowVersionId: startedRun.workflowVersionId || definition.publishedVersionId || null,
        runSource: normalizedInput.runSource || 'manual',
        triggerType: normalizedInput.triggerType || 'MANUAL',
        executor: 'temporal',
        temporalWorkflowId: temporalStart.workflow.workflowId || null,
        temporalRunId: temporalStart.workflow.runId || null,
      },
    });

    return {
      ok: true,
      started: true,
      async: true,
      run: startedRun,
      definition,
      nodeRuns: [],
      temporalWorkflow: temporalStart.workflow,
      message,
    };
  } catch (error) {
    const failedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_FAILURE_STATUS,
      summary: `Workflow ${definition.displayName} failed to start in Temporal: ${error.message || String(error)}`,
      metadata: {
        executor: 'skycommand_workflow_executor_temporal_v1',
        temporalBacked: true,
        startFailure: true,
        errorMessage: error.message || String(error),
      },
    });

    await recordWorkflowAuditEvent({
      user,
      context,
      eventType: 'WORKFLOW_RUN_START_FAILED',
      resourceType: 'worker.workflow_run_records',
      resourceId: run.workflowRunRecordId,
      action: 'start_workflow',
      success: false,
      message: `Workflow ${definition.displayName} failed to start through Temporal.`,
      metadata: {
        workflowCode: definition.workflowCode,
        workflowDisplayName: definition.displayName,
        runSource: normalizedInput.runSource || 'manual',
        triggerType: normalizedInput.triggerType || 'MANUAL',
        executor: 'temporal',
        error: error.message || String(error),
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

async function executeWorkflow({
  workflowCode,
  input = {},
  user,
  session,
  permissions = [],
  context = {},
} = {}) {
  const definition = await getWorkflowDefinition(workflowCode);

  assertPermission({
    permissionCode: WORKFLOW_RUN_PERMISSION,
    permissions,
    action: 'start_workflow',
  });
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

  await assertWorkflowExecutionTargetsAvailable(definition);

  const normalizedInput = await validateWorkflowRuntimeInput(definition, input);

  const run = await insertWorkflowRun({ definition, input: normalizedInput, user, context });
  const nodeRuns = [];
  const nodeOutputsByKey = {};
  let workflowRuntimeContext = buildContextObjectFromPatch(
    buildInitialWorkflowContextPatch({
      run,
      definition,
      input: normalizedInput,
    }),
  );
  let previousNodeOutput = null;
  let conditionStop = null;
  const startedAtMs = Date.now();

  try {
    const executionPlan = buildWorkflowExecutionPlan(definition.nodes);
    const conditionBranchRoutes = [];
    let currentNodeIndex = 0;

    while (currentNodeIndex < executionPlan.nodes.length) {
      const node = executionPlan.nodes[currentNodeIndex];
      const nodeRun = await insertNodeRun({ workflowRunRecordId: run.workflowRunRecordId, node });
      const nodeContext = {
        ...buildWorkflowExecutionContext({
          baseContext: context,
          runtimeContext: workflowRuntimeContext,
          input: normalizedInput,
          nodeOutputsByKey,
          previousNodeOutput,
          currentNodeKey: node.nodeKey,
        }),
        definition,
        workflowRunRecordId: run.workflowRunRecordId,
        nodeRuns,
        startedAtMs,
        totalNodeCount: definition.nodes.length,
      };
      const parameters = buildNodeParameters(node, normalizedInput, nodeContext);
      let nextNodeIndex = currentNodeIndex + 1;

      try {
        const output = await executeNode({
          node,
          parameters,
          user,
          session,
          permissions,
          context: nodeContext,
        });
        const completedNodeRun = await updateNodeRun({
          nodeRunRecordId: nodeRun.workflowNodeRunRecordId,
          status: TERMINAL_SUCCESS_STATUS,
          output,
          metadata: { parameters },
        });
        nodeRuns.push(completedNodeRun);
        nodeOutputsByKey[node.nodeKey] = output;
        previousNodeOutput = output;
        workflowRuntimeContext = applyContextPatch(
          workflowRuntimeContext,
          buildNodeContextPatch(completedNodeRun),
        );

        if (node.nodeTypeCode === 'CONDITION') {
          const branchTargetIndex = resolveConditionBranchIndex({
            output,
            currentIndex: currentNodeIndex,
            executionPlan,
          });

          if (Number.isInteger(branchTargetIndex)) {
            conditionBranchRoutes.push({
              nodeKey: node.nodeKey,
              branchLabel: output.branchLabel || (output.passed ? 'TRUE' : 'FALSE'),
              targetNodeKey: output.branchTargetNodeKey,
            });
            nextNodeIndex = branchTargetIndex;
          } else if (output?.passed === false) {
            const onFalse = getConditionOnFalseFromOutput(output);

            if (onFalse === 'FAIL_WORKFLOW') {
              throw new WorkflowServiceError(
                output.summary || 'Workflow condition failed.',
                500,
                output,
              );
            }

            if (onFalse === 'STOP_SUCCESS') {
              conditionStop = { output, nodeKey: node.nodeKey };
              break;
            }
          }
        }
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

      currentNodeIndex = nextNodeIndex;
    }

    const summaryOutput = getWorkflowRunSummaryOutput(nodeOutputsByKey);
    const summary = conditionStop
      ? buildConditionStopSummary({
          definition,
          output: conditionStop.output,
          completedNodeCount: nodeRuns.length,
          totalNodeCount: definition.nodes.length,
        })
      : summaryOutput?.summary ||
        `Workflow ${definition.displayName} completed: ${nodeRuns.length}/${definition.nodes.length} node(s) succeeded.`;
    const completedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_SUCCESS_STATUS,
      summary,
      metadata: {
        durationMs: Date.now() - startedAtMs,
        completedNodeCount: nodeRuns.length,
        skippedNodeCount: conditionStop
          ? Math.max(0, definition.nodes.length - nodeRuns.length)
          : Math.max(0, definition.nodes.length - nodeRuns.length),
        conditionStopNodeKey: conditionStop?.nodeKey || null,
        conditionBranchRoutes,
        summaryNodeKey: summaryOutput?.nodeKey || null,
        summaryTitle: summaryOutput?.title || null,
      },
    });

    await recordWorkflowAuditEvent({
      user,
      context,
      eventType: 'WORKFLOW_RUN_COMPLETED',
      resourceType: 'worker.workflow_run_records',
      resourceId: completedRun.workflowRunRecordId,
      action: 'run_workflow_inline',
      success: true,
      message: summary,
      metadata: {
        workflowCode: definition.workflowCode,
        workflowDisplayName: definition.displayName,
        runSource: normalizedInput.runSource || 'manual',
        triggerType: normalizedInput.triggerType || 'MANUAL',
        executor: 'inline',
        nodeCount: definition.nodes.length,
        completedNodeCount: nodeRuns.length,
        durationMs: Date.now() - startedAtMs,
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
        failedNodeCount: nodeRuns.filter((nodeRun) => nodeRun?.status === TERMINAL_FAILURE_STATUS)
          .length,
        errorMessage: error.message || String(error),
      },
    });

    await recordWorkflowAuditEvent({
      user,
      context,
      eventType: 'WORKFLOW_RUN_FAILED',
      resourceType: 'worker.workflow_run_records',
      resourceId: failedRun.workflowRunRecordId,
      action: 'run_workflow_inline',
      success: false,
      message: summary,
      metadata: {
        workflowCode: definition.workflowCode,
        workflowDisplayName: definition.displayName,
        runSource: normalizedInput.runSource || 'manual',
        triggerType: normalizedInput.triggerType || 'MANUAL',
        executor: 'inline',
        failedNodeCount: nodeRuns.filter((nodeRun) => nodeRun?.status === TERMINAL_FAILURE_STATUS)
          .length,
        durationMs: Date.now() - startedAtMs,
        error: error.message || String(error),
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
  const offset = parseOffset(filters.offset);
  const clauses = [];
  const values = [];
  const status = String(filters.status || '')
    .trim()
    .toUpperCase();
  const workflowCode = String(filters.workflowCode || '').trim();
  const rawCategoryCode = String(filters.categoryCode || '').trim();
  const categoryCode = rawCategoryCode ? normalizeWorkflowCategoryCode(rawCategoryCode) : '';
  const from = String(filters.from || '').trim();
  const to = String(filters.to || filters.through || '').trim();

  if (status) {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  if (workflowCode) {
    values.push(workflowCode);
    clauses.push(`workflow_code = $${values.length}`);
  }

  if (categoryCode) {
    values.push(categoryCode);
    clauses.push(`workflow_category_code = $${values.length}`);
  }

  if (from) {
    values.push(from);
    clauses.push(`COALESCE(started_at, created_at) >= $${values.length}::timestamptz`);
  }

  if (to) {
    values.push(to);
    clauses.push(`COALESCE(started_at, created_at) <= $${values.length}::timestamptz`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = buildWhitelistedOrderBy({
    sortValue: filters.sort,
    sortFields: {
      workflow: "LOWER(COALESCE(NULLIF(BTRIM(workflow_display_name), ''), workflow_code))",
      category: "LOWER(COALESCE(NULLIF(BTRIM(workflow_category_display_name), ''), workflow_category_code))",
      status: 'status',
      startedAt: 'COALESCE(started_at, created_at)',
      durationMs: 'EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at))) * 1000',
      completedAt: 'completed_at',
      runtime: "CASE WHEN temporal_workflow_id IS NOT NULL THEN 'temporal' ELSE 'inline' END",
    },
    defaultSorts: [{ field: 'startedAt', direction: 'desc' }],
    tieBreakers: ['created_at DESC', 'workflow_run_record_id DESC'],
  });
  const filterValues = [...values];
  const [countResult, result] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total FROM worker.vw_workflow_run_records ${whereClause}`,
      filterValues,
    ),
    query(
      `
        SELECT *
        FROM worker.vw_workflow_run_records
        ${whereClause}
        ${orderBy}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: countResult.rows[0]?.total || 0,
    limit,
    offset,
    items: result.rows.map(normalizeRunRow),
  };
}

async function getWorkflowRunById(workflowRunRecordId) {
  if (!workflowRunRecordId) {
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_run_records
      WHERE workflow_run_record_id = $1
      LIMIT 1
    `,
    [workflowRunRecordId],
  );

  return result.rows[0] ? normalizeRunRow(result.rows[0]) : null;
}

async function getWorkflowNodeRunsForRun(workflowRunRecordId) {
  const result = await query(
    `
      SELECT *
      FROM worker.workflow_node_run_records
      WHERE workflow_run_record_id = $1
      ORDER BY created_at, node_key
    `,
    [workflowRunRecordId],
  );

  return result.rows.map(normalizeNodeRunRow);
}

async function getWorkflowApprovalRequestById(approvalRequestId) {
  if (!approvalRequestId) {
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_approval_requests
      WHERE approval_request_id = $1
      LIMIT 1
    `,
    [approvalRequestId],
  );

  return result.rows[0] ? normalizeApprovalRow(result.rows[0]) : null;
}

async function createWorkflowApprovalRequest({
  workflowRunRecordId,
  workflowNodeRunRecordId,
  node = {},
  parameters = {},
  user = null,
  context = {},
  temporalWorkflowId = null,
  temporalRunId = null,
} = {}) {
  if (!workflowRunRecordId || !workflowNodeRunRecordId) {
    throw new WorkflowServiceError(
      'Approval requests require workflowRunRecordId and workflowNodeRunRecordId.',
      400,
      {
        workflowRunRecordId,
        workflowNodeRunRecordId,
      },
    );
  }

  const approvalParameters = normalizeHumanApprovalParameters(parameters, node);
  const existingResult = await query(
    `
      SELECT *
      FROM worker.vw_workflow_approval_requests
      WHERE workflow_node_run_record_id = $1
        AND approval_key = $2
      LIMIT 1
    `,
    [workflowNodeRunRecordId, approvalParameters.approvalKey],
  );

  if (existingResult.rows[0]) {
    if (context?.nodeRecovery?.active === true) {
      const recoveryExpiresAt = approvalParameters.timeoutMs
        ? new Date(Date.now() + approvalParameters.timeoutMs).toISOString()
        : null;
      const resetResult = await query(
        `
          UPDATE worker.workflow_approval_requests
          SET approval_title = $2,
              instructions = $3,
              status = 'PENDING',
              required_role_code = $4,
              on_reject = $5,
              on_timeout = $6,
              timeout_ms = $7,
              temporal_workflow_id = $8,
              temporal_run_id = $9,
              requested_by_user_id = $10,
              decided_by_user_id = NULL,
              decision_note = NULL,
              requested_at = CURRENT_TIMESTAMP,
              decided_at = NULL,
              expires_at = $11,
              metadata = metadata || $12::jsonb
          WHERE approval_request_id = $1
          RETURNING *
        `,
        [
          existingResult.rows[0].approval_request_id,
          approvalParameters.approvalTitle,
          approvalParameters.instructions || null,
          approvalParameters.requiredRoleCode || null,
          approvalParameters.onReject,
          approvalParameters.onTimeout,
          approvalParameters.timeoutMs || null,
          temporalWorkflowId || null,
          temporalRunId || null,
          user?.userId || null,
          recoveryExpiresAt,
          JSON.stringify({
            manualNodeRecovery: true,
            nodeRecoveryNodeKey: node.nodeKey || null,
            nodeRecoveryAttemptNumber: context.nodeRecovery?.recoveryAttemptNumber || 1,
            reopenedAt: new Date().toISOString(),
          }),
        ],
      );

      return normalizeApprovalRow(resetResult.rows[0]);
    }

    return normalizeApprovalRow(existingResult.rows[0]);
  }

  const expiresAt = approvalParameters.timeoutMs
    ? new Date(Date.now() + approvalParameters.timeoutMs).toISOString()
    : null;
  const metadata = {
    ...(getSafeObject(context) || {}),
    nodeKey: node.nodeKey || null,
    nodeTypeCode: node.nodeTypeCode || 'HUMAN_APPROVAL',
    rejectTargetNodeKey: approvalParameters.rejectTargetNodeKey || null,
    createdBy: 'skycommand_workflow_executor',
  };

  const insertResult = await query(
    `
      INSERT INTO worker.workflow_approval_requests (
        workflow_run_record_id,
        workflow_node_run_record_id,
        workflow_node_id,
        node_key,
        approval_key,
        approval_title,
        instructions,
        required_role_code,
        on_reject,
        on_timeout,
        timeout_ms,
        temporal_workflow_id,
        temporal_run_id,
        signal_name,
        requested_by_user_id,
        expires_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
      RETURNING approval_request_id
    `,
    [
      workflowRunRecordId,
      workflowNodeRunRecordId,
      node.workflowNodeId || null,
      node.nodeKey || approvalParameters.approvalKey,
      approvalParameters.approvalKey,
      approvalParameters.approvalTitle,
      approvalParameters.instructions || null,
      approvalParameters.requiredRoleCode || null,
      approvalParameters.onReject,
      approvalParameters.onTimeout,
      approvalParameters.timeoutMs,
      temporalWorkflowId || context?.temporalWorkflowId || null,
      temporalRunId || context?.temporalRunId || null,
      HUMAN_APPROVAL_DECISION_SIGNAL,
      user?.userId || null,
      expiresAt,
      JSON.stringify(metadata),
    ],
  );

  return getWorkflowApprovalRequestById(insertResult.rows[0].approval_request_id);
}

async function resolveWorkflowApprovalRequest({
  approvalRequestId,
  decision,
  decisionNote = null,
  user = null,
  metadata = {},
} = {}) {
  const normalizedDecision = normalizeApprovalDecision(decision);

  if (!approvalRequestId) {
    throw new WorkflowServiceError('approvalRequestId is required.', 400);
  }

  await query(
    `
      UPDATE worker.workflow_approval_requests
      SET status = $2,
          decision_note = COALESCE($3, decision_note),
          decided_by_user_id = COALESCE($4, decided_by_user_id),
          decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP),
          metadata = metadata || $5::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE approval_request_id = $1
    `,
    [
      approvalRequestId,
      normalizedDecision,
      decisionNote || null,
      user?.userId || null,
      JSON.stringify(getSafeObject(metadata)),
    ],
  );

  const approval = await getWorkflowApprovalRequestById(approvalRequestId);

  if (!approval) {
    throw new WorkflowServiceError('Approval request was not found.', 404, {
      approvalRequestId,
    });
  }

  return approval;
}

async function listWorkflowApprovalRequests(filters = {}) {
  const limit = parseLimit(filters.limit);
  const requestedPage = Number.parseInt(filters.page, 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const clauses = [];
  const values = [];
  const status = String(filters.status || '')
    .trim()
    .toUpperCase();
  const workflowRunRecordId = String(filters.workflowRunRecordId || '').trim();
  const workflowCode = String(filters.workflowCode || '').trim();
  const categoryCode = String(filters.categoryCode || '').trim().toUpperCase();
  const requiredRoleCode = normalizeRoleCode(filters.requiredRoleCode || '');
  const userId = String(filters.userId || '').trim();
  const searchText = String(filters.q || filters.search || '').trim();

  if (status && status !== 'ALL') {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  if (workflowRunRecordId) {
    values.push(workflowRunRecordId);
    clauses.push(`workflow_run_record_id = $${values.length}`);
  }

  if (workflowCode) {
    values.push(workflowCode);
    clauses.push(`workflow_code = $${values.length}`);
  }

  if (categoryCode) {
    values.push(categoryCode);
    clauses.push(`workflow_category_code = $${values.length}`);
  }

  if (requiredRoleCode) {
    values.push(requiredRoleCode);
    clauses.push(`required_role_code = $${values.length}`);
  }

  if (userId) {
    values.push(userId);
    clauses.push(`(
      requested_by_user_id::text = $${values.length}
      OR decided_by_user_id::text = $${values.length}
    )`);
  }

  if (searchText) {
    values.push(`%${searchText}%`);
    clauses.push(`(
      approval_request_id::text ILIKE $${values.length}
      OR workflow_run_record_id::text ILIKE $${values.length}
      OR COALESCE(workflow_display_name, '') ILIKE $${values.length}
      OR COALESCE(workflow_code, '') ILIKE $${values.length}
      OR COALESCE(workflow_category_display_name, '') ILIKE $${values.length}
      OR COALESCE(workflow_category_code, '') ILIKE $${values.length}
      OR COALESCE(approval_title, '') ILIKE $${values.length}
      OR COALESCE(approval_key, '') ILIKE $${values.length}
      OR COALESCE(node_key, '') ILIKE $${values.length}
      OR COALESCE(node_display_name, '') ILIKE $${values.length}
      OR COALESCE(instructions, '') ILIKE $${values.length}
      OR COALESCE(required_role_code, '') ILIKE $${values.length}
      OR COALESCE(requested_by_display_name, '') ILIKE $${values.length}
      OR COALESCE(requested_by_email, '') ILIKE $${values.length}
      OR COALESCE(decided_by_display_name, '') ILIKE $${values.length}
      OR COALESCE(decided_by_email, '') ILIKE $${values.length}
      OR COALESCE(decision_note, '') ILIKE $${values.length}
      OR COALESCE(status, '') ILIKE $${values.length}
    )`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderBy = buildWhitelistedOrderBy({
    sortValue: filters.sort,
    sortFields: {
      workflow: "LOWER(COALESCE(NULLIF(BTRIM(workflow_display_name), ''), workflow_code))",
      category: "LOWER(COALESCE(NULLIF(BTRIM(workflow_category_display_name), ''), workflow_category_code))",
      approval: "LOWER(COALESCE(NULLIF(BTRIM(approval_title), ''), NULLIF(BTRIM(node_display_name), ''), approval_key, node_key))",
      status: 'status',
      requiredRole: "LOWER(COALESCE(required_role_code, ''))",
      requestedBy: "LOWER(COALESCE(NULLIF(BTRIM(requested_by_display_name), ''), NULLIF(BTRIM(requested_by_email), ''), ''))",
      requestedAt: 'COALESCE(requested_at, created_at)',
      decidedBy: "LOWER(COALESCE(NULLIF(BTRIM(decided_by_display_name), ''), NULLIF(BTRIM(decided_by_email), ''), ''))",
      decidedAt: 'decided_at',
    },
    defaultSorts: [{ field: 'requestedAt', direction: 'desc' }],
    tieBreakers: ['created_at DESC', 'approval_request_id DESC'],
  });
  const countValues = [...values];
  const offset = (page - 1) * limit;
  const itemValues = [...values, limit, offset];
  const limitParameter = itemValues.length - 1;
  const offsetParameter = itemValues.length;

  const [countResult, itemResult, categoryResult, workflowResult, roleResult, userResult, statusResult] = await Promise.all([
    query(
      `
        SELECT COUNT(*)::integer AS total
        FROM worker.vw_workflow_approval_requests
        ${whereClause}
      `,
      countValues,
    ),
    query(
      `
        SELECT *
        FROM worker.vw_workflow_approval_requests
        ${whereClause}
        ${orderBy}
        LIMIT $${limitParameter}
        OFFSET $${offsetParameter}
      `,
      itemValues,
    ),
    query(
      `
        SELECT c.category_code AS workflow_category_code,
               c.display_name AS workflow_category_display_name
        FROM worker.workflow_categories c
        WHERE c.enabled = TRUE
          AND EXISTS (
            SELECT 1
            FROM worker.vw_workflow_approval_requests a
            WHERE a.workflow_category_code = c.category_code
          )
        ORDER BY c.display_order, c.display_name, c.category_code
      `,
    ),
    query(
      `
        SELECT workflow_code, MAX(workflow_display_name) AS workflow_display_name
        FROM worker.vw_workflow_approval_requests
        WHERE workflow_code IS NOT NULL
        GROUP BY workflow_code
        ORDER BY MAX(workflow_display_name), workflow_code
      `,
    ),
    query(
      `
        SELECT DISTINCT required_role_code
        FROM worker.vw_workflow_approval_requests
        WHERE required_role_code IS NOT NULL
          AND BTRIM(required_role_code) <> ''
        ORDER BY required_role_code
      `,
    ),
    query(
      `
        SELECT user_id, MAX(display_name) AS display_name, MAX(email) AS email
        FROM (
          SELECT requested_by_user_id AS user_id,
                 requested_by_display_name AS display_name,
                 requested_by_email AS email
          FROM worker.vw_workflow_approval_requests
          WHERE requested_by_user_id IS NOT NULL
          UNION ALL
          SELECT decided_by_user_id AS user_id,
                 decided_by_display_name AS display_name,
                 decided_by_email AS email
          FROM worker.vw_workflow_approval_requests
          WHERE decided_by_user_id IS NOT NULL
        ) approval_users
        GROUP BY user_id
        ORDER BY COALESCE(MAX(display_name), MAX(email), user_id::text)
      `,
    ),
    query(
      `
        SELECT status, COUNT(*)::integer AS count
        FROM worker.vw_workflow_approval_requests
        GROUP BY status
        ORDER BY status
      `,
    ),
  ]);

  const total = Number(countResult.rows[0]?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return {
    total,
    limit,
    page,
    pageCount,
    items: itemResult.rows.map(normalizeApprovalRow),
    facets: {
      categories: categoryResult.rows.map((row) => ({
        value: row.workflow_category_code,
        label: row.workflow_category_display_name || row.workflow_category_code,
      })),
      workflows: workflowResult.rows.map((row) => ({
        value: row.workflow_code,
        label: row.workflow_display_name || row.workflow_code,
      })),
      roles: roleResult.rows.map((row) => row.required_role_code),
      users: userResult.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name || null,
        email: row.email || null,
      })),
      statuses: statusResult.rows.map((row) => ({
        status: row.status,
        count: Number(row.count || 0),
      })),
    },
  };
}

async function getWorkflowApprovalRequestsForRun(workflowRunRecordId) {
  if (!workflowRunRecordId) {
    return [];
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_approval_requests
      WHERE workflow_run_record_id = $1
      ORDER BY COALESCE(requested_at, created_at), created_at
    `,
    [workflowRunRecordId],
  );

  return result.rows.map(normalizeApprovalRow);
}

async function decideWorkflowApprovalRequest({
  approvalRequestId,
  payload = {},
  user,
  permissions = [],
  context = {},
} = {}) {
  assertPermission({
    permissionCode: 'WORKFLOW_APPROVAL_DECIDE',
    permissions,
    action: 'decide_workflow_approval',
  });

  const approval = await getWorkflowApprovalRequestById(approvalRequestId);

  if (!approval) {
    throw new WorkflowServiceError('Approval request was not found.', 404, {
      approvalRequestId,
    });
  }

  if (approval.status !== 'PENDING') {
    throw new WorkflowServiceError('Approval request has already been decided.', 409, {
      approvalRequestId,
      status: approval.status,
    });
  }

  assertApprovalRole({
    requiredRoleCode: approval.requiredRoleCode,
    permissions,
  });

  const decision = normalizeApprovalDecision(payload.decision || payload.status);
  const decisionNote =
    String(payload.decisionNote || payload.note || '')
      .trim()
      .slice(0, 4000) || null;

  if (!approval.temporalWorkflowId) {
    throw new WorkflowServiceError('Approval request is not linked to a Temporal workflow.', 409, {
      approvalRequestId,
    });
  }

  const actor = {
    userId: user?.userId || null,
    email: user?.email || null,
    displayName: user?.displayName || user?.email || null,
  };
  const decidedAt = new Date().toISOString();
  const signalPayload = {
    approvalRequestId: approval.approvalRequestId,
    workflowRunRecordId: approval.workflowRunRecordId,
    workflowNodeRunRecordId: approval.workflowNodeRunRecordId,
    nodeKey: approval.nodeKey,
    approvalKey: approval.approvalKey,
    decision,
    decisionNote,
    actor,
    decidedAt,
  };

  const signalResult = await temporalService.signalWorkflow({
    workflowId: approval.temporalWorkflowId,
    runId: approval.temporalRunId,
    signalName: approval.signalName || HUMAN_APPROVAL_DECISION_SIGNAL,
    payload: signalPayload,
  });

  const resolved = await resolveWorkflowApprovalRequest({
    approvalRequestId: approval.approvalRequestId,
    decision,
    decisionNote,
    user,
    metadata: {
      decidedVia: 'api',
      signalSent: true,
      signalResult,
      requestContext: getSafeObject(context),
    },
  });

  await recordWorkflowAuditEvent({
    user,
    context,
    eventType: 'WORKFLOW_APPROVAL_DECIDED',
    resourceType: 'worker.workflow_approval_requests',
    resourceId: resolved.approvalRequestId,
    action: 'decide_workflow_approval',
    success: true,
    message: `Workflow approval ${decision.toLowerCase()}.`,
    metadata: {
      workflowRunRecordId: resolved.workflowRunRecordId,
      workflowNodeRunRecordId: resolved.workflowNodeRunRecordId,
      nodeKey: resolved.nodeKey,
      approvalKey: resolved.approvalKey,
      requiredRoleCode: resolved.requiredRoleCode,
      decision,
      decisionNote,
      temporalWorkflowId: resolved.temporalWorkflowId || approval.temporalWorkflowId || null,
      temporalRunId: resolved.temporalRunId || approval.temporalRunId || null,
    },
  });

  return {
    approval: resolved,
    signal: signalResult,
    output: buildHumanApprovalOutput({
      approval: resolved,
      decision,
      decisionNote,
      actor,
    }),
  };
}

async function listChildWorkflowRuns(parentWorkflowRunRecordId) {
  if (!parentWorkflowRunRecordId) {
    return [];
  }

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_run_records
      WHERE input->>'parentWorkflowRunRecordId' = $1
         OR metadata->>'parentWorkflowRunRecordId' = $1
      ORDER BY COALESCE(started_at, created_at), created_at
    `,
    [String(parentWorkflowRunRecordId)],
  );

  return result.rows.map(normalizeRunRow);
}

async function findWorkflowRunRoot(run, maxDepth = 10) {
  let current = run;
  const visited = new Set();

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const parentId = getRunParentWorkflowRunRecordId(current);

    if (!parentId || visited.has(parentId)) {
      return current;
    }

    visited.add(parentId);
    const parent = await getWorkflowRunById(parentId);

    if (!parent) {
      return current;
    }

    current = parent;
  }

  return current;
}

async function buildWorkflowRunTree(run, { depth = 0, maxDepth = 6, visited = new Set() } = {}) {
  if (!run || visited.has(run.workflowRunRecordId)) {
    return null;
  }

  visited.add(run.workflowRunRecordId);
  const [nodeRuns, childRuns] = await Promise.all([
    getWorkflowNodeRunsForRun(run.workflowRunRecordId),
    depth >= maxDepth ? Promise.resolve([]) : listChildWorkflowRuns(run.workflowRunRecordId),
  ]);

  const children = [];

  for (const childRun of childRuns) {
    const childTree = await buildWorkflowRunTree(childRun, {
      depth: depth + 1,
      maxDepth,
      visited,
    });

    if (childTree) {
      children.push(childTree);
    }
  }

  return {
    run,
    nodeRuns,
    children,
    parentWorkflowRunRecordId: getRunParentWorkflowRunRecordId(run),
    parentNodeKey: getRunParentNodeKey(run),
    depth,
    truncated: depth >= maxDepth && childRuns.length > 0,
  };
}

async function getWorkflowRunRelations(run) {
  const parentWorkflowRunRecordId = getRunParentWorkflowRunRecordId(run);
  const [parentRun, childRuns] = await Promise.all([
    parentWorkflowRunRecordId
      ? getWorkflowRunById(parentWorkflowRunRecordId)
      : Promise.resolve(null),
    listChildWorkflowRuns(run.workflowRunRecordId),
  ]);
  const rootRun = await findWorkflowRunRoot(run);
  const runTree = await buildWorkflowRunTree(rootRun, { maxDepth: 6 });

  return {
    parentRun,
    childRuns,
    rootRun,
    runTree,
    selectedRunId: run.workflowRunRecordId,
  };
}

async function getWorkflowRun(workflowRunRecordId) {
  const run = await getWorkflowRunById(workflowRunRecordId);

  if (!run) {
    throw new WorkflowServiceError('Workflow run was not found.', 404, {
      workflowRunRecordId,
    });
  }

  const [nodeRuns, nodeOutputs, contextValues, relations, approvals, definitionGraph] =
    await Promise.all([
      getWorkflowNodeRunsForRun(workflowRunRecordId),
      getWorkflowNodeOutputsForRun(workflowRunRecordId),
      getWorkflowContextValuesForRun(workflowRunRecordId),
      getWorkflowRunRelations(run),
      getWorkflowApprovalRequestsForRun(workflowRunRecordId),
      getWorkflowVersionGraph(run.workflowVersionId),
    ]);

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
    nodeRuns,
    nodeOutputs,
    contextValues,
    approvals,
    definitionGraph,
    relations,
    runTree: relations.runTree,
    temporalRuntime,
  };
}

function isWorkflowRunStatusActive(status) {
  return ACTIVE_RUN_STATUSES.has(
    String(status || '')
      .trim()
      .toUpperCase(),
  );
}

function normalizeTelemetryDurationMs(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric);
}

function getTelemetryDateMs(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function getTelemetryDurationBetween(start, end) {
  const startMs = getTelemetryDateMs(start);
  const endMs = getTelemetryDateMs(end);

  if (startMs === null || endMs === null) {
    return null;
  }

  return Math.max(0, endMs - startMs);
}

function getRunDurationMs(run = {}) {
  return (
    normalizeTelemetryDurationMs(run.durationMs) ??
    normalizeTelemetryDurationMs(run.metadata?.durationMs) ??
    normalizeTelemetryDurationMs(run.output?.durationMs) ??
    getTelemetryDurationBetween(
      run.startedAt || run.createdAt,
      run.completedAt || (isWorkflowRunStatusActive(run.status) ? new Date().toISOString() : null),
    )
  );
}

function getNodeRunDurationMs(nodeRun = {}) {
  if (!nodeRun) {
    return null;
  }

  return (
    normalizeTelemetryDurationMs(nodeRun.durationMs) ??
    normalizeTelemetryDurationMs(nodeRun.metadata?.durationMs) ??
    normalizeTelemetryDurationMs(nodeRun.output?.durationMs) ??
    getTelemetryDurationBetween(
      nodeRun.startedAt || nodeRun.createdAt,
      nodeRun.completedAt ||
        (isWorkflowRunStatusActive(nodeRun.status) ? new Date().toISOString() : null),
    )
  );
}

function summarizeWorkflowNodeOutput(output = {}) {
  const safeOutput = getSafeObject(output);

  if (safeOutput.summary) {
    return String(safeOutput.summary);
  }

  if (safeOutput.message) {
    return String(safeOutput.message);
  }

  if (safeOutput.kind === 'tool_execution') {
    return `${safeOutput.toolCode || 'Tool'} finished with ${safeOutput.status || 'UNKNOWN'}`;
  }

  if (safeOutput.kind === 'api_call') {
    return `API ${safeOutput.method || ''} ${safeOutput.url || ''} returned ${safeOutput.statusCode || 'unknown status'}`.trim();
  }

  if (safeOutput.kind === 'condition_evaluation') {
    return `Condition ${safeOutput.passed ? 'passed' : 'did not pass'}.`;
  }

  if (safeOutput.kind === 'human_approval') {
    return `Human approval ${safeOutput.status || safeOutput.decision || 'completed'}.`;
  }

  return '';
}

function buildWorkflowTelemetryNode({ node = {}, nodeRun = null, index = 0 } = {}) {
  const status = nodeRun?.status || 'QUEUED';
  const startedAt = nodeRun?.startedAt || nodeRun?.createdAt || null;
  const completedAt = nodeRun?.completedAt || null;

  return {
    nodeId: node.nodeKey || nodeRun?.nodeKey || `node-${index + 1}`,
    nodeKey: node.nodeKey || nodeRun?.nodeKey || null,
    nodeRunRecordId: nodeRun?.workflowNodeRunRecordId || null,
    nodeType: node.nodeTypeCode || nodeRun?.nodeTypeCode || null,
    label: node.displayName || nodeRun?.nodeKey || `Node ${index + 1}`,
    status,
    targetCode: node.targetCode || nodeRun?.targetCode || null,
    startedAt,
    completedAt,
    durationMs: getNodeRunDurationMs(nodeRun),
    attemptCount: nodeRun?.attemptCount ?? 0,
    outputSummary: summarizeWorkflowNodeOutput(nodeRun?.output),
    output: nodeRun?.output || {},
    errorMessage: nodeRun?.errorMessage || null,
    metadata: nodeRun?.metadata || {},
  };
}

function findTelemetryCurrentNodeId(nodes = [], run = {}) {
  const runningNode = nodes.find((node) => isWorkflowRunStatusActive(node.status));

  if (runningNode) {
    return runningNode.nodeId;
  }

  if (!isWorkflowRunStatusActive(run.status)) {
    return null;
  }

  const queuedNode = nodes.find((node) => String(node.status || '').toUpperCase() === 'QUEUED');

  return queuedNode?.nodeId || null;
}

function groupNodeOutputsByNodeKey(nodeOutputs = []) {
  return nodeOutputs.reduce((accumulator, output) => {
    const nodeKey = String(output?.nodeKey || '').trim();

    if (!nodeKey) {
      return accumulator;
    }

    if (!accumulator[nodeKey]) {
      accumulator[nodeKey] = [];
    }

    accumulator[nodeKey].push(output);
    return accumulator;
  }, {});
}

function buildWorkflowRunTelemetrySnapshot(detail = {}) {
  const run = detail.run || {};
  const definitionNodes = detail.definitionGraph?.nodes || [];
  const nodeRuns = detail.nodeRuns || [];
  const nodeRunsByKey = new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeKey, nodeRun]));
  const persistedOutputsByNodeKey = groupNodeOutputsByNodeKey(detail.nodeOutputs || []);
  const contextObject = buildContextObjectFromRows(detail.contextValues || []);
  const nodes =
    definitionNodes.length > 0
      ? definitionNodes.map((node, index) => ({
          ...buildWorkflowTelemetryNode({
            node,
            nodeRun: nodeRunsByKey.get(node.nodeKey) || null,
            index,
          }),
          persistedOutputs: persistedOutputsByNodeKey[node.nodeKey] || [],
        }))
      : nodeRuns.map((nodeRun, index) => ({
          ...buildWorkflowTelemetryNode({ nodeRun, index }),
          persistedOutputs: persistedOutputsByNodeKey[nodeRun.nodeKey] || [],
        }));
  const currentNodeId = findTelemetryCurrentNodeId(nodes, run);
  const activeNodeCount = nodes.filter((node) => isWorkflowRunStatusActive(node.status)).length;
  const completedNodeCount = nodes.filter((node) => node.status === TERMINAL_SUCCESS_STATUS).length;
  const failedNodeCount = nodes.filter((node) => node.status === TERMINAL_FAILURE_STATUS).length;

  return {
    generatedAt: new Date().toISOString(),
    workflowRunRecordId: run.workflowRunRecordId,
    runId: run.workflowRunRecordId,
    workflowName: run.workflowDisplayName || run.workflowCode,
    workflowCode: run.workflowCode,
    status: run.status,
    active: isWorkflowRunStatusActive(run.status),
    currentNodeId,
    startedAt: run.startedAt || run.createdAt || null,
    completedAt: run.completedAt || null,
    durationMs: getRunDurationMs(run),
    summary: run.summary || null,
    runtime: run.temporalWorkflowId ? 'temporal' : 'inline',
    temporalWorkflowId: run.temporalWorkflowId || null,
    temporalRunId: run.temporalRunId || null,
    nodes,
    nodeOutputs: detail.nodeOutputs || [],
    outputsByNodeKey: persistedOutputsByNodeKey,
    contextValues: detail.contextValues || [],
    contextObject,
    approvals: detail.approvals || [],
    counts: {
      nodes: nodes.length,
      activeNodes: activeNodeCount,
      completedNodes: completedNodeCount,
      failedNodes: failedNodeCount,
      approvals: (detail.approvals || []).length,
      pendingApprovals: (detail.approvals || []).filter((approval) => approval.status === 'PENDING')
        .length,
    },
  };
}

async function listActiveWorkflowRuns(filters = {}) {
  const limit = parseLimit(filters.limit);
  const clauses = ['status = ANY($1::text[])'];
  const values = [[...ACTIVE_RUN_STATUSES]];
  const workflowCode = String(filters.workflowCode || '').trim();

  if (workflowCode) {
    values.push(workflowCode);
    clauses.push(`workflow_code = $${values.length}`);
  }

  values.push(limit);

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_run_records
      WHERE ${clauses.join(' AND ')}
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

async function getWorkflowRunTelemetry(workflowRunRecordId) {
  const detail = await getWorkflowRun(workflowRunRecordId);

  return {
    ...detail,
    telemetry: buildWorkflowRunTelemetrySnapshot(detail),
  };
}

module.exports = {
  WorkflowServiceError,
  completeWorkflowNodeRun,
  completeWorkflowRun,
  archiveWorkflowDefinition,
  cloneWorkflowDefinition,
  createWorkflowDraftVersion,
  deleteWorkflowDefinition,
  discardWorkflowDraftVersion,
  createChildWorkflowRun,
  createWorkflowDefinition,
  createWorkflowVersion,
  replaceWorkflowGraph,
  evaluateConditionNode,
  resolveConditionBranchIndex,
  executeWorkflow,
  executeWorkflowNode,
  failWorkflowNodeRun,
  failWorkflowRun,
  requestWorkflowRunControlAction,
  retryWorkflowRun,
  retryWorkflowNode,
  getWorkflowNodeRecoveryState,
  getWorkflowDefinition,
  getWorkflowDefinitionForVersion,
  getWorkflowDefinitionForManage,
  getWorkflowRun,
  getWorkflowRunTelemetry,
  getWorkflowNodeOutputsForRun,
  getWorkflowContextValuesForRun,
  createWorkflowApprovalRequest,
  decideWorkflowApprovalRequest,
  publishWorkflowDraftVersion,
  listWorkflowApprovalRequests,
  resolveWorkflowApprovalRequest,
  listBuilderCatalog,
  listWorkflowCategories,
  linkWorkflowRunToTemporal,
  listWorkflowDefinitions,
  listActiveWorkflowRuns,
  listWorkflowRuns,
  markWorkflowNodeAttempt,
  startWorkflowNodeRun,
  saveWorkflowDraftGraph,
  startWorkflowWithTemporal,
  updateWorkflowDefinition,
  validateWorkflowRuntimeInput,
};
