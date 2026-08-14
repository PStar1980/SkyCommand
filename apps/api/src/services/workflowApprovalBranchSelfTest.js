const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const approvalEditorSource = read('apps/admin-web/src/components/HumanApprovalParameterEditor.jsx');
const workflowBuilderSource = read('apps/admin-web/src/pages/WorkflowBuilder.jsx');
const workflowManagerSource = read('apps/admin-web/src/pages/WorkflowManager.jsx');
const workflowGraphSource = read('apps/admin-web/src/components/WorkflowVisualGraph.jsx');
const workflowPageSource = read('apps/admin-web/src/pages/SkyWorkflows.jsx');
const workflowServiceSource = read('apps/api/src/services/workflowExecutorService.js');
const temporalWorkflowSource = read(
  'packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  approvalEditorSource.includes("rejectTargetNodeKey: ''")
    && approvalEditorSource.includes('branchTargetOptions = []')
    && approvalEditorSource.includes('When rejected, jump to')
    && approvalEditorSource.includes('<option value="">Use rejection action</option>')
    && approvalEditorSource.includes('When set, it overrides the rejection action.'),
  'Human Approval authoring must expose a forward rejection branch that overrides the fallback action.',
);

assert(
  workflowBuilderSource.includes(
    'branchTargetOptions={getForwardBranchTargetOptions(allNodes, index)}',
  )
    && workflowManagerSource.includes(
      'branchTargetOptions={getForwardBranchTargetOptions(allNodes, index)}',
    ),
  'Create and Manage Workflow must constrain approval rejection jumps to later workflow nodes.',
);

assert(
  workflowServiceSource.includes('function validateHumanApprovalBranchTargets(nodes = [])')
    && workflowServiceSource.includes('validateHumanApprovalBranchTargets(nodes);')
    && workflowServiceSource.includes(
      'Human approval rejection branch targets must point to later nodes in the sequential lane.',
    )
    && workflowServiceSource.includes(
      'rejectTargetNodeKey: approvalParameters.rejectTargetNodeKey || null',
    ),
  'Workflow persistence must validate approval rejection branches and carry the target into approval evidence.',
);

const branchResolutionIndex = temporalWorkflowSource.indexOf(
  'const approvalBranchTargetIndex = resolveHumanApprovalBranchIndex({',
);
const fallbackActionIndex = temporalWorkflowSource.indexOf(
  "const action = completedNodeRun.output.action || 'FAIL_WORKFLOW';",
  branchResolutionIndex,
);
assert(
  temporalWorkflowSource.includes('function resolveHumanApprovalBranchIndex(')
    && temporalWorkflowSource.includes('const approvalBranchRoutes = [];')
    && temporalWorkflowSource.includes('approvalBranchRoutes.push({')
    && temporalWorkflowSource.includes('approvalBranchRoutes,')
    && branchResolutionIndex >= 0
    && fallbackActionIndex > branchResolutionIndex,
  'Temporal execution must resolve a configured rejection jump before applying fail/stop/continue fallback behavior.',
);

assert(
  temporalWorkflowSource.includes("branchLabel: rejectTargetNodeKey ? 'REJECTED' : null")
    && temporalWorkflowSource.includes('branchTargetNodeKey: rejectTargetNodeKey || null')
    && temporalWorkflowSource.includes('routing to ${rejectTargetNodeKey}.'),
  'Rejected approval output must record the chosen branch for workflow history and runtime inspection.',
);

assert(
  workflowGraphSource.includes('function getHumanApprovalRuntimeRoute(')
    && workflowGraphSource.includes('function getHumanApprovalBranchBadges(')
    && workflowGraphSource.includes("branchLabel: 'REJECTED'")
    && workflowPageSource.includes('? `Jump to ${approval.branchTargetNodeKey}`'),
  'Workflow runtime surfaces must show rejected approval routing instead of presenting it as a terminal stop.',
);

console.log('[SkyCommand] Human Approval rejection branch self-test passed.');
