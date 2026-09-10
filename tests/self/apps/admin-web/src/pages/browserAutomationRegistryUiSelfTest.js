const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

const navbar = read('apps/admin-web/src/components/Navbar.jsx');
const main = read('apps/admin-web/src/main.jsx');
const app = read('apps/admin-web/src/App.jsx');
const css = read('apps/admin-web/src/App.css');
const page = read('apps/admin-web/src/pages/BrowserAutomations.jsx');
const service = read('apps/admin-web/src/services/browserAutomationService.js');

assert.ok(navbar.includes("label: 'Playwright Automation'"), 'Sidebar must expose the PLAYWRIGHT AUTOMATION category.');
for (const route of [
  '/browser-automations/operations',
  '/browser-automations/run',
  '/browser-automations/manage',
  '/browser-automations/add',
]) {
  assert.ok(navbar.includes(`to: '${route}'`), `Sidebar should expose ${route}.`);
}
assert.ok(navbar.includes("hasPermission('ADMIN_BROWSER_AUTOMATION_READ')"));
assert.ok(navbar.includes("hasPermission('BROWSER_AUTOMATION_RUN')"));
assert.ok(main.includes('path="browser-automations/operations"'));
assert.ok(main.includes('path="browser-automations/run"'));
assert.ok(main.includes('path="browser-automations/manage"'));
assert.ok(main.includes('path="browser-automations/add"'));
assert.ok(main.includes('permissionCode="BROWSER_AUTOMATION_READ"'));
assert.ok(main.includes('permissionCode="BROWSER_AUTOMATION_RUN"'));
assert.ok(main.includes('permissionCode="ADMIN_BROWSER_AUTOMATION_READ"'));
assert.ok(main.includes('permissionCode="ADMIN_BROWSER_AUTOMATION_WRITE"'));
assert.ok(app.includes("'/browser-automations'"));
assert.ok(css.includes('--sky-sidebar-width: 25rem;'), 'Desktop sidebar should stay wide enough for PLAYWRIGHT AUTOMATION.');

for (const heading of [
  'PLAYWRIGHT AUTOMATION · EXECUTION',
  'PLAYWRIGHT AUTOMATION · OPERATIONS',
  'PLAYWRIGHT AUTOMATION · ADMINISTRATION',
  'PLAYWRIGHT AUTOMATION · REGISTRATION',
]) {
  assert.ok(page.includes(heading), `Phase 7 page should render ${heading}.`);
}
assert.ok(page.includes('Run Automation'));
assert.ok(page.includes('Automation Operations'));
assert.ok(page.includes('Manage Automations'));
assert.ok(page.includes('Add Automation'));
assert.ok(page.includes('Execution mode'));
assert.ok(page.includes('Interactive (Headed · Host)'));
assert.ok(page.includes('Confirmation required'));
assert.ok(page.includes('SIDE EFFECTS') || page.includes('Side Effects'));
assert.ok(page.includes('IDEMPOTENCY') || page.includes('Idempotency'));
assert.ok(page.includes('OUTPUT CONTRACT') || page.includes('Output contract'));
assert.ok(page.includes('sky-canonical-operations-table'));
assert.ok(page.includes('sky-form-control'), 'Playwright Automation forms must use SkyCommand dark form controls.');
assert.ok(page.includes('table-hover sky-table sky-canonical-operations-table'), 'Playwright Automation browsers must use the canonical selectable table treatment.');
assert.ok(page.includes('sky-table sky-detail-table'), 'Automation execution/configuration detail must use the SkyCommand detail table treatment.');
assert.ok(page.includes('sky-btn-primary'));
assert.ok(page.includes('sky-btn-ghost'));
assert.ok(css.includes('white-space: nowrap;'), 'Sidebar group labels should remain on one line.');
assert.ok(page.includes('sky-selected-row'));

for (const endpoint of [
  "'/api/browser-automations'",
  "'/api/browser-automations/runs'",
  "'/api/admin/browser-automations/options'",
  "'/api/admin/browser-automations'",
]) {
  assert.ok(service.includes(endpoint), `Browser Automation UI service should use ${endpoint}.`);
}
assert.ok(service.includes('runAutomation'));
assert.ok(service.includes('getArtifact'));
assert.ok(service.includes('setLastRunWorkflowId'));

console.log('[SkyCommand] Playwright Automation Phase 7 UI self-test passed.');
