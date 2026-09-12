const { query } = require('../../../../packages/db/src/connection');
const browserAutomationExecutionService = require('../../../api/src/services/browserAutomationExecutionService');
const browserAutomationRegistryService = require('../../../api/src/services/browserAutomationRegistryService');
const browserTestRegistryService = require('../../../api/src/services/browserTestRegistryService');
const browserTestSuiteService = require('../../../api/src/services/browserTestSuiteService');

const BROWSER_TEST_SCHEDULE_TOOL_CODE = 'browser_test_schedule_start';
const BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE = 'browser_test_suite_schedule_start';
const BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE = 'browser_automation_schedule_start';
const POLL_INTERVAL_MS = 750;
const DEFAULT_TEST_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SUITE_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_AUTOMATION_TIMEOUT_MS = 20 * 60 * 1000;

const TERMINAL_TEST_STATUSES = new Set(['PASSED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const TERMINAL_SUITE_STATUSES = new Set(['PASSED', 'FAILED', 'PARTIAL', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);
const TERMINAL_AUTOMATION_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value, fallback = '') {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || fallback;
}

function getParameterValue(parameters, ...names) {
  for (const name of names) {
    if (parameters && Object.prototype.hasOwnProperty.call(parameters, name)) {
      return parameters[name];
    }
  }
  return undefined;
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || value === '') return {};
  if (!Array.isArray(value) && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be valid JSON object text. ${error.message}`);
  }
}

async function loadWorkerSystemPermissions() {
  const result = await query(
    `
      SELECT DISTINCT
        p.permission_code AS "permissionCode",
        p.resource,
        p.action,
        p.description
      FROM auth.roles r
      JOIN auth.role_permissions rp
        ON rp.role_id = r.role_id
       AND rp.active = TRUE
      JOIN auth.permissions p
        ON p.permission_id = rp.permission_id
       AND p.active = TRUE
      WHERE r.role_code = 'SUPER_ADMIN'
        AND r.active = TRUE
      ORDER BY p.permission_code
    `,
  );
  return result.rows;
}

function buildActor(schedule = {}) {
  return {
    userId: schedule.createdByUserId || null,
    displayName: `Scheduler: ${schedule.scheduleName || schedule.scheduleCode || 'Playwright target'}`,
  };
}

function buildScheduledPlaywrightRequest({ schedule } = {}) {
  const parameters = schedule?.parameters || {};
  const environmentCode = normalizeText(
    getParameterValue(parameters, 'environmentCode', 'environment_code'),
    'LOCAL',
  ).toUpperCase();
  const runtimeParameters = parseJsonObject(
    getParameterValue(parameters, 'parametersJson', 'parameters_json'),
    'parametersJson',
  );

  if (schedule?.toolCode === BROWSER_TEST_SCHEDULE_TOOL_CODE) {
    const targetCode = normalizeText(getParameterValue(parameters, 'testCode', 'test_code'));
    if (!targetCode) throw new Error('testCode is required for scheduled Playwright Tests.');
    return { targetType: 'BROWSER_TEST', targetCode, environmentCode, runtimeParameters };
  }

  if (schedule?.toolCode === BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE) {
    const targetCode = normalizeText(getParameterValue(parameters, 'suiteCode', 'suite_code'));
    if (!targetCode) throw new Error('suiteCode is required for scheduled Playwright Test Suites.');
    return { targetType: 'BROWSER_TEST_SUITE', targetCode, environmentCode, runtimeParameters: {} };
  }

  if (schedule?.toolCode === BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE) {
    const targetCode = normalizeText(getParameterValue(parameters, 'automationCode', 'automation_code'));
    if (!targetCode) throw new Error('automationCode is required for scheduled Playwright Automations.');
    return { targetType: 'BROWSER_AUTOMATION', targetCode, environmentCode, runtimeParameters };
  }

  throw new Error(`Unsupported Playwright scheduler bridge: ${schedule?.toolCode || 'unknown'}`);
}

async function pollRun({ getter, workflowId, terminalStatuses, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const run = await getter(workflowId);
    const status = normalizeText(run?.status).toUpperCase();
    if (terminalStatuses.has(status)) return run;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Scheduled Playwright execution timed out after ${timeoutMs} ms (${workflowId}).`);
}

function buildBrowserTargetResult({ request, targetLabel, run, operationsPath, successStatus }) {
  const status = normalizeText(run?.status, 'UNKNOWN').toUpperCase();
  const durationMs = run?.durationMs === undefined || run?.durationMs === null
    ? null
    : Number(run.durationMs);
  return {
    status: status === successStatus ? 'SUCCESS' : 'FAILED',
    executionId: null,
    exitCode: status === successStatus ? 0 : 1,
    durationMs,
    summary: `${targetLabel || request.targetCode} ${status}.`,
    browserTarget: {
      targetType: request.targetType,
      targetCode: request.targetCode,
      targetLabel: targetLabel || request.targetCode,
      status,
      workflowId: run?.workflowId || null,
      runId: run?.runId || null,
      executionId: run?.executionId || null,
      environmentCode: run?.environmentCode || request.environmentCode,
      executionMode: run?.executionMode || 'HEADLESS',
      durationMs,
      sourceCommit: run?.sourceCommit || null,
      operationsPath,
      result: run?.result || null,
      failure: run?.failure || null,
      artifactCount: Number(run?.artifactCount || run?.artifacts?.length || 0),
    },
  };
}

async function runScheduledPlaywright({ schedule, scheduleRun, workerNode } = {}) {
  const request = buildScheduledPlaywrightRequest({ schedule, scheduleRun, workerNode });
  const permissions = await loadWorkerSystemPermissions();
  const actor = buildActor(schedule);

  console.log(
    `[SkyCommand Worker] Starting scheduled ${request.targetType} ${request.targetCode} from ${schedule.scheduleCode}.`,
  );

  if (request.targetType === 'BROWSER_TEST') {
    const target = await browserTestRegistryService.getBrowserTestByCode(request.targetCode, { includeDisabled: false });
    if (!target) throw new Error(`Playwright Test '${request.targetCode}' is unavailable.`);
    const started = await browserTestRegistryService.startRegisteredBrowserTest({
      testCode: request.targetCode,
      body: {
        environmentCode: request.environmentCode,
        executionMode: 'HEADLESS',
        parameters: request.runtimeParameters,
      },
      permissions,
      actor,
      triggerSource: 'SCHEDULER',
    });
    const run = await pollRun({
      getter: browserTestRegistryService.getBrowserTestRun,
      workflowId: started.execution.workflowId,
      terminalStatuses: TERMINAL_TEST_STATUSES,
      timeoutMs: Math.max(DEFAULT_TEST_TIMEOUT_MS, Number(target.timeoutSeconds || 60) * 1000 + 30_000),
    });
    return buildBrowserTargetResult({
      request,
      targetLabel: target.label || target.name || request.targetCode,
      run,
      operationsPath: `/browser-tests/operations?workflowId=${encodeURIComponent(run.workflowId)}`,
      successStatus: 'PASSED',
    });
  }

  if (request.targetType === 'BROWSER_TEST_SUITE') {
    const target = await browserTestSuiteService.getSuiteByCode(request.targetCode);
    if (!target) throw new Error(`Playwright Test Suite '${request.targetCode}' is unavailable.`);
    const started = await browserTestSuiteService.startSuite({
      suiteCode: request.targetCode,
      body: { environmentCode: request.environmentCode, executionMode: 'HEADLESS' },
      permissions,
      actor,
      triggerSource: 'SCHEDULER',
    });
    const run = await pollRun({
      getter: browserTestSuiteService.getSuiteRun,
      workflowId: started.execution.workflowId,
      terminalStatuses: TERMINAL_SUITE_STATUSES,
      timeoutMs: DEFAULT_SUITE_TIMEOUT_MS,
    });
    return buildBrowserTargetResult({
      request,
      targetLabel: target.label || target.name || request.targetCode,
      run,
      operationsPath: `/browser-tests/suites?workflowId=${encodeURIComponent(run.workflowId)}`,
      successStatus: 'PASSED',
    });
  }

  const target = await browserAutomationRegistryService.getBrowserAutomationByCode(
    request.targetCode,
    { includeDisabled: false },
  );
  if (!target) throw new Error(`Playwright Automation '${request.targetCode}' is unavailable.`);
  const started = await browserAutomationExecutionService.startRegisteredAutomation({
    automationCode: request.targetCode,
    body: {
      environmentCode: request.environmentCode,
      executionMode: 'HEADLESS',
      parameters: request.runtimeParameters,
    },
    permissions,
    actor,
    triggerSource: 'SCHEDULER',
  });
  const run = await pollRun({
    getter: browserAutomationExecutionService.getRun,
    workflowId: started.execution.workflowId,
    terminalStatuses: TERMINAL_AUTOMATION_STATUSES,
    timeoutMs: Math.max(DEFAULT_AUTOMATION_TIMEOUT_MS, Number(target.timeoutSeconds || 120) * 1000 + 30_000),
  });
  return buildBrowserTargetResult({
    request,
    targetLabel: target.label || target.name || request.targetCode,
    run,
    operationsPath: `/browser-automations/operations?workflowId=${encodeURIComponent(run.workflowId)}`,
    successStatus: 'SUCCESS',
  });
}

module.exports = {
  BROWSER_AUTOMATION_SCHEDULE_TOOL_CODE,
  BROWSER_TEST_SCHEDULE_TOOL_CODE,
  BROWSER_TEST_SUITE_SCHEDULE_TOOL_CODE,
  buildScheduledPlaywrightRequest,
  runScheduledPlaywright,
};
