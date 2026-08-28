const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const serviceSource = read('apps/admin-web/src/services/workflowService.js');
const builderSource = read('apps/admin-web/src/pages/WorkflowBuilder.jsx');
const managerSource = read('apps/admin-web/src/pages/WorkflowManager.jsx');
const workflowSource = read('apps/admin-web/src/pages/SkyWorkflows.jsx');
const categoryUtilsSource = read('apps/admin-web/src/utils/workflowCategories.js');
const cssSource = read('apps/admin-web/src/App.css');

assert(
  serviceSource.includes("api.get('/api/workflows/categories'")
    && serviceSource.includes('listCategories,'),
  'Admin-Web workflow service must expose the workflow category catalogue.',
);

assert(
  categoryUtilsSource.includes("DEFAULT_WORKFLOW_CATEGORY_CODE = 'GENERAL'")
    && categoryUtilsSource.includes('getWorkflowCategoryCode')
    && categoryUtilsSource.includes('getWorkflowCategoryDisplayName')
    && categoryUtilsSource.includes('normalizeWorkflowCategories'),
  'Workflow category UI must share one normalization/display contract.',
);

assert(
  builderSource.includes('id="workflowCategory"')
    && builderSource.includes("categoryCode: DEFAULT_WORKFLOW_CATEGORY_CODE")
    && builderSource.includes('workflowService.listCategories()')
    && builderSource.includes('categoryCode,\n        description:')
    && builderSource.includes('Workflow category is required.'),
  'Create Workflow must load categories, require a category, and send categoryCode when creating a definition.',
);

assert(
  managerSource.includes('id="manageWorkflowCategoryFilter"')
    && managerSource.includes("renderManageWorkflowSortableHeader('Category', 'category')")
    && managerSource.includes('id="managerCategory"')
    && managerSource.includes('categoryCode: metadataForm.categoryCode')
    && managerSource.includes('Category changes reorganize the catalogue without creating a new workflow graph version.'),
  'Manage Workflows must filter/sort by Category and edit category as definition metadata.',
);

assert(
  workflowSource.includes('id="startWorkflowCategoryFilter"')
    && workflowSource.includes("renderStartWorkflowSortableHeader('Category', 'category')")
    && workflowSource.includes("startWorkflowFilters.categoryCode")
    && workflowSource.includes('getWorkflowCategoryDisplayName(definition, workflowCategories)'),
  'Start Workflow must expose Category as a catalogue filter and sortable column.',
);

assert(
  workflowSource.includes('id="workflowHistoryCategory"')
    && workflowSource.includes("renderHistorySortableHeader('Category', 'category')")
    && workflowSource.includes('categoryCode: nextFilters.categoryCode')
    && workflowSource.includes('getWorkflowCategoryDisplayName(run, workflowCategories)'),
  'Workflow Operations must expose Category as a server-backed filter and sortable run-history column.',
);

assert(
  cssSource.includes('.sky-workflow-start-filter-grid')
    && cssSource.includes('repeat(4, minmax(8.5rem, 0.68fr))')
    && cssSource.includes('.sky-manage-workflows-filter-grid')
    && cssSource.includes('repeat(5, minmax(8rem, 0.64fr))')
    && cssSource.includes('.sky-history-browser-filter-grid')
    && cssSource.includes('repeat(3, minmax(9.5rem, 0.72fr))'),
  'Workflow category filters must remain on the canonical single-row browser grid at desktop widths.',
);

console.log('[SkyCommand] Workflow category UI self-test passed.');
