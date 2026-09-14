'use strict';

const SKYCOMMAND_WORKFLOW_START_TOOL_CODE = 'skyserver_workflow_start';
const BROWSER_TEST_SCHEDULE_TOOL_CODE = 'browser_test_schedule_start';
const BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE = 'browser_test_suite_schedule_start';
const BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE = 'browser_automation_schedule_start';

const SCHEDULE_TARGET_BRIDGE_DEFINITIONS = Object.freeze({
  [SKYCOMMAND_WORKFLOW_START_TOOL_CODE]: Object.freeze({
    targetType: 'WORKFLOW',
    parameterName: 'workflowCode',
    parameterAliases: Object.freeze(['workflowCode', 'workflow_code']),
  }),
  [BROWSER_TEST_SCHEDULE_TOOL_CODE]: Object.freeze({
    targetType: 'BROWSER_TEST',
    parameterName: 'testCode',
    parameterAliases: Object.freeze(['testCode', 'test_code']),
  }),
  [BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE]: Object.freeze({
    targetType: 'BROWSER_TEST_SUITE',
    parameterName: 'suiteCode',
    parameterAliases: Object.freeze(['suiteCode', 'suite_code']),
  }),
  [BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE]: Object.freeze({
    targetType: 'BROWSER_AUTOMATION',
    parameterName: 'automationCode',
    parameterAliases: Object.freeze(['automationCode', 'automation_code']),
  }),
});

function normalizeScheduleToolCode(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function getScheduleParameterValue(parameters, ...names) {
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') {
    return undefined;
  }

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(parameters, name)) return parameters[name];
  }

  return undefined;
}

function parseScheduleParameters(parameters) {
  if (parameters && !Array.isArray(parameters) && typeof parameters === 'object') {
    return { value: parameters, malformed: false };
  }

  if (typeof parameters !== 'string') {
    return { value: {}, malformed: true };
  }

  try {
    const parsed = JSON.parse(parameters);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return { value: {}, malformed: true };
    }
    return { value: parsed, malformed: false };
  } catch (_error) {
    return { value: {}, malformed: true };
  }
}

function normalizeTargetIdentifier(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' || typeof value === 'boolean') return undefined;

  const normalized = String(value).trim();
  return normalized || null;
}

function resolveScheduledTarget({ toolCode, parameters, toolName = null, catalogues = {} } = {}) {
  const normalizedToolCode = normalizeScheduleToolCode(toolCode);
  const bridge = SCHEDULE_TARGET_BRIDGE_DEFINITIONS[normalizedToolCode];

  if (!bridge) {
    const tool = (catalogues.tools || []).find((item) => item.code === normalizedToolCode);
    return {
      targetType: 'TOOL',
      targetCode: normalizedToolCode || null,
      targetName: tool?.label || tool?.name || toolName || null,
      targetParameterName: null,
      targetResolution: tool || toolName ? 'REGISTERED' : 'UNREGISTERED_TOOL',
    };
  }

  const parsed = parseScheduleParameters(parameters);
  if (parsed.malformed) {
    return {
      targetType: bridge.targetType,
      targetCode: null,
      targetName: null,
      targetParameterName: bridge.parameterName,
      targetResolution: 'MALFORMED_PARAMETERS',
    };
  }

  const targetCode = normalizeTargetIdentifier(
    getScheduleParameterValue(parsed.value, ...bridge.parameterAliases),
  );
  if (targetCode === undefined) {
    return {
      targetType: bridge.targetType,
      targetCode: null,
      targetName: null,
      targetParameterName: bridge.parameterName,
      targetResolution: 'MALFORMED_TARGET_IDENTIFIER',
    };
  }
  if (!targetCode) {
    return {
      targetType: bridge.targetType,
      targetCode: null,
      targetName: null,
      targetParameterName: bridge.parameterName,
      targetResolution: 'MISSING_TARGET_IDENTIFIER',
    };
  }

  const catalogueKey =
    bridge.targetType === 'WORKFLOW'
      ? 'workflows'
      : bridge.targetType === 'BROWSER_TEST'
        ? 'browserTests'
        : bridge.targetType === 'BROWSER_TEST_SUITE'
          ? 'testSuites'
          : 'browserAutomations';
  const target = (catalogues[catalogueKey] || []).find((item) => item.code === targetCode);

  return {
    targetType: bridge.targetType,
    targetCode,
    targetName: target?.label || target?.name || null,
    targetParameterName: bridge.parameterName,
    targetResolution: target ? 'REGISTERED' : 'UNREGISTERED_TARGET',
  };
}

module.exports = {
  BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE,
  BROWSER_TEST_SCHEDULE_TOOL_CODE,
  BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE,
  SCHEDULE_TARGET_BRIDGE_DEFINITIONS,
  SKYCOMMAND_WORKFLOW_START_TOOL_CODE,
  getScheduleParameterValue,
  normalizeScheduleToolCode,
  parseScheduleParameters,
  resolveScheduledTarget,
};
