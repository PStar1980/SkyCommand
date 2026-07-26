const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const addToolSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/AddTool.jsx'),
  'utf8',
);
const workflowSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/pages/SkyWorkflows.jsx'),
  'utf8',
);
const cssSource = fs.readFileSync(
  path.join(repoRoot, 'apps/admin-web/src/App.css'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  addToolSource.includes('className="form-control sky-form-control sky-tool-upload-input"'),
  'Add Tool file inputs must use the shared SkyCommand form-control skin.',
);
assert(
  cssSource.includes('.sky-tool-upload-input::file-selector-button'),
  'Add Tool file inputs must style the browser file-selector button.',
);
assert(
  workflowSource.includes('id="startWorkflowSearchFilter"') &&
    workflowSource.includes('id="startWorkflowStructureFilter"') &&
    workflowSource.includes('id="startWorkflowParameterFilter"') &&
    workflowSource.includes('id="startWorkflowNodeScaleFilter"'),
  'Start Workflow must provide search and workflow catalogue filters.',
);
assert(
  workflowSource.includes('renderStartWorkflowPagination()') &&
    workflowSource.includes('aria-label="Start workflow pagination"'),
  'Start Workflow must provide Tool History-style pagination.',
);
assert(
  workflowSource.includes('<th>Workflow</th>') &&
    workflowSource.includes("'Select workflow'") &&
    !workflowSource.includes('id="workflowStartDefinition"'),
  'Start Workflow must use a selectable full-width table instead of the legacy dropdown.',
);
assert(
  workflowSource.includes('{selectedDefinition && (') &&
    workflowSource.includes('className="sky-card sky-workflow-start-config-card"'),
  'Workflow information and parameter entry must appear only after a workflow is selected.',
);
assert(
  workflowSource.includes('inspectorMode="navigation"') &&
    !workflowSource.includes('inspectorMode="full"'),
  'Start Workflow must remove the full node inspector while retaining lightweight graph navigation.',
);
assert(
  workflowSource.includes('className="sky-workflow-start-detail-stack"') &&
    cssSource.includes('.sky-workflow-start-detail-stack .sky-workflow-visual-map') &&
    cssSource.includes('overflow-x: auto;'),
  'Start Workflow graph must stay page-width and scroll horizontally like Workflow History.',
);
assert(
  !workflowSource.includes('Runtime values are saved into workflow context as <code>params</code>'),
  'Start Workflow must not repeat workflow parameter authoring instructions in the launch card.',
);
assert(
  workflowSource.includes('function WorkflowNodeParameterCard({') &&
    workflowSource.includes('isVisualNodeCompleted(') &&
    workflowSource.includes('<WorkflowNodeOutputLedger') &&
    workflowSource.includes('<WorkflowNodeParameterCard'),
  'Start Workflow must switch between focused output and saved node parameters based on node completion.',
);

console.log('[SkyCommand] Start Workflow catalogue, conditional node detail, and Add Tool upload UI self-test passed.');
