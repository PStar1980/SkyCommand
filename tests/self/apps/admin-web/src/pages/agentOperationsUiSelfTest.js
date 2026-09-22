const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('apps/admin-web/src/pages/AgentOperations.jsx');
const service = read('apps/admin-web/src/services/agentService.js');
const main = read('apps/admin-web/src/main.jsx');
const navbar = read('apps/admin-web/src/components/Navbar.jsx');
const projects = read('apps/admin-web/src/pages/AgentProjects.jsx');
const manageAgents = read('apps/admin-web/src/pages/ManageAgents.jsx');

assert.match(page, /Agent Operations/);
assert.match(page, /Normalized Events/);
assert.match(page, /Provider Operation Journal/);
assert.match(page, /Immutable Result/);
assert.match(page, /Managed Capability Effects/);
assert.match(page, /Credential lifecycle evidence/);
assert.match(page, /Grant: \{effect\.managedCredential\?\.reference \|\| 'ABSENT'\}/);
assert.match(page, /Fingerprint: \{effect\.managedCredential\?\.credentialFingerprint \|\| 'ABSENT'\}/);
assert.match(page, /Issued: \{formatDate\(effect\.managedCredential\?\.issuedAt\)\}/);
assert.match(page, /Closed: \{formatDate\(effect\.managedCredential\?\.closedAt\)\}/);
assert.match(page, /surface \{effect\.executionSurfaceDecision\?\.mode \|\| 'UNKNOWN'\}/);
assert.match(page, /Cancel Run/);
assert.match(page, /Stop Root/);
assert.match(page, /runtimeIdentity\(run\.runtimeKind\)/);
assert.match(page, /Scenario \/ case:/);
assert.match(page, /Fake-runtime scenario \/ case:/);
assert.match(page, /containmentEntries/);
assert.doesNotMatch(projects, /Phase 19\.1|execution is disabled\/not implemented/i);
assert.doesNotMatch(manageAgents, /Phase 19\.1|execution is disabled\/not implemented/i);
for (const pageSource of [page, projects, manageAgents]) {
  assert.match(pageSource, /Controlled source-backed fake runtime execution and one bounded managed Browser Automation capability are enabled in Phase 19\.2B/);
  assert.match(pageSource, /Real providers, generic capability effects, scheduler execution, delegation, writable development workspaces, and external Agent execution remain disabled/);
}
assert.match(manageAgents, /Phase 19\.2B bounded fake-runtime and managed Browser capability admission/);
assert.match(manageAgents, /this preview cannot start a run/);
for (const endpoint of ['/api/agent-runs', '/api/execution-scopes']) assert.match(service, new RegExp(endpoint.replace(/[/-]/g, '\\$&')));
assert.match(main, /path="agents\/operations"/);
assert.match(main, /permissionCode="AGENT_RUN"/);
assert.match(navbar, /'agent operations': '\/agents\/operations'/);
assert.match(navbar, /label: 'Agent Operations'/);
assert.match(navbar, /hasPermission\('AGENT_RUN'\)/);

(async () => {
  const presentation = await import(pathToFileURL(path.join(root, 'apps/admin-web/src/pages/agentOperationsPresentation.mjs')).href);
  assert.equal(presentation.runtimeIdentity('FAKE_PERSISTENT'), 'FAKE_PERSISTENT');
  assert.equal(presentation.runtimeIdentity('FAKE_EPHEMERAL'), 'FAKE_EPHEMERAL');
  assert.equal(presentation.runtimeIdentity(''), 'UNKNOWN');
  assert.equal(presentation.containmentValue(false), 'ABSENT (FALSE)');
  assert.equal(presentation.containmentValue('DENIED'), 'DENIED');
  assert.deepEqual(presentation.containmentEntries({ dockerSocket: false, providerCredentials: false }), [
    { key: 'dockerSocket', label: 'Docker socket', value: 'ABSENT (FALSE)' },
    { key: 'providerCredentials', label: 'Provider credential', value: 'ABSENT (FALSE)' },
  ]);
  console.log('✅ Phase 19.2B Agent Operations UI contract self-test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
