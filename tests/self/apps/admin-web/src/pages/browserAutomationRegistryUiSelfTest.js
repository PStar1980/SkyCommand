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
assert.ok(navbar.includes("to: '/browser-automations/registry'"));
assert.ok(navbar.includes("hasPermission('ADMIN_BROWSER_AUTOMATION_READ')"));
assert.ok(navbar.includes("hasPermission('BROWSER_AUTOMATION_RUN')"));
assert.ok(main.includes('path="browser-automations/registry"'));
assert.ok(main.includes('permissionCode="ADMIN_BROWSER_AUTOMATION_READ"'));
assert.ok(app.includes("'/browser-automations'"));
assert.ok(css.includes('--sky-sidebar-width: 22.75rem;'), 'Desktop sidebar should be widened for PLAYWRIGHT AUTOMATION.');

assert.ok(page.includes('PLAYWRIGHT AUTOMATION · REGISTRY'));
assert.ok(page.includes('SIDE EFFECTS'));
assert.ok(page.includes('IDEMPOTENCY'));
assert.ok(page.includes('OUTPUT CONTRACT'));
assert.ok(page.includes('sky-canonical-operations-table'));
assert.ok(page.includes('sky-selected-row'));
assert.ok(service.includes("'/api/admin/browser-automations/options'"));
assert.ok(service.includes("'/api/admin/browser-automations'"));

console.log('[SkyCommand] Playwright Automation Phase 6 UI foundation self-test passed.');
