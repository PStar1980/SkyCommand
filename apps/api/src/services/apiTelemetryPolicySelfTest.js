const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildApiTelemetryRecord,
  buildRouteTemplate,
  normalizeFallbackPath,
  resolveAuthMode,
  shouldTrackApiRequest,
} = require('./apiTelemetryPolicy');

assert.strictEqual(
  normalizeFallbackPath('/api/users/7136d2e7-f36a-48b8-a810-2d7ff7b74f4e?token=secret'),
  '/api/users/:uuid',
);
assert.strictEqual(normalizeFallbackPath('/api/workflows/123/runs/987'), '/api/workflows/:id/runs/:id');
assert.strictEqual(
  buildRouteTemplate({ baseUrl: '/api/admin', route: { path: '/users/:userId' } }),
  '/api/admin/users/:userId',
);
assert.strictEqual(
  buildRouteTemplate({
    originalUrl: '/api/admin/users/7136d2e7-f36a-48b8-a810-2d7ff7b74f4e',
    route: { path: '/users/:userId' },
  }),
  '/api/admin/users/:userId',
);
assert.strictEqual(shouldTrackApiRequest({ path: '/api/admin/users' }), true);
assert.strictEqual(shouldTrackApiRequest({ path: '/assets/index.js' }), false);
assert.strictEqual(resolveAuthMode({ sessionToken: 'token' }), 'BEARER_SESSION');
assert.strictEqual(
  resolveAuthMode({ session: { authMode: 'internal_service_token' } }),
  'INTERNAL_SERVICE_TOKEN',
);

const record = buildApiTelemetryRecord({
  req: {
    method: 'post',
    baseUrl: '/api/auth',
    route: { path: '/login' },
    headers: {
      authorization: 'Bearer top-secret',
      'content-length': '128',
    },
    body: {
      appCode: 'SKYSERVER_ADMIN',
      password: 'never-store-this',
    },
  },
  res: {
    statusCode: 401,
    getHeader(name) {
      return name === 'content-length' ? '64' : null;
    },
  },
  durationMs: 12.34567,
  requestId: 'request-123',
});

assert.deepStrictEqual(Object.keys(record), [
  'occurredAt',
  'method',
  'routeTemplate',
  'statusCode',
  'durationMs',
  'appCode',
  'authMode',
  'requestBytes',
  'responseBytes',
  'requestId',
]);
assert.strictEqual(record.routeTemplate, '/api/auth/login');
assert.strictEqual(record.requestBytes, 128);
assert.strictEqual(record.responseBytes, 64);
assert.strictEqual(JSON.stringify(record).includes('top-secret'), false);
assert.strictEqual(JSON.stringify(record).includes('never-store-this'), false);

const repositoryRoot = path.resolve(__dirname, '../../../..');
const middlewareSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/middleware/apiTelemetryMiddleware.js'),
  'utf8',
);
const serviceSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/api/src/services/apiTelemetryService.js'),
  'utf8',
);
const migrationSource = fs.readFileSync(
  path.join(repositoryRoot, 'packages/db_build/src/migrations/00071__api_request_telemetry.sql'),
  'utf8',
);
const dashboardSource = fs.readFileSync(
  path.join(repositoryRoot, 'apps/admin-web/src/components/charts/ApiObservabilityPanel.jsx'),
  'utf8',
);

assert.match(middlewareSource, /res\.once\('finish'/);
assert.match(middlewareSource, /setImmediate/);
assert.match(middlewareSource, /recordApiRequestTelemetry\(record\)\.catch/);
assert.match(serviceSource, /percentile_cont\(0\.95\)/);
assert.match(serviceSource, /API_TELEMETRY_RETENTION_DAYS/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS core\.api_request_telemetry/);
const tableDefinition = migrationSource.split(');', 1)[0];
assert.doesNotMatch(
  tableDefinition,
  /authorization_header|request_body|query_string|password|secret_value/i,
);
assert.match(dashboardSource, /API traffic trend/);
assert.match(dashboardSource, /API latency trend/);
assert.match(dashboardSource, /Busiest API routes/);

console.log('[SkyCommand] API telemetry privacy, normalization, and dashboard self-test passed.');
