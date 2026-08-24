const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../../../..');
const schedulerPage = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/SchedulerControl.jsx'),
  'utf8',
);
const workerServiceSource = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/workerService.js'),
  'utf8',
);
const workflowExecutorSource = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/workflowExecutorService.js'),
  'utf8',
);
const scheduledWorkflowRunnerSource = fs.readFileSync(
  path.join(repoRoot, 'apps/worker/src/jobs/scheduledSkyCommandWorkflowRunner.js'),
  'utf8',
);

assert(
  schedulerPage.includes('Workflow parameters') &&
    schedulerPage.includes('workflowRuntimeValues') &&
    schedulerPage.includes('parseWorkflowParameterValues'),
  'Create/Manage Schedules must render and serialize workflow-level runtime parameters.',
);
assert(
  schedulerPage.includes('params: runtimeParameters') &&
    schedulerPage.includes('runtimeParameters,'),
  'Workflow schedule parameters must be persisted into the workflow bridge input contract.',
);
assert(
  schedulerPage.includes('getBuilderCatalog().catch') &&
    schedulerPage.includes('repositoryOptions'),
  'Workflow repository parameters should reuse repository choices when catalogue access is available.',
);
assert(
  workerServiceSource.includes('validateScheduleParameters') &&
    workerServiceSource.includes("toolCode !== SKYCOMMAND_WORKFLOW_START_TOOL_CODE") &&
    workerServiceSource.includes('validateWorkflowRuntimeInput(definition, workflowInput)'),
  'Schedule create/update must validate nested workflow runtime parameters before persistence.',
);
assert(
  workflowExecutorSource.includes('  validateWorkflowRuntimeInput,\n};'),
  'Workflow runtime validation must be reusable by the scheduler service.',
);

const futureOnceGuard = /schedule_type = 'ONCE'[\s\S]*?last_run_at IS NOT NULL[\s\S]*?last_status IN \('SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED'\)[\s\S]*?next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP/;
const guardMatches = workerServiceSource.match(new RegExp(futureOnceGuard.source, 'g')) || [];
assert.equal(
  guardMatches.length,
  2,
  'Manage Schedules and worker-health counts must retain future-dated one-time definitions even when they have historical terminal runs.',
);

assert(
  scheduledWorkflowRunnerSource.includes('const inputJson = parseJsonObject') &&
    scheduledWorkflowRunnerSource.includes('...inputJson,') &&
    scheduledWorkflowRunnerSource.includes("runSource: 'scheduler'") &&
    scheduledWorkflowRunnerSource.includes("triggerType: 'SCHEDULER'"),
  'Scheduled SkyCommand workflow execution must preserve the serialized workflow input and add scheduler context.',
);

console.log('[SkyCommand] Scheduler workflow parameters and future one-time visibility self-test passed.');
