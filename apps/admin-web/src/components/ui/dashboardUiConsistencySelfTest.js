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
  'pages/DockerOverview.jsx',
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

const panelSource = fs.readFileSync(path.join(sourceRoot, 'components/ui/Panel.jsx'), 'utf8');
assert.match(panelSource, /titleClassName = 'h5 mb-0'/);
assert.match(panelSource, /<h2 className=\{titleClassName\}>\{title\}<\/h2>/);

const addToolSource = fs.readFileSync(path.join(sourceRoot, 'pages/AddTool.jsx'), 'utf8');
assert.match(addToolSource, /title="Add Tool"/);
assert.match(addToolSource, /titleClassName="sky-page-title mb-0"/);

const navbarSource = fs.readFileSync(path.join(sourceRoot, 'components/Navbar.jsx'), 'utf8');
const dashboardGroupSource = navbarSource.slice(
  navbarSource.indexOf("label: 'Dashboards'"),
  navbarSource.indexOf("label: 'Tools',\n      icon: '◧'"),
);
const expectedDashboardLabels = [
  'Command Center',
  'Tools',
  'Workflows',
  'Automation',
  'Data',
  'API',
  'Docker',
];
let priorLabelIndex = -1;

for (const label of expectedDashboardLabels) {
  const labelIndex = dashboardGroupSource.indexOf(`label: '${label}'`);
  assert.ok(labelIndex > priorLabelIndex, `${label} should follow the dashboard menu order.`);
  priorLabelIndex = labelIndex;
}

assert.match(dashboardGroupSource, /label: 'Docker'[\s\S]*?to: '\/dashboard\/docker'/);
assert.doesNotMatch(dashboardGroupSource, /label: 'Readiness'/);
assert.doesNotMatch(navbarSource, /'readiness dashboard': '\/dashboard\/readiness'/);
assert.match(navbarSource, /readiness: '\/configuration\/production-readiness'/);
assert.doesNotMatch(navbarSource, /label: 'Worker Health'/);
assert.doesNotMatch(navbarSource, /to: '\/workflows\/worker-health'/);

const dataDashboardSource = fs.readFileSync(
  path.join(sourceRoot, 'pages/IngestionStatus.jsx'),
  'utf8',
);
assert.doesNotMatch(dataDashboardSource, /buildStatCards/);
assert.doesNotMatch(dataDashboardSource, /sky-ingestion-stat-card/);
assert.doesNotMatch(dataDashboardSource, />Indicator freshness</);
assert.doesNotMatch(dataDashboardSource, />Recent ingestion executions</);
assert.match(dataDashboardSource, /title="Data Dashboard"/);


const dataStatusSource = fs.readFileSync(path.join(sourceRoot, 'pages/DataStatus.jsx'), 'utf8');
assert.match(dataStatusSource, /title="Indicators"/);
assert.match(dataStatusSource, />Indicator freshness</);
assert.match(dataStatusSource, /SMART_TABLE_DEFAULT_PAGE_SIZE/);
assert.match(dataStatusSource, /DATA_INTELLIGENCE_FETCH_LIMIT = 500/);
assert.match(dataStatusSource, /renderSortableHeader\('Indicator', 'indicator'\)/);
assert.match(dataStatusSource, /getAvailableTablePageSizes/);
assert.match(dataStatusSource, /id="dataStatusRowsSelect"/);
assert.match(dataStatusSource, /sky-canonical-rows-control/);
assert.match(dataStatusSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
assert.match(dataStatusSource, /<div className="fw-bold">/);
assert.doesNotMatch(dataStatusSource, /fw-bold sky-detail-value/);
assert.match(dataStatusSource, /renderSortableHeader\('Latest data', 'latestData'\)/);
assert.match(dataStatusSource, /Shift\+click to add to multi-column sorting/);
assert.match(dataStatusSource, /Clear sorting/);
assert.match(dataStatusSource, /sky-canonical-operations-table-frame/);
assert.match(dataStatusSource, /sky-canonical-operations-pagination-row/);
assert.match(dataStatusSource, /dataStatusPageSelect/);
assert.match(dataStatusSource, /Showing \{rangeStart\}–\{rangeEnd\} of \{total\}/);

const dataGroupSource = navbarSource.slice(
  navbarSource.indexOf("label: 'Data',\n      icon: '◫'"),
  navbarSource.indexOf("label: 'Access Control'"),
);
assert.match(dataGroupSource, /label: 'Indicators'/);
assert.match(dataGroupSource, /to: '\/data\/intelligence'/);
assert.ok(dataGroupSource.indexOf("label: 'Ingestion Operations'") < dataGroupSource.indexOf("label: 'Indicators'"));
assert.match(dataStatusSource, /className="sky-data-status-filters"/);
assert.ok(
  dataStatusSource.indexOf('id="dataStatusSearchFilter"') < dataStatusSource.indexOf('id="dataStatusSourceFilter"'),
  'Indicators should place Search first in the filter row.',
);
assert.match(dataStatusSource, /onChange=\{\(event\) => updateFilter\('q', event\.target\.value\)\}/);
assert.doesNotMatch(dataStatusSource, />\s*Apply\s*</);
assert.doesNotMatch(navbarSource, /label: 'Configuration'/);

const routerSource = fs.readFileSync(path.join(sourceRoot, 'main.jsx'), 'utf8');
assert.match(routerSource, /path="dashboard\/docker"/);
assert.match(
  routerSource,
  /path="docker\/overview" element=\{<Navigate replace to="\/dashboard\/docker" \/>\}/,
);
assert.match(routerSource, /path="data\/intelligence"/);
assert.match(routerSource, /path="data\/status" element=\{<Navigate replace to="\/data\/intelligence" \/>\}/);
assert.match(routerSource, /<DataStatus \/>/);
assert.doesNotMatch(routerSource, /<WorkflowWorkerHealth \/>/);
assert.match(
  routerSource,
  /path="workflows\/worker-health"[\s\S]*?<Navigate replace to="\/dashboard\/automation" \/>/,
);

assert.match(navbarSource, /className="sky-topbar-center"/);
assert.match(navbarSource, /<header className="sky-topbar" ref=\{topbarControlsRef\}>/);
assert.match(cssSource, /\.sky-topbar \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns:/);
const globalBrandLockupWidth = cssSource.match(
  /\.sky-brand-lockup \{[\s\S]*?width:\s*([^;]+);/,
)?.[1]?.trim();
const scopedBrandLockupWidth = cssSource.match(
  /\.sky-sidebar-brand \.sky-brand-lockup,[\s\S]*?\.sky-public-brand \.sky-brand-lockup \{[\s\S]*?width:\s*([^;]+);/,
)?.[1]?.trim();
assert.match(globalBrandLockupWidth || '', /^min\(\d+(?:\.\d+)?rem,\s*100%\)$/);
assert.strictEqual(
  scopedBrandLockupWidth,
  globalBrandLockupWidth,
  'Public and sidebar brand lockups should use the same responsive width.',
);
assert.match(navbarSource, /<SkyCommandMark variant="lockup" \/>/);

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


assert.match(navbarSource, /function createNavGroups\(hasPermission, hasRole\)/);
assert.match(navbarSource, /label: 'Readiness'[\s\S]*?label: 'Production Readiness'[\s\S]*?visible: hasRole\('SUPER_ADMIN'\)/);
assert.doesNotMatch(dataGroupSource, /label: 'Production Readiness'/);
assert.match(routerSource, /roleCode="SUPER_ADMIN"/);

const authContextSource = fs.readFileSync(path.join(sourceRoot, 'context/AuthContext.jsx'), 'utf8');
const protectedRouteSource = fs.readFileSync(
  path.join(sourceRoot, 'components/ProtectedRoute.jsx'),
  'utf8',
);
const authServiceSource = fs.readFileSync(
  path.join(apiSourceRoot, 'services/authService.js'),
  'utf8',
);
assert.match(authContextSource, /const hasRole = useCallback/);
assert.match(authContextSource, /roleCodes\.has\(String\(roleCode\)/);
assert.match(protectedRouteSource, /roleCode/);
assert.match(protectedRouteSource, /!hasRole\(roleCode\)/);
assert.match(authServiceSource, /async function getRoleCodesForUser/);
assert.match(authServiceSource, /roleCodes:/);

const appShellSource = fs.readFileSync(path.join(sourceRoot, 'App.jsx'), 'utf8');
assert.match(appShellSource, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
assert.match(appShellSource, /\[location\.pathname\]/);

const dashboardSource = fs.readFileSync(path.join(sourceRoot, 'pages/Dashboard.jsx'), 'utf8');
assert.match(dashboardSource, /showRouteTable=\{false\}/);
assert.match(dashboardSource, /<ServerStatusPanel/);
assert.match(dashboardSource, /label: 'Supervisor'/);
assert.match(dashboardSource, /onStatusChange=\{setSupervisorStatus\}/);
assert.match(dashboardSource, /label: 'Web server'/);
assert.match(dashboardSource, /label: 'Temporal worker'/);
assert.match(dashboardSource, /label: 'Host agent'/);
assert.match(dashboardSource, /hostAgentHealth\.online/);
assert.match(dashboardSource, /title="SkyCommand User Summary"/);
assert.match(dashboardSource, />SkyCommand access activity<\/h2>/);
assert.doesNotMatch(dashboardSource, /SkyWeb User Summary/);
assert.doesNotMatch(dashboardSource, /skyweb-user-summary/);
assert.doesNotMatch(dashboardSource, /appCode: 'SKYWEB'/);
assert.match(dashboardSource, /workflowTaskQueue\.healthy[\s\S]*?\? 'Online'/);
assert.match(dashboardSource, /workflowTaskQueue\.healthy[\s\S]*?\? 'ONLINE'/);
assert.doesNotMatch(dashboardSource, /sky-command-center-page/);
assert.doesNotMatch(cssSource, /Command Center gold-outline experiment/);
assert.match(cssSource, /--sky-card-outline: rgba\(220, 177, 63, 0\.68\);/);
assert.match(cssSource, /Global gold card-outline contract/);
for (const selector of [
  '.sky-page-header,',
  '.sky-card,',
  '.sky-table-card,',
  '.sky-dashboard-visuals,',
  '.sky-chart-card,',
  '.sky-server-status-card,',
  '.sky-api-metric-card,',
  '.sky-api-route-card,',
  '.sky-mini-metric,',
]) {
  assert.ok(cssSource.includes(selector), `${selector} should participate in the global gold card-outline contract.`);
}
assert.match(cssSource, /border: 1px solid var\(--sky-card-outline\);/);
assert.doesNotMatch(dashboardSource, /workflowTaskQueue\.healthy[\s\S]*?\? 'Polling'/);
assert.doesNotMatch(dashboardSource, /workflowTaskQueue\.healthy[\s\S]*?\? 'POLLING'/);
assert.doesNotMatch(dashboardSource, /label: 'Readiness'/);
assert.doesNotMatch(dashboardSource, /productionReadiness/);

assert.match(dashboardSource, /loadDashboardActivity\(\(query\) => workflowService\.listRuns\(query\)\)/);
assert.match(dashboardSource, /loadDashboardActivity\(\(query\) => workerService\.listRuns\(query\)\)/);
assert.match(dashboardSource, /from: getDashboardActivityWindowStart\(\)/);
assert.match(dashboardSource, /to: new Date\(\)\.toISOString\(\)/);
assert.doesNotMatch(dashboardSource, /DASHBOARD_RECENT_LIMIT/);
assert.doesNotMatch(dashboardSource, /listAuditEvents/);
assert.doesNotMatch(dashboardSource, /api\/ingestion\/status/);

const dashboardVisualsSource = fs.readFileSync(
  path.join(sourceRoot, 'components/charts/DashboardVisuals.jsx'),
  'utf8',
);
for (const expectedText of [
  'Tool activity',
  'Workflow activity',
  'Automation activity',
  'Tool utilization',
  'Workflow performance',
  'Workflow utilization',
  'P50 duration',
  'P95 duration',
  'Productivity intelligence',
]) {
  assert.ok(dashboardVisualsSource.includes(expectedText), `${expectedText} should appear in Productivity Intelligence.`);
}
assert.match(dashboardVisualsSource, /name: 'Runs'/);
assert.match(dashboardVisualsSource, /name: 'Errors'/);
assert.doesNotMatch(dashboardVisualsSource, /Audit events/);
assert.doesNotMatch(dashboardVisualsSource, /Macro freshness/);
assert.doesNotMatch(dashboardVisualsSource, /Workflow quality mix/);
assert.doesNotMatch(dashboardVisualsSource, /Automation reliability/);
assert.doesNotMatch(dashboardVisualsSource, /Schedule outcome mix/);

const workflowExecutorSource = fs.readFileSync(
  path.join(apiSourceRoot, 'services/workflowExecutorService.js'),
  'utf8',
);
assert.match(workflowExecutorSource, /COALESCE\(started_at, created_at\) >= \$\$\{values\.length\}::timestamptz/);
assert.match(workflowExecutorSource, /COALESCE\(started_at, created_at\) <= \$\$\{values\.length\}::timestamptz/);
assert.match(workflowExecutorSource, /OFFSET \$\$\{values\.length \+ 2\}/);
assert.match(workflowExecutorSource, /SELECT COUNT\(\*\)::int AS total FROM worker\.vw_workflow_run_records/);

const workerServiceSource = fs.readFileSync(
  path.join(apiSourceRoot, 'services/workerService.js'),
  'utf8',
);
const scheduleRunSource = workerServiceSource.slice(workerServiceSource.indexOf('async function listScheduleRuns'));
assert.match(scheduleRunSource, /queued_at >= \$\$\{values\.length\}::timestamptz/);
assert.match(scheduleRunSource, /queued_at <= \$\$\{values\.length\}::timestamptz/);

const ingestionVisualsSource = fs.readFileSync(
  path.join(sourceRoot, 'components/charts/IngestionStatusVisuals.jsx'),
  'utf8',
);
assert.match(ingestionVisualsSource, /source\.counts \|\| \{\}/);
assert.match(ingestionVisualsSource, /Configured indicators grouped by source and freshness state\./);

const serverStatusPanelSource = fs.readFileSync(
  path.join(sourceRoot, 'components/ui/ServerStatusPanel.jsx'),
  'utf8',
);
assert.match(serverStatusPanelSource, /ONLINE_STATUSES/);
assert.match(serverStatusPanelSource, /Supervisor, web shell/);
assert.match(serverStatusPanelSource, /host execution agent/);
assert.match(serverStatusPanelSource, /isOnlineService\(item\) \? 'is-online' : ''/);

assert.match(cssSource, /route-contained workflow graph/);
assert.match(cssSource, /\.sky-workflow-history-detail-stack \.sky-workflow-visual-map \{[\s\S]*?overflow-x: auto;/);
assert.match(cssSource, /\.sky-server-status-grid \{[\s\S]*?repeat\(8, minmax\(0, 1fr\)\)/);
assert.match(cssSource, /\.sky-server-status-card\.is-online \{[\s\S]*?rgba\(255, 210, 97, 0\.78\)/);

console.log('[SkyCommand] Dashboard header and page typography self-test passed.');
