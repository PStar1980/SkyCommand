#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { repositoryRoot } = require('../../../../../_support/sourceTestBootstrap.js');
require('dotenv').config({ path: path.join(repositoryRoot, '.env'), quiet: true });

const runtimeRefresh = require(
  path.join(repositoryRoot, 'apps/api/src/services/devRuntimeRefreshService'),
);
const middleware = require(
  path.join(repositoryRoot, 'apps/api/src/middleware/assistantIntegrationMiddleware'),
);
const integration = require(
  path.join(repositoryRoot, 'apps/api/src/services/assistantIntegrationService'),
);
const { authorizeRuntimeControl } = require(
  path.join(repositoryRoot, 'apps/api/src/services/supervisorLifecycleGrantService'),
);
const { verifyLifecycleGrant } = require(
  path.join(repositoryRoot, 'packages/supervisor/src/lifecycleGrant'),
);
const { AGENT_SESSION_RUNTIME_REBUILD_SERVICES, CODEX_BOOTSTRAP_REBUILD_SERVICES } = require(
  path.join(repositoryRoot, 'packages/supervisor/src/config'),
);

const OPERATION_ID = '123e4567-e89b-12d3-a456-426614174000';
const grantSecretEnv = process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET;
const controlTokenEnv = process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN;
process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET = 'dev-runtime-refresh-self-test-secret';
process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN = '';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeFakeDatabase() {
  const rows = new Map();
  const statements = [];
  return {
    rows,
    statements,
    async query(sql, values = []) {
      statements.push(sql);
      if (sql.includes('INSERT INTO worker.dev_runtime_refresh_operations')) {
        const [
          operation_id,
          caller_principal_code,
          caller_agent_id,
          idempotency_key,
          request_digest,
          profile_code,
          repository_code,
          environment_code,
          lifecycle_profile_code,
          target_service,
          action,
          affected_services,
          before_heartbeat,
          before_runtime_evidence,
          evidence,
        ] = values;
        const uniqueKey = `${caller_principal_code}\u0000${idempotency_key}`;
        if (
          [...rows.values()].some(
            (row) => `${row.caller_principal_code}\u0000${row.idempotency_key}` === uniqueKey,
          )
        ) {
          return { rows: [] };
        }
        const now = '2026-09-25T12:00:00.000Z';
        const row = {
          operation_id,
          caller_principal_code,
          caller_agent_id,
          idempotency_key,
          request_digest,
          profile_code,
          repository_code,
          environment_code,
          lifecycle_profile_code,
          target_service,
          action,
          affected_services: JSON.parse(affected_services),
          status: 'PENDING',
          supervisor_operation_id: null,
          before_heartbeat: JSON.parse(before_heartbeat),
          after_heartbeat: {},
          before_runtime_evidence: JSON.parse(before_runtime_evidence),
          after_runtime_evidence: {},
          evidence: JSON.parse(evidence),
          status_reason: null,
          requested_at: now,
          accepted_at: null,
          completed_at: null,
          last_reconciled_at: null,
          created_at: now,
          updated_at: now,
        };
        rows.set(operation_id, row);
        return { rows: [clone(row)] };
      }
      if (sql.includes('SELECT operation_id')) {
        let row;
        if (sql.includes('WHERE operation_id = $1')) {
          row = rows.get(values[0]);
          if (row?.caller_principal_code !== values[1]) row = null;
        } else {
          row = [...rows.values()].find(
            (candidate) =>
              candidate.caller_principal_code === values[0] &&
              candidate.idempotency_key === values[1],
          );
        }
        return { rows: row ? [clone(row)] : [] };
      }
      if (sql.includes('UPDATE worker.dev_runtime_refresh_operations')) {
        const operationId = values[0];
        const row = rows.get(operationId);
        if (!row) return { rows: [] };
        if (
          /status NOT IN \('SUCCEEDED', 'FAILED'\)/i.test(sql) &&
          ['SUCCEEDED', 'FAILED'].includes(row.status)
        ) {
          return { rows: [] };
        }
        const assignments =
          sql.match(/SET ([\s\S]*?), updated_at = CURRENT_TIMESTAMP WHERE/i)?.[1] || '';
        for (const assignment of assignments.split(',')) {
          const match = assignment.trim().match(/^([a-z_]+) = \$(\d+)$/i);
          if (!match) continue;
          row[match[1]] = clone(values[Number(match[2]) - 1]);
          if (
            typeof row[match[1]] === 'string' &&
            ['evidence', 'after_heartbeat', 'after_runtime_evidence'].includes(match[1])
          ) {
            row[match[1]] = JSON.parse(row[match[1]]);
          }
        }
        row.updated_at = '2026-09-25T12:01:00.000Z';
        return { rows: [] };
      }
      throw new Error(`Unexpected test SQL statement: ${sql.slice(0, 80)}`);
    },
  };
}

function supervisorStatus(profile, { operationId = null, status = null, active = null } = {}) {
  const services = profile.affectedServices
    .filter((service) => !profile.oneShotServices.includes(service))
    .map((service) => ({ service, state: 'RUNNING', health: 'HEALTHY', running: true }));
  for (const service of profile.oneShotServices) {
    services.push({ service, state: 'NOT_CREATED', health: 'UNKNOWN', running: false });
  }
  return {
    supervisorStatus: 'ONLINE',
    engineStatus: 'ONLINE',
    runtimeStatus: 'ONLINE',
    runningCount: services.filter((service) => service.running).length,
    serviceCount: services.length,
    services,
    activeOperation: active,
    lastOperation: operationId
      ? {
          operationId,
          action: profile.action,
          status,
          requestedAt: '2026-09-25T12:00:00.000Z',
          completedAt:
            status === 'SUCCEEDED' || status === 'FAILED' ? '2026-09-25T12:01:00.000Z' : null,
          runtimeStatus: 'ONLINE',
          code: status === 'FAILED' ? 'SUPERVISOR_REFRESH_FAILED' : null,
        }
      : null,
  };
}

function errorCode(code) {
  return (error) => error?.details?.code === code;
}

async function testServiceOperations() {
  const profile = runtimeRefresh
    .listDevRuntimeRefreshProfiles()
    .find((item) => item.profileCode === 'CODEX_BOOTSTRAP');
  const fakeDb = makeFakeDatabase();
  let currentStatus = supervisorStatus(profile);
  let dispatchCount = 0;
  let auditedPermission = null;
  let capturedGrant = null;
  const authorize = (options) =>
    authorizeRuntimeControl({
      ...options,
      auditRecorder: async (event) => {
        auditedPermission = event.metadata.permissionCode;
      },
      nowMs: Date.UTC(2026, 8, 25, 12, 0, 0),
    });
  const supervisorPoster = async ({ operationId, profile: resolvedProfile, grant }) => {
    dispatchCount += 1;
    assert.equal(resolvedProfile.profileCode, 'CODEX_BOOTSTRAP');
    capturedGrant = grant;
    return { operationId, action: resolvedProfile.action, status: null };
  };
  const options = {
    request: { profileCode: 'codex_bootstrap', idempotencyKey: 'runtime-refresh-1' },
    permissions: ['DEV_RUNTIME_LIFECYCLE'],
    agentId: 'codex-local',
    principalCode: 'assistant-http',
    actor: { username: 'skycommand-assistant' },
    session: { sessionId: 'assistant-session', appCode: 'SKYSERVER_ADMIN' },
    authorize,
    supervisorPoster,
    supervisorStatusLoader: async () => currentStatus,
    queryExecutor: fakeDb.query,
    now: () => new Date('2026-09-25T12:00:00.000Z'),
  };

  const started = await runtimeRefresh.startDevRuntimeRefresh(options);
  assert.equal(started.reused, false);
  assert.match(started.operation.operationId, /^[0-9a-f-]{36}$/i);
  assert.equal(started.operation.profileCode, 'CODEX_BOOTSTRAP');
  assert.equal(started.operation.action, 'REBUILD_CODEX_BOOTSTRAP');
  assert.equal(started.operation.status, 'DISPATCHED');
  assert.deepEqual(started.operation.affectedServices, CODEX_BOOTSTRAP_REBUILD_SERVICES);
  assert.equal(started.operation.requestedAt, '2026-09-25T12:00:00.000Z');
  assert.ok(started.operation.runtimeEvidence.before);
  assert.equal(JSON.stringify(started).includes('runtime-refresh-1'), false);
  assert.equal(
    JSON.stringify([...fakeDb.rows.values()]).includes(capturedGrant || 'grant-not-issued-yet'),
    false,
  );
  assert.equal(auditedPermission, 'DEV_RUNTIME_LIFECYCLE');
  assert.equal(dispatchCount, 1);

  await assert.rejects(
    () =>
      runtimeRefresh.getDevRuntimeRefresh({
        operationId: started.operation.operationId,
        principalCode: 'assistant-http',
        agentId: 'assistant-http',
        permissions: ['DEV_RUNTIME_LIFECYCLE'],
        queryExecutor: fakeDb.query,
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED'),
  );
  assert.ok(capturedGrant);
  const claims = verifyLifecycleGrant(capturedGrant, {
    secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
    action: 'REBUILD_CODEX_BOOTSTRAP',
    nowMs: Date.UTC(2026, 8, 25, 12, 0, 1),
  });
  assert.equal(claims.operationId, started.operation.operationId);
  assert.equal(JSON.stringify(started).includes(capturedGrant), false);
  assert.equal(JSON.stringify(started).includes('compose.yaml'), false);
  assert.equal(JSON.stringify(started).includes('hostPath'), false);
  assert.equal(
    fakeDb.statements.every(
      (sql) => !/managed_codex_runtime_lifecycle|agent_runtime_enrollment_operations/i.test(sql),
    ),
    true,
  );

  currentStatus = supervisorStatus(profile, {
    operationId: started.operation.operationId,
    status: 'SUCCEEDED',
  });
  const replay = await runtimeRefresh.startDevRuntimeRefresh(options);
  assert.equal(replay.reused, true);
  assert.equal(replay.operation.operationId, started.operation.operationId);
  assert.equal(replay.operation.status, 'SUCCEEDED');
  assert.equal(replay.operation.runtimeEvidence.after.freshness, 'CURRENT');
  assert.equal(
    replay.operation.runtimeEvidence.after.services.find(
      (service) => service.service === 'codex-managed-volume-init',
    ).state,
    'COMPLETED_BY_GOVERNED_ACTION',
  );
  assert.equal(dispatchCount, 1);

  const readback = await runtimeRefresh.getDevRuntimeRefresh({
    operationId: started.operation.operationId,
    principalCode: 'assistant-http',
    agentId: 'codex-local',
    permissions: ['DEV_RUNTIME_LIFECYCLE'],
    queryExecutor: fakeDb.query,
  });
  assert.equal(readback.operation.operationId, started.operation.operationId);
  assert.equal(readback.operation.status, 'SUCCEEDED');
  await assert.rejects(
    () =>
      runtimeRefresh.getDevRuntimeRefresh({
        operationId: started.operation.operationId,
        principalCode: 'different-principal',
        agentId: 'codex-local',
        permissions: ['DEV_RUNTIME_LIFECYCLE'],
        queryExecutor: fakeDb.query,
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_NOT_FOUND'),
  );

  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        request: { profileCode: 'TEMPORAL_WORKER', idempotencyKey: 'runtime-refresh-1' },
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_IDEMPOTENCY_CONFLICT'),
  );
  assert.equal(dispatchCount, 1);

  const unknownDb = makeFakeDatabase();
  let unknownDispatches = 0;
  const unknown = await runtimeRefresh.startDevRuntimeRefresh({
    ...options,
    request: { profileCode: 'CODEX_BOOTSTRAP', idempotencyKey: 'uncertain-dispatch' },
    queryExecutor: unknownDb.query,
    supervisorPoster: async () => {
      unknownDispatches += 1;
      const error = new Error('redacted transport detail');
      error.details = {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_DISPATCH_OUTCOME_UNKNOWN',
        outcomeUnknown: true,
      };
      throw error;
    },
  });
  assert.equal(unknown.operation.status, 'UNKNOWN');
  assert.equal(
    unknown.operation.statusReason,
    'SKYCOMMAND_DEV_RUNTIME_REFRESH_DISPATCH_OUTCOME_UNKNOWN',
  );
  assert.equal(JSON.stringify(unknown).includes('redacted transport detail'), false);
  assert.equal(unknownDispatches, 1);

  const rejectedDb = makeFakeDatabase();
  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        request: { profileCode: 'CODEX_BOOTSTRAP', idempotencyKey: 'rejected-dispatch' },
        queryExecutor: rejectedDb.query,
        supervisorPoster: async () => {
          const error = new Error('internal details suppressed');
          error.details = { code: 'SKYCOMMAND_SUPERVISOR_CONTROL_DENIED', outcomeUnknown: false };
          throw error;
        },
      }),
    errorCode('SKYCOMMAND_SUPERVISOR_CONTROL_DENIED'),
  );
  assert.equal([...rejectedDb.rows.values()][0].status, 'FAILED');

  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        permissions: ['WORKFLOW_RUN'],
        request: { profileCode: 'CODEX_BOOTSTRAP', idempotencyKey: 'denied-permission' },
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_PERMISSION_SCOPE_MISSING'),
  );
  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        agentId: 'assistant-http',
        request: { profileCode: 'CODEX_BOOTSTRAP', idempotencyKey: 'denied-agent' },
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED'),
  );
  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        request: { profileCode: 'REBUILD_BACKEND', idempotencyKey: 'unknown-profile' },
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_PROFILE_NOT_ALLOWED'),
  );
  for (const field of [
    'action',
    'service',
    'services',
    'composeArgs',
    'command',
    'url',
    'path',
    'supervisorUrl',
    'grant',
  ]) {
    await assert.rejects(
      () =>
        runtimeRefresh.startDevRuntimeRefresh({
          ...options,
          request: {
            profileCode: 'CODEX_BOOTSTRAP',
            idempotencyKey: `extra-${field}`,
            [field]: 'not-accepted',
          },
        }),
      errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_UNEXPECTED_FIELDS'),
    );
  }
  await assert.rejects(
    () =>
      runtimeRefresh.startDevRuntimeRefresh({
        ...options,
        supervisorStatusLoader: async () => ({
          ...currentStatus,
          activeOperation: { operationId: OPERATION_ID, action: 'REBUILD_BACKEND' },
        }),
        request: { profileCode: 'CODEX_BOOTSTRAP', idempotencyKey: 'supervisor-busy' },
      }),
    errorCode('SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_BUSY'),
  );

  const terminalDb = makeFakeDatabase();
  const terminalProfile = runtimeRefresh.getDevRuntimeRefreshProfile('CODEX_BOOTSTRAP');
  const terminalOperation = await runtimeRefresh.insertOperation(
    {
      callerPrincipalCode: 'assistant-http',
      callerAgentId: 'codex-local',
      idempotencyKey: 'terminal-status-is-immutable',
      requestDigest: runtimeRefresh.buildRequestDigest(terminalProfile),
      profile: terminalProfile,
      beforeRuntimeEvidence: {},
      beforeHeartbeat: {},
    },
    terminalDb.query,
  );
  await runtimeRefresh.updateOperation(
    terminalOperation.operation_id,
    { status: 'SUCCEEDED', completed_at: '2026-09-25T12:02:00.000Z' },
    terminalDb.query,
  );
  await runtimeRefresh.updateOperation(
    terminalOperation.operation_id,
    { status: 'DISPATCHED', completed_at: null },
    terminalDb.query,
  );
  assert.equal(terminalDb.rows.get(terminalOperation.operation_id).status, 'SUCCEEDED');
}

async function testTransportAndDiscovery() {
  const profile = runtimeRefresh.getDevRuntimeRefreshProfile('CODEX_BOOTSTRAP');
  let request = null;
  const accepted = await runtimeRefresh.postSupervisorRefresh({
    operationId: OPERATION_ID,
    profile,
    grant: 'short-lived-test-grant',
    environment: { SKYCOMMAND_SUPERVISOR_HOST: '127.0.0.1', SKYCOMMAND_SUPERVISOR_PORT: '17170' },
    fetcher: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          accepted: true,
          operation: {
            operationId: OPERATION_ID,
            action: 'REBUILD_CODEX_BOOTSTRAP',
            requestedAt: '2026-09-25T12:00:00Z',
          },
          grant: 'must-not-be-projected',
          stdout: 'must-not-be-projected',
        }),
      };
    },
  });
  assert.equal(request.url, 'http://127.0.0.1:17170/runtime/rebuild-codex-bootstrap');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-SkyCommand-Supervisor-Grant'], 'short-lived-test-grant');
  assert.equal(request.options.body, '{}');
  assert.equal(accepted.operationId, OPERATION_ID);
  assert.equal(JSON.stringify(accepted).includes('must-not-be-projected'), false);

  await assert.rejects(
    () =>
      runtimeRefresh.postSupervisorRefresh({
        operationId: OPERATION_ID,
        profile,
        grant: 'test-grant',
        fetcher: async () => ({
          ok: false,
          status: 403,
          json: async () => ({
            ok: false,
            code: 'SKYCOMMAND_SUPERVISOR_CONTROL_DENIED',
            error: 'private raw text',
          }),
        }),
      }),
    (error) =>
      error.details.code === 'SKYCOMMAND_SUPERVISOR_CONTROL_DENIED' &&
      error.details.outcomeUnknown === false,
  );
  await assert.rejects(
    () =>
      runtimeRefresh.postSupervisorRefresh({
        operationId: OPERATION_ID,
        profile,
        grant: 'test-grant',
        fetcher: async () => ({
          ok: false,
          status: 502,
          json: async () => ({ ok: false, code: 'UPSTREAM_FAILURE', error: 'private raw text' }),
        }),
      }),
    (error) => error.details.code === 'UPSTREAM_FAILURE' && error.details.outcomeUnknown === true,
  );

  const agentSessionRuntime = runtimeRefresh.getDevRuntimeRefreshProfile('AGENT_SESSION_RUNTIME');
  assert.equal(agentSessionRuntime.action, 'REBUILD_AGENT_SESSION_RUNTIME');
  assert.equal(agentSessionRuntime.supervisorPath, '/runtime/rebuild-agent-session-runtime');
  assert.deepEqual(agentSessionRuntime.affectedServices, AGENT_SESSION_RUNTIME_REBUILD_SERVICES);
  assert.deepEqual(agentSessionRuntime.healthOptionalServices, ['node-worker']);
  const temporal = runtimeRefresh.getDevRuntimeRefreshProfile('TEMPORAL_WORKER');
  assert.equal(temporal.action, 'REBUILD_TEMPORAL_WORKER');
  assert.equal(temporal.supervisorPath, '/runtime/rebuild-temporal-worker');
  assert.deepEqual(temporal.affectedServices, ['temporal-worker']);
  assert.deepEqual(
    runtimeRefresh.listDevRuntimeRefreshProfiles().map((item) => item.profileCode),
    ['CODEX_BOOTSTRAP', 'TEMPORAL_WORKER', 'AGENT_SESSION_RUNTIME'],
  );
  assert.equal(
    runtimeRefresh.buildSupervisorActionUrl('CODEX_BOOTSTRAP', {
      SKYCOMMAND_SUPERVISOR_HOST: 'localhost',
      SKYCOMMAND_SUPERVISOR_PORT: '17170',
    }),
    'http://localhost:17170/runtime/rebuild-codex-bootstrap',
  );
  assert.equal(
    runtimeRefresh.buildSupervisorActionUrl('AGENT_SESSION_RUNTIME', {
      SKYCOMMAND_SUPERVISOR_HOST: 'localhost',
      SKYCOMMAND_SUPERVISOR_PORT: '17170',
    }),
    'http://localhost:17170/runtime/rebuild-agent-session-runtime',
  );
  assert.equal(
    runtimeRefresh.buildSupervisorActionUrl('TEMPORAL_WORKER', {
      SKYCOMMAND_SUPERVISOR_HOST: 'localhost',
      SKYCOMMAND_SUPERVISOR_PORT: '17170',
    }),
    'http://localhost:17170/runtime/rebuild-temporal-worker',
  );

  const projectedStatus = runtimeRefresh.projectSupervisorStatus(
    {
      ok: true,
      supervisor: 'ONLINE',
      engineStatus: 'ONLINE',
      runtimeStatus: 'ONLINE',
      operation: {
        operationId: OPERATION_ID,
        action: 'REBUILD_CODEX_BOOTSTRAP',
        requestedAt: '2026-09-25T12:00:00Z',
        grant: 'never-project',
      },
      lastOperation: {
        operationId: OPERATION_ID,
        action: 'REBUILD_CODEX_BOOTSTRAP',
        status: 'SUCCEEDED',
        stdout: 'never-project',
      },
      services: [
        {
          service: 'api',
          state: 'RUNNING',
          health: 'HEALTHY',
          running: true,
          hostPath: 'never-project',
        },
      ],
      unrestrictedOutput: 'never-project',
    },
    profile,
  );
  assert.equal(JSON.stringify(projectedStatus).includes('never-project'), false);
  assert.equal(
    projectedStatus.services.every((item) => profile.affectedServices.includes(item.service)),
    true,
  );
  const malformedActive = runtimeRefresh.projectSupervisorStatus(
    {
      ok: true,
      supervisor: 'ONLINE',
      engineStatus: 'ONLINE',
      runtimeStatus: 'ONLINE',
      operation: { operationId: 'not-a-uuid', action: 'REBUILD_BACKEND' },
      services: [],
    },
    profile,
  );
  assert.equal(malformedActive.activeOperationPresent, true);
  assert.equal(malformedActive.activeOperation, null);

  const agentSessionStatus = runtimeRefresh.projectSupervisorStatus(
    {
      ok: true,
      supervisor: 'ONLINE',
      engineStatus: 'ONLINE',
      runtimeStatus: 'ONLINE',
      operation: null,
      lastOperation: {
        operationId: OPERATION_ID,
        action: 'REBUILD_AGENT_SESSION_RUNTIME',
        status: 'SUCCEEDED',
      },
      services: [
        { service: 'api', state: 'RUNNING', health: 'HEALTHY', running: true },
        { service: 'node-worker', state: 'RUNNING', health: null, running: true },
      ],
    },
    agentSessionRuntime,
  );
  const agentSessionEvidence = runtimeRefresh.buildRuntimeEvidence(
    agentSessionStatus,
    agentSessionRuntime,
    '2026-10-02T20:00:00Z',
  );
  assert.equal(agentSessionEvidence.freshness, 'CURRENT');
  assert.equal(agentSessionEvidence.generationOperationId, OPERATION_ID);
  assert.equal(agentSessionEvidence.services.find((item) => item.service === 'node-worker').health, 'NONE');

  const unhealthyApiEvidence = runtimeRefresh.buildRuntimeEvidence(
    runtimeRefresh.projectSupervisorStatus(
      {
        ok: true,
        supervisor: 'ONLINE',
        engineStatus: 'ONLINE',
        runtimeStatus: 'ONLINE',
        lastOperation: {
          operationId: OPERATION_ID,
          action: 'REBUILD_AGENT_SESSION_RUNTIME',
          status: 'SUCCEEDED',
        },
        services: [
          { service: 'api', state: 'RUNNING', health: 'UNHEALTHY', running: true },
          { service: 'node-worker', state: 'RUNNING', health: null, running: true },
        ],
      },
      agentSessionRuntime,
    ),
    agentSessionRuntime,
    '2026-10-02T20:00:00Z',
  );
  assert.equal(unhealthyApiEvidence.freshness, 'UNKNOWN');

  const cap = runtimeRefresh.getDevRuntimeRefreshCapabilitySummary(
    ['DEV_RUNTIME_LIFECYCLE'],
    'codex-local',
  );
  assert.equal(cap.capability, 'skycommand_dev_runtime_refresh');
  assert.equal(cap.executable, true);
  assert.deepEqual(cap.requestFields, ['profileCode', 'idempotencyKey']);
  assert.deepEqual(
    cap.profiles.map((item) => item.profileCode),
    ['CODEX_BOOTSTRAP', 'TEMPORAL_WORKER', 'AGENT_SESSION_RUNTIME'],
  );
  assert.equal(cap.grantPersisted, false);
  assert.equal(cap.directDockerReachable, false);
  assert.equal(
    runtimeRefresh.getDevRuntimeRefreshCapabilitySummary(
      ['DEV_RUNTIME_LIFECYCLE'],
      'assistant-http',
    ).executable,
    false,
  );
  const devRuntimeRestartAuditEvents = [];
  const devRuntimeRestartAuthorization = await authorizeRuntimeControl({
    action: 'RESTART',
    permissionCode: 'DEV_RUNTIME_LIFECYCLE',
    confirmed: true,
    actor: { userId: 'user-1', username: 'paul' },
    session: { sessionId: 'session-1', appCode: 'SKYSERVER_ADMIN' },
    auditRecorder: async (event) => devRuntimeRestartAuditEvents.push(event),
  });
  assert.equal(devRuntimeRestartAuthorization.authorization.action, 'RESTART');
  assert.ok(devRuntimeRestartAuthorization.authorization.grant);
  verifyLifecycleGrant(devRuntimeRestartAuthorization.authorization.grant, {
    secret: process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
    action: 'RESTART',
  });
  assert.equal(devRuntimeRestartAuditEvents.length, 1);
  assert.equal(
    devRuntimeRestartAuditEvents[0].metadata.permissionCode,
    'DEV_RUNTIME_LIFECYCLE',
  );
}

async function testPermissionProjectionAndContracts() {
  const envKeys = [
    'SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED',
    'SKYCOMMAND_ASSISTANT_API_TOKEN',
    'SKYCOMMAND_ASSISTANT_PERMISSION_CODES',
    'SKYCOMMAND_ASSISTANT_AGENT_ID',
    'SKYCOMMAND_ASSISTANT_PRINCIPAL_CODE',
  ];
  const oldValues = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED = 'true';
    process.env.SKYCOMMAND_ASSISTANT_API_TOKEN = 'test-assistant-token';
    process.env.SKYCOMMAND_ASSISTANT_PERMISSION_CODES =
      'BROWSER_AUTOMATION_RUN,MANAGED_CODEX_READ,DEV_RUNTIME_LIFECYCLE';
    process.env.SKYCOMMAND_ASSISTANT_AGENT_ID = 'codex-local';
    const req = {
      headers: {
        'x-skycommand-assistant-token': 'test-assistant-token',
        'x-skycommand-agent-id': 'assistant-http',
      },
    };
    let continued = false;
    middleware.requireAssistantIntegration(
      req,
      {
        status() {
          throw new Error('unexpected auth failure');
        },
      },
      () => {
        continued = true;
      },
    );
    assert.equal(continued, true);
    assert.equal(req.assistantIntegration.agentId, 'codex-local');
    assert.deepEqual(
      req.assistantIntegration.permissionCodes.sort(),
      ['BROWSER_AUTOMATION_RUN', 'DEV_RUNTIME_LIFECYCLE', 'MANAGED_CODEX_READ'].sort(),
    );

    process.env.SKYCOMMAND_ASSISTANT_AGENT_ID = 'assistant-http';
    const otherReq = {
      headers: {
        'x-skycommand-assistant-token': 'test-assistant-token',
        'x-skycommand-agent-id': 'codex-local',
      },
    };
    middleware.requireAssistantIntegration(
      otherReq,
      {
        status() {
          throw new Error('unexpected auth failure');
        },
      },
      () => {},
    );
    assert.equal(otherReq.assistantIntegration.agentId, 'assistant-http');
    assert.equal(
      otherReq.assistantIntegration.permissionCodes.includes('DEV_RUNTIME_LIFECYCLE'),
      false,
    );
    assert.equal(
      integration.getCapabilities({
        permissionCodes: otherReq.assistantIntegration.permissionCodes,
        agentId: otherReq.assistantIntegration.agentId,
      }).devRuntimeRefresh.executable,
      false,
    );

    for (const pinnedIdentity of [false, true]) {
      for (const permissionConfigured of [false, true]) {
        process.env.SKYCOMMAND_ASSISTANT_AGENT_ID = pinnedIdentity ? 'codex-local' : '';
        process.env.SKYCOMMAND_ASSISTANT_PERMISSION_CODES = permissionConfigured
          ? 'BROWSER_AUTOMATION_RUN,DEV_RUNTIME_LIFECYCLE'
          : 'BROWSER_AUTOMATION_RUN';
        const combinationReq = {
          headers: {
            'x-skycommand-assistant-token': 'test-assistant-token',
            'x-skycommand-agent-id': 'codex-local',
          },
        };
        middleware.requireAssistantIntegration(
          combinationReq,
          {
            status() {
              throw new Error('unexpected auth failure');
            },
          },
          () => {},
        );
        const expectedGrant = pinnedIdentity && permissionConfigured;
        assert.equal(
          combinationReq.assistantIntegration.permissionCodes.includes('DEV_RUNTIME_LIFECYCLE'),
          expectedGrant,
          `identity pin=${pinnedIdentity}, explicit permission=${permissionConfigured}`,
        );
        assert.equal(
          integration.getCapabilities({
            permissionCodes: combinationReq.assistantIntegration.permissionCodes,
            agentId: combinationReq.assistantIntegration.agentId,
          }).devRuntimeRefresh.executable,
          expectedGrant,
        );
      }
    }

    process.env.SKYCOMMAND_ASSISTANT_AGENT_ID = '';
    process.env.SKYCOMMAND_ASSISTANT_PERMISSION_CODES =
      'BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN';
    assert.equal(
      middleware.DEFAULT_ASSISTANT_PERMISSION_CODES.includes('DEV_RUNTIME_LIFECYCLE'),
      false,
    );
    assert.deepEqual(middleware.getAssistantIntegrationConfig().permissionCodes, [
      'BROWSER_AUTOMATION_READ',
      'BROWSER_AUTOMATION_RUN',
    ]);
  } finally {
    for (const [key, value] of Object.entries(oldValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const capabilities = integration.getCapabilities({
    permissionCodes: ['DEV_RUNTIME_LIFECYCLE'],
    agentId: 'codex-local',
  });
  assert.equal(capabilities.devRuntimeRefresh.capability, 'skycommand_dev_runtime_refresh');
  assert.equal(capabilities.devRuntimeRefresh.executable, true);
  const openApi = integration.getOpenApiDocument();
  const startContract = openApi.paths['/runtime-refresh/runs'].post;
  assert.equal(startContract.operationId, 'skycommand_dev_runtime_refresh');
  assert.deepEqual(startContract['x-required-permission-codes'], ['DEV_RUNTIME_LIFECYCLE']);
  const requestSchema = startContract.requestBody.content['application/json'].schema;
  assert.equal(requestSchema.additionalProperties, false);
  assert.deepEqual(requestSchema.required, ['profileCode', 'idempotencyKey']);
  assert.deepEqual(Object.keys(requestSchema.properties).sort(), ['idempotencyKey', 'profileCode']);
  assert.deepEqual(requestSchema.properties.profileCode.enum, [
    'CODEX_BOOTSTRAP',
    'TEMPORAL_WORKER',
    'AGENT_SESSION_RUNTIME',
  ]);
  assert.ok(openApi.paths['/runtime-refresh/runs/{operationId}'].get);
  assert.ok(openApi.paths['/orchestrator-refresh/runs'].post);

  const routeSource = fs.readFileSync(
    path.join(repositoryRoot, 'apps/api/src/routes/assistantIntegration.routes.js'),
    'utf8',
  );
  assert.match(routeSource, /\/runtime-refresh\/runs/);
  const migration = fs.readFileSync(
    path.join(
      repositoryRoot,
      'packages/db_build/src/migrations/00160__assistant_dev_runtime_refresh_operations.sql',
    ),
    'utf8',
  );
  for (const fragment of [
    'caller_principal_code',
    'caller_agent_id',
    'idempotency_key',
    'request_digest',
    'profile_code',
    'supervisor_operation_id',
    'before_runtime_evidence',
    'after_runtime_evidence',
    "'CODEX_BOOTSTRAP'",
    "'TEMPORAL_WORKER'",
    "'REBUILD_CODEX_BOOTSTRAP'",
    "'REBUILD_TEMPORAL_WORKER'",
    'UNIQUE (caller_principal_code, idempotency_key)',
  ])
    assert.ok(migration.includes(fragment), `migration missing ${fragment}`);
  assert.ok(
    migration.includes(
      "caller_agent_id TEXT NOT NULL\n    CHECK (caller_agent_id ~ '^[A-Za-z0-9_.:-]{1,64}$')",
    ),
  );
  assert.doesNotMatch(
    migration,
    /caller_agent_id TEXT NOT NULL DEFAULT|caller_agent_id\s*=\s*'codex-local'/,
  );
  assert.doesNotMatch(
    migration,
    /managed_codex_runtime_lifecycle|agent_runtime_enrollment_operations/i,
  );
  const r3Migration = fs.readFileSync(
    path.join(
      repositoryRoot,
      'packages/db_build/src/migrations/00168__agent_session_runtime_refresh_profile.sql',
    ),
    'utf8',
  );
  for (const fragment of [
    'AGENT_SESSION_RUNTIME',
    'REBUILD_AGENT_SESSION_RUNTIME',
    '["api","node-worker"]',
  ]) assert.ok(r3Migration.includes(fragment), `R3 migration missing ${fragment}`);

  const serviceSource = fs.readFileSync(
    path.join(repositoryRoot, 'apps/api/src/services/devRuntimeRefreshService.js'),
    'utf8',
  );
  assert.doesNotMatch(serviceSource, /child_process|dockerode|execFile|spawn\(/i);
  assert.match(serviceSource, /authorizeRuntimeControl/);
  assert.match(serviceSource, /DEV_RUNTIME_REFRESH_AGENT_ID/);
}

async function run() {
  await testServiceOperations();
  await testTransportAndDiscovery();
  await testPermissionProjectionAndContracts();
  console.log('✅ DEV runtime refresh capability self-test passed.');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (grantSecretEnv === undefined) delete process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET;
    else process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET = grantSecretEnv;
    if (controlTokenEnv === undefined) delete process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN;
    else process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN = controlTokenEnv;
  });
