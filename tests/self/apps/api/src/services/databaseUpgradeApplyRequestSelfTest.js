const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';
const service = require(
  path.join(ROOT, 'apps/api/src/services/databaseUpgradeApplyRequestService'),
);
const authService = require(path.join(ROOT, 'apps/api/src/services/authService'));

const BASE_ENVIRONMENT = {
  PGDATABASE: 'skyserver_dev',
  SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED: 'true',
  SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
  SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '12345678901234567890',
  SKYCOMMAND_DB_UPGRADE_APPLY_REQUEST_TTL_MINUTES: '30',
};

function planResult(overrides = {}) {
  return {
    mode: 'PLAN',
    outcome: 'PLAN_READY',
    databaseIdentity: {
      databaseName: 'skyserver_dev',
      systemIdentifier: '12345678901234567890',
    },
    baseline: { ordinal: 128 },
    sourceRevision: 'revision-a',
    planDigest: { algorithm: 'SHA-256', digest: 'A'.repeat(64) },
    pendingChanges: [
      {
        ordinal: 131,
        kind: 'MIGRATION',
        relativePath: 'packages/db_build/src/migrations/00131__request.sql',
        sha256: 'B'.repeat(64),
      },
    ],
    ...overrides,
  };
}

function rowFromRequest(request, overrides = {}) {
  return {
    request_id: request.requestId || 'request-1',
    status: request.status || 'PENDING',
    requested_by_agent_id: request.requestedByAgentId || 'codex-local',
    requested_by_actor_metadata: request.requestedByActorMetadata || { agentId: 'codex-local' },
    trigger_source: 'ASSISTANT',
    database_name: 'skyserver_dev',
    system_identifier: '12345678901234567890',
    baseline_ordinal: 128,
    source_revision: 'revision-a',
    plan_digest: 'A'.repeat(64),
    pending_count: 1,
    pending_changes: planResult().pendingChanges,
    request_digest:
      request.requestDigest ||
      service.buildRequestDigest({
        databaseName: 'skyserver_dev',
        systemIdentifier: '12345678901234567890',
        baselineOrdinal: 128,
        sourceRevision: 'revision-a',
        planDigest: 'A'.repeat(64),
        pendingCount: 1,
        pendingChanges: planResult().pendingChanges,
      }),
    policy_contract_version: service.POLICY_CONTRACT_VERSION,
    requested_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    human_decision_user_id: null,
    human_decision_identity: null,
    human_decision_at: null,
    human_decision_note: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDatabase(initialRows = []) {
  const rows = [...initialRows];
  const auditEvents = [];
  let sequence = rows.length + 1;
  const database = {
    rows,
    auditEvents,
    query: async (sql, params = []) => {
      if (
        /UPDATE core\.database_upgrade_apply_requests SET status = 'EXPIRED'.*expires_at <=/i.test(
          sql,
        )
      ) {
        const expiredRows = rows.filter(
          (item) =>
            item.status === 'PENDING' &&
            (!params.length || item.request_id === params[0]) &&
            new Date(item.expires_at).getTime() <= Date.now(),
        );
        expiredRows.forEach((item) => {
          item.status = 'EXPIRED';
        });
        return { rowCount: expiredRows.length, rows: expiredRows };
      }
      if (/SELECT COUNT\(\*\)/i.test(sql)) return { rows: [{ count: rows.length }] };
      if (/FOR UPDATE/i.test(sql) || /WHERE request_id = \$1 LIMIT 1/i.test(sql)) {
        const row = rows.find((item) => item.request_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      return { rowCount: rows.length, rows };
    },
  };
  const client = {
    auditEvents,
    async query(sql, params = []) {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [] };
      if (
        /UPDATE core\.database_upgrade_apply_requests SET status = 'EXPIRED'.*expires_at <=/i.test(
          sql,
        )
      ) {
        const expiredRows = rows.filter(
          (item) =>
            item.status === 'PENDING' &&
            (!params.length || item.request_id === params[0]) &&
            new Date(item.expires_at).getTime() <= Date.now(),
        );
        expiredRows.forEach((item) => {
          item.status = 'EXPIRED';
        });
        return { rowCount: expiredRows.length, rows: expiredRows };
      }
      if (/SELECT COUNT\(\*\)/i.test(sql)) return { rows: [{ count: rows.length }] };
      if (/requested_by_agent_id = \$1/i.test(sql)) {
        const row = rows.find(
          (item) =>
            item.requested_by_agent_id === params[0] &&
            item.database_name === params[1] &&
            item.plan_digest === params[2] &&
            item.status === 'PENDING',
        );
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (/FOR UPDATE/i.test(sql)) {
        const row = rows.find((item) => item.request_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (/INSERT INTO core\.database_upgrade_apply_requests/i.test(sql)) {
        const row = rowFromRequest({
          requestId: `request-${sequence++}`,
          requestedByAgentId: params[0],
          requestedByActorMetadata: JSON.parse(params[1]),
          requestDigest: params[9],
        });
        row.database_name = params[2];
        row.system_identifier = params[3];
        row.baseline_ordinal = params[4];
        row.source_revision = params[5];
        row.plan_digest = params[6];
        row.pending_count = params[7];
        row.pending_changes = JSON.parse(params[8]);
        rows.push(row);
        return { rowCount: 1, rows: [row] };
      }
      if (
        /UPDATE core\.database_upgrade_apply_requests SET status = 'EXPIRED'.*RETURNING/i.test(sql)
      ) {
        const row = rows.find((item) => item.request_id === params[0]);
        if (row) row.status = 'EXPIRED';
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (/SET status = 'STALE'/i.test(sql)) {
        const row = rows.find((item) => item.request_id === params[0]);
        if (row) row.status = 'STALE';
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (/SET status = \$2/i.test(sql)) {
        const row = rows.find((item) => item.request_id === params[0]);
        if (!row || row.status !== 'PENDING') return { rowCount: 0, rows: [] };
        row.status = params[1];
        row.human_decision_user_id = params[2];
        row.human_decision_identity = JSON.parse(params[3]);
        row.human_decision_at = new Date().toISOString();
        row.human_decision_note = params[4];
        return { rowCount: 1, rows: [row] };
      }
      return { rows: [] };
    },
    release() {},
  };
  database.pool = { connect: async () => client };
  return database;
}

async function rejects(action, code) {
  await assert.rejects(
    async () => action(),
    (error) => {
      assert.equal(error.code, code);
      return true;
    },
  );
}

async function run() {
  assert.deepEqual(
    service.assertExactApplyRequestBody({ body: { expectedPlanDigest: 'a'.repeat(64) } }),
    'A'.repeat(64),
  );
  await rejects(
    () => service.assertExactApplyRequestBody({ body: {} }),
    'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_INVALID_ARGUMENTS',
  );
  await rejects(
    () =>
      service.assertExactApplyRequestBody({
        body: { expectedPlanDigest: 'A'.repeat(64), extra: true },
      }),
    'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_INVALID_ARGUMENTS',
  );
  await rejects(
    () => service.assertExactApplyRequestBody({ body: { expectedPlanDigest: 'short' } }),
    'ASSISTANT_DATABASE_UPGRADE_PLAN_DIGEST_INVALID',
  );
  assert.equal(service.getApplyRequestConfig({}).applyRequestEnabled, false);
  assert.equal(service.getApplyRequestConfig(BASE_ENVIRONMENT, []).applyRequestExecutable, false);
  assert.equal(
    service.getApplyRequestConfig(BASE_ENVIRONMENT, [
      { permissionCode: 'DB_UPGRADE_APPLY_REQUEST' },
    ]).applyRequestExecutable,
    true,
  );
  await rejects(
    () =>
      service.assertHumanPrincipal({
        user: { userId: 'u' },
        session: { authMode: 'ASSISTANT_SERVICE_TOKEN' },
        permissions: [],
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_HUMAN_REQUIRED',
  );
  await rejects(
    () =>
      service.assertHumanPrincipal({
        user: { userId: 'u', roleCodes: ['SUPER_ADMIN'] },
        session: {},
        permissions: [],
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_PERMISSION_REQUIRED',
  );
  await rejects(
    () =>
      service.assertHumanPrincipal({
        user: { userId: 'u', roleCodes: ['ADMIN'] },
        session: {},
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_ROLE_REQUIRED',
  );

  const calls = [];
  const executor = async (input) => {
    calls.push(input);
    return planResult();
  };
  const database = makeDatabase();
  assert.equal(typeof authService.recordAuditEventWithClient, 'function');
  const originalAudit = authService.recordAuditEventWithClient;
  authService.recordAuditEventWithClient = async (client, event) => client.auditEvents.push(event);
  try {
    const created = await service.createApplyRequest({
      expectedPlanDigest: 'A'.repeat(64),
      permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_REQUEST' }],
      assistantIdentity: {
        agentId: 'codex-local',
        authMode: 'ASSISTANT_SERVICE_TOKEN',
        userId: null,
      },
      environment: BASE_ENVIRONMENT,
      upgradeExecutor: executor,
      database,
    });
    assert.equal(created.accepted, true);
    assert.equal(created.reused, false);
    assert.equal(created.request.status, 'PENDING');
    assert.equal(created.request.pendingChanges[0].sha256, 'B'.repeat(64));
    assert.equal(created.request.requestedByActorMetadata.authMode, 'ASSISTANT_SERVICE_TOKEN');
    assert.equal(database.auditEvents[0].metadata.outcome, 'ACCEPTED');
    const duplicate = await service.createApplyRequest({
      expectedPlanDigest: 'A'.repeat(64),
      permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_REQUEST' }],
      assistantIdentity: {
        agentId: 'codex-local',
        authMode: 'ASSISTANT_SERVICE_TOKEN',
        userId: null,
      },
      environment: BASE_ENVIRONMENT,
      upgradeExecutor: executor,
      database,
    });
    assert.equal(duplicate.reused, true);
    assert.equal(database.rows.length, 1);
    assert.ok(calls.every((call) => call.mode === 'PLAN'));
    await rejects(
      () =>
        service.createApplyRequest({
          expectedPlanDigest: 'A'.repeat(64),
          permissions: [],
          assistantIdentity: { agentId: 'codex-local', authMode: 'ASSISTANT_SERVICE_TOKEN' },
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: executor,
          database,
        }),
      'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_PERMISSION_SCOPE_MISSING',
    );
    await rejects(
      () =>
        service.createApplyRequest({
          expectedPlanDigest: 'A'.repeat(64),
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_REQUEST' }],
          assistantIdentity: { agentId: 'codex-local', authMode: 'ASSISTANT_SERVICE_TOKEN' },
          environment: {
            ...BASE_ENVIRONMENT,
            SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED: 'false',
          },
          upgradeExecutor: executor,
          database,
        }),
      'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_DISABLED',
    );
    await rejects(
      () =>
        service.createApplyRequest({
          expectedPlanDigest: 'C'.repeat(64),
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_REQUEST' }],
          assistantIdentity: { agentId: 'codex-local', authMode: 'ASSISTANT_SERVICE_TOKEN' },
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: executor,
          database,
        }),
      'ASSISTANT_DATABASE_UPGRADE_PLAN_DIGEST_MISMATCH',
    );
    await rejects(
      () =>
        service.createApplyRequest({
          expectedPlanDigest: 'A'.repeat(64),
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_REQUEST' }],
          assistantIdentity: { agentId: 'codex-local', authMode: 'ASSISTANT_SERVICE_TOKEN' },
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: async () => planResult({ pendingChanges: [] }),
          database,
        }),
      'DATABASE_UPGRADE_NO_PENDING_CHANGES',
    );

    const human = {
      userId: '00000000-0000-0000-0000-000000000001',
      email: 'paul@example.test',
      displayName: 'Paul',
      roleCodes: ['SUPER_ADMIN'],
    };
    const approved = await service.decideApplyRequest({
      requestId: created.request.requestId,
      body: { decision: 'APPROVED', decisionNote: 'Reviewed exact envelope.' },
      user: human,
      session: {},
      permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
      environment: BASE_ENVIRONMENT,
      upgradeExecutor: executor,
      database,
    });
    assert.equal(approved.request.status, 'APPROVED');
    assert.equal(approved.request.humanDecisionUserId, human.userId);
    await rejects(
      () =>
        service.decideApplyRequest({
          requestId: created.request.requestId,
          body: { decision: 'REJECTED' },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: executor,
          database,
        }),
      'DATABASE_UPGRADE_APPLY_REQUEST_ALREADY_DECIDED',
    );

    const rejectedDatabase = makeDatabase([rowFromRequest({ requestId: 'reject-1' })]);
    let rejectPlanCalls = 0;
    const rejected = await service.decideApplyRequest({
      requestId: 'reject-1',
      body: { decision: 'REJECTED', decisionNote: 'Rejected after reviewing the stored envelope.' },
      user: human,
      session: {},
      permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
      environment: BASE_ENVIRONMENT,
      upgradeExecutor: async () => {
        rejectPlanCalls += 1;
        return planResult({ planDigest: { digest: 'C'.repeat(64) } });
      },
      database: rejectedDatabase,
    });
    assert.equal(rejected.request.status, 'REJECTED');
    assert.equal(rejected.request.humanDecisionUserId, human.userId);
    assert.deepEqual(rejected.request.humanDecisionIdentity, {
      userId: human.userId,
      email: human.email,
      displayName: human.displayName,
      roleCodes: ['SUPER_ADMIN'],
    });
    assert.ok(rejected.request.humanDecisionAt);
    assert.equal(Number.isNaN(Date.parse(rejected.request.humanDecisionAt)), false);
    assert.equal(
      rejected.request.humanDecisionNote,
      'Rejected after reviewing the stored envelope.',
    );
    assert.equal(rejectPlanCalls, 0);
    assert.equal(rejectedDatabase.auditEvents.length, 1);
    assert.equal(
      rejectedDatabase.auditEvents[0].eventType,
      'DATABASE_UPGRADE_APPLY_REQUEST_REJECTED',
    );
    assert.equal(rejectedDatabase.auditEvents[0].success, true);
    assert.equal(rejectedDatabase.auditEvents[0].metadata.outcome, 'REJECTED');
    assert.equal(rejectedDatabase.auditEvents[0].metadata.actorId, human.userId);
    assert.equal(rejectedDatabase.auditEvents[0].metadata.humanApprovalRequired, true);
    assert.equal(rejectedDatabase.auditEvents[0].metadata.applyExecutionExposed, false);
    assert.equal(rejectedDatabase.auditEvents[0].metadata.errorCode, null);
    assert.doesNotMatch(
      JSON.stringify(rejectedDatabase.auditEvents[0]),
      /sql|password|connectionString|absolutePath/i,
    );
    await rejects(
      () =>
        service.decideApplyRequest({
          requestId: 'reject-1',
          body: { decision: 'APPROVED' },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: async () => {
            rejectPlanCalls += 1;
            return planResult();
          },
          database: rejectedDatabase,
        }),
      'DATABASE_UPGRADE_APPLY_REQUEST_ALREADY_DECIDED',
    );
    assert.equal(rejectPlanCalls, 0);

    const staleDatabase = makeDatabase([rowFromRequest({ requestId: 'stale-1' })]);
    await rejects(
      () =>
        service.decideApplyRequest({
          requestId: 'stale-1',
          body: { decision: 'APPROVED' },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: async () => planResult({ planDigest: { digest: 'C'.repeat(64) } }),
          database: staleDatabase,
        }),
      'DATABASE_UPGRADE_APPLY_REQUEST_STALE',
    );
    assert.equal(staleDatabase.rows[0].status, 'STALE');

    const expiredApproveDatabase = makeDatabase([
      rowFromRequest(
        { requestId: 'expired-approve-1' },
        { expires_at: new Date(Date.now() - 1000).toISOString() },
      ),
    ]);
    let expiredApprovePlanCalls = 0;
    await rejects(
      () =>
        service.decideApplyRequest({
          requestId: 'expired-approve-1',
          body: { decision: 'APPROVED' },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: async () => {
            expiredApprovePlanCalls += 1;
            return planResult();
          },
          database: expiredApproveDatabase,
        }),
      'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
    );
    assert.equal(expiredApproveDatabase.rows[0].status, 'EXPIRED');
    assert.equal(expiredApprovePlanCalls, 0);
    assert.equal(expiredApproveDatabase.auditEvents[0].success, true);
    assert.equal(expiredApproveDatabase.auditEvents[0].metadata.outcome, 'EXPIRED');

    const expiredRejectDatabase = makeDatabase([
      rowFromRequest(
        { requestId: 'expired-reject-1' },
        { expires_at: new Date(Date.now() - 1000).toISOString() },
      ),
    ]);
    await rejects(
      () =>
        service.decideApplyRequest({
          requestId: 'expired-reject-1',
          body: { decision: 'REJECTED' },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment: BASE_ENVIRONMENT,
          upgradeExecutor: async () => planResult(),
          database: expiredRejectDatabase,
        }),
      'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
    );
    assert.equal(expiredRejectDatabase.rows[0].status, 'EXPIRED');
    assert.equal(expiredRejectDatabase.auditEvents[0].success, true);
    assert.equal(expiredRejectDatabase.auditEvents[0].metadata.outcome, 'EXPIRED');
  } catch (error) {
    if (error.code !== 'DATABASE_UPGRADE_APPLY_REQUEST_STALE') throw error;
    assert.equal(database.rows[0]?.status, 'APPROVED');
  } finally {
    authService.recordAuditEventWithClient = originalAudit;
  }

  const source = require('node:fs').readFileSync(
    path.join(ROOT, 'apps/api/src/services/assistantIntegrationService.js'),
    'utf8',
  );
  assert.ok(!source.includes("mode: 'APPLY'"));
  const gateway = require(path.join(ROOT, 'scripts/mcp/skycommandMcpGateway.js'));
  const tool = gateway
    .getToolDefinitions({
      databaseUpgradeApplyRequestEnabled: true,
      executionEnabled: false,
      devPromotionEnabled: false,
      allowedAutomationCodes: new Set(),
    })
    .find((item) => item.name === 'skycommand_database_upgrade_apply_request');
  assert.deepEqual(tool.inputSchema, {
    type: 'object',
    properties: { expectedPlanDigest: { type: 'string', pattern: '^[A-Fa-f0-9]{64}$' } },
    required: ['expectedPlanDigest'],
    additionalProperties: false,
  });
  assert.deepEqual(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(
    gateway
      .getToolDefinitions({
        databaseUpgradeApplyRequestEnabled: false,
        executionEnabled: true,
        devPromotionEnabled: true,
        allowedAutomationCodes: new Set(),
      })
      .some((item) => item.name.includes('database_upgrade_apply')),
    false,
  );
  console.log('[database-upgrade-apply-request:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
