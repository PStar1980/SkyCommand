const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const workflowServiceSource = fs.readFileSync(
  path.join(repoRoot, 'apps/api/src/services/workflowExecutorService.js'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  workflowServiceSource.includes('runtimeParameters: sourceRuntimeParameters,') &&
    workflowServiceSource.includes(
      'source.runtimeParameters || getParameterSchemaFromConfig(source.config || {})',
    ),
  'Workflow cloning must copy the complete workflow-level runtime parameter schema.',
);

assert(
  workflowServiceSource.includes('config: getCloneableWorkflowConfig(source.config),') &&
    workflowServiceSource.includes('startPermissionCode: source.startPermissionCode,') &&
    workflowServiceSource.includes('cancelPermissionCode: source.cancelPermissionCode,') &&
    workflowServiceSource.includes('clonedFromWorkflowCode: source.workflowCode,'),
  'Workflow cloning must preserve definition-level execution configuration and permissions while recording clone provenance.',
);

assert(
  workflowServiceSource.includes('delete sourceConfig.createdBy;') &&
    workflowServiceSource.includes('delete sourceConfig.updatedBy;') &&
    workflowServiceSource.includes('delete sourceConfig.lastVersionCreatedBy;') &&
    workflowServiceSource.includes('delete sourceConfig.runtimeParameters;'),
  'Workflow clone configuration must discard source authoring metadata before fresh clone metadata is applied.',
);

const nodeCloneStart = workflowServiceSource.indexOf('function versionNodesToCreateInput(nodes = [])');
const nodeCloneEnd = workflowServiceSource.indexOf(
  '\nfunction validateConditionBranchTargets',
  nodeCloneStart,
);
const nodeCloneSource = workflowServiceSource.slice(nodeCloneStart, nodeCloneEnd);

[
  'nodeKey: node.nodeKey',
  'nodeTypeCode: node.nodeTypeCode',
  'displayName: node.displayName',
  'description: node.description',
  'targetCode: node.targetCode',
  'inputParameters: getSafeObject(node.inputParameters)',
  'retryPolicy: getSafeObject(node.retryPolicy)',
  'timeoutMs: node.timeoutMs',
  'positionX: node.positionX',
  'positionY: node.positionY',
  'displayOrder: node.displayOrder',
  'enabled: node.enabled !== false',
  "config: getSafeObject(node.config, { builderCard: 'tool' })",
].forEach((fragment) => {
  assert(
    nodeCloneSource.includes(fragment),
    `Workflow node cloning must preserve ${fragment}.`,
  );
});

console.log('[SkyCommand] Workflow clone parity self-test passed.');
