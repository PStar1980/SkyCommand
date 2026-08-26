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
    managerSource.includes("renderManageWorkflowSortableHeader('Workflow', 'workflow')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Structure', 'structure')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Nodes', 'nodes')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Edges', 'edges')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Runtime parameters', 'runtimeParameters')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Published version', 'publishedVersion')")
      && managerSource.includes("renderManageWorkflowSortableHeader('Status', 'status')")
      && managerSource.includes('Shift+click to add to multi-column sorting')
      && managerSource.includes('Clear sorting'),
    'Manage Workflows catalogue headers must use canonical multi-column sorting controls.',
  ],
  [
    managerSource.includes('sky-canonical-operations-table-frame')
      && managerSource.includes('sky-canonical-operations-table align-middle mb-0')
      && managerSource.includes('sky-canonical-operations-pagination-row')
      && managerSource.includes('id="manageWorkflowRowsSelect"')
      && managerSource.includes('manageWorkflowAvailablePageSizes.map')
      && managerSource.includes('changeManageWorkflowPageSize')
      && managerSource.includes('browserCardRef.current?.scrollIntoView')
      && managerSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
    'Manage Workflows catalogue must use the canonical table frame, centered gold pagination, and smart Rows selector.',
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
      && manageToolsSource.includes('initialLoadCompleteRef')
      && manageToolsSource.includes("renderSortableHeader('Category', 'category')"),
    'Manage Tools filters must auto-apply and the catalogue must expose a dedicated Category column.',
  ],
  [
    manageToolsSource.includes("renderSortableHeader('Tool', 'tool')")
      && manageToolsSource.includes("renderSortableHeader('Category', 'category')")
      && manageToolsSource.includes("renderSortableHeader('Runtime', 'runtime')")
      && manageToolsSource.includes("renderSortableHeader('Risk', 'risk')")
      && manageToolsSource.includes("renderSortableHeader('Parameters', 'parameters')")
      && manageToolsSource.includes("renderSortableHeader('Visibility', 'visibility')")
      && manageToolsSource.includes("renderSortableHeader('Output contract', 'outputContract')")
      && manageToolsSource.includes("renderSortableHeader('Status', 'status')")
      && manageToolsSource.includes('Shift+click to add to multi-column sorting')
      && manageToolsSource.includes('Clear sorting'),
    'Manage Tools catalogue headers must use canonical multi-column sorting controls.',
  ],
  [
    manageToolsSource.includes('sky-canonical-operations-table-frame')
      && manageToolsSource.includes('sky-canonical-operations-table align-middle mb-0')
      && manageToolsSource.includes('sky-canonical-operations-pagination-row')
      && manageToolsSource.includes('sky-canonical-operations-pagination-balance')
      && manageToolsSource.includes('className="btn btn-sm sky-pagination-nav-button"'),
    'Manage Tools catalogue must use the canonical table frame and centered gold pagination.',
  ],
  [
    manageToolsSource.includes('const MANAGE_TOOLS_FETCH_LIMIT = 500;')
      && manageToolsSource.includes('async function listAllManagedTools')
      && manageToolsSource.includes('offset += batch.length;')
      && manageToolsSource.includes('listAllManagedTools(DEFAULT_FILTERS)'),
    'Manage Tools must respect the API maximum page size while assembling the full filtered catalogue for client-side sorting.',
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
