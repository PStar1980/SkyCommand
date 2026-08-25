const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const pageSource = read('apps/admin-web/src/pages/IngestionOperations.jsx');
const mainSource = read('apps/admin-web/src/main.jsx');
const navbarSource = read('apps/admin-web/src/components/Navbar.jsx');
const toolsSource = read('apps/admin-web/src/pages/Tools.jsx');
const serviceSource = read('apps/admin-web/src/services/ingestionService.js');
const ledgerSource = read('packages/ingestion/src/ledger/ingestionLedgerService.js');
const routeSource = read('apps/api/src/routes/ingestion.routes.js');

assert.match(pageSource, /title="Ingestion Operations"/);
assert.match(pageSource, /ingestion_run_summary\.v1|contractVersion/);
assert.match(pageSource, /Asset attempts/);
assert.match(pageSource, /Recovery history/);
assert.match(pageSource, /Recover failed assets/);
assert.match(pageSource, /listRecoveryRequests/);
assert.match(pageSource, /resumeRunId/);
assert.match(pageSource, /INGESTION_RUN_FETCH_LIMIT = 250/);
assert.match(pageSource, /renderSortableHeader\('Started', 'started'\)/);
assert.match(pageSource, /renderSortableHeader\('Domain \/ source', 'domainSource'\)/);
assert.match(pageSource, /renderSortableHeader\('Quality', 'quality'\)/);
assert.match(pageSource, /Shift\+click to add to multi-column sorting/);
assert.match(pageSource, /Clear sorting/);
assert.match(pageSource, /sky-canonical-operations-table-frame/);
assert.match(pageSource, /sky-canonical-operations-pagination-row/);
assert.doesNotMatch(pageSource, /\['FRED',\s*'BOC',\s*'STATCAN'\]/);

assert.match(mainSource, /path="data\/operations"/);
assert.match(navbarSource, /label: 'Ingestion Operations'/);
assert.match(serviceSource, /listCatalogueSources/);
assert.match(serviceSource, /listIngestionRuns/);
assert.match(serviceSource, /getIngestionRun/);
assert.match(routeSource, /\/catalogue\/sources/);
assert.match(ledgerSource, /filters\.q \|\| filters\.search/);

assert.match(toolsSource, /useSearchParams/);
assert.match(toolsSource, /searchParams\.get\('toolCode'\)/);
assert.match(toolsSource, /parameter\.parameterName/);
assert.match(toolsSource, /searchParams\.has\(parameter\.parameterName\)/);

console.log('Phase 16.8.1 generic ingestion operations surface self-test passed.');
