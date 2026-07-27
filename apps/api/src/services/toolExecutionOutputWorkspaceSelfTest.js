const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '../../../..');
const adminReadSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/services/adminReadService.js'),
  'utf8',
);
const executionSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/services/scriptExecutionService.js'),
  'utf8',
);
const controllerSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/controllers/adminController.js'),
  'utf8',
);
const routeSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/routes/admin.routes.js'),
  'utf8',
);
const adminWebRoot = path.join(repositoryRoot, 'apps/admin-web/src');
const historySource = fs.readFileSync(path.join(adminWebRoot, 'pages/ScriptExecutions.jsx'), 'utf8');
const runToolsSource = fs.readFileSync(path.join(adminWebRoot, 'pages/Tools.jsx'), 'utf8');
const outputPanelsSource = fs.readFileSync(
  path.join(adminWebRoot, 'components/tools/ToolExecutionOutputPanels.jsx'),
  'utf8',
);
const structuredDisplaySource = fs.readFileSync(
  path.join(adminWebRoot, 'components/tools/StructuredToolResultDisplay.jsx'),
  'utf8',
);
const manageToolsSource = fs.readFileSync(path.join(adminWebRoot, 'pages/ManageTools.jsx'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(adminWebRoot, 'pages/Dashboard.jsx'), 'utf8');
const dashboardVisualsSource = fs.readFileSync(
  path.join(adminWebRoot, 'components/charts/DashboardVisuals.jsx'),
  'utf8',
);

assert.match(executionSource, /toolResultPersisted: Boolean\(childResult\.toolResult\)/);
assert.match(executionSource, /toolResult: childResult\.toolResult/);
assert.match(adminReadSource, /async function getScriptExecutionDetail\(executionId\)/);
assert.match(adminReadSource, /readScriptExecutionOutput/);
assert.match(adminReadSource, /structuredResult: metadata\.toolResult \|\| null/);
assert.match(adminReadSource, /sanitizeScriptExecutionMetadata/);
assert.match(routeSource, /\/script-executions\/:executionId/);
assert.match(controllerSource, /getScriptExecutionDetail/);

assert.match(historySource, /ToolExecutionOutputPanels/);
assert.match(historySource, /Tool Details/);
assert.match(historySource, /sky-tool-details-modal/);
assert.match(historySource, /sky-tool-history-workspace-card/);
assert.match(historySource, /toolHistorySearchFilter/);
assert.match(historySource, /Clear filters/);
assert.doesNotMatch(historySource, /sky-execution-detail-layout/);
assert.match(runToolsSource, /title="Run Tools"/);
assert.match(runToolsSource, /sky-run-tools-browser/);
assert.match(runToolsSource, /table table-sm table-hover sky-table/);
assert.match(runToolsSource, /renderPagination/);
assert.match(runToolsSource, /sky-run-tool-result-workspace/);
assert.match(runToolsSource, /ToolExecutionOutputPanels/);
assert.doesNotMatch(runToolsSource, /sky-tool-category-list/);
assert.doesNotMatch(runToolsSource, /row g-3 sky-run-tools-layout/);

assert.match(manageToolsSource, /sky-manage-tools-browser/);
assert.match(manageToolsSource, /table table-sm table-hover sky-table/);
assert.match(manageToolsSource, /renderPagination/);
assert.doesNotMatch(manageToolsSource, /sky-tool-admin-list/);
assert.doesNotMatch(manageToolsSource, /title="Tool catalogue"/);

assert.match(outputPanelsSource, /Streamed tool output/);
assert.match(outputPanelsSource, /Structured output/);
assert.match(outputPanelsSource, /StructuredToolResultDisplay/);
assert.match(outputPanelsSource, /sky-tool-output-grid-stacked/);
assert.match(outputPanelsSource, /expectedOutputType/);
assert.match(outputPanelsSource, /toolResult\.output \?\? toolResult/);
for (const outputType of [
  'macro_ingestion_summary.v1',
  'repository_package_summary.v1',
  'repository_map_summary.v1',
  'git_repository_status.v1',
  'git_commit_summary.v1',
  'git_branch_sync_summary.v1',
  'database_health_summary.v1',
  'database_build_summary.v1',
  'postgresql_database_comparison_summary.v1',
]) {
  assert.match(structuredDisplaySource, new RegExp(outputType.replaceAll('.', '\\.')));
}
assert.match(structuredDisplaySource, /Run totals/);
assert.match(structuredDisplaySource, /Indicator results/);

assert.match(dashboardSource, /<ServerStatusPanel/);
for (const serverLabel of [
  'Web server',
  'Database',
  'API server',
  'Node worker',
  'Temporal server',
  'Temporal worker',
]) {
  assert.match(dashboardSource, new RegExp(`label: '${serverLabel}'`));
}
assert.doesNotMatch(dashboardSource, /label: 'Readiness'/);
assert.match(dashboardSource, /async function loadDashboardActivity\(loader\)/);
assert.match(dashboardSource, /from: getDashboardActivityWindowStart\(\)/);
assert.match(dashboardSource, /DASHBOARD_ACTIVITY_PAGE_SIZE = 200/);
assert.doesNotMatch(dashboardVisualsSource, /SystemHealthStrip/);

console.log('[SkyCommand] Server status and tool execution output workspace self-test passed.');
