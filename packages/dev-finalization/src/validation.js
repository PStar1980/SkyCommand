#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createValidationFailureToolResult,
  createValidationToolResult,
  VALIDATION_OUTPUT_TYPE,
} = require('./finalizationResult');
const {
  assertRunId,
  FinalizationError,
  getRun,
  loadBinding,
  readDatabasePlan,
  databaseSummary,
  updateRunStage,
} = require('./finalization');

const TOOL_CODE = 'dev_finalization_validate';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const VALIDATION_PROFILE = 'r5-dev-finalization-v1';
const SYNTAX_FILES = Object.freeze([
  'packages/dev-finalization/src/finalization.js',
  'packages/dev-finalization/src/finalizationResult.js',
  'packages/dev-finalization/src/preflight.js',
  'packages/dev-finalization/src/lifecycle.js',
  'packages/dev-finalization/src/validation.js',
  'packages/dev-finalization/src/readiness.js',
  'packages/dev-finalization/src/receipt.js',
  'packages/host-agent/src/activities.js',
  'packages/host-agent/src/devFinalizationLifecycle.js',
  'packages/supervisor/src/runtimeLifecycle.js',
  'packages/temporal/src/workflows/hostAgentWorkflow.js',
  'apps/api/src/services/temporalService.js',
  'apps/api/src/services/workflowExecutorService.js',
  'apps/api/src/controllers/workflowController.js',
  'apps/api/src/routes/workflow.routes.js',
]);

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function runCheck(name, execute, classification = 'REQUIRED') {
  const started = Date.now();
  try {
    const detail = execute() || {};
    if (detail.status && detail.status !== 'PASS') {
      return {
        name,
        status: detail.status,
        exitCode: detail.exitCode === undefined ? null : detail.exitCode,
        durationMs: detail.durationMs === undefined ? Date.now() - started : detail.durationMs,
        classification: detail.classification || classification,
        detail: text(detail.detail, ''),
      };
    }
    return {
      name,
      status: 'PASS',
      exitCode: 0,
      durationMs: Date.now() - started,
      classification,
      detail: text(detail.detail, ''),
    };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      exitCode: Number.isInteger(error?.status) ? error.status : 1,
      durationMs: Date.now() - started,
      classification,
      detail: text(error?.message || error, 'Validation check failed.').slice(0, 280),
    };
  }
}

function isCapabilityCatalogImageBaselineError(error) {
  const detail = [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .join('\n');
  return /128\s*!==\s*0|not a git repository/i.test(detail);
}

function runSyntaxCheck(relativePath) {
  const filePath = path.resolve(REPOSITORY_ROOT, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Required R5 source file is missing: ${relativePath}`);
  execFileSync(process.execPath, ['--check', filePath], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    windowsHide: true,
  });
  return { detail: relativePath };
}

function runCapabilitySelfTest() {
  try {
    execFileSync(process.execPath, ['scripts/capabilityCatalogExport.js', '--self-test'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      windowsHide: true,
    });
    return { detail: 'capability catalogue contract self-test' };
  } catch (error) {
    if (!isCapabilityCatalogImageBaselineError(error)) throw error;
    return {
      status: 'KNOWN_BASELINE_LIMITATION',
      exitCode: Number.isInteger(error?.status) ? error.status : 1,
      classification: 'KNOWN_BASELINE_LIMITATION',
      detail: 'The production runtime image excludes .git, so the exporter self-test cannot verify git check-ignore there; the host-side self-test remains required and is run separately.',
    };
  }
}

function runFocusedSelfTest() {
  const relativePath = 'tests/self/packages/dev-finalization/src/devFinalizationSelfTest.js';
  const filePath = path.resolve(REPOSITORY_ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return {
      status: 'KNOWN_BASELINE_LIMITATION',
      exitCode: null,
      durationMs: 0,
      classification: 'KNOWN_BASELINE_LIMITATION',
      detail: 'The production runtime image excludes repository self-tests by its Docker context policy.',
    };
  }
  return runCheck('r5_focused_self_test', () => {
    execFileSync(process.execPath, [relativePath], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      windowsHide: true,
    });
    return { detail: relativePath };
  });
}

async function executeValidation(args = []) {
  if (!Array.isArray(args) || args.length !== 1) {
    throw new FinalizationError('R5_VALIDATION_ARGUMENTS_INVALID', 'R5 validation requires workflow run id.');
  }
  const runId = assertRunId(args[0]);
  const startedAt = new Date().toISOString();
  const run = await getRun(runId);
  const checks = [];
  for (const relativePath of SYNTAX_FILES) {
    checks.push(runCheck(`syntax:${relativePath}`, () => runSyntaxCheck(relativePath)));
  }
  checks.push(runCheck('capability_catalog_self_test', runCapabilitySelfTest));
  const focused = runFocusedSelfTest();
  checks.push(focused);

  const binding = await loadBinding('SkyCommand', process.env);
  const plan = await readDatabasePlan(binding.repositoryRoot, process.env);
  checks.push({
    name: 'database_plan_no_pending_changes',
    status: plan.pendingCount === 0 && ['PLAN_READY', 'NO_CHANGES'].includes(plan.outcome) ? 'PASS' : 'FAIL',
    exitCode: plan.pendingCount === 0 ? 0 : 1,
    durationMs: 0,
    classification: 'REQUIRED',
    detail: `${plan.outcome}:${plan.pendingCount}`,
  });

  const failedCount = checks.filter((check) => check.status === 'FAIL').length;
  const knownLimitationCount = checks.filter((check) => check.status === 'KNOWN_BASELINE_LIMITATION').length;
  const passedCount = checks.filter((check) => check.status === 'PASS').length;
  const outcome = failedCount > 0 ? 'FAIL' : knownLimitationCount > 0 ? 'KNOWN_BASELINE_LIMITATION' : 'PASS';
  const completedAt = new Date().toISOString();
  const output = {
    outcome,
    profile: VALIDATION_PROFILE,
    checks,
    passedCount,
    knownLimitationCount,
    failedCount,
    timing: {
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    },
    database: databaseSummary(plan),
  };
  await updateRunStage(runId, 'validation', output);
  if (outcome === 'FAIL') {
    throw new FinalizationError(
      'R5_VALIDATION_FAILED',
      'R5 deterministic validation profile failed.',
      { output },
    );
  }
  return output;
}

function renderConsole(result) {
  console.log(`[SkyCommand R5 validation] ${result.outcome}: ${result.passedCount} passed, ${result.failedCount} failed.`);
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: VALIDATION_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_finalization_validation_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executeValidation,
    createToolResult: createValidationToolResult,
    createFailureToolResult: createValidationFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  REPOSITORY_ROOT,
  SYNTAX_FILES,
  TOOL_CODE,
  VALIDATION_PROFILE,
  executeValidation,
  main,
  runCheck,
  runCapabilitySelfTest,
  isCapabilityCatalogImageBaselineError,
  runFocusedSelfTest,
  runSyntaxCheck,
};
