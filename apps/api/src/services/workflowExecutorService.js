const axios = require('axios');
const { pool, query } = require('../../../../packages/db/src/connection');
const scriptExecutionService = require('./scriptExecutionService');
const temporalService = require('./temporalService');
const toolManifestService = require('./toolManifestService');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SUPPORTED_NODE_TYPES = new Set(['TOOL', 'API_CALL', 'WORKFLOW', 'TEMPORAL_WORKFLOW', 'CONDITION', 'WAIT', 'HUMAN_APPROVAL']);
const TERMINAL_SUCCESS_STATUS = 'COMPLETED';
const TERMINAL_FAILURE_STATUS = 'FAILED';
const DEFAULT_START_PERMISSION = 'WORKFLOW_START';
const DEFAULT_CANCEL_PERMISSION = 'WORKFLOW_CANCEL';
const DEFAULT_CONDITION_ON_FALSE = 'STOP_SUCCESS';
const DEFAULT_WAIT_DURATION_MS = 1000;
const MAX_WAIT_DURATION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HUMAN_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
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

  const raw = value === undefined || value === null || value === '' ? '200,201,202,204' : String(value);
  const codes = raw
    .split(/[,\s]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item >= 100 && item <= 599);

  return codes.length > 0 ? codes : [200, 201, 202, 204];
}

function normalizeConditionOperator(value) {
  const normalized = String(value || 'truthy')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    '': 'TRUTHY',
    TRUE: 'TRUTHY',
    IS_TRUE: 'TRUTHY',
    TRUTHY: 'TRUTHY',
    FALSE: 'FALSY',
    IS_FALSE: 'FALSY',
    FALSY: 'FALSY',
    EXISTS: 'EXISTS',
    NOT_EXISTS: 'NOT_EXISTS',
    MISSING: 'NOT_EXISTS',
    EQUALS: 'EQUALS',
    EQUAL: 'EQUALS',
    EQ: 'EQUALS',
    NOT_EQUALS: 'NOT_EQUALS',
    NOT_EQUAL: 'NOT_EQUALS',
    NE: 'NOT_EQUALS',
    CONTAINS: 'CONTAINS',
    NOT_CONTAINS: 'NOT_CONTAINS',
    GREATER_THAN: 'GREATER_THAN',
    GT: 'GREATER_THAN',
    GREATER_OR_EQUAL: 'GREATER_OR_EQUAL',
    GTE: 'GREATER_OR_EQUAL',
    LESS_THAN: 'LESS_THAN',
    LT: 'LESS_THAN',
    LESS_OR_EQUAL: 'LESS_OR_EQUAL',
    LTE: 'LESS_OR_EQUAL',
  };
  const operator = aliases[normalized] || normalized;
  const allowed = new Set([
    'TRUTHY',
    'FALSY',
    'EXISTS',
    'NOT_EXISTS',
    'EQUALS',
    'NOT_EQUALS',
    'CONTAINS',
    'NOT_CONTAINS',
    'GREATER_THAN',
    'GREATER_OR_EQUAL',
    'LESS_THAN',
    'LESS_OR_EQUAL',
  ]);

  if (!allowed.has(operator)) {
    throw new WorkflowServiceError('Unsupported CONDITION operator.', 400, {
      operator: value,
      allowed: [...allowed],
    });
  }

  return operator;
}

function normalizeConditionOnFalse(value) {
  const normalized = String(value || DEFAULT_CONDITION_ON_FALSE)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases = {
    '': DEFAULT_CONDITION_ON_FALSE,
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
    throw new WorkflowServiceError('Unsupported CONDITION onFalse action.', 400, {
      onFalse: value,
      allowed: [...allowed],
    });
  }

  return action;
}

function normalizeConditionBranchTargetNodeKey(value) {
  return String(value || '').trim();
}

function normalizeConditionValueType(value) {
  const normalized = String(value || 'AUTO').trim().toUpperCase();
  const allowed = new Set(['AUTO', 'STRING', 'NUMBER', 'BOOLEAN', 'JSON']);

  if (!allowed.has(normalized)) {
    throw new WorkflowServiceError('Unsupported CONDITION value type.', 400, {
      valueType: value,
      allowed: [...allowed],
    });
  }

  return normalized;
}

function hasOwnValue(source, propertyName) {
  return Object.prototype.hasOwnProperty.call(source || {}, propertyName);
}

function isBlankValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseConditionTypedValue(value, valueType = 'AUTO') {
  const normalizedType = normalizeConditionValueType(valueType);

  if (normalizedType === 'STRING') {
    return value === undefined || value === null ? '' : String(value);
  }

  if (normalizedType === 'NUMBER') {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      throw new WorkflowServiceError('CONDITION number value must be numeric.', 400, { value });
    }

    return parsed;
  }

  if (normalizedType === 'BOOLEAN') {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = String(value || '').trim().toLowerCase();

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }

    throw new WorkflowServiceError('CONDITION boolean value must be true or false.', 400, { value });
  }

  if (normalizedType === 'JSON') {
    if (typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(String(value || 'null'));
    } catch (error) {
      throw new WorkflowServiceError('CONDITION JSON value must be valid JSON.', 400, {
        value,
        parseError: error.message,
      });
    }
  }

  if (typeof value !== 'string') {
    return value;
  }

  const text = value.trim();

  if (text === '') {
    return '';
  }

  const lower = text.toLowerCase();

  if (lower === 'true') {
    return true;
  }

  if (lower === 'false') {
    return false;
  }

  if (lower === 'null') {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);

    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return text;
}

function normalizeConditionParameters(parameters = {}) {
  const input = getSafeObject(parameters);
  const operator = normalizeConditionOperator(input.operator || input.conditionOperator);
  const onFalse = normalizeConditionOnFalse(input.onFalse || input.falseAction);
  const leftPath = String(input.leftPath || input.sourcePath || input.path || '').trim();
  const rightType = normalizeConditionValueType(input.rightType || input.valueType || 'AUTO');
  const leftType = normalizeConditionValueType(input.leftType || 'AUTO');
  const unaryOperators = new Set(['TRUTHY', 'FALSY', 'EXISTS', 'NOT_EXISTS']);
  const hasLeftLiteral = hasOwnValue(input, 'leftValue') && !isBlankValue(input.leftValue);
  const hasRightValue = hasOwnValue(input, 'rightValue') && !isBlankValue(input.rightValue);

  if (!leftPath && !hasLeftLiteral) {
    throw new WorkflowServiceError('CONDITION nodes require a leftPath or leftValue.', 400, {
      fieldName: 'leftPath',
    });
  }

  if (!unaryOperators.has(operator) && !hasRightValue) {
    throw new WorkflowServiceError('CONDITION comparison operators require rightValue.', 400, {
      fieldName: 'rightValue',
      operator,
    });
  }

  return {
    ...input,
    leftPath,
    leftValue: hasLeftLiteral ? input.leftValue : input.leftValue,
    leftType,
    operator,
    rightValue: hasRightValue ? input.rightValue : input.rightValue,
    rightType,
    caseSensitive: input.caseSensitive === true || input.caseSensitive === 'true' || input.caseSensitive === '1',
    onFalse,
    trueTargetNodeKey: normalizeConditionBranchTargetNodeKey(input.trueTargetNodeKey || input.trueTarget || input.onTrueTargetNodeKey),
    falseTargetNodeKey: normalizeConditionBranchTargetNodeKey(input.falseTargetNodeKey || input.falseTarget || input.onFalseTargetNodeKey),
  };
}

function getValueAtPath(source, path) {
  const normalizedPath = String(path || '').trim();

  if (!normalizedPath) {
    return undefined;
  }

  const segments = normalizedPath
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current = source;

  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }

    if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function isConditionTruthy(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    return !['', 'false', '0', 'no', 'off', 'null', 'undefined'].includes(normalized);
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return Boolean(value);
}

function normalizeComparable(value, { caseSensitive = false } = {}) {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return caseSensitive ? value : value.toLowerCase();
  }

  try {
    const text = JSON.stringify(value);
    return caseSensitive ? text : text.toLowerCase();
  } catch (error) {
    const text = String(value);
    return caseSensitive ? text : text.toLowerCase();
  }
}

function compareConditionValues(leftValue, rightValue, operator, { caseSensitive = false } = {}) {
  if (operator === 'TRUTHY') {
    return isConditionTruthy(leftValue);
  }

  if (operator === 'FALSY') {
    return !isConditionTruthy(leftValue);
  }

  if (operator === 'EXISTS') {
    return leftValue !== undefined && leftValue !== null;
  }

  if (operator === 'NOT_EXISTS') {
    return leftValue === undefined || leftValue === null;
  }

  if (['GREATER_THAN', 'GREATER_OR_EQUAL', 'LESS_THAN', 'LESS_OR_EQUAL'].includes(operator)) {
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);

    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
      return false;
    }

    if (operator === 'GREATER_THAN') {
      return leftNumber > rightNumber;
    }

    if (operator === 'GREATER_OR_EQUAL') {
      return leftNumber >= rightNumber;
    }

    if (operator === 'LESS_THAN') {
      return leftNumber < rightNumber;
    }

    return leftNumber <= rightNumber;
  }

  if (operator === 'CONTAINS' || operator === 'NOT_CONTAINS') {
    let contains = false;

    if (Array.isArray(leftValue)) {
      const comparableRight = normalizeComparable(rightValue, { caseSensitive });
      contains = leftValue.some((item) => normalizeComparable(item, { caseSensitive }) === comparableRight);
    } else {
      const leftText = String(leftValue === undefined || leftValue === null ? '' : leftValue);
      const rightText = String(rightValue === undefined || rightValue === null ? '' : rightValue);
      contains = caseSensitive
        ? leftText.includes(rightText)
        : leftText.toLowerCase().includes(rightText.toLowerCase());
    }

    return operator === 'CONTAINS' ? contains : !contains;
  }

  const normalizedLeft = normalizeComparable(leftValue, { caseSensitive });
  const normalizedRight = normalizeComparable(rightValue, { caseSensitive });
  const equals = normalizedLeft === normalizedRight;

  return operator === 'NOT_EQUALS' ? !equals : equals;
}

function serializeConditionValue(value) {
  if (value === undefined) {
    return null;
  }

  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
}

function evaluateConditionNode({ node, parameters = {}, context = {} }) {
  const normalizedParameters = normalizeConditionParameters(parameters);
  const evaluationContext = getSafeObject(context.conditionEvaluation, {});
  const leftValueFromPath = normalizedParameters.leftPath
    ? getValueAtPath(evaluationContext, normalizedParameters.leftPath)
    : undefined;
  const useLeftPathValue = normalizedParameters.leftPath && leftValueFromPath !== undefined;
  const leftValue = useLeftPathValue
    ? leftValueFromPath
    : parseConditionTypedValue(normalizedParameters.leftValue, normalizedParameters.leftType);
  const unaryOperators = new Set(['TRUTHY', 'FALSY', 'EXISTS', 'NOT_EXISTS']);
  const rightValue = unaryOperators.has(normalizedParameters.operator)
    ? undefined
    : parseConditionTypedValue(normalizedParameters.rightValue, normalizedParameters.rightType);
  const passed = compareConditionValues(leftValue, rightValue, normalizedParameters.operator, {
    caseSensitive: normalizedParameters.caseSensitive,
  });
  const branchTargetNodeKey = passed
    ? normalizedParameters.trueTargetNodeKey || null
    : normalizedParameters.falseTargetNodeKey || null;
  const branchLabel = passed ? 'TRUE' : 'FALSE';
  const summary = branchTargetNodeKey
    ? `Condition ${node.displayName || node.nodeKey} resolved ${branchLabel}; routing to ${branchTargetNodeKey}.`
    : passed
      ? `Condition ${node.displayName || node.nodeKey} passed; continuing workflow.`
      : `Condition ${node.displayName || node.nodeKey} did not pass; ${normalizedParameters.onFalse === 'STOP_SUCCESS' ? 'stopping workflow successfully' : normalizedParameters.onFalse === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`;

  return {
    kind: 'condition_evaluation',
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    operator: normalizedParameters.operator,
    leftPath: normalizedParameters.leftPath || null,
    leftValue: serializeConditionValue(leftValue),
    leftExists: leftValue !== undefined && leftValue !== null,
    rightValue: serializeConditionValue(rightValue),
    rightType: normalizedParameters.rightType,
    caseSensitive: normalizedParameters.caseSensitive,
    onFalse: normalizedParameters.onFalse,
    trueTargetNodeKey: normalizedParameters.trueTargetNodeKey || null,
    falseTargetNodeKey: normalizedParameters.falseTargetNodeKey || null,
    branchTargetNodeKey,
    branchLabel,
    branchTaken: Boolean(branchTargetNodeKey),
    summary,
  };
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
  const rawDuration = input.duration ?? input.waitDuration ?? input.delayDuration ?? DEFAULT_WAIT_DURATION_MS / WAIT_UNIT_MULTIPLIERS_MS[unit];
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
      throw new WorkflowServiceError('HUMAN_APPROVAL timeoutMs must be a positive number or blank.', 400, {
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
    throw new WorkflowServiceError('HUMAN_APPROVAL timeout duration must be a positive number or blank.', 400, {
      timeoutDuration: rawDuration,
    });
  }

  return Math.round(parsedDuration * HUMAN_APPROVAL_TIMEOUT_UNIT_MULTIPLIERS_MS[unit]);
}

function normalizeHumanApprovalParameters(parameters = {}, node = {}) {
  const input = getSafeObject(parameters);
  const approvalTitle = String(input.approvalTitle || input.title || node.displayName || 'Approval required').trim();
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
    instructions: String(input.instructions || input.prompt || '').trim().slice(0, 4000),
    approvalKey,
    requiredRoleCode: normalizeRoleCode(input.requiredRoleCode || input.requiredRole) || null,
    onReject: normalizeHumanApprovalAction(input.onReject || input.rejectAction || 'STOP_SUCCESS', 'onReject action'),
    onTimeout: normalizeHumanApprovalAction(input.onTimeout || input.timeoutAction || 'FAIL_WORKFLOW', 'onTimeout action'),
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
    return normalizeHumanApprovalAction(approvalParameters.onReject || 'STOP_SUCCESS', 'onReject action');
  }

  if (decision === 'TIMED_OUT') {
    return normalizeHumanApprovalAction(approvalParameters.onTimeout || 'FAIL_WORKFLOW', 'onTimeout action');
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
    nodeKey: item.nodeKey,
    nodeDisplayName: item.nodeDisplayName,
    nodeTypeCode: item.nodeTypeCode,
    approvalKey: item.approvalKey,
    approvalTitle: item.approvalTitle,
    instructions: item.instructions,
    status: item.status,
    requiredRoleCode: item.requiredRoleCode,
    onReject: item.onReject,
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
    const roles = parseGrantedRoleCodes(permission.grantedThroughRoles || permission.granted_through_roles);

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
    throw new WorkflowServiceError('Approval requires a role the current user does not have.', 403, {
      requiredRoleCode: normalizedRole,
    });
  }
}

function buildHumanApprovalOutput({ approval, decision, decisionNote = null, actor = null, timedOut = false } = {}) {
  const normalizedDecision = normalizeApprovalDecision(decision);
  const action = getApprovalActionForDecision(normalizedDecision, approval);
  const actorName = actor?.displayName || actor?.email || approval?.decidedByDisplayName || approval?.decidedByEmail || null;
  const title = approval?.approvalTitle || approval?.title || 'Approval required';
  const summary = normalizedDecision === 'APPROVED'
    ? `Approval granted for ${title}${actorName ? ` by ${actorName}` : ''}; continuing workflow.`
    : normalizedDecision === 'REJECTED'
      ? `Approval rejected for ${title}${actorName ? ` by ${actorName}` : ''}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`
      : `Approval timed out for ${title}; ${action === 'STOP_SUCCESS' ? 'stopping workflow successfully' : action === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`;

  return {
    kind: 'human_approval',
    status: normalizedDecision,
    approved: normalizedDecision === 'APPROVED',
    rejected: normalizedDecision === 'REJECTED',
    timedOut: timedOut || normalizedDecision === 'TIMED_OUT',
    decision: normalizedDecision,
    action,
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
  throw new WorkflowServiceError('HUMAN_APPROVAL nodes require Temporal-backed execution so SkyServer can wait for an approval signal durably.', 409, {
    nodeTypeCode: 'HUMAN_APPROVAL',
    requiredExecutorMode: 'temporal',
  });
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
    INTERNAL: 'SKYSERVER_INTERNAL',
    INTERNAL_SERVICE: 'SKYSERVER_INTERNAL',
    SKY_SERVER_INTERNAL: 'SKYSERVER_INTERNAL',
    SKYSERVER_INTERNAL: 'SKYSERVER_INTERNAL',
  };

  const authMode = aliases[normalized] || normalized;
  const allowed = new Set(['AUTO', 'NONE', 'SKYSERVER_INTERNAL']);

  if (!allowed.has(authMode)) {
    throw new WorkflowServiceError('Unsupported API_CALL auth mode.', 400, {
      authMode: value,
      allowed: [...allowed],
    });
  }

  return authMode;
}

function getInternalApiToken() {
  return String(process.env.SKYSERVER_INTERNAL_API_TOKEN || '').trim();
}

function isLocalSkyServerUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return false;
  }

  const host = String(parsed.hostname || '').toLowerCase();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);

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

    if (token && isLocalSkyServerUrl(url)) {
      outputHeaders['x-skyserver-internal-token'] = token;
    }

    return outputHeaders;
  }

  if (authMode === 'SKYSERVER_INTERNAL') {
    if (!isLocalSkyServerUrl(url)) {
      throw new WorkflowServiceError('SkyServer internal API auth can only be used for the local SkyServer API.', 400, {
        url,
        authMode,
      });
    }

    const token = getInternalApiToken();

    if (!token) {
      throw new WorkflowServiceError('SKYSERVER_INTERNAL_API_TOKEN is required for SkyServer internal API auth.', 500, {
        authMode,
        envVar: 'SKYSERVER_INTERNAL_API_TOKEN',
      });
    }

    outputHeaders['x-skyserver-internal-token'] = token;
    return outputHeaders;
  }

  return outputHeaders;
}

function normalizeHttpMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
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

function normalizePositiveNumber(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function getNodeDisplayNameForType(nodeTypeCode, fallback = 'Workflow node') {
  const map = {
    API_CALL: 'Call API',
    CONDITION: 'Evaluate Condition',
    HUMAN_APPROVAL: 'Human Approval',
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

function getRunParentWorkflowRunRecordId(run = {}) {
  return run?.input?.parentWorkflowRunRecordId
    || run?.metadata?.parentWorkflowRunRecordId
    || null;
}

function getRunParentNodeKey(run = {}) {
  return run?.input?.parentNodeKey
    || run?.metadata?.parentNodeKey
    || null;
}

function normalizeRunRow(row) {
  const item = camelizeRow(row);
  const input = item.input || {};
  const metadata = item.metadata || {};
  const parentWorkflowRunRecordId = getRunParentWorkflowRunRecordId({ input, metadata });
  const parentNodeKey = getRunParentNodeKey({ input, metadata });
  const childWorkflow = item.runSource === 'child_workflow'
    || item.triggerType === 'CHILD_WORKFLOW'
    || metadata.childWorkflow === true
    || Boolean(parentWorkflowRunRecordId);

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


async function runApiCallNode({ node, parameters }) {
  const method = normalizeHttpMethod(parameters.method);
  const url = normalizeApiUrl(parameters.url || node.targetCode);
  const authMode = normalizeApiAuthMode(parameters.authMode || 'AUTO');
  const configuredHeaders = parseJsonText(parameters.headersJson ?? parameters.headers, {}, 'headersJson');
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
  const [nodeTypeResult, toolManifest, workflowTargetResult, temporalWorkflowTargetResult, approvalRoleResult] = await Promise.all([
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
          workflow_definition_id,
          workflow_code,
          display_name,
          description,
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

  const workflowTargets = workflowTargetResult.rows.map((row) => {
    const item = camelizeRow(row);

    return {
      nodeTypeCode: 'WORKFLOW',
      targetKind: 'worker.workflow_definitions',
      targetCode: item.workflowCode,
      targetRefId: item.workflowDefinitionId,
      displayName: item.displayName,
      description: item.description,
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

  return {
    nodeTypes,
    supportedNodeTypes: nodeTypes.filter((nodeType) => nodeType.initiallySupported),
    toolTargets,
    workflowTargets,
    temporalWorkflowTargets,
    approvalRoleTargets,
  };
}

function normalizeCreateNodeInput(node, index, seenKeys) {
  const nodeTypeCode = String(node.nodeTypeCode || 'TOOL').trim().toUpperCase();

  if (!SUPPORTED_NODE_TYPES.has(nodeTypeCode)) {
    throw new WorkflowServiceError('Workflow Builder currently supports TOOL, API_CALL, WORKFLOW, TEMPORAL_WORKFLOW, CONDITION, WAIT, and HUMAN_APPROVAL nodes.', 400, {
      nodeTypeCode,
      supportedNodeTypes: ['TOOL', 'API_CALL', 'WORKFLOW', 'TEMPORAL_WORKFLOW', 'CONDITION', 'WAIT', 'HUMAN_APPROVAL'],
    });
  }

  const inputParameters = getSafeObject(node.inputParameters);
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
    throw new WorkflowServiceError('Each WORKFLOW node requires a child workflow targetCode.', 400, {
      index,
    });
  }

  if (nodeTypeCode === 'TEMPORAL_WORKFLOW' && !targetCode) {
    throw new WorkflowServiceError('Each TEMPORAL_WORKFLOW node requires an approved Temporal workflow template targetCode.', 400, {
      index,
    });
  }

  if (nodeTypeCode === 'API_CALL') {
    normalizeApiUrl(inputParameters.url || targetCode);
    normalizeHttpMethod(inputParameters.method || 'GET');
    normalizeApiAuthMode(inputParameters.authMode || 'AUTO');
    parseJsonText(inputParameters.headersJson ?? inputParameters.headers, {}, `nodes[${index}].headersJson`);
    parseJsonText(inputParameters.bodyJson ?? inputParameters.body, null, `nodes[${index}].bodyJson`);
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
    displayName: String(node.displayName || node.label || targetCode || getNodeDisplayNameForType(nodeTypeCode)).trim(),
    description: String(node.description || '').trim() || null,
    targetCode: targetCode || null,
    inputParameters,
    retryPolicy: getSafeObject(node.retryPolicy),
    timeoutMs: node.timeoutMs ? Number.parseInt(node.timeoutMs, 10) : null,
    positionX: Number.isFinite(Number(node.positionX)) ? Number(node.positionX) : 80 + index * 280,
    positionY: Number.isFinite(Number(node.positionY)) ? Number(node.positionY) : 120,
    displayOrder: Number.isFinite(Number(node.displayOrder)) ? Number(node.displayOrder) : (index + 1) * 10,
    enabled: node.enabled !== false,
    config: getSafeObject(node.config, { builderCard: nodeTypeCode === 'API_CALL' ? 'api' : nodeTypeCode === 'WORKFLOW' ? 'workflow' : nodeTypeCode === 'TEMPORAL_WORKFLOW' ? 'temporal' : nodeTypeCode === 'CONDITION' ? 'condition' : nodeTypeCode === 'WAIT' ? 'wait' : nodeTypeCode === 'HUMAN_APPROVAL' ? 'human_approval' : 'tool' }),
  };
}

async function insertWorkflowEdges({ client, workflowVersionId, insertedNodes = [], createdBy = 'workflow_builder_v1' } = {}) {
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

    const { toolsByCode, workflowDefinitionsByCode, temporalDefinitionsByCode } = await validateWorkflowTargets(client, nodes, { parentWorkflowCode: workflowCode });

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
          builderVersion: '10.25',
          supportedNodeTypes: ['TOOL', 'API_CALL', 'WORKFLOW', 'TEMPORAL_WORKFLOW', 'CONDITION', 'WAIT', 'HUMAN_APPROVAL'],
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
      const tool = node.nodeTypeCode === 'TOOL' ? toolsByCode.get(node.targetCode) : null;
      const childWorkflow = node.nodeTypeCode === 'WORKFLOW' ? workflowDefinitionsByCode.get(node.targetCode) : null;
      const temporalDefinition = node.nodeTypeCode === 'TEMPORAL_WORKFLOW' ? temporalDefinitionsByCode.get(node.targetCode) : null;
      const targetRefId = tool?.tool_id || childWorkflow?.workflow_definition_id || temporalDefinition?.definition_id || null;
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
        node_type_display_name: getNodeDisplayNameForType(node.nodeTypeCode),
        node_type_category: getNodeCategoryForType(node.nodeTypeCode),
        target_kind: getNodeTargetKindForType(node.nodeTypeCode),
      }));
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
      throw new WorkflowServiceError('Condition true and false branches must target different nodes in Branching v1.', 400, {
        nodeKey: node.nodeKey,
        targetNodeKey: trueTargetNodeKey,
      });
    }

    for (const [branchLabel, targetNodeKey] of branchTargets) {
      if (!nodeKeyToIndex.has(targetNodeKey)) {
        throw new WorkflowServiceError('Condition branch target node was not found in this workflow graph.', 400, {
          nodeKey: node.nodeKey,
          branchLabel,
          targetNodeKey,
        });
      }

      const targetIndex = nodeKeyToIndex.get(targetNodeKey);

      if (targetIndex <= index) {
        throw new WorkflowServiceError('Condition branch targets must point to later nodes in the sequential lane.', 400, {
          nodeKey: node.nodeKey,
          branchLabel,
          targetNodeKey,
          currentDisplayOrder: index + 1,
          targetDisplayOrder: targetIndex + 1,
        });
      }
    }
  }
}

async function validateWorkflowTargets(client, nodes, { parentWorkflowCode = null } = {}) {
  validateConditionBranchTargets(nodes);

  const toolTargetCodes = [...new Set(
    nodes
      .filter((node) => node.nodeTypeCode === 'TOOL')
      .map((node) => node.targetCode),
  )];
  const workflowTargetCodes = [...new Set(
    nodes
      .filter((node) => node.nodeTypeCode === 'WORKFLOW')
      .map((node) => node.targetCode),
  )];
  const temporalWorkflowTargetCodes = [...new Set(
    nodes
      .filter((node) => node.nodeTypeCode === 'TEMPORAL_WORKFLOW')
      .map((node) => node.targetCode),
  )];
  const approvalRoleCodes = [...new Set(
    nodes
      .filter((node) => node.nodeTypeCode === 'HUMAN_APPROVAL')
      .map((node) => normalizeRoleCode(node.inputParameters?.requiredRoleCode || node.inputParameters?.requiredRole))
      .filter(Boolean),
  )];
  const normalizedParentWorkflowCode = String(parentWorkflowCode || '').trim();

  if (normalizedParentWorkflowCode && workflowTargetCodes.includes(normalizedParentWorkflowCode)) {
    throw new WorkflowServiceError('A workflow cannot directly contain itself as a child workflow node.', 400, {
      workflowCode: normalizedParentWorkflowCode,
    });
  }

  let toolsByCode = new Map();
  let workflowDefinitionsByCode = new Map();
  let temporalDefinitionsByCode = new Map();

  if (toolTargetCodes.length > 0) {
    const toolResult = await client.query(
      `
        SELECT tool_id, tool_code, label, description
        FROM core.tools
        WHERE tool_code = ANY($1::text[])
          AND enabled = TRUE
      `,
      [toolTargetCodes],
    );
    toolsByCode = new Map(toolResult.rows.map((row) => [row.tool_code, row]));
    const missingTools = toolTargetCodes.filter((targetCode) => !toolsByCode.has(targetCode));

    if (missingTools.length > 0) {
      throw new WorkflowServiceError('One or more tool targets were not found or are disabled.', 400, {
        missingTools,
      });
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
    const missingWorkflows = workflowTargetCodes.filter((targetCode) => !workflowDefinitionsByCode.has(targetCode));

    if (missingWorkflows.length > 0) {
      throw new WorkflowServiceError('One or more child workflow targets were not found, inactive, or unpublished.', 400, {
        missingWorkflows,
      });
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
        throw new WorkflowServiceError('Child workflow relationship would create a workflow cycle.', 400, {
          workflowCode: normalizedParentWorkflowCode,
          childWorkflowTargets: workflowTargetCodes,
          cyclePath: cycleResult.rows[0].path,
        });
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
    const missingTemporalWorkflows = temporalWorkflowTargetCodes.filter((targetCode) => !temporalDefinitionsByCode.has(targetCode));

    if (missingTemporalWorkflows.length > 0) {
      throw new WorkflowServiceError('One or more Temporal workflow template targets were not found, disabled, or hidden.', 400, {
        missingTemporalWorkflows,
      });
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
    const missingApprovalRoles = approvalRoleCodes.filter((roleCode) => !approvalRolesByCode.has(roleCode));

    if (missingApprovalRoles.length > 0) {
      throw new WorkflowServiceError('One or more human approval roles were not found or are inactive.', 400, {
        missingApprovalRoles,
      });
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
  const { toolsByCode, workflowDefinitionsByCode, temporalDefinitionsByCode } = await validateWorkflowTargets(client, nodes, { parentWorkflowCode: definition.workflowCode });
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
    const childWorkflow = node.nodeTypeCode === 'WORKFLOW' ? workflowDefinitionsByCode.get(node.targetCode) : null;
    const temporalDefinition = node.nodeTypeCode === 'TEMPORAL_WORKFLOW' ? temporalDefinitionsByCode.get(node.targetCode) : null;
    const targetRefId = tool?.tool_id || childWorkflow?.workflow_definition_id || temporalDefinition?.definition_id || null;
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

    insertedNodes.push(normalizeNodeRow({
      ...nodeResult.rows[0],
      workflow_definition_id: definition.workflowDefinitionId,
      workflow_code: definition.workflowCode,
      workflow_display_name: definition.displayName,
      version_number: versionNumber,
      version_status: status,
      node_type_display_name: getNodeDisplayNameForType(node.nodeTypeCode),
      node_type_category: getNodeCategoryForType(node.nodeTypeCode),
      target_kind: getNodeTargetKindForType(node.nodeTypeCode),
    }));
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
    throw new WorkflowServiceError('At least one supported workflow node is required for a workflow graph.', 400);
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
    throw new WorkflowServiceError('At least one supported workflow node is required for a workflow version.', 400);
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
    throw new WorkflowServiceError('A workflow cannot directly run itself as a child workflow.', 400, {
      parentWorkflowCode,
      childWorkflowCode: normalizedChildWorkflowCode,
      parentNodeKey,
    });
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
    permissionCode: definition.startPermissionCode,
    permissions,
    action: 'start_child_workflow',
  });

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
      executor: 'skyserver_workflow_executor_temporal_v1',
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
    summary: `Started child SkyServer workflow ${childWorkflowCode}.`,
    note: 'Inline fallback starts child workflows asynchronously. Temporal-backed parent workflows wait for child completion.',
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

function getConditionOnFalseFromOutput(output = {}) {
  return normalizeConditionOnFalse(output.onFalse || DEFAULT_CONDITION_ON_FALSE);
}

function buildConditionStopSummary({ definition, output, completedNodeCount, totalNodeCount }) {
  const skippedNodeCount = Math.max(0, Number(totalNodeCount || 0) - Number(completedNodeCount || 0));

  return `Workflow ${definition.displayName} stopped successfully by condition gate: ${output.summary || 'condition returned false'} (${skippedNodeCount} remaining node(s) skipped).`;
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

function resolveConditionBranchIndex({ output, currentIndex, executionPlan }) {
  const branchTargetNodeKey = getConditionBranchTargetKeyFromOutput(output);

  if (!branchTargetNodeKey) {
    return null;
  }

  const targetIndex = executionPlan.nodeIndexByKey.get(branchTargetNodeKey);

  if (!Number.isInteger(targetIndex)) {
    throw new WorkflowServiceError('Condition branch target was not found in the workflow graph.', 500, {
      branchTargetNodeKey,
      output,
    });
  }

  if (targetIndex <= currentIndex) {
    throw new WorkflowServiceError('Condition branch target must point to a later node in the sequential lane.', 500, {
      branchTargetNodeKey,
      currentIndex,
      targetIndex,
    });
  }

  return targetIndex;
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
  const nodeOutputsByKey = {};
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
      const parameters = buildNodeParameters(node, input);
      const nodeContext = {
        ...context,
        conditionEvaluation: {
          input,
          nodes: nodeOutputsByKey,
          previous: previousNodeOutput,
          currentNodeKey: node.nodeKey,
        },
      };
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
              throw new WorkflowServiceError(output.summary || 'Workflow condition failed.', 500, output);
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

    const summary = conditionStop
      ? buildConditionStopSummary({
        definition,
        output: conditionStop.output,
        completedNodeCount: nodeRuns.length,
        totalNodeCount: definition.nodes.length,
      })
      : `Workflow ${definition.displayName} completed: ${nodeRuns.length}/${definition.nodes.length} node(s) succeeded.`;
    const completedRun = await updateWorkflowRun({
      workflowRunRecordId: run.workflowRunRecordId,
      status: TERMINAL_SUCCESS_STATUS,
      summary,
      metadata: {
        durationMs: Date.now() - startedAtMs,
        completedNodeCount: nodeRuns.length,
        skippedNodeCount: conditionStop ? Math.max(0, definition.nodes.length - nodeRuns.length) : Math.max(0, definition.nodes.length - nodeRuns.length),
        conditionStopNodeKey: conditionStop?.nodeKey || null,
        conditionBranchRoutes,
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
    throw new WorkflowServiceError('Approval requests require workflowRunRecordId and workflowNodeRunRecordId.', 400, {
      workflowRunRecordId,
      workflowNodeRunRecordId,
    });
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
    return normalizeApprovalRow(existingResult.rows[0]);
  }

  const expiresAt = approvalParameters.timeoutMs
    ? new Date(Date.now() + approvalParameters.timeoutMs).toISOString()
    : null;
  const metadata = {
    ...(getSafeObject(context) || {}),
    nodeKey: node.nodeKey || null,
    nodeTypeCode: node.nodeTypeCode || 'HUMAN_APPROVAL',
    createdBy: 'skyserver_workflow_executor',
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
  const clauses = [];
  const values = [];
  const status = String(filters.status || '').trim().toUpperCase();
  const workflowRunRecordId = String(filters.workflowRunRecordId || '').trim();

  if (status && status !== 'ALL') {
    values.push(status);
    clauses.push(`status = $${values.length}`);
  }

  if (workflowRunRecordId) {
    values.push(workflowRunRecordId);
    clauses.push(`workflow_run_record_id = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);

  const result = await query(
    `
      SELECT *
      FROM worker.vw_workflow_approval_requests
      ${whereClause}
      ORDER BY
        CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,
        COALESCE(requested_at, created_at) DESC,
        created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );

  return {
    total: result.rows.length,
    limit,
    items: result.rows.map(normalizeApprovalRow),
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
  const decisionNote = String(payload.decisionNote || payload.note || '').trim().slice(0, 4000) || null;

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
    parentWorkflowRunRecordId ? getWorkflowRunById(parentWorkflowRunRecordId) : Promise.resolve(null),
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

  const [nodeRuns, relations, approvals] = await Promise.all([
    getWorkflowNodeRunsForRun(workflowRunRecordId),
    getWorkflowRunRelations(run),
    getWorkflowApprovalRequestsForRun(workflowRunRecordId),
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
    approvals,
    relations,
    runTree: relations.runTree,
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
  createChildWorkflowRun,
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
  createWorkflowApprovalRequest,
  decideWorkflowApprovalRequest,
  listWorkflowApprovalRequests,
  resolveWorkflowApprovalRequest,
  listBuilderCatalog,
  linkWorkflowRunToTemporal,
  listWorkflowDefinitions,
  listWorkflowRuns,
  markWorkflowNodeAttempt,
  startWorkflowNodeRun,
  startWorkflowWithTemporal,
  updateWorkflowDefinition,
};
