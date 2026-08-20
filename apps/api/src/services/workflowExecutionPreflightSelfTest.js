#!/usr/bin/env node

const assert = require('node:assert/strict');

const {
  assertWorkflowExecutionTargetsAvailable,
  buildHostAgentState,
  getHostAgentAvailability,
  getHostExecutionNodes,
  getNodeExecutionTarget,
} = require('./workflowExecutionPreflightService');

function hostWorkflow() {
  return {
    workflowCode: 'development-promotion',
    nodes: [
      {
        nodeKey: 'remote_sync_node',
        config: {},
      },
      {
        nodeKey: 'local_repo_sync_node',
        config: {
          executionTarget: 'HOST_AGENT',
        },
      },
    ],
  };
}

async function expectWorkflowError(promise, expectedCode, expectedStatusCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.statusCode, expectedStatusCode);
    assert.equal(error?.details?.code, expectedCode);
    return true;
  });
}

async function main() {
  assert.equal(getNodeExecutionTarget({ config: { executionTarget: 'host_agent' } }), 'HOST_AGENT');
  assert.equal(getNodeExecutionTarget({ targetConfig: { executionTarget: 'HOST' } }), 'HOST');
  assert.deepEqual(
    getHostExecutionNodes(hostWorkflow()).map((node) => node.nodeKey),
    ['local_repo_sync_node'],
  );

  let loaderCalled = false;
  const noHostResult = await assertWorkflowExecutionTargetsAvailable(
    { workflowCode: 'plain-workflow', nodes: [{ nodeKey: 'tool', config: {} }] },
    {
      availabilityLoader: async () => {
        loaderCalled = true;
        return {};
      },
    },
  );
  assert.equal(loaderCalled, false);
  assert.equal(noHostResult.hostAgentRequired, false);

  await expectWorkflowError(
    assertWorkflowExecutionTargetsAvailable(hostWorkflow(), {
      availabilityLoader: async () =>
        buildHostAgentState({
          enabled: false,
          namespace: 'default',
          taskQueue: 'skycommand-host-local',
        }),
    }),
    'WORKFLOW_HOST_AGENT_DISABLED',
    409,
  );

  await expectWorkflowError(
    assertWorkflowExecutionTargetsAvailable(hostWorkflow(), {
      availabilityLoader: async () =>
        buildHostAgentState({
          enabled: true,
          namespace: 'default',
          taskQueue: 'skycommand-host-local',
          heartbeats: [
            {
              status: 'ONLINE',
              is_recent: false,
              last_seen_at: '2026-08-19T20:00:00.000Z',
            },
          ],
        }),
    }),
    'WORKFLOW_HOST_AGENT_UNAVAILABLE',
    503,
  );

  const previousHostAgentEnabled = process.env.SKYCOMMAND_HOST_AGENT_ENABLED;
  process.env.SKYCOMMAND_HOST_AGENT_ENABLED = 'true';
  let freshProbeCalled = false;
  const freshHeartbeatAvailability = await getHostAgentAvailability({
    heartbeatLoader: async () => [
      {
        status: 'ONLINE',
        is_recent: true,
        last_seen_at: new Date().toISOString(),
        metadata: { role: 'HOST_AGENT' },
      },
    ],
    liveProbeLoader: async () => {
      freshProbeCalled = true;
      return { attempted: true, online: true, status: 'ONLINE' };
    },
  });
  assert.equal(freshHeartbeatAvailability.online, true);
  assert.equal(freshHeartbeatAvailability.availabilitySource, 'HEARTBEAT');
  assert.equal(freshProbeCalled, false);

  const liveProbeFallback = await getHostAgentAvailability({
    heartbeatLoader: async () => [
      {
        status: 'ONLINE',
        is_recent: false,
        last_seen_at: '2026-08-19T20:00:00.000Z',
      },
    ],
    liveProbeLoader: async ({ taskQueue }) => ({
      attempted: true,
      online: true,
      status: 'ONLINE',
      checkedAt: new Date().toISOString(),
      hostname: 'Entity007',
      processId: 6268,
      profileCode: 'DEV_LOCAL',
      taskQueue,
    }),
  });
  assert.equal(liveProbeFallback.online, true);
  assert.equal(liveProbeFallback.availabilitySource, 'TEMPORAL_PROBE');
  assert.equal(liveProbeFallback.heartbeatDegraded, true);
  assert.equal(liveProbeFallback.liveProbe.processId, 6268);

  const databaseOutageFallback = await getHostAgentAvailability({
    heartbeatLoader: async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:55432');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    liveProbeLoader: async ({ taskQueue }) => ({
      attempted: true,
      online: true,
      status: 'ONLINE',
      checkedAt: new Date().toISOString(),
      taskQueue,
    }),
  });
  assert.equal(databaseOutageFallback.online, true);
  assert.equal(databaseOutageFallback.availabilitySource, 'TEMPORAL_PROBE');
  assert.match(databaseOutageFallback.error, /ECONNREFUSED/);

  const fallbackReady = await assertWorkflowExecutionTargetsAvailable(hostWorkflow(), {
    availabilityLoader: async () => liveProbeFallback,
  });
  assert.equal(fallbackReady.hostAgentRequired, true);
  assert.equal(fallbackReady.availability.availabilitySource, 'TEMPORAL_PROBE');
  if (previousHostAgentEnabled === undefined) {
    delete process.env.SKYCOMMAND_HOST_AGENT_ENABLED;
  } else {
    process.env.SKYCOMMAND_HOST_AGENT_ENABLED = previousHostAgentEnabled;
  }

  const ready = await assertWorkflowExecutionTargetsAvailable(hostWorkflow(), {
    availabilityLoader: async () =>
      buildHostAgentState({
        enabled: true,
        namespace: 'default',
        taskQueue: 'skycommand-host-local',
        heartbeats: [
          {
            status: 'ONLINE',
            is_recent: true,
            last_seen_at: new Date().toISOString(),
            metadata: { role: 'HOST_AGENT' },
          },
        ],
      }),
  });

  assert.equal(ready.hostAgentRequired, true);
  assert.equal(ready.availability.online, true);
  assert.deepEqual(ready.hostNodeKeys, ['local_repo_sync_node']);

  console.log('✅ Workflow Host Agent preflight self-test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
