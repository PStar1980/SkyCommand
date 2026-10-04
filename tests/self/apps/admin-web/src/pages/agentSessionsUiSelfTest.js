const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('apps/admin-web/src/services/agentService.js');
const calls = [];
const api = Object.fromEntries(
  ['get', 'post', 'patch'].map((method) => [
    method,
    (...args) => {
      calls.push({ method, args });
      return args;
    },
  ]),
);
const context = { api };
vm.runInNewContext(
  source
    .replace(/^import .*;\s*/m, '')
    .replace(/export default agentService;\s*$/, 'globalThis.agentService = agentService;'),
  context,
);
const command = {
  instruction: 'Read the registered status result.',
  idempotencyKey: 'session-fixture-key',
};
context.agentService.listAgentSessions({ limit: 20, offset: 20, q: 'Project A' });
context.agentService.getAgentSession('session-a');
context.agentService.continueAgentSession('session-a', command);
context.agentService.archiveAgentSession('session-a');
context.agentService.admitAgentRun(command);
assert.deepEqual(
  calls.map((call) => [call.method, call.args[0]]),
  [
    ['get', '/api/agent-sessions'],
    ['get', '/api/agent-sessions/session-a'],
    ['post', '/api/agent-sessions/session-a/runs'],
    ['post', '/api/agent-sessions/session-a/archive'],
    ['post', '/api/agent-runs'],
  ],
);
assert.equal(calls[0].args[1].query.offset, 20);
assert.equal(
  calls[2].args[1],
  command,
  'Continuation forwards the immutable command without client-selected provider binding.',
);
assert.equal(Object.keys(calls[3].args[1]).length, 0);

const page = read('apps/admin-web/src/pages/AgentSessions.jsx');
const main = read('apps/admin-web/src/main.jsx');
const navbar = read('apps/admin-web/src/components/Navbar.jsx');
const operations = read('apps/admin-web/src/pages/AgentOperations.jsx');
assert.match(main, /path="agents\/sessions"/);
assert.match(main, /path="agents\/sessions\/:sessionId"/);
assert.match(navbar, /label: 'Agent Sessions'/);
assert.match(navbar, /'agent sessions': '\/agents\/sessions'/);
assert.match(page, /Current authority is checked again/);
assert.match(page, /pendingCommand\.current = \{ instruction, idempotencyKey:/);
assert.match(page, /if \(!outcomeUncertain\) pendingCommand\.current = null/);
assert.match(page, /disabled=\{submitting \|\| uncertain\}/);
assert.match(page, /History is preserved.*active Run will continue/);
assert.match(page, /detail\.runs\.map/);
assert.match(page, /\/agents\/operations\?runId=/);
assert.doesNotMatch(
  page,
  /providerSessionReference|providerThreadId|thread\/start|thread\/resume|turn\/start/,
);
assert.match(operations, /new URLSearchParams\(location\.search\)\.get\('runId'\)/);
assert.match(operations, /useState\(requestedRunId\)/);
console.log('✅ Phase 19.3B Agent Sessions UI/API mapping self-test passed.');
