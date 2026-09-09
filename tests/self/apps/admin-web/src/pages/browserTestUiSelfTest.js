const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

const navbarSource = read('apps/admin-web/src/components/Navbar.jsx');
const mainSource = read('apps/admin-web/src/main.jsx');
const appSource = read('apps/admin-web/src/App.jsx');
const pageSource = read('apps/admin-web/src/pages/BrowserTests.jsx');
const serviceSource = read('apps/admin-web/src/services/browserTestService.js');

assert(
  navbarSource.includes("label: 'Playwright Tests'") &&
    navbarSource.includes("to: '/browser-tests/operations'") &&
    navbarSource.includes("to: '/browser-tests/run'") &&
    navbarSource.includes("to: '/browser-tests/manage'") &&
    navbarSource.includes("to: '/browser-tests/add'"),
  'Playwright Tests navigation must expose Test Operations, Run Tests, Manage Tests, and Add Test.',
);

assert(
  navbarSource.includes("hasPermission('BROWSER_TEST_READ')") &&
    navbarSource.includes("hasPermission('BROWSER_TEST_RUN')") &&
    navbarSource.includes("hasPermission('ADMIN_BROWSER_TEST_READ')") &&
    navbarSource.includes("hasPermission('ADMIN_BROWSER_TEST_WRITE')"),
  'Playwright Tests navigation must preserve registry read/run/admin permission boundaries.',
);

assert(
  mainSource.includes('path="browser-tests/operations"') &&
    mainSource.includes('path="browser-tests/run"') &&
    mainSource.includes('path="browser-tests/manage"') &&
    mainSource.includes('path="browser-tests/add"') &&
    mainSource.includes('permissionCode="BROWSER_TEST_READ"') &&
    mainSource.includes('permissionCode="BROWSER_TEST_RUN"') &&
    mainSource.includes('permissionCode="ADMIN_BROWSER_TEST_READ"') &&
    mainSource.includes('permissionCode="ADMIN_BROWSER_TEST_WRITE"'),
  'Playwright Tests routes must be protected by their intended permission codes.',
);

assert(
  appSource.includes("'/browser-tests'"),
  'Playwright Tests routes must participate in the workbench page shell.',
);

assert(
  pageSource.includes('export function BrowserTestOperations()') &&
    pageSource.includes('export function BrowserTestRun()') &&
    pageSource.includes('export function BrowserTestManage()') &&
    pageSource.includes('export function BrowserTestAdd()'),
  'Browser Test Phase 4 must provide all four planned UI surfaces.',
);

assert(
  pageSource.includes('BrowserRuntimeParameterFields') &&
    pageSource.includes('TEST INITIALIZATION') &&
    pageSource.includes('Run Test') &&
    pageSource.includes('Open Test Operations'),
  'Run Tests must initialize registered runtime parameters and expose the launched execution workspace.',
);

assert(
  pageSource.includes('BrowserTestRegistryForm') &&
    pageSource.includes('Allowed environments') &&
    pageSource.includes('RUNTIME PARAMETERS') &&
    pageSource.includes('Execution permission') &&
    pageSource.includes('Confirmation required'),
  'Browser Test administration must expose environments, parameters, permissions, and confirmation controls.',
);



assert(
  pageSource.includes('sky-canonical-operations-table-frame') &&
    pageSource.includes('sky-canonical-operations-table') &&
    pageSource.includes('sky-clickable-row') &&
    pageSource.includes('sky-selected-row') &&
    pageSource.includes('BrowserTablePagination') &&
    pageSource.includes('Clear filters') &&
    pageSource.includes('Clear sorting'),
  'Playwright Test browser tables must use the canonical Tool Operations interaction and table template.',
);

assert(
  pageSource.includes('onClick={() => initializeTest(test)}') &&
    pageSource.includes('onClick={() => selectTest(test)}') &&
    !pageSource.includes('>Initialize</button></td>') &&
    !pageSource.includes('>Configure</button></td>'),
  'Run Tests and Manage Tests must use selectable rows instead of Actions-column buttons.',
);

assert(
  serviceSource.includes("'/api/browser-tests/runs'") &&
    pageSource.includes('browserTestService.listRuns'),
  'Test Operations must browse recent Temporal-backed Playwright Test executions.',
);

assert(
  serviceSource.includes("'/api/browser-tests'") &&
    serviceSource.includes("'/api/admin/browser-tests/options'") &&
    serviceSource.includes('/run') &&
    serviceSource.includes('/parameters') &&
    serviceSource.includes('/environments'),
  'Browser Test UI service must use the Phase 3 catalogue, execution, and administration APIs.',
);

console.log('[SkyCommand] Playwright Test UI/table parity self-test passed.');
