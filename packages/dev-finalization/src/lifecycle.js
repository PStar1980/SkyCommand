#!/usr/bin/env node

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const { Connection, Client } = require('@temporalio/client');
const { getTemporalConfig } = require('../../temporal/src/config');
const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
  normalizeHostAgentTaskQueue,
} = require('../../host-agent/src/config');
const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createLifecycleFailureToolResult,
  createLifecycleToolResult,
  LIFECYCLE_OUTPUT_TYPE,
} = require('./finalizationResult');
const {
  assertRunId,
  FinalizationError,
  getRun,
  updateRunStage,
} = require('./finalization');
const {
  FINALIZATION_REBUILD_SERVICES,
} = require('../../supervisor/src/config');

const TOOL_CODE = 'dev_runtime_lifecycle';
const REPOSITORY_CODE = 'SkyCommand';
const ACTION = 'REBUILD_SERVICES';
const HOST_TOOL_CODE = '__dev_finalization_lifecycle';
const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeServices(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      throw new FinalizationError(
        'R5_LIFECYCLE_SERVICES_INVALID',
        'R5 lifecycle services must be a JSON array.',
      );
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new FinalizationError(
      'R5_LIFECYCLE_SERVICES_INVALID',
      'R5 lifecycle services must be a non-empty array.',
    );
  }
  const requested = [...new Set(parsed.map((item) => text(item).toLowerCase()).filter(Boolean))];
  const unsupported = requested.filter((service) => !FINALIZATION_REBUILD_SERVICES.includes(service));
  if (unsupported.length > 0) {
    throw new FinalizationError(
      'R5_LIFECYCLE_SERVICE_NOT_ALLOWLISTED',
      'R5 lifecycle requested a service outside the fixed R5 allowlist.',
      { unsupported },
    );
  }
  return FINALIZATION_REBUILD_SERVICES.filter((service) => requested.includes(service));
}

function buildWorkflowId(runId) {
  return `skycommand-dev-finalization-${runId}`;
}

function buildOutput({
  runId,
  action,
  services,
  operationId,
  hostRunId,
  status,
  idempotencyOutcome,
  startedAt,
  warning = null,
} = {}) {
  const completedAt = new Date().toISOString();
  const output = {
    outcome: status === 'COMPLETED' ? (idempotencyOutcome === 'REPLAYED' ? 'NO_CHANGES' : 'RECONCILED') : 'FAILED',
    runId,
    action,
    services,
    operationId: operationId || null,
    hostWorkflowId: operationId || null,
    hostRunId: hostRunId || null,
    idempotencyOutcome: idempotencyOutcome || 'STARTED',
    status: status || 'UNKNOWN',
    timing: {
      startedAt: startedAt || completedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt || completedAt)),
    },
    warnings: warning ? [warning] : [],
  };
  return output;
}

async function executeLifecycle(args = []) {
  if (!Array.isArray(args) || args.length !== 3) {
    throw new FinalizationError(
      'R5_LIFECYCLE_ARGUMENTS_INVALID',
      'R5 lifecycle requires workflow run id, fixed action, and service JSON.',
    );
  }
  const runId = assertRunId(args[0]);
  const action = text(args[1]).toUpperCase();
  if (action !== ACTION) {
    throw new FinalizationError(
      'R5_LIFECYCLE_ACTION_INVALID',
      'R5 lifecycle action is fixed to REBUILD_SERVICES.',
    );
  }
  const services = normalizeServices(args[2]);
  const existingRun = await getRun(runId);
  const existing = existingRun.lifecycle_output || {};
  if (['RECONCILED', 'NO_CHANGES'].includes(text(existing.outcome).toUpperCase())) {
    return {
      ...existing,
      idempotencyOutcome: 'REPLAYED',
      status: 'COMPLETED',
    };
  }

  if (String(process.env.SKYCOMMAND_HOST_AGENT_ENABLED || '').toLowerCase() !== 'true') {
    throw new FinalizationError(
      'R5_HOST_AGENT_DISABLED',
      'R5 lifecycle requires the enabled local Host Agent.',
    );
  }

  const temporalConfig = getTemporalConfig();
  const hostTaskQueue = normalizeHostAgentTaskQueue(
    process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE,
  );
  const operationId = buildWorkflowId(runId);
  const startedAt = new Date().toISOString();
  const input = {
    toolCode: HOST_TOOL_CODE,
    repoCode: REPOSITORY_CODE,
    action,
    services,
    runId,
    hostTaskQueue,
  };
  let connection = null;
  try {
    connection = await Connection.connect({ address: temporalConfig.address });
    const client = new Client({ connection, namespace: temporalConfig.namespace });
    let handle;
    let idempotencyOutcome = 'STARTED';
    try {
      handle = await client.workflow.start('skyCommandHostAgentToolWorkflow', {
        taskQueue: temporalConfig.taskQueue,
        workflowId: operationId,
        args: [input],
      });
    } catch (error) {
      const message = text(error?.message || error);
      if (!/already started|already exists|workflow execution already running/i.test(message)) {
        throw error;
      }
      handle = client.workflow.getHandle(operationId);
      idempotencyOutcome = 'REPLAYED';
    }
    const response = await handle.result();
    const activityResult = response?.result || response;
    if (!response?.ok || activityResult?.ok === false) {
      const remoteError = response?.error || activityResult?.error || {};
      throw new FinalizationError(
        text(remoteError.code, 'R5_HOST_AGENT_LIFECYCLE_FAILED'),
        text(remoteError.message, 'R5 Host Agent lifecycle operation failed.'),
        { output: buildOutput({ runId, action, services, operationId, hostRunId: handle.firstExecutionRunId, status: 'FAILED', idempotencyOutcome, startedAt }) },
      );
    }
    const output = buildOutput({
      runId,
      action,
      services,
      operationId,
      hostRunId: handle.firstExecutionRunId || null,
      status: 'COMPLETED',
      idempotencyOutcome,
      startedAt,
    });
    await updateRunStage(runId, 'lifecycle', output);
    return output;
  } catch (error) {
    if (error instanceof FinalizationError) throw error;
    throw new FinalizationError(
      'R5_HOST_AGENT_LIFECYCLE_FAILED',
      'R5 Host Agent lifecycle dispatch failed.',
      { cause: text(error?.message || error) },
    );
  } finally {
    await connection?.close().catch(() => {});
  }
}

function renderConsole(result) {
  console.log(`[SkyCommand R5 lifecycle] ${result.outcome}: ${result.services?.join(', ') || 'none'}.`);
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: LIFECYCLE_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_finalization_lifecycle_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executeLifecycle,
    createToolResult: createLifecycleToolResult,
    createFailureToolResult: createLifecycleFailureToolResult,
    renderConsole,
  });
}

if (require.main === module) main();

module.exports = {
  ACTION,
  HOST_TOOL_CODE,
  REPOSITORY_CODE,
  TOOL_CODE,
  buildWorkflowId,
  executeLifecycle,
  main,
  normalizeServices,
};
