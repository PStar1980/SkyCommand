const { query } = require('../../../../packages/db/src/connection');
const workflowExecutorService = require('../../../api/src/services/workflowExecutorService');
const {
  getScheduleParameterValue,
  SCHEDULE_TARGET_BRIDGE_DEFINITIONS,
  SKYCOMMAND_WORKFLOW_START_TOOL_CODE,
} = require('../../../../packages/core/src/scheduleTargetResolution');

const DEFAULT_WORKFLOW_CODE = 'macro-refresh-pipeline';

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function parseJsonObject(value, label) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (!Array.isArray(value) && typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(String(value));

    if (Array.isArray(parsed) || !parsed || typeof parsed !== 'object') {
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

function buildScheduledSkyCommandWorkflowStart({ schedule, scheduleRun, workerNode } = {}) {
  const parameters = schedule.parameters || {};
  const workflowCode =
    normalizeOptionalString(
      getScheduleParameterValue(
        parameters,
        ...SCHEDULE_TARGET_BRIDGE_DEFINITIONS[SKYCOMMAND_WORKFLOW_START_TOOL_CODE].parameterAliases,
      ),
    ) || DEFAULT_WORKFLOW_CODE;
  const workflowId = normalizeOptionalString(
    getScheduleParameterValue(parameters, 'workflowId', 'workflow_id'),
  );
  const inputJson = parseJsonObject(
    getScheduleParameterValue(parameters, 'inputJson', 'input_json'),
    'inputJson',
  );

  const input = {
    ...inputJson,
    runSource: 'scheduler',
    triggerType: 'SCHEDULER',
    schedulerContext: {
      scheduleId: schedule.scheduleId,
      scheduleCode: schedule.scheduleCode,
      scheduleName: schedule.scheduleName,
      scheduleRunId: scheduleRun.scheduleRunId,
      workerNodeId: workerNode?.workerNodeId || null,
      workerNodeName: workerNode?.nodeName || null,
      queuedAt: scheduleRun.queuedAt,
      startedAt: scheduleRun.startedAt,
    },
  };

  if (workflowId) {
    input.workflowId = workflowId;
  }

  return {
    workflowCode,
    input,
  };
}

async function runScheduledSkyCommandWorkflow({ schedule, scheduleRun, workerNode } = {}) {
  const startRequest = buildScheduledSkyCommandWorkflowStart({ schedule, scheduleRun, workerNode });
  const permissions = await loadWorkerSystemPermissions();

  console.log(
    `[SkyCommand Worker] Starting SkyCommand workflow ${startRequest.workflowCode} from schedule ${schedule.scheduleCode}.`,
  );

  const result = await workflowExecutorService.startWorkflowWithTemporal({
    workflowCode: startRequest.workflowCode,
    input: startRequest.input,
    user: null,
    session: null,
    permissions,
    context: {
      ipAddress: null,
      userAgent: `SkyCommand Worker scheduler (${workerNode?.nodeName || 'unknown-node'})`,
    },
  });

  const run = result.run || {};
  const temporalWorkflow = result.temporalWorkflow || {};
  const definition = result.definition || {};

  return {
    status: 'SUCCESS',
    executionId: null,
    exitCode: 0,
    durationMs: null,
    summary: `Started SkyCommand workflow ${run.workflowDisplayName || definition.displayName || startRequest.workflowCode}.`,
    skyCommandWorkflow: {
      workflowRunRecordId: run.workflowRunRecordId,
      workflowCode: run.workflowCode || definition.workflowCode || startRequest.workflowCode,
      workflowDisplayName:
        run.workflowDisplayName || definition.displayName || startRequest.workflowCode,
      status: run.status || 'RUNNING',
      runSource: run.runSource || 'scheduler',
      triggerType: run.triggerType || 'SCHEDULER',
      temporalWorkflowId: run.temporalWorkflowId || temporalWorkflow.workflowId,
      temporalRunId: run.temporalRunId || temporalWorkflow.runId,
      temporalWorkflowType: temporalWorkflow.workflowType,
      temporalTaskQueue: temporalWorkflow.taskQueue,
      temporalNamespace: temporalWorkflow.namespace,
    },
    workflowRun: run,
    definition,
    temporalWorkflow,
    input: result.input || startRequest.input,
  };
}

module.exports = {
  buildScheduledSkyCommandWorkflowStart,
  runScheduledSkyCommandWorkflow,
};
