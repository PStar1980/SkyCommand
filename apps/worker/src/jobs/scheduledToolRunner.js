const { query } = require('../../../../packages/db/src/connection');
const { calculateNextRunAfterExecution } = require('../schedulers/scheduleCalculator');
const { runWorkerTool } = require('./workerToolExecutionService');
const { runScheduledTemporalWorkflow } = require('./scheduledTemporalWorkflowRunner');
const { runScheduledSkyserverWorkflow } = require('./scheduledSkyserverWorkflowRunner');
const {
  buildScheduledToolResultSummary,
} = require('../../../../packages/tools/src/workflowResultContext');

const TEMPORAL_WORKFLOW_START_TOOL_CODE = 'temporal_workflow_start';
const SKYSERVER_WORKFLOW_START_TOOL_CODE = 'skyserver_workflow_start';

function sanitizeSchedule(row) {
  return {
    scheduleId: row.schedule_id,
    scheduleCode: row.schedule_code,
    scheduleName: row.schedule_name,
    description: row.description,
    toolId: row.tool_id,
    toolCode: row.tool_code,
    toolLabel: row.tool_label,
    profileId: row.profile_id,
    profileCode: row.profile_code,
    scheduleType: row.schedule_type,
    timezone: row.timezone,
    runAt: row.run_at,
    intervalValue: row.interval_value,
    intervalUnit: row.interval_unit,
    cronExpression: row.cron_expression,
    parameters: row.parameters || {},
    enabled: row.enabled,
    maxConcurrentRuns: row.max_concurrent_runs,
    misfirePolicy: row.misfire_policy,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
  };
}

function sanitizeScheduleRun(row) {
  return {
    scheduleRunId: row.schedule_run_id,
    scheduleId: row.schedule_id,
    workerNodeId: row.worker_node_id,
    executionId: row.execution_id,
    status: row.status,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.message,
    metadata: row.metadata || {},
  };
}

async function markScheduleRunStarted(scheduleRunId, workerNodeId) {
  const result = await query(
    `
      UPDATE worker.schedule_runs
      SET worker_node_id = $2,
          status = 'STARTED',
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_run_id = $1
      RETURNING
        schedule_run_id,
        schedule_id,
        worker_node_id,
        execution_id,
        status,
        queued_at,
        started_at,
        finished_at,
        message,
        metadata
    `,
    [scheduleRunId, workerNodeId || null],
  );

  return sanitizeScheduleRun(result.rows[0]);
}

async function markScheduleRunFinished({
  scheduleRunId,
  status,
  executionId,
  message,
  metadata = {},
}) {
  const result = await query(
    `
      UPDATE worker.schedule_runs
      SET execution_id = COALESCE($2, execution_id),
          status = $3,
          finished_at = CURRENT_TIMESTAMP,
          message = $4,
          metadata = metadata || $5::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_run_id = $1
      RETURNING
        schedule_run_id,
        schedule_id,
        worker_node_id,
        execution_id,
        status,
        queued_at,
        started_at,
        finished_at,
        message,
        metadata
    `,
    [scheduleRunId, executionId || null, status, message || null, JSON.stringify(metadata || {})],
  );

  return sanitizeScheduleRun(result.rows[0]);
}

async function updateScheduleAfterRun({ schedule, status }) {
  const nextRunAt = calculateNextRunAfterExecution(schedule, new Date());
  const shouldDisable = schedule.scheduleType === 'ONCE' && nextRunAt === null;

  await query(
    `
      UPDATE worker.schedules
      SET next_run_at = $2,
          last_run_at = CURRENT_TIMESTAMP,
          last_status = $3,
          enabled = CASE WHEN $4 = TRUE THEN FALSE ELSE enabled END,
          queue_requested_at = NULL,
          queue_requested_by_user_id = NULL,
          queued_previous_next_run_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE schedule_id = $1
    `,
    [schedule.scheduleId, nextRunAt, status, shouldDisable],
  );

  return {
    nextRunAt,
    disabled: shouldDisable,
  };
}

async function runClaimedSchedule(claim, workerNode) {
  const schedule = sanitizeSchedule(claim.schedule);
  let scheduleRun = sanitizeScheduleRun(claim.scheduleRun);

  scheduleRun = await markScheduleRunStarted(scheduleRun.scheduleRunId, workerNode?.workerNodeId);

  console.log(
    `[SkyServer Worker] Starting schedule ${schedule.scheduleCode} (${schedule.toolCode}) run ${scheduleRun.scheduleRunId}`,
  );

  try {
    let result;

    if (schedule.toolCode === TEMPORAL_WORKFLOW_START_TOOL_CODE) {
      result = await runScheduledTemporalWorkflow({
        schedule,
        scheduleRun,
        workerNode,
      });
    } else if (schedule.toolCode === SKYSERVER_WORKFLOW_START_TOOL_CODE) {
      result = await runScheduledSkyserverWorkflow({
        schedule,
        scheduleRun,
        workerNode,
      });
    } else {
      result = await runWorkerTool({
        toolCode: schedule.toolCode,
        parameters: schedule.parameters || {},
        schedule,
        scheduleRun,
        workerNode,
      });
    }

    const finalStatus = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    const message = result.summary || `${schedule.toolCode} finished with ${finalStatus}.`;

    await markScheduleRunFinished({
      scheduleRunId: scheduleRun.scheduleRunId,
      status: finalStatus,
      executionId: result.executionId,
      message,
      metadata: {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        toolResult: result.toolResult
          ? {
              available: true,
              ...buildScheduledToolResultSummary(result.toolResult),
            }
          : {
              available: false,
              contractStatus: result.toolResultContract?.status || 'NOT_APPLICABLE',
            },
        temporalWorkflow:
          result.workflow && schedule.toolCode === TEMPORAL_WORKFLOW_START_TOOL_CODE
            ? {
                workflowId: result.workflow.workflowId,
                runId: result.workflow.runId,
                workflowCode: result.definition?.workflowCode,
                workflowType: result.definition?.workflowType || result.workflow.workflowType,
                taskQueue: result.workflow.taskQueue,
                namespace: result.workflow.namespace,
                runRecordId: result.runRecord?.runRecordId || null,
              }
            : null,
        skyserverWorkflow:
          result.skyserverWorkflow && schedule.toolCode === SKYSERVER_WORKFLOW_START_TOOL_CODE
            ? result.skyserverWorkflow
            : null,
      },
    });

    const scheduleUpdate = await updateScheduleAfterRun({
      schedule,
      status: finalStatus,
    });

    console.log(
      `[SkyServer Worker] Finished schedule ${schedule.scheduleCode} with ${finalStatus}. Next run: ${scheduleUpdate.nextRunAt || 'none'}`,
    );

    return {
      schedule,
      scheduleRun,
      result,
      status: finalStatus,
      nextRunAt: scheduleUpdate.nextRunAt,
    };
  } catch (error) {
    await markScheduleRunFinished({
      scheduleRunId: scheduleRun.scheduleRunId,
      status: 'FAILED',
      message: error.message || 'Scheduled tool execution failed.',
      metadata: {
        errorMessage: error.message || String(error),
        errorStack: error.stack || null,
      },
    });

    const scheduleUpdate = await updateScheduleAfterRun({
      schedule,
      status: 'FAILED',
    });

    console.error(
      `[SkyServer Worker] Schedule ${schedule.scheduleCode} failed: ${error.message}. Next run: ${scheduleUpdate.nextRunAt || 'none'}`,
    );

    return {
      schedule,
      scheduleRun,
      result: null,
      status: 'FAILED',
      nextRunAt: scheduleUpdate.nextRunAt,
      error,
    };
  }
}

module.exports = {
  runClaimedSchedule,
};
