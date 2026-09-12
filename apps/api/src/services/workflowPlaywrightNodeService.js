const browserAutomationExecutionService = require('./browserAutomationExecutionService');
const browserAutomationRegistryService = require('./browserAutomationRegistryService');
const browserTestRegistryService = require('./browserTestRegistryService');
const browserTestSuiteService = require('./browserTestSuiteService');
const { WorkflowServiceError } = require('./workflowServiceError');

const TERMINAL_TEST_STATUSES = new Set(['PASSED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const TERMINAL_SUITE_STATUSES = new Set(['PASSED', 'FAILED', 'PARTIAL', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const TERMINAL_AUTOMATION_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const POLL_INTERVAL_MS = 750;
const RESERVED_INPUT_KEYS = new Set(['environmentCode', 'executionMode', 'confirmed', 'confirm']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePermissions(permissions = []) {
  return new Set(
    (Array.isArray(permissions) ? permissions : [])
      .map((item) => item?.permissionCode || item?.permission_code || item)
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  );
}

function canUseTarget(target, permissions = []) {
  const required = String(target?.permissionCode || '').trim();
  return !required || normalizePermissions(permissions).has(required);
}

function normalizeTargetParameter(parameter = {}) {
  return {
    parameterId: parameter.parameterId || null,
    parameterName: parameter.parameterName,
    label: parameter.label || parameter.parameterName,
    type: parameter.type || parameter.paramTypeCode || 'string',
    prompt: parameter.prompt || null,
    required: parameter.required === true,
    defaultValue: parameter.defaultValue ?? null,
    optionSourceCode: parameter.optionSourceCode || null,
    displayOrder: Number(parameter.displayOrder || 0),
    enabled: parameter.enabled !== false,
    options: Array.isArray(parameter.options) ? parameter.options : [],
  };
}

async function listBuilderTargets({ permissions = [] } = {}) {
  const [testsResult, suitesResult, automationsResult] = await Promise.all([
    browserTestRegistryService.listBrowserTests({ limit: 100 }),
    browserTestSuiteService.listSuites({}),
    browserAutomationRegistryService.listBrowserAutomations({ limit: 100 }),
  ]);

  const browserTestTargets = [];
  for (const item of testsResult.items || []) {
    const detail = await browserTestRegistryService.getBrowserTestByCode(item.testCode, { includeDisabled: false });
    if (!detail || !canUseTarget(detail, permissions)) continue;
    browserTestTargets.push({
      nodeTypeCode: 'BROWSER_TEST',
      targetKind: 'core.browser_tests',
      targetCode: detail.testCode,
      targetRefId: detail.testId,
      displayName: detail.label || detail.name || detail.testCode,
      description: detail.description || null,
      categoryCode: detail.category?.categoryCode || null,
      categoryLabel: detail.category?.label || 'Playwright Tests',
      browserType: detail.browserType || 'chromium',
      defaultEnvironmentCode: detail.defaultEnvironmentCode || 'LOCAL',
      environments: Array.isArray(detail.environments) ? detail.environments : [],
      permissionCode: detail.permissionCode || 'BROWSER_TEST_RUN',
      requiresConfirmation: detail.requiresConfirmation === true,
      riskCode: detail.riskCode || null,
      parameters: (detail.parameters || []).filter((parameter) => parameter.enabled !== false).map(normalizeTargetParameter),
    });
  }

  const browserTestSuiteTargets = [];
  for (const item of suitesResult.items || []) {
    const detail = await browserTestSuiteService.getSuiteByCode(item.suiteCode);
    if (!detail || !canUseTarget(detail, permissions)) continue;
    browserTestSuiteTargets.push({
      nodeTypeCode: 'BROWSER_TEST_SUITE',
      targetKind: 'core.browser_test_suites',
      targetCode: detail.suiteCode,
      targetRefId: detail.suiteId,
      displayName: detail.label || detail.name || detail.suiteCode,
      description: detail.description || null,
      defaultEnvironmentCode: detail.defaultEnvironmentCode || 'LOCAL',
      environments: [{ environmentCode: detail.defaultEnvironmentCode || 'LOCAL', environmentName: detail.defaultEnvironmentCode || 'LOCAL', enabled: true }],
      permissionCode: detail.permissionCode || 'BROWSER_TEST_SUITE_RUN',
      memberCount: Number(detail.memberCount || detail.members?.length || 0),
      stopOnFailure: detail.stopOnFailure === true,
      parameters: [],
    });
  }

  const browserAutomationTargets = [];
  for (const item of automationsResult.items || []) {
    const detail = await browserAutomationRegistryService.getBrowserAutomationByCode(item.automationCode, { includeDisabled: false });
    if (!detail || !canUseTarget(detail, permissions)) continue;
    browserAutomationTargets.push({
      nodeTypeCode: 'BROWSER_AUTOMATION',
      targetKind: 'core.browser_automations',
      targetCode: detail.automationCode,
      targetRefId: detail.automationId,
      displayName: detail.label || detail.name || detail.automationCode,
      description: detail.description || null,
      categoryCode: detail.category?.categoryCode || null,
      categoryLabel: detail.category?.label || 'Playwright Automation',
      browserType: detail.browserType || 'chromium',
      defaultEnvironmentCode: detail.defaultEnvironmentCode || 'LOCAL',
      environments: Array.isArray(detail.environments) ? detail.environments : [],
      permissionCode: detail.permissionCode || 'BROWSER_AUTOMATION_RUN',
      requiresConfirmation: detail.requiresConfirmation === true,
      confirmationText: detail.confirmationText || null,
      riskCode: detail.riskCode || null,
      sideEffectLevel: detail.sideEffectLevel || 'READ_ONLY',
      idempotencyMode: detail.idempotencyMode || 'READ_ONLY',
      outputType: detail.outputType || null,
      parameters: (detail.parameters || []).filter((parameter) => parameter.enabled !== false).map(normalizeTargetParameter),
    });
  }

  return { browserTestTargets, browserTestSuiteTargets, browserAutomationTargets };
}

function extractRuntimeParameters(parameters = {}) {
  return Object.fromEntries(
    Object.entries(parameters || {}).filter(([key, value]) => !RESERVED_INPUT_KEYS.has(key) && value !== undefined),
  );
}

function actorFromUser(user = null) {
  if (!user || typeof user !== 'object') return null;
  return {
    userId: user.userId || user.user_id || null,
    username: user.username || null,
    email: user.email || null,
    displayName: user.displayName || user.display_name || user.username || user.email || null,
  };
}

async function pollRun({ getter, workflowId, terminalStatuses, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const run = await getter(workflowId);
    const status = String(run?.status || '').toUpperCase();
    if (terminalStatuses.has(status)) return run;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new WorkflowServiceError('Playwright workflow node timed out while waiting for browser execution.', 504, {
    workflowId,
    timeoutMs,
  });
}

function assertUnattendedConfirmationSafe(target, nodeTypeCode) {
  if (target?.requiresConfirmation) {
    throw new WorkflowServiceError(
      `${nodeTypeCode === 'BROWSER_AUTOMATION' ? 'Playwright Automation' : 'Playwright Test'} '${target.automationCode || target.testCode || target.targetCode || 'target'}' requires interactive confirmation and cannot run unattended as a workflow node in Phase 9.`,
      409,
      { code: 'PLAYWRIGHT_WORKFLOW_NODE_CONFIRMATION_REQUIRED' },
    );
  }
}

function normalizeNodeTimeoutMs(node, fallbackMs) {
  const configured = Number.parseInt(node?.timeoutMs, 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return Math.max(30_000, Number(fallbackMs || 600_000) + 30_000);
}

function buildCommonOutput(kind, targetCode, run, operationsPath) {
  return {
    kind,
    targetCode,
    status: run.status,
    temporalStatus: run.temporalStatus || null,
    workflowId: run.workflowId || null,
    runId: run.runId || null,
    executionId: run.executionId || null,
    environmentCode: run.environmentCode || null,
    executionMode: run.executionMode || 'HEADLESS',
    durationMs: run.durationMs ?? null,
    sourceCommit: run.sourceCommit || null,
    operationsPath,
    result: run.result || null,
  };
}

async function executePlaywrightWorkflowNode({ node, parameters = {}, user = null, permissions = [] } = {}) {
  const nodeTypeCode = String(node?.nodeTypeCode || '').toUpperCase();
  const targetCode = String(node?.targetCode || '').trim();
  const environmentCode = String(parameters.environmentCode || 'LOCAL').trim().toUpperCase();
  const runtimeParameters = extractRuntimeParameters(parameters);
  const actor = actorFromUser(user);

  if (!targetCode) throw new WorkflowServiceError('Playwright workflow node target_code is required.', 400, { nodeKey: node?.nodeKey });

  if (nodeTypeCode === 'BROWSER_TEST') {
    const target = await browserTestRegistryService.getBrowserTestByCode(targetCode, { includeDisabled: false });
    if (!target) throw new WorkflowServiceError(`Playwright Test '${targetCode}' is unavailable.`, 404);
    assertUnattendedConfirmationSafe(target, nodeTypeCode);
    const started = await browserTestRegistryService.startRegisteredBrowserTest({
      testCode: targetCode,
      body: { environmentCode, executionMode: 'HEADLESS', parameters: runtimeParameters },
      permissions,
      actor,
      triggerSource: 'WORKFLOW',
    });
    const timeoutMs = normalizeNodeTimeoutMs(node, Number(target.timeoutSeconds || 60) * 1000);
    const run = await pollRun({
      getter: browserTestRegistryService.getBrowserTestRun,
      workflowId: started.execution.workflowId,
      terminalStatuses: TERMINAL_TEST_STATUSES,
      timeoutMs,
    });
    const output = buildCommonOutput('playwright_test', targetCode, run, `/browser-tests/operations?workflowId=${encodeURIComponent(run.workflowId)}`);
    output.summary = `${target.label || targetCode} ${run.status}.`;
    output.artifactCount = Array.isArray(run.artifacts) ? run.artifacts.length : 0;
    if (run.status !== 'PASSED') throw new WorkflowServiceError(output.summary, 500, output);
    return output;
  }

  if (nodeTypeCode === 'BROWSER_TEST_SUITE') {
    const target = await browserTestSuiteService.getSuiteByCode(targetCode);
    if (!target) throw new WorkflowServiceError(`Playwright Test Suite '${targetCode}' is unavailable.`, 404);
    const started = await browserTestSuiteService.startSuite({
      suiteCode: targetCode,
      body: { environmentCode, executionMode: 'HEADLESS' },
      permissions,
      actor,
      triggerSource: 'WORKFLOW',
    });
    const timeoutMs = normalizeNodeTimeoutMs(node, 60 * 60 * 1000);
    const run = await pollRun({
      getter: browserTestSuiteService.getSuiteRun,
      workflowId: started.execution.workflowId,
      terminalStatuses: TERMINAL_SUITE_STATUSES,
      timeoutMs,
    });
    const output = buildCommonOutput('playwright_test_suite', targetCode, run, `/browser-tests/suites?workflowId=${encodeURIComponent(run.workflowId)}`);
    output.summary = `${target.label || targetCode} ${run.status}: ${run.result?.passed || 0} passed, ${run.result?.failed || 0} failed, ${run.result?.notRun || 0} not run.`;
    output.total = Number(run.result?.total || run.memberCount || 0);
    output.passed = Number(run.result?.passed || 0);
    output.failed = Number(run.result?.failed || 0);
    output.notRun = Number(run.result?.notRun || 0);
    output.members = Array.isArray(run.members) ? run.members : [];
    if (run.status !== 'PASSED') throw new WorkflowServiceError(output.summary, 500, output);
    return output;
  }

  if (nodeTypeCode === 'BROWSER_AUTOMATION') {
    const target = await browserAutomationRegistryService.getBrowserAutomationByCode(targetCode, { includeDisabled: false });
    if (!target) throw new WorkflowServiceError(`Playwright Automation '${targetCode}' is unavailable.`, 404);
    assertUnattendedConfirmationSafe(target, nodeTypeCode);
    const started = await browserAutomationExecutionService.startRegisteredAutomation({
      automationCode: targetCode,
      body: { environmentCode, executionMode: 'HEADLESS', parameters: runtimeParameters },
      permissions,
      actor,
      triggerSource: 'WORKFLOW',
    });
    const timeoutMs = normalizeNodeTimeoutMs(node, Number(target.timeoutSeconds || 120) * 1000);
    const run = await pollRun({
      getter: browserAutomationExecutionService.getRun,
      workflowId: started.execution.workflowId,
      terminalStatuses: TERMINAL_AUTOMATION_STATUSES,
      timeoutMs,
    });
    const output = buildCommonOutput('playwright_automation', targetCode, run, `/browser-automations/operations?workflowId=${encodeURIComponent(run.workflowId)}`);
    output.summary = `${target.label || targetCode} ${run.status}.`;
    output.sideEffectLevel = run.sideEffectLevel || target.sideEffectLevel || null;
    output.idempotencyMode = run.idempotencyMode || target.idempotencyMode || null;
    output.automationOutput = (run.result?.output ?? run.result?.result ?? run.result) || null;
    output.artifactCount = Array.isArray(run.artifacts) ? run.artifacts.length : 0;
    if (run.status !== 'SUCCESS') throw new WorkflowServiceError(output.summary, 500, output);
    return output;
  }

  throw new WorkflowServiceError(`Unsupported Playwright workflow node type: ${nodeTypeCode}`, 400);
}

module.exports = {
  executePlaywrightWorkflowNode,
  listBuilderTargets,
};
