#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const repositoryRoot = path.resolve(__dirname, '../../../../../../');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });
const {
  ORCHESTRATOR_REFRESH_ACTION,
  ORCHESTRATOR_REFRESH_PERMISSION,
  ORCHESTRATOR_REFRESH_TARGET_SERVICE,
  assertExactRefreshBody,
  buildReconciliationEvidence,
  buildSupervisorRefreshUrl,
  getCapabilitySummary,
  sanitizeOperation,
} = require(path.join(repositoryRoot, 'apps/api/src/services/orchestratorRefreshService'));
const {
  issueLifecycleGrant,
  verifyLifecycleGrant,
} = require('../../../../../../packages/supervisor/src/lifecycleGrant');
const {
  controlRuntime,
} = require('../../../../../../packages/supervisor/src/runtimeLifecycle');

const operationId = '123e4567-e89b-12d3-a456-426614174000';
const now = new Date();
const before = {
  workerIdentity: 'skycommand-temporal-worker:old:100:default:skyserver-local',
  namespace: 'default',
  taskQueue: 'skyserver-local',
};
const current = {
  workerIdentity: 'skycommand-temporal-worker:new:200:default:skyserver-local',
  namespace: 'default',
  taskQueue: 'skyserver-local',
  status: 'ONLINE',
  startedAt: new Date(now.getTime() - 1000).toISOString(),
  lastSeenAt: now.toISOString(),
};

assert.deepEqual(assertExactRefreshBody({ idempotencyKey: 'refresh-1' }), {
  idempotencyKey: 'refresh-1',
});
assert.throws(
  () => assertExactRefreshBody({ idempotencyKey: 'refresh-1', targetService: 'api' }),
  /unsupported fields/i,
);
assert.match(
  buildSupervisorRefreshUrl({
    SKYCOMMAND_RUNTIME_ENV: 'docker',
    SKYCOMMAND_CONTAINER_HOST_ALIAS: 'host.docker.internal',
    SKYCOMMAND_SUPERVISOR_PORT: '17170',
  }),
  /host\.docker\.internal:17170\/runtime\/rebuild-temporal-worker$/,
);

const capability = getCapabilitySummary([ORCHESTRATOR_REFRESH_PERMISSION]);
assert.equal(capability.executable, true);
assert.equal(capability.targetService, ORCHESTRATOR_REFRESH_TARGET_SERVICE);
assert.equal(capability.action, ORCHESTRATOR_REFRESH_ACTION);
assert.equal(capability.grantPersisted, false);
assert.equal(getCapabilitySummary([]).executable, false);

const evidence = buildReconciliationEvidence({
  beforeHeartbeat: before,
  heartbeats: [current],
  diagnostics: {
    namespace: 'default',
    taskQueue: 'skyserver-local',
    healthy: true,
    pollerCount: 1,
    pollers: [{ identity: current.workerIdentity }],
  },
  supervisorStatus: {
    lastOperation: {
      operationId,
      action: ORCHESTRATOR_REFRESH_ACTION,
      status: 'SUCCEEDED',
    },
  },
});
assert.equal(evidence.heartbeatFresh, true);
assert.equal(evidence.pollerIdentityMatch, true);
assert.equal(evidence.observedWorkerIdentity, current.workerIdentity);

const safeOperation = sanitizeOperation({
  operation_id: operationId,
  caller_principal_code: 'assistant-http',
  idempotency_key: 'refresh-1',
  request_digest: 'a'.repeat(128),
  repository_code: 'SkyCommand',
  environment_code: 'DEV_LOCAL',
  target_service: ORCHESTRATOR_REFRESH_TARGET_SERVICE,
  action: ORCHESTRATOR_REFRESH_ACTION,
  status: 'DISPATCHED',
  supervisor_operation_id: operationId,
  before_heartbeat: before,
  evidence,
  grant: 'must-not-be-returned',
});
assert.equal(JSON.stringify(safeOperation).includes('must-not-be-returned'), false);
assert.equal(safeOperation.targetService, ORCHESTRATOR_REFRESH_TARGET_SERVICE);

const issued = issueLifecycleGrant({
  secret: 'self-test-refresh-secret',
  action: ORCHESTRATOR_REFRESH_ACTION,
  operationId,
  nowMs: Date.UTC(2026, 8, 22, 12, 0, 0),
  nonce: 'refresh-grant-test',
});
const verified = verifyLifecycleGrant(issued.token, {
  secret: 'self-test-refresh-secret',
  action: ORCHESTRATOR_REFRESH_ACTION,
  nowMs: Date.UTC(2026, 8, 22, 12, 0, 10),
});
assert.equal(verified.operationId, operationId);
assert.throws(
  () => verifyLifecycleGrant(
    issueLifecycleGrant({
      secret: 'self-test-refresh-secret',
      action: ORCHESTRATOR_REFRESH_ACTION,
      operationId: 'not-a-uuid',
    }).token,
    { secret: 'self-test-refresh-secret', action: ORCHESTRATOR_REFRESH_ACTION },
  ),
  /operation identity is invalid/i,
);

const config = {
  repositoryRoot,
  composeFile: path.join(repositoryRoot, 'compose.yaml'),
  projectName: 'skycommand',
  runtimeServices: ['api', 'temporal-worker'],
  webService: 'web',
  backendRebuildServices: ['api', 'temporal-worker'],
  rebuildTimeoutMs: 1000,
};
let observedDockerArgs = null;
let observedRebuildArgs = null;
const fakeExecutor = async (_command, args) => {
  observedDockerArgs = args;
  if (args.includes('--force-recreate')) observedRebuildArgs = args;
  if (args.includes('ps')) {
    return {
      stdout: '[{"Service":"api","State":"running","Health":"healthy"},{"Service":"temporal-worker","State":"running","Health":"healthy"}]',
      stderr: '',
    };
  }
  return { stdout: 'temporal-worker rebuilt', stderr: '' };
};

controlRuntime(config, ORCHESTRATOR_REFRESH_ACTION, { executor: fakeExecutor })
  .then((result) => {
    assert.equal(result.action, 'REBUILD_SERVICES');
    assert.deepEqual(result.services, ['temporal-worker']);
    assert.deepEqual(observedRebuildArgs.slice(-1), ['temporal-worker']);
    console.log('✅ Temporal orchestrator refresh seam self-test passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
