const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(sourceRoot, '../../..');

const dashboardSource = fs.readFileSync(path.join(sourceRoot, 'pages/Dashboard.jsx'), 'utf8');
const visualsSource = fs.readFileSync(
  path.join(sourceRoot, 'components/charts/DashboardVisuals.jsx'),
  'utf8',
);
const apiDashboardSource = fs.readFileSync(path.join(sourceRoot, 'pages/ApiDashboard.jsx'), 'utf8');
const apiPanelSource = fs.readFileSync(
  path.join(sourceRoot, 'components/charts/ApiObservabilityPanel.jsx'),
  'utf8',
);
const navbarSource = fs.readFileSync(path.join(sourceRoot, 'components/Navbar.jsx'), 'utf8');
const routerSource = fs.readFileSync(path.join(sourceRoot, 'main.jsx'), 'utf8');
const serviceSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/services/apiTelemetryService.js'),
  'utf8',
);

assert.doesNotMatch(visualsSource, /ApiObservabilityPanel/);
assert.match(dashboardSource, /<ApiObservabilityPanel className="mt-4" data=\{summary\.apiTelemetry\} \/>/);
assert.ok(
  dashboardSource.indexOf('<ApiObservabilityPanel') <
    dashboardSource.indexOf('sky-dashboard-identity-panel'),
  'API observability must appear before Identity Early Warning.',
);
assert.match(apiPanelSource, /sky-card sky-api-observability-panel/);
assert.match(apiPanelSource, /sky-card-header sky-dashboard-section-heading/);

assert.match(apiDashboardSource, /DashboardRefreshActions/);
assert.match(apiDashboardSource, /DashboardFilterCard/);
assert.match(apiDashboardSource, /title="API Dashboard"/);
assert.match(apiDashboardSource, /Observation window/);
assert.match(apiDashboardSource, /Route contains/);
assert.match(apiDashboardSource, /Hourly pressure profile/);
assert.match(apiDashboardSource, /Slowest normalized routes/);
assert.match(apiDashboardSource, /Authentication modes/);

assert.match(navbarSource, /to: '\/dashboard\/api'/);
assert.match(navbarSource, /description: 'Request observability'/);
assert.match(routerSource, /path="dashboard\/api"/);
assert.match(routerSource, /permissionCode="API_TELEMETRY_READ"/);

assert.match(serviceSource, /normalizeTelemetryFilters/);
assert.match(serviceSource, /statusGroup/);
assert.match(serviceSource, /routeSearch/);
assert.match(serviceSource, /slowRoutes/);
assert.match(serviceSource, /authModes/);
assert.match(serviceSource, /hourly:/);
assert.match(serviceSource, /filterOptions:/);

const serviceModule = { exports: {} };
const serviceFactory = vm.runInNewContext(
  `(function(require, module, exports) { ${serviceSource}\n })`,
  { console, process },
);
serviceFactory(
  (requestPath) => {
    if (requestPath === '../../../../packages/db/src/connection') {
      return { query: async () => ({ rows: [] }) };
    }

    throw new Error(`Unexpected mocked dependency: ${requestPath}`);
  },
  serviceModule,
  serviceModule.exports,
);

const normalizedFilters = serviceModule.exports.normalizeTelemetryFilters({
  days: '999',
  routeLimit: '1000',
  appCode: ' SKYSERVER_ADMIN ',
  method: 'post',
  routeSearch: ' /api/workflows ',
  statusGroup: 'client_error',
});
assert.strictEqual(normalizedFilters.days, 90);
assert.strictEqual(normalizedFilters.routeLimit, 50);
assert.strictEqual(normalizedFilters.appCode, 'SKYSERVER_ADMIN');
assert.strictEqual(normalizedFilters.method, 'POST');
assert.strictEqual(normalizedFilters.routeSearch, '/api/workflows');
assert.strictEqual(normalizedFilters.statusGroup, 'CLIENT_ERROR');

const where = serviceModule.exports.buildTelemetryWhere(normalizedFilters);
assert.match(where.whereClause, /COALESCE\(app_code, 'UNSCOPED'\) = \$2/);
assert.match(where.whereClause, /method = \$3/);
assert.match(where.whereClause, /route_template ILIKE \$4/);
assert.match(where.whereClause, /status_code BETWEEN 400 AND 499/);
assert.strictEqual(where.values[0], 90);
assert.strictEqual(where.values[1], 'SKYSERVER_ADMIN');
assert.strictEqual(where.values[2], 'POST');
assert.strictEqual(where.values[3], '%/api/workflows%');

console.log('[SkyCommand] API dashboard layout, routing, filters, and telemetry analysis self-test passed.');
