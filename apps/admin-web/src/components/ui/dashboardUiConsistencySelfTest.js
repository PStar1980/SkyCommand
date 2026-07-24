const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sourceRoot = path.resolve(__dirname, '../..');
const dashboardPages = [
  'pages/Dashboard.jsx',
  'pages/IngestionStatus.jsx',
  'pages/ToolsDashboard.jsx',
  'pages/WorkflowsDashboard.jsx',
  'pages/AutomationDashboard.jsx',
  'pages/ReadinessDashboard.jsx',
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

console.log('[SkyCommand] Dashboard header and page typography self-test passed.');
