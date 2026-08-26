#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const executorSource = read('apps/api/src/services/workflowExecutorService.js');
const controllerSource = read('apps/api/src/controllers/workflowController.js');
const routesSource = read('apps/api/src/routes/workflow.routes.js');
const activitiesSource = read('packages/temporal/src/activities/skyCommandWorkflowActivities.js');
const temporalWorkflowSource = read('packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js');
const webServiceSource = read('apps/admin-web/src/services/workflowService.js');
const workflowsPageSource = read('apps/admin-web/src/pages/SkyWorkflows.jsx');
const cssSource = read('apps/admin-web/src/App.css');

assert(
  routesSource.includes("'/runs/:workflowRunRecordId/nodes/:nodeKey/retry'")
    && routesSource.includes('workflowController.retryNode'),
  'Workflow API must expose a WORKFLOW_RUN-protected failed-node retry route.',
);

assert(
  controllerSource.includes('async function retryNode(req, res, next)')
    && controllerSource.includes('workflowExecutorService.retryWorkflowNode')
    && controllerSource.includes('nodeKey: req.params.nodeKey'),
  'Workflow controller must forward failed-node retry requests to the executor service.',
);

assert(
  executorSource.includes('async function retryWorkflowNode({')
    && executorSource.includes("normalizedRunStatus !== TERMINAL_FAILURE_STATUS")
    && executorSource.includes("normalizedNodeStatus !== TERMINAL_FAILURE_STATUS")
    && executorSource.includes('Only the most recently executed failed node can resume this workflow safely.')
    && executorSource.includes('getWorkflowDefinitionForVersion(run.workflowCode, run.workflowVersionId)')
    && executorSource.includes('nodes: recoveryNodeIndex >= 0 ? definition.nodes.slice(recoveryNodeIndex) : definition.nodes')
    && executorSource.includes('startSkyCommandWorkflowExecutorWorkflow')
    && executorSource.includes('workflowRunRecordId: run.workflowRunRecordId')
    && executorSource.includes('nodeRecoveryHistory'),
  'Executor service must recover the same failed run from the failed checkpoint using the exact run version.',
);

assert(
  executorSource.includes("completed_at = NULL")
    && executorSource.includes('metadata?.manualNodeRecovery === true')
    && executorSource.includes("output = '{}'::jsonb")
    && executorSource.includes('DELETE FROM worker.workflow_run_node_outputs')
    && executorSource.includes('DELETE FROM worker.workflow_run_context_values'),
  'Manual recovery must reopen the run/node ledger and clear stale failed-node output/context before re-execution.',
);

assert(
  executorSource.includes('context?.nodeRecovery?.active === true')
    && executorSource.includes("status = 'PENDING'")
    && executorSource.includes('reopenedAt'),
  'Human approval nodes must be reopenable against the replacement Temporal execution during node recovery.',
);

assert(
  activitiesSource.includes('loadSkyserverWorkflowNodeRecoveryStateActivity')
    && activitiesSource.includes('getWorkflowDefinitionForVersion'),
  'Temporal activities must load exact-version workflow definitions and durable recovery state.',
);

assert(
  temporalWorkflowSource.includes('const recoveryNodeKey = nodeRecovery.active === true')
    && temporalWorkflowSource.includes('const definitionActivityInput = requestInput.workflowVersionId')
    && temporalWorkflowSource.includes(': { workflowCode };')
    && temporalWorkflowSource.includes('loadSkyserverWorkflowNodeRecoveryStateActivity')
    && temporalWorkflowSource.includes('buildContextObjectFromPersistedRows')
    && temporalWorkflowSource.includes('nodeRuns.push(priorNodeRun)')
    && temporalWorkflowSource.includes('executionPlan.nodeIndexByKey.get(recoveryNodeKey)')
    && temporalWorkflowSource.includes('manualNodeRecovery: true')
    && temporalWorkflowSource.includes('recoveredSuccessfully: true'),
  'Temporal workflow recovery must restore durable context, preserve completed checkpoints, and resume at the failed node.',
);

assert(
  webServiceSource.includes('function retryNode(workflowRunRecordId, nodeKey, payload = {})')
    && webServiceSource.includes('/nodes/${encodeURIComponent(nodeKey)}/retry'),
  'Admin-Web workflow service must expose the failed-node retry endpoint.',
);

assert(
  workflowsPageSource.includes('function WorkflowNodeFailureRecoveryCard({')
    && workflowsPageSource.includes('Failed node recovery')
    && workflowsPageSource.includes('Retry failed node & continue')
    && workflowsPageSource.includes('workflowService.retryNode(')
    && workflowsPageSource.includes(".toUpperCase() === 'FAILED' && selectedRun && !isActiveRun(selectedRun)"),
  'Workflow Operations must render the dedicated recovery display only for failed nodes on inactive runs.',
);

assert(
  cssSource.includes('.sky-workflow-node-recovery-card')
    && cssSource.includes('.sky-workflow-node-recovery-panel'),
  'Failed-node recovery display must have dedicated SkyCommand styling.',
);

console.log('[SkyCommand] Workflow failed-node recovery self-test passed.');
