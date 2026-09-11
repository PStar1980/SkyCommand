#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const migration = read('packages/db_build/src/migrations/00121__browser_test_suites.sql');
const seed = read('packages/db_build/src/seeds/00122__browser_test_suites_seed.sql');
const suiteService = read('apps/api/src/services/browserTestSuiteService.js');
const routes = read('apps/api/src/routes/browserTestSuite.routes.js');
const workflows = read('packages/browser/src/temporal/workflows.js');
const ui = read('apps/admin-web/src/pages/BrowserTests.jsx');
const nav = read('apps/admin-web/src/components/Navbar.jsx');

assert(migration.includes('core.browser_test_suites'), 'Missing suite definition table.');
assert(migration.includes('core.browser_test_suite_members'), 'Missing suite membership table.');
assert(migration.includes('worker.browser_test_suite_runs'), 'Missing durable suite run ledger.');
assert(migration.includes('worker.browser_test_suite_member_runs'), 'Missing suite member result ledger.');
assert(seed.includes("'skycommand-smoke'"), 'Missing first SkyCommand smoke suite seed.');
assert(seed.includes("'workflow-initialization-e2e'"), 'Smoke suite must include the proven Workflow Initialization E2E test.');
assert(seed.includes('BROWSER_TEST_SUITE_RUN'), 'Missing suite execution permission.');
assert(workflows.includes('browserTestSuiteWorkflow'), 'Missing Temporal Browser Test Suite workflow.');
assert(suiteService.includes("executionMode: 'HEADLESS'"), 'Suite execution must default to background/headless mode.');
assert(suiteService.includes('resolveBrowserTestParameters'), 'Suite members must reuse registered Browser Test parameter validation.');
assert(routes.includes("router.post('/:suiteCode/run'"), 'Missing suite execution API route.');
assert(ui.includes('export function BrowserTestSuites'), 'Missing Test Suites UI.');
assert(ui.includes('Run Suite'), 'Missing suite run control.');
assert(ui.includes('SUITE RESULT'), 'Missing suite summary surface.');
assert(nav.includes("label: 'Test Suites'"), 'Missing Playwright Tests > Test Suites navigation.');

console.log('[browser-test-suite:self-test] PASS');
