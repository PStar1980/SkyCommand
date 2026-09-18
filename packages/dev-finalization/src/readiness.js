#!/usr/bin/env node

const path = require('node:path');
const dotenv = require('dotenv');

const { query } = require('../../db/src/connection');
const { getHostAgentAvailability } = require('../../../apps/api/src/services/workflowExecutionPreflightService');
const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createReadinessFailureToolResult,
  createReadinessToolResult,
  READINESS_OUTPUT_TYPE,
} = require('./finalizationResult');
const {
  assertRunId,
  FinalizationError,
  getRun,
  getProfileCode,
  loadBinding,
  readDatabasePlan,
  databaseSummary,
  updateRunStage,
} = require('./finalization');

const TOOL_CODE = 'dev_finalization_readiness';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const REQUIRED_TOOLS = Object.freeze([
  'dev_finalization_preflight',
  'dev_runtime_lifecycle',
  'dev_finalization_validate',
  'dev_finalization_readiness',
  'dev_finalization_receipt',
  'database_upgrade_apply',
  'dev_env_reconcile',
  'capability_catalog_export',
  'repo_map_generate',
  'repo_zip_generate',
]);

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function resolveApiHealthUrl(environment = process.env) {
  return getProfileCode(environment) === 'DOCKER_LOCAL'
    ? 'http://api:7171/_health'
    : 'http://127.0.0.1:7171/_health';
}

async function fetchProbe(name, url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      name,
      status: response.ok ? 'PASS' : 'FAIL',
      detail: `${response.status} ${new URL(url).hostname}`,
    };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      detail: `${text(error?.name, 'FETCH_ERROR')} ${new URL(url).hostname}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function registrationProbe() {
  const workflow = await query(
    `
      SELECT workflow_code, status, enabled, published_version_number
      FROM worker.vw_workflow_definitions
      WHERE workflow_code = 'dev_change_finalize'
        AND status = 'ACTIVE'
        AND enabled = TRUE
        AND published_version_number IS NOT NULL
      LIMIT 1
    `,
  );
  const tools = await query(
    `
      SELECT tool_code
      FROM core.tools
      WHERE enabled = TRUE
        AND tool_code = ANY($1::text[])
      ORDER BY tool_code
    `,
    [REQUIRED_TOOLS],
  );
  const toolCodes = tools.rows.map((row) => row.tool_code);
  const workflowReady = workflow.rowCount === 1;
  const toolsReady = REQUIRED_TOOLS.every((toolCode) => toolCodes.includes(toolCode));
  return {
    workflowReady,
    toolsReady,
    workflow: workflowReady ? 'PUBLISHED' : 'MISSING',
    tools: toolCodes,
    detail: `${workflowReady ? 'workflow' : 'workflow-missing'};${toolsReady ? 'tools' : 'tools-missing'}`,
  };
}

async function executeReadiness(args = []) {
  if (!Array.isArray(args) || args.length !== 1) {
    throw new FinalizationError('R5_READINESS_ARGUMENTS_INVALID', 'R5 readiness requires workflow run id.');
  }
  const runId = assertRunId(args[0]);
  const startedAt = new Date().toISOString();
  const run = await getRun(runId);
  const binding = await loadBinding('SkyCommand', process.env);
  const plan = await readDatabasePlan(binding.repositoryRoot, process.env);
  const probes = [];
  probes.push(await fetchProbe('api_health', resolveApiHealthUrl(process.env)));

  const lifecycleServices = Array.isArray(run.lifecycle_output?.services)
    ? run.lifecycle_output.services
    : [];
  const webProbe = lifecycleServices.includes('web')
    ? await fetchProbe('web_health', 'http://web:8080/healthz')
    : { name: 'web_health', status: 'NOT_REQUESTED', detail: 'web was outside the R5 lifecycle scope' };
  probes.push(webProbe);

  const registration = await registrationProbe();
  probes.push({
    name: 'r5_registration',
    status: registration.workflowReady && registration.toolsReady ? 'PASS' : 'FAIL',
    detail: registration.detail,
  });

  let hostAgent = null;
  try {
    hostAgent = await getHostAgentAvailability();
    probes.push({
      name: 'host_agent_availability',
      status: hostAgent.online ? 'PASS' : 'FAIL',
      detail: text(hostAgent.status, 'UNKNOWN'),
    });
  } catch (error) {
    probes.push({ name: 'host_agent_availability', status: 'FAIL', detail: 'probe-error' });
  }

  probes.push({
    name: 'database_no_pending_changes',
    status: plan.pendingCount === 0 && ['PLAN_READY', 'NO_CHANGES'].includes(plan.outcome) ? 'PASS' : 'FAIL',
    detail: `${plan.outcome}:${plan.pendingCount}`,
  });

  const apiProbe = probes.find((probe) => probe.name === 'api_health');
  const hostProbe = probes.find((probe) => probe.name === 'host_agent_availability');
  const failed = probes.some((probe) => probe.status === 'FAIL');
  const completedAt = new Date().toISOString();
  const output = {
    outcome: failed ? 'NOT_READY' : 'READY',
    runId,
    probes,
    runtime: {
      api: apiProbe?.status === 'PASS' ? 'ONLINE' : 'OFFLINE',
      web: webProbe.status === 'PASS' ? 'ONLINE' : webProbe.status === 'NOT_REQUESTED' ? 'NOT_REQUESTED' : 'OFFLINE',
      hostAgent: hostProbe?.status === 'PASS' ? 'ONLINE' : 'OFFLINE',
    },
    database: databaseSummary(plan),
    registrations: {
      workflow: registration.workflow,
      tools: registration.tools,
    },
    timing: {
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
    },
    warnings: hostAgent?.heartbeatDegraded ? ['Host Agent is online through the live probe while heartbeat persistence is degraded.'] : [],
  };
  await updateRunStage(runId, 'readiness', output);
  if (failed) {
    throw new FinalizationError('R5_READINESS_FAILED', 'R5 runtime readiness probes did not pass.', { output });
  }
  return output;
}

function renderConsole(result) {
  console.log(`[SkyCommand R5 readiness] ${result.outcome}: API ${result.runtime?.api || 'UNKNOWN'}, Host Agent ${result.runtime?.hostAgent || 'UNKNOWN'}.`);
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: READINESS_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_finalization_readiness_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executeReadiness,
    createToolResult: createReadinessToolResult,
    createFailureToolResult: createReadinessFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  REQUIRED_TOOLS,
  TOOL_CODE,
  executeReadiness,
  fetchProbe,
  main,
  registrationProbe,
  resolveApiHealthUrl,
};
