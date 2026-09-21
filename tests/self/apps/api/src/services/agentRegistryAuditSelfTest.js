const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const connectionPath = require.resolve(path.join(root, 'packages/db/src/connection'));
const authServicePath = require.resolve(path.join(root, 'apps/api/src/services/authService'));
const registryServicePath = require.resolve(path.join(root, 'apps/api/src/services/agentRegistryService'));

const actorUserId = '11111111-1111-4111-8111-111111111111';
const runtimeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function loadRegistryService(state) {
  const originalLoad = Module._load;
  const previousService = require.cache[registryServicePath];
  delete require.cache[registryServicePath];
  const operations = [];
  const auditEvents = [];
  const client = {
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (statement === 'begin' || statement === 'commit' || statement === 'rollback') {
        operations.push(statement.toUpperCase());
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes('insert into core.agent_runtimes')) {
        return {
          rows: [{
            agent_runtime_id: runtimeId,
            runtime_code: 'RUNTIME_A',
            runtime_name: 'Runtime A',
            description: null,
            active: true,
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected audit self-test query: ${statement}`);
    },
    release() {},
  };
  state.operations = operations;
  state.auditEvents = auditEvents;
  state.client = client;
  Module._load = function loadWithAuditFixture(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === connectionPath) return { pool: { connect: async () => client }, query: async () => { throw new Error('Unexpected top-level query.'); } };
    if (resolved === authServicePath) {
      return {
        recordAuditEventWithClient: async (auditClient, event) => {
          assert.equal(auditClient, client);
          auditEvents.push(event);
          if (state.failAudit) throw new Error('simulated audit failure');
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return require(registryServicePath);
  } finally {
    Module._load = originalLoad;
    if (previousService) require.cache[registryServicePath] = previousService;
    else delete require.cache[registryServicePath];
  }
}

async function run() {
  const state = { failAudit: false };
  const service = loadRegistryService(state);
  const request = {
    user: { userId: actorUserId },
    permissions: ['AGENT_RUNTIME_MANAGE'],
    session: { appCode: 'SKYSERVER_ADMIN' },
    ip: '127.0.0.1',
    get: (name) => name === 'user-agent' ? 'phase19-self-test' : null,
  };

  await service.createRuntime(request, { runtimeCode: 'RUNTIME_A', runtimeName: 'Runtime A' });
  assert.deepEqual(state.operations, ['BEGIN', 'COMMIT']);
  assert.equal(state.auditEvents.length, 1);
  assert.deepEqual(state.auditEvents[0], {
    appCode: 'SKYSERVER_ADMIN',
    userId: actorUserId,
    eventType: 'AGENT_REGISTRY_MUTATION',
    resourceType: 'core.agent_runtimes',
    resourceId: runtimeId,
    action: 'register_runtime',
    success: true,
    message: 'Agent runtime metadata registered.',
    metadata: { phase: '19.1', actorUserId, runtimeId },
    ipAddress: '127.0.0.1',
    userAgent: 'phase19-self-test',
  });
  assert.doesNotMatch(JSON.stringify(state.auditEvents[0]), /secret|token|password|raw.?path/i);

  state.failAudit = true;
  const beforeFailure = state.operations.length;
  await assert.rejects(
    () => service.createRuntime(request, { runtimeCode: 'RUNTIME_B', runtimeName: 'Runtime B' }),
    /simulated audit failure/,
  );
  assert.deepEqual(state.operations.slice(beforeFailure), ['BEGIN', 'ROLLBACK']);
  assert.equal(state.operations.slice(beforeFailure).includes('COMMIT'), false);

  console.log('✅ Phase 19.1 registry audit attribution and transaction self-test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
