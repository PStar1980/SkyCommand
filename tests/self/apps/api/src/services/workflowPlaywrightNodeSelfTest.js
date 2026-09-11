#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../../..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const migration = read('packages/db_build/src/migrations/00123__playwright_workflow_node_types.sql');
const adapter = read('apps/api/src/services/workflowPlaywrightNodeService.js');
const executor = read('apps/api/src/services/workflowExecutorService.js');
const builder = read('apps/admin-web/src/pages/WorkflowBuilder.jsx');
const manager = read('apps/admin-web/src/pages/WorkflowManager.jsx');
const graph = read('apps/admin-web/src/components/WorkflowVisualGraph.jsx');

for (const code of ['BROWSER_TEST', 'BROWSER_TEST_SUITE', 'BROWSER_AUTOMATION']) {
  assert(migration.includes(`'${code}'`), `Missing ${code} workflow-node migration.`);
  assert(executor.includes(`'${code}'`), `Workflow executor does not support ${code}.`);
  assert(builder.includes(`value=\"${code}\"`), `Create Workflow does not expose ${code}.`);
  assert(manager.includes(`value=\"${code}\"`), `Manage Workflow does not expose ${code}.`);
  assert(graph.includes(`${code}: {`), `Workflow graph has no visual metadata for ${code}.`);
}

assert(executor.includes('workflowPlaywrightNodeService.executePlaywrightWorkflowNode'), 'Playwright workflow nodes are not routed through the execution adapter.');
assert(executor.includes('browserTestTargets'), 'Workflow catalogue does not expose Playwright Test targets.');
assert(executor.includes('browserTestSuiteTargets'), 'Workflow catalogue does not expose Playwright Test Suite targets.');
assert(executor.includes('browserAutomationTargets'), 'Workflow catalogue does not expose Playwright Automation targets.');
assert(adapter.includes("executionMode: 'HEADLESS'"), 'Workflow Playwright nodes must execute headlessly.');
assert(adapter.includes('browserTestRegistryService.listBrowserTests({ limit: 100 })'), 'Workflow builder Playwright Test catalogue must respect the registry 100-row page-size cap.');
assert(adapter.includes('browserAutomationRegistryService.listBrowserAutomations({ limit: 100 })'), 'Workflow builder Playwright Automation catalogue must respect the registry 100-row page-size cap.');
assert(!adapter.includes('limit: 500'), 'Workflow builder must not request a registry page size above the 100-row maximum.');
assert(adapter.includes('operationsPath'), 'Playwright workflow output must preserve an operations deep link.');
assert(adapter.includes("kind: 'playwright_test_suite'") || adapter.includes("buildCommonOutput('playwright_test_suite'"), 'Suite workflow output is missing structured suite identity.');
assert(builder.includes('Add Playwright test'), 'Workflow builder Playwright Test action missing.');
assert(builder.includes('Add test suite'), 'Workflow builder Playwright Test Suite action missing.');
assert(builder.includes('Add Playwright automation'), 'Workflow builder Playwright Automation action missing.');
assert(manager.includes('Add Playwright test'), 'Workflow manager Playwright Test action missing.');
assert(manager.includes('Add test suite'), 'Workflow manager Playwright Test Suite action missing.');
assert(manager.includes('Add Playwright automation'), 'Workflow manager Playwright Automation action missing.');
assert(graph.includes("badge: 'PW TEST'"), 'Runtime graph Playwright Test badge missing.');
assert(graph.includes("badge: 'PW SUITE'"), 'Runtime graph Playwright Test Suite badge missing.');
assert(graph.includes("badge: 'PW AUTO'"), 'Runtime graph Playwright Automation badge missing.');

console.log('[workflow-playwright-nodes:self-test] PASS');
