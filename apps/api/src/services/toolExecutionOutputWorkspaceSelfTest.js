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
assert.doesNotMatch(historySource, /sky-execution-detail-layout/);
assert.match(runToolsSource, /title="Run Tools"/);
assert.match(runToolsSource, /sky-run-tool-result-workspace/);
assert.match(runToolsSource, /ToolExecutionOutputPanels/);
assert.match(outputPanelsSource, /Streamed tool output/);
assert.match(outputPanelsSource, /Structured output/);
assert.match(outputPanelsSource, /toolResult\.output \?\? toolResult/);

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
assert.doesNotMatch(dashboardVisualsSource, /SystemHealthStrip/);

console.log('[SkyCommand] Server status and tool execution output workspace self-test passed.');
