const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourceRoot = path.resolve(__dirname, '../..');
const dashboardPages = [
  'pages/Dashboard.jsx',
  'pages/ApiDashboard.jsx',
  'pages/IngestionStatus.jsx',
  'pages/ToolsDashboard.jsx',
  'pages/WorkflowsDashboard.jsx',
  'pages/AutomationDashboard.jsx',
];

for (const relativePath of dashboardPages) {
  const source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8');
  assert.match(source, /DashboardRefreshActions/);
  assert.match(source, /actionClassName="sky-dashboard-page-actions"/);
  assert.doesNotMatch(source, /Refresh (dashboard|analytics|all)/);
}

const refreshActionsSource = fs.readFileSync(
  path.join(sourceRoot, 'components/ui/DashboardRefreshActions.jsx'),
  'utf8',
);
assert.match(refreshActionsSource, /Last refresh:/);
assert.match(refreshActionsSource, /showUpdatedAt=\{false\}/);
assert.match(refreshActionsSource, /loading \? 'Refreshing\.\.\.' : 'Refresh'/);

const pollingSource = fs.readFileSync(
  path.join(sourceRoot, 'components/ui/SmartPollingStatus.jsx'),
  'utf8',
);
assert.match(pollingSource, /showUpdatedAt = true/);
assert.match(pollingSource, /showUpdatedAt &&/);

const cssSource = fs.readFileSync(path.join(sourceRoot, 'App.css'), 'utf8');
assert.match(cssSource, /--sky-max-display-font-size: 1\.14rem;/);
assert.match(cssSource, /\.sky-main \.h4 \{\s*font-size: 1\.1rem;/);
assert.match(cssSource, /\.sky-dashboard-refresh-stack/);
assert.match(
  cssSource,
  /\.sky-dashboard-command-title,\s*\.sky-page-title \{[\s\S]*?font-size: 1\.16rem;[\s\S]*?font-weight: 780;/,
);

const navbarSource = fs.readFileSync(path.join(sourceRoot, 'components/Navbar.jsx'), 'utf8');
const dashboardGroupSource = navbarSource.slice(
  navbarSource.indexOf("label: 'Dashboards'"),
  navbarSource.indexOf("label: 'Tools',\n      icon: '◧'"),
);
const expectedDashboardLabels = [
  'Command Center',
  'API',
  'Data',
  'Tools',
  'Workflows',
  'Automation',
];
let priorLabelIndex = -1;

for (const label of expectedDashboardLabels) {
  const labelIndex = dashboardGroupSource.indexOf(`label: '${label}'`);
  assert.ok(labelIndex > priorLabelIndex, `${label} should follow the dashboard menu order.`);
  priorLabelIndex = labelIndex;
}

assert.doesNotMatch(dashboardGroupSource, /label: 'Readiness'/);
assert.doesNotMatch(navbarSource, /'readiness dashboard': '\/dashboard\/readiness'/);
assert.match(navbarSource, /readiness: '\/configuration\/production-readiness'/);

const dataDashboardSource = fs.readFileSync(
  path.join(sourceRoot, 'pages/IngestionStatus.jsx'),
  'utf8',
);
assert.match(dataDashboardSource, /const statCards = useMemo\(\(\) => buildStatCards\(summary\)/);
assert.match(dataDashboardSource, /sky-ingestion-stat-card/);
assert.doesNotMatch(dataDashboardSource, />Source health</);

const toolHistorySource = fs.readFileSync(path.join(sourceRoot, 'pages/ScriptExecutions.jsx'), 'utf8');
assert.match(toolHistorySource, /DashboardRefreshActions/);
assert.match(toolHistorySource, /lastRefreshAt=\{refreshingAt\}/);
assert.match(toolHistorySource, /toolHistoryCategoryFilter/);
assert.match(toolHistorySource, /toolHistoryToolFilter/);
assert.match(toolHistorySource, /toolHistoryStatusFilter/);

const workflowHistorySource = fs.readFileSync(path.join(sourceRoot, 'pages/SkyWorkflows.jsx'), 'utf8');
assert.match(workflowHistorySource, /DashboardRefreshActions/);
assert.doesNotMatch(workflowHistorySource, /Updated\{' '\}/);

const apiSourceRoot = path.resolve(sourceRoot, '../../api/src');
const adminRoutesSource = fs.readFileSync(
  path.join(apiSourceRoot, 'routes/admin.routes.js'),
  'utf8',
);
const adminControllerSource = fs.readFileSync(
  path.join(apiSourceRoot, 'controllers/adminController.js'),
  'utf8',
);
const adminReadServiceSource = fs.readFileSync(
  path.join(apiSourceRoot, 'services/adminReadService.js'),
  'utf8',
);
assert.match(adminRoutesSource, /\/script-executions\/options/);
assert.match(adminControllerSource, /getScriptExecutionOptions/);
assert.match(adminReadServiceSource, /columnName: 'category', value: filters\.category/);
assert.match(adminReadServiceSource, /async function getScriptExecutionOptions\(\)/);

console.log('[SkyCommand] Dashboard header and page typography self-test passed.');
