const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const main = fs.readFileSync(path.join(root, 'apps/admin-web/src/main.jsx'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'apps/admin-web/src/components/Navbar.jsx'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/AgentProjects.jsx'), 'utf8');
const agents = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/ManageAgents.jsx'), 'utf8');

assert.match(main, /path="agents\/projects"/);
assert.match(main, /path="agents\/manage"/);
assert.match(main, /permissionCode="AGENT_PROJECT_READ"/);
assert.match(main, /permissionCode="AGENT_READ"/);
assert.match(nav, /label: 'Agents'/);
assert.match(nav, /label: 'Agent Projects'/);
assert.match(nav, /label: 'Manage Agents'/);
assert.doesNotMatch(nav, /label: '(Run Agents|Agent Runs)'/);
assert.match(projects, /Agent execution is disabled\/not implemented in Phase 19\.1/);
assert.match(projects, /Save Project/);
assert.match(projects, /Project membership/);
assert.match(projects, /Bind repo/);
assert.match(projects, /Bind workspace/);
assert.match(projects, /Project → Agent allow rules/);
assert.match(agents, /Agent execution is disabled\/not implemented in Phase 19\.1/);
assert.match(agents, /Advisory authority preview/);
assert.match(agents, /Runtime account entitlement/);
assert.match(agents, /UNVERIFIED/);
assert.match(agents, /UNCONFIGURED/);
assert.match(agents, /Save Agent metadata/);
assert.match(agents, /Create next immutable revision/);
assert.match(agents, /Execution-surface intersection/);
assert.match(agents, /Policy-effective constraints/);
assert.match(agents, /Runtime-compatible authority/);
assert.match(agents, /Runtime compatibility/);
assert.match(agents, /Execution admission/);
assert.doesNotMatch(agents, /api\/agent-runs|Start Agent|Run Agent/);

console.log('✅ Phase 19.1 Admin-Web registry surface self-test passed.');
