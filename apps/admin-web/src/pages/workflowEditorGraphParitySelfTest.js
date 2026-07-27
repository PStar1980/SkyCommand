const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const graphSource = fs.readFileSync(path.join(root, 'components', 'WorkflowVisualGraph.jsx'), 'utf8');
const managerSource = fs.readFileSync(path.join(__dirname, 'WorkflowManager.jsx'), 'utf8');
const builderSource = fs.readFileSync(path.join(__dirname, 'WorkflowBuilder.jsx'), 'utf8');
const manageToolsSource = fs.readFileSync(path.join(__dirname, 'ManageTools.jsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'App.css'), 'utf8');

const checks = [
  [
    graphSource.includes('function getDesignNodeOverlay')
      && graphSource.includes("label: 'Configuration'")
      && graphSource.includes("runtimeOverlay ? 'Runtime' : designOverlay.label"),
    'Workflow editor nodes must use the shared bottom mini-card treatment.',
  ],
  [
    managerSource.includes('<WorkflowVisualGraph\n                    inspectorMode="navigation"'),
    'Manage Workflows must use graph navigation instead of the node inspector card.',
  ],
  [
    /<WorkflowVisualGraph\s+inspectorMode="navigation"/.test(builderSource)
      && !builderSource.includes('includeRuntimeInspectorRows'),
    'Create Workflow must use graph navigation instead of the node inspector card.',
  ],
  [
    managerSource.includes('sky-manage-workflows-filter-grid')
      && cssSource.includes('.sky-manage-workflows-filter-grid'),
    'Manage Workflows filters must keep the Clear filters action on the main filter row.',
  ],
  [
    /\.sky-workflow-start-detail-stack\s*\{[^}]*display:\s*grid;[^}]*gap:\s*1rem;/s.test(cssSource),
    'Start Workflow graph and node-detail cards must use the standard one-rem vertical gap.',
  ],
  [
    manageToolsSource.includes('Clear filters'),
    'Manage Tools must label the reset action Clear filters.',
  ],
  [
    !manageToolsSource.includes('Apply filters')
      && manageToolsSource.includes('filterAutoApplyReadyRef')
      && manageToolsSource.includes('<th>Category</th>'),
    'Manage Tools filters must auto-apply and the catalogue must expose a dedicated Category column.',
  ],
  [
    !manageToolsSource.includes('<th className="text-end">Actions</th>')
      && !managerSource.includes('<th className="text-end">Actions</th>'),
    'Manage Tools and Manage Workflows must use row selection without redundant Actions columns.',
  ],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);

if (failures.length > 0) {
  console.error('[SkyCommand] Workflow editor graph parity self-test failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[SkyCommand] Workflow editor graph parity self-test passed.');
