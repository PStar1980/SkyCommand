const { WorkflowServiceError } = require('./workflowServiceError');
const { isBlankValue } = require('./workflowParameterUtils');

const DEFAULT_CONDITION_ON_FALSE = 'STOP_SUCCESS';
const UNARY_CONDITION_OPERATORS = new Set(['TRUTHY', 'FALSY', 'EXISTS', 'NOT_EXISTS']);

function getSafeObject(value, fallback = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }

  return value;
}

function normalizeContextKey(value, fallback = 'value') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);

  return normalized || fallback;
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
  const normalized = String(value || 'AUTO')
    .trim()
    .toUpperCase();
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

    const normalized = String(value || '')
      .trim()
      .toLowerCase();

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) {
      return false;
    }

    throw new WorkflowServiceError('CONDITION boolean value must be true or false.', 400, {
      value,
    });
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
  const hasLeftLiteral = hasOwnValue(input, 'leftValue') && !isBlankValue(input.leftValue);
  const hasRightValue = hasOwnValue(input, 'rightValue') && !isBlankValue(input.rightValue);

  if (!leftPath && !hasLeftLiteral) {
    throw new WorkflowServiceError('CONDITION nodes require a leftPath or leftValue.', 400, {
      fieldName: 'leftPath',
    });
  }

  if (!UNARY_CONDITION_OPERATORS.has(operator) && !hasRightValue) {
    throw new WorkflowServiceError('CONDITION comparison operators require rightValue.', 400, {
      fieldName: 'rightValue',
      operator,
    });
  }

  return {
    ...input,
    leftPath,
    leftValue: input.leftValue,
    leftType,
    operator,
    rightValue: input.rightValue,
    rightType,
    caseSensitive:
      input.caseSensitive === true || input.caseSensitive === 'true' || input.caseSensitive === '1',
    onFalse,
    trueTargetNodeKey: normalizeConditionBranchTargetNodeKey(
      input.trueTargetNodeKey || input.trueTarget || input.onTrueTargetNodeKey,
    ),
    falseTargetNodeKey: normalizeConditionBranchTargetNodeKey(
      input.falseTargetNodeKey || input.falseTarget || input.onFalseTargetNodeKey,
    ),
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
      contains = leftValue.some(
        (item) => normalizeComparable(item, { caseSensitive }) === comparableRight,
      );
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
  const hasFallbackValue = !isBlankValue(normalizedParameters.leftValue);

  if (normalizedParameters.leftPath && !useLeftPathValue && !hasFallbackValue) {
    throw new WorkflowServiceError(
      `Condition path ${normalizedParameters.leftPath} was not found in the live workflow scope.`,
      400,
      {
        code: 'WORKFLOW_CONDITION_PATH_NOT_FOUND',
        nodeKey: node.nodeKey || null,
        leftPath: normalizedParameters.leftPath,
        guidance:
          'Use nodes.<nodeKey>.output.<customPath> for domain output or provide a left fallback value.',
      },
    );
  }

  const leftValue = useLeftPathValue
    ? leftValueFromPath
    : parseConditionTypedValue(normalizedParameters.leftValue, normalizedParameters.leftType);
  const rightValue = UNARY_CONDITION_OPERATORS.has(normalizedParameters.operator)
    ? undefined
    : parseConditionTypedValue(normalizedParameters.rightValue, normalizedParameters.rightType);
  const passed = compareConditionValues(leftValue, rightValue, normalizedParameters.operator, {
    caseSensitive: normalizedParameters.caseSensitive,
  });
  const branchTargetNodeKey = passed
    ? normalizedParameters.trueTargetNodeKey || null
    : normalizedParameters.falseTargetNodeKey || null;
  const branchLabel = passed ? 'TRUE' : 'FALSE';
  const conditionContextKey = normalizeContextKey(
    node.nodeKey || node.displayName || 'condition',
    'condition',
  );
  const summary = branchTargetNodeKey
    ? `Condition ${node.displayName || node.nodeKey} resolved ${branchLabel}; routing to ${branchTargetNodeKey}.`
    : passed
      ? `Condition ${node.displayName || node.nodeKey} passed; continuing workflow.`
      : `Condition ${node.displayName || node.nodeKey} did not pass; ${normalizedParameters.onFalse === 'STOP_SUCCESS' ? 'stopping workflow successfully' : normalizedParameters.onFalse === 'FAIL_WORKFLOW' ? 'failing workflow' : 'continuing anyway'}.`;
  const contextUpdates = {
    [`conditions.${conditionContextKey}.nodeKey`]: node.nodeKey || null,
    [`conditions.${conditionContextKey}.passed`]: passed,
    [`conditions.${conditionContextKey}.status`]: passed ? 'PASSED' : 'FAILED',
    [`conditions.${conditionContextKey}.branchLabel`]: branchLabel,
    [`conditions.${conditionContextKey}.branchTargetNodeKey`]: branchTargetNodeKey,
    [`conditions.${conditionContextKey}.evaluatedAt`]: new Date().toISOString(),
    [`conditions.${conditionContextKey}.summary`]: summary,
    'lastCondition.nodeKey': node.nodeKey || null,
    'lastCondition.passed': passed,
    'lastCondition.status': passed ? 'PASSED' : 'FAILED',
    'lastCondition.branchLabel': branchLabel,
    'lastCondition.branchTargetNodeKey': branchTargetNodeKey,
    'lastCondition.summary': summary,
  };

  return {
    kind: 'condition_evaluation',
    status: passed ? 'PASSED' : 'FAILED',
    passed,
    route: branchLabel,
    reason: summary,
    operator: normalizedParameters.operator,
    leftPath: normalizedParameters.leftPath || null,
    leftPathResolved: Boolean(useLeftPathValue),
    leftPathUsedFallback: Boolean(
      normalizedParameters.leftPath && !useLeftPathValue && hasFallbackValue,
    ),
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
    contextUpdates,
  };
}

function getConditionBranchTargetKeyFromOutput(output = {}) {
  return normalizeConditionBranchTargetNodeKey(
    output.branchTargetNodeKey || output.nextNodeKey || output.targetNodeKey,
  );
}

function resolveConditionBranchIndex({ output, currentIndex, executionPlan }) {
  const branchTargetNodeKey = getConditionBranchTargetKeyFromOutput(output);

  if (!branchTargetNodeKey) {
    return null;
  }

  const targetIndex = executionPlan?.nodeIndexByKey?.get(branchTargetNodeKey);

  if (!Number.isInteger(targetIndex)) {
    throw new WorkflowServiceError(
      'Condition branch target was not found in the workflow graph.',
      500,
      {
        branchTargetNodeKey,
        output,
      },
    );
  }

  if (targetIndex <= currentIndex) {
    throw new WorkflowServiceError(
      'Condition branch target must point to a later node in the sequential lane.',
      500,
      {
        branchTargetNodeKey,
        currentIndex,
        targetIndex,
      },
    );
  }

  return targetIndex;
}

module.exports = {
  evaluateConditionNode,
  normalizeConditionBranchTargetNodeKey,
  normalizeConditionOnFalse,
  normalizeConditionParameters,
  resolveConditionBranchIndex,
};
