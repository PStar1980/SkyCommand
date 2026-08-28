const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const migration = read('packages/db_build/src/migrations/00107__workflow_category_foundation.sql');
const seed = read('packages/db_build/src/seeds/00108__workflow_category_seed.sql');
const runProjectionMigration = read('packages/db_build/src/migrations/00109__workflow_run_category_projection.sql');
const tableSource = read('scripts/db/tables/worker.workflow_categories.sql');
const definitionTableSource = read('scripts/db/tables/worker.workflow_definitions.sql');
const definitionViewSource = read('scripts/db/views/worker.vw_workflow_definitions.sql');
const runViewSource = read('scripts/db/views/worker.vw_workflow_run_records.sql');
const workflowService = read('apps/api/src/services/workflowExecutorService.js');
const workflowController = read('apps/api/src/controllers/workflowController.js');
const workflowRoutes = read('apps/api/src/routes/workflow.routes.js');
const readinessService = read('apps/api/src/services/productionReadinessService.js');
const setupScript = read('scripts/db/workflowCategoryFoundation.js');

assert(
  migration.includes('CREATE TABLE IF NOT EXISTS worker.workflow_categories')
    && migration.includes('workflow_category_id UUID')
    && migration.includes('ON DELETE RESTRICT')
    && migration.includes('ALTER COLUMN workflow_category_id SET NOT NULL'),
  'Workflow category migration must create a first-class category table and require every workflow definition to reference one safely.',
);

assert(
  migration.includes("'GENERAL'")
    && migration.includes('idx_workflow_definitions_category_status')
    && migration.includes('category_display_name')
    && migration.includes('category_display_order'),
  'Workflow category migration must bootstrap GENERAL, index category browsing, and expose category metadata through the definition view.',
);

[
  "'REPOSITORY_AUTOMATION'",
  "'DATA_PIPELINES'",
  "'DATABASE_OPERATIONS'",
  "'GENERAL'",
  "'skyserver_dev_commit'",
  "'git-repo-intelligence'",
  "'repo-map-zip'",
  "'macro-refresh-pipeline'",
  "'db-sync-test'",
].forEach((fragment) => {
  assert(seed.includes(fragment), `Workflow category seed is missing ${fragment}.`);
});

assert(
  tableSource.includes('workflow_category_id UUID PRIMARY KEY')
    && definitionTableSource.includes('workflow_category_id UUID NOT NULL REFERENCES worker.workflow_categories')
    && definitionViewSource.includes('category.category_code')
    && definitionViewSource.includes('category.display_name AS category_display_name'),
  'Database source-of-truth scripts must model workflow categories and expose them through worker.vw_workflow_definitions.',
);


assert(
  runProjectionMigration.includes("metadata ->> 'workflowCategoryCode'")
    && runProjectionMigration.includes('workflow_category_code')
    && runProjectionMigration.includes("'CURRENT_DEFINITION'")
    && runViewSource.includes('workflow_category_display_name')
    && runViewSource.includes('workflow_category_source'),
  'Workflow run history must prefer category snapshots and provide a current-definition fallback for legacy runs.',
);

const legacyRunViewColumns = [
  'r.workflow_run_record_id',
  'r.workflow_definition_id',
  'd.workflow_code AS definition_workflow_code',
  'd.display_name AS workflow_display_name',
  'r.workflow_version_id',
  'v.version_number AS definition_version_number',
  'r.workflow_code',
  'r.version_number',
  'r.run_source',
  'r.trigger_type',
  'r.status',
  'r.temporal_workflow_id',
  'r.temporal_run_id',
  'r.input',
  'r.request_context',
  'r.summary',
  'r.started_by_user_id',
  'u.email AS started_by_email',
  'u.display_name AS started_by_display_name',
  'r.started_at',
  'r.completed_at',
  'r.metadata',
  'r.created_at',
  'r.updated_at',
];

function assertViewAppendsCategoryColumns(source, label) {
  let previousIndex = -1;

  legacyRunViewColumns.forEach((column) => {
    const index = source.indexOf(column);
    assert(index > previousIndex, `${label} must preserve legacy run-view column order through ${column}.`);
    previousIndex = index;
  });

  const categoryIndex = source.indexOf('AS workflow_category_code');
  assert(
    categoryIndex > source.indexOf('r.updated_at'),
    `${label} must append workflow category columns after every existing run-view column so CREATE OR REPLACE VIEW remains PostgreSQL-compatible.`,
  );
}

assertViewAppendsCategoryColumns(runProjectionMigration, 'Workflow category run projection migration');
assertViewAppendsCategoryColumns(runViewSource, 'Workflow run source-of-truth view');

assert(
  workflowService.includes('async function listWorkflowCategories')
    && workflowService.includes('async function resolveWorkflowCategory')
    && workflowService.includes("const DEFAULT_WORKFLOW_CATEGORY_CODE = 'GENERAL';")
    && workflowService.includes('categoryCode: req.query?.categoryCode') === false,
  'Workflow service must own category resolution/catalogue behavior and keep HTTP query handling in the controller.',
);

assert(
  workflowService.includes('categoryCode = \'\'')
    && workflowService.includes('category_code = $${params.length}')
    && workflowService.includes('ORDER BY display_name, workflow_code'),
  'Workflow definition catalogue must support category filtering without changing the existing default catalogue ordering.',
);

assert(
  workflowService.includes('workflow_category_id,\n          workflow_code,')
    && workflowService.includes('category.workflowCategoryId,\n        workflowCode,')
    && workflowService.includes("payload.categoryCode || definitionDefaults.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE"),
  'Workflow creation must persist an enabled category while retaining GENERAL as the backward-compatible default.',
);

assert(
  workflowService.includes("Object.prototype.hasOwnProperty.call(payload, 'categoryCode')")
    && workflowService.includes('workflow_category_id = COALESCE($7, workflow_category_id)')
    && workflowService.includes('categoryCode: payload.categoryCode || source.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE'),
  'Workflow metadata updates must allow category moves without graph-version changes, and clones must inherit their source category.',
);

assert(
  workflowService.includes('categoryCode: definition.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE')
    && workflowService.includes("categoryDisplayName: definition.categoryDisplayName || 'General'")
    && workflowService.includes('workflowCategoryCode: definition.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE')
    && workflowService.includes("workflowCategoryDisplayName: definition.categoryDisplayName || 'General'"),
  'Workflow version snapshots and run metadata must retain category evidence for historical auditability.',
);

assert(
  workflowRoutes.includes("'/categories'")
    && workflowRoutes.includes('workflowController.listCategories')
    && workflowController.includes('async function listCategories')
    && workflowController.includes('workflowExecutorService.listWorkflowCategories')
    && workflowController.includes("categoryCode: req.query?.categoryCode || ''"),
  'Workflow HTTP API must expose the category catalogue and category-filtered workflow definitions.',
);

assert(
  workflowService.includes('categoryCode: item.categoryCode || DEFAULT_WORKFLOW_CATEGORY_CODE')
    && workflowService.includes('categoryDisplayName: item.categoryDisplayName || \'General\'')
    && workflowService.includes('categoryDisplayOrder: Number(item.categoryDisplayOrder || 0)'),
  'Workflow definition normalization and child-workflow targets must expose category metadata to future UI consumers.',
);


assert(
  workflowService.includes('workflowCategoryCode:')
    && workflowService.includes('workflowCategoryDisplayName:')
    && workflowService.includes("const rawCategoryCode = String(filters.categoryCode || '').trim();")
    && workflowService.includes('workflow_category_code = $${values.length}')
    && workflowService.includes('category: "LOWER(COALESCE(NULLIF(BTRIM(workflow_category_display_name), \'\'), workflow_category_code))"'),
  'Workflow run history must normalize, filter, and sort category metadata for Workflow Operations.',
);

assert(
  readinessService.includes("'worker.workflow_categories'"),
  'Production readiness must require the workflow category catalogue relation.',
);

assert(
  setupScript.includes("00107__workflow_category_foundation.sql")
    && setupScript.includes("00109__workflow_run_category_projection.sql")
    && setupScript.includes("00108__workflow_category_seed.sql")
    && setupScript.includes("workflow_category_id IS NULL")
    && setupScript.includes("Known workflow category mismatch"),
  'Workflow category foundation must include a non-destructive setup/verification utility for the active development database.',
);

console.log('[SkyCommand] Workflow category foundation self-test passed.');
