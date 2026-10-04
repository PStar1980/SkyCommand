#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
sourceDirectoryForTest(__filename);

const assert = require('node:assert/strict');
process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';
const {
  ACTIONS,
  ASSISTANT_PERMISSION,
  HUMAN_PERMISSION,
  assertAuthority,
  deriveAvailableActions,
  getRuntimeControlStatus,
  loadSupervisorStatus,
  startRuntimeControl,
} = require('./runtimeControlService');

const onlineSupervisor = {
  status: 'ONLINE',
  runtimeStatus: 'ONLINE',
  engineStatus: 'ONLINE',
  services: [{ service: 'api', state: 'RUNNING', running: true }],
  activeOperation: null,
  lastOperation: null,
};

const operationId = '223e4567-e89b-42d3-a456-426614174001';
const assistantContext = { permissions: [ASSISTANT_PERMISSION], agentId: 'codex-local' };
const onlineAgent = { enabled: true, online: true, status: 'ONLINE', taskQueue: 'skycommand-host-local' };

async function main() {
  assert.deepEqual(
    deriveAvailableActions(
      { ...onlineSupervisor, runtimeStatus: 'UNKNOWN' },
      { status: 'UNKNOWN' },
    ),
    [],
    'unknown runtime and process observations must expose no lifecycle action',
  );
  assert.deepEqual(
    deriveAvailableActions(onlineSupervisor, { status: 'OFFLINE' }),
    ['REBUILD_FRONTEND', 'REBUILD_BACKEND', 'STOP_RUNTIME', 'RESTART_RUNTIME', 'START_HOST_AGENT'],
  );
  assert.deepEqual(
    deriveAvailableActions(
      { status: 'OFFLINE', runtimeStatus: 'UNKNOWN', engineStatus: 'UNKNOWN' },
      { status: 'ONLINE' },
    ),
    ['START_SUPERVISOR'],
  );
  assert.ok(ACTIONS.RESTART_SUPERVISOR);
  const busySupervisorActions = deriveAvailableActions(
    { ...onlineSupervisor, activeOperation: { operationId, action: 'REBUILD_BACKEND', status: 'RUNNING' } },
    { status: 'ONLINE' },
  );
  assert.ok(!busySupervisorActions.includes('RESTART_SUPERVISOR'));
  assert.equal(
    assertAuthority({ permissions: [HUMAN_PERMISSION, ASSISTANT_PERMISSION] }),
    HUMAN_PERMISSION,
    'human control permission must remain valid when the identity also has the agent scope',
  );

  await assert.rejects(
    () => getRuntimeControlStatus({
      permissions: [ASSISTANT_PERMISSION],
      agentId: 'different-agent',
      supervisorStatusLoader: async () => onlineSupervisor,
      hostAgentAvailabilityLoader: async () => onlineAgent,
    }),
    (error) => error.statusCode === 403 && error.code === 'SKYCOMMAND_RUNTIME_CONTROL_PRINCIPAL_NOT_ALLOWED',
  );

  const safeStatus = await loadSupervisorStatus({
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        supervisor: 'ONLINE',
        runtimeStatus: 'ONLINE',
        engineStatus: 'ONLINE',
        services: [{ service: 'api', state: 'RUNNING', running: true, secret: 'must-not-escape' }],
        operation: { operationId, action: 'RESTART', status: 'RUNNING', token: 'must-not-escape' },
      }),
    }),
  });
  assert.equal(safeStatus.status, 'ONLINE');
  assert.equal(safeStatus.services[0].secret, undefined);
  assert.equal(safeStatus.activeOperation.operationId, operationId);
  assert.equal(safeStatus.activeOperation.token, undefined);

  const offlineAgentStatus = await getRuntimeControlStatus({
    ...assistantContext,
    supervisorStatusLoader: async () => onlineSupervisor,
    hostAgentAvailabilityLoader: async () => ({ enabled: true, online: false, status: 'OFFLINE' }),
  });
  assert.ok(offlineAgentStatus.availableActions.includes('START_HOST_AGENT'));
  assert.ok(!offlineAgentStatus.availableActions.includes('RESTART_HOST_AGENT'));
  assert.ok(!offlineAgentStatus.availableActions.includes('RESTART_SUPERVISOR'));

  let authorizedAction = null;
  let dispatchedPath = '';
  const hostAgentStart = await startRuntimeControl({
    ...assistantContext,
    request: { action: 'START_HOST_AGENT', operationId },
    statusLoader: async () => offlineAgentStatus,
    authorize: async (input) => {
      authorizedAction = input;
      return { authorization: { grant: 'opaque-one-use-grant' } };
    },
    fetcher: async (url, options) => {
      dispatchedPath = new URL(url).pathname;
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{}');
      assert.equal(options.headers['X-SkyCommand-Supervisor-Grant'], 'opaque-one-use-grant');
      return {
        ok: true,
        status: 202,
        json: async () => ({ ok: true, operation: { operationId, requestedAt: '2026-10-02T00:00:00.000Z' } }),
      };
    },
  });
  assert.equal(authorizedAction.permissionCode, ASSISTANT_PERMISSION);
  assert.equal(authorizedAction.action, 'START_HOST_AGENT');
  assert.equal(authorizedAction.operationId, operationId);
  assert.equal(dispatchedPath, '/runtime/start-host-agent');
  assert.equal(hostAgentStart.operation.transport, 'HOST_SUPERVISOR_SIGNED_GRANT');
  assert.equal(hostAgentStart.operation.operationId, operationId);
  assert.equal(hostAgentStart.operation.grant, undefined, 'the signed grant must not escape in the receipt');

  let deniedDispatchCount = 0;
  await assert.rejects(
    () => startRuntimeControl({
      ...assistantContext,
      request: { action: 'RESTART_SUPERVISOR', operationId },
      statusLoader: async () => ({
        supervisor: { status: 'UNKNOWN', runtimeStatus: 'UNKNOWN' },
        hostAgent: { status: 'UNKNOWN' },
        availableActions: [],
      }),
      authorize: async () => { deniedDispatchCount += 1; },
      fetcher: async () => { deniedDispatchCount += 1; },
    }),
    (error) => error.statusCode === 409 && error.code === 'SKYCOMMAND_RUNTIME_CONTROL_STATE_MISMATCH',
  );
  assert.equal(deniedDispatchCount, 0, 'unknown state must fail closed before authorization or dispatch');

  let supervisorProcess = null;
  const auditEvents = [];
  const supervisorStart = await startRuntimeControl({
    ...assistantContext,
    request: { action: 'START_SUPERVISOR', operationId },
    statusLoader: async () => ({
      supervisor: { status: 'OFFLINE', runtimeStatus: 'UNKNOWN' },
      hostAgent: { status: 'ONLINE' },
      availableActions: ['START_SUPERVISOR'],
    }),
    auditRecorder: async (event) => auditEvents.push(event),
    supervisorProcessDispatcher: async (input) => {
      supervisorProcess = input;
      return {
        ok: true,
        result: { outcome: 'COMPLETED', transport: 'guarded_host_agent_process', processId: 5150, previousProcessIds: [] },
        workflowId: `skycommand-supervisor-process-${operationId}`,
      };
    },
  });
  assert.deepEqual(supervisorProcess, { action: 'START', operationId });
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].metadata.permissionCode, ASSISTANT_PERMISSION);
  assert.equal(auditEvents[0].metadata.operationId, operationId);
  assert.equal(supervisorStart.operation.targetService, 'supervisor');
  assert.equal(supervisorStart.operation.status, 'COMPLETED');
  assert.equal(supervisorStart.operation.hostAgentResult.workflowId, `skycommand-supervisor-process-${operationId}`);
  assert.equal(supervisorStart.operation.hostAgentResult.processId, 5150);

  await assert.rejects(
    () => startRuntimeControl({
      ...assistantContext,
      request: { action: 'RESTART_RUNTIME', operationId, services: ['arbitrary'] },
    }),
    (error) => error.statusCode === 400 && error.code === 'SKYCOMMAND_RUNTIME_CONTROL_UNEXPECTED_FIELDS',
  );

  console.log('✅ SkyCommand runtime-control service self-test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
