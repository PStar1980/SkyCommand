const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../../../..');
process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';
const service = require(
  path.join(ROOT, 'apps/api/src/services/databaseUpgradeApplyRequestService'),
);

const human = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'paul@example.test',
  displayName: 'Paul',
  roleCodes: ['SUPER_ADMIN'],
};
const environment = {
  PGDATABASE: 'skyserver_dev',
  SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED: 'true',
  SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE: 'skyserver_dev',
  SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER: '12345678901234567890',
};
const pendingChanges = [
  {
    ordinal: 132,
    kind: 'MIGRATION',
    relativePath:
      'packages/db_build/src/migrations/00132__database_upgrade_apply_execution_receipt.sql',
    sha256: 'B'.repeat(64),
  },
];
const laterPendingChange = {
  ordinal: 133,
  kind: 'MIGRATION',
  relativePath: 'packages/db_build/src/migrations/00133__later_migration.sql',
  sha256: 'C'.repeat(64),
};

function planResult(overrides = {}) {
  const resolvedPendingChanges = overrides.pendingChanges || pendingChanges;
  return {
    mode: 'PLAN',
    outcome: 'PLAN_READY',
    databaseIdentity: {
      databaseName: 'skyserver_dev',
      systemIdentifier: '12345678901234567890',
    },
    baseline: { ordinal: 128 },
    sourceRevision: null,
    planDigest: { algorithm: 'SHA-256', digest: 'A'.repeat(64) },
    pendingCount: resolvedPendingChanges.length,
    pendingChanges: resolvedPendingChanges,
    ledger: { appliedCount: 3, receipts: [] },
    ...overrides,
  };
}

function approvedRow(overrides = {}) {
  const rowPendingChanges = overrides.pending_changes || pendingChanges;
  const snapshot = {
    databaseName: overrides.database_name || 'skyserver_dev',
    systemIdentifier: overrides.system_identifier || '12345678901234567890',
    baselineOrdinal: overrides.baseline_ordinal ?? 128,
    sourceRevision: overrides.source_revision ?? null,
    planDigest: String(overrides.plan_digest || 'A'.repeat(64)).toUpperCase(),
    pendingCount: overrides.pending_count ?? rowPendingChanges.length,
    pendingChanges: rowPendingChanges,
  };
  return {
    request_id: 'request-1',
    status: 'APPROVED',
    requested_by_agent_id: 'codex-local',
    requested_by_actor_metadata: { agentId: 'codex-local' },
    trigger_source: 'ASSISTANT',
    database_name: snapshot.databaseName,
    system_identifier: snapshot.systemIdentifier,
    baseline_ordinal: snapshot.baselineOrdinal,
    source_revision: snapshot.sourceRevision,
    plan_digest: snapshot.planDigest,
    pending_count: snapshot.pendingCount,
    pending_changes: snapshot.pendingChanges,
    request_digest: overrides.request_digest || service.buildRequestDigest(snapshot),
    policy_contract_version: service.POLICY_CONTRACT_VERSION,
    requested_at: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    human_decision_user_id: human.userId,
    human_decision_identity: { userId: human.userId, roleCodes: ['SUPER_ADMIN'] },
    human_decision_at: new Date(Date.now() - 500).toISOString(),
    human_decision_note: 'Approved exact envelope.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function receiptRow(params, overrides = {}) {
  return {
    execution_id: params[0],
    request_id: params[1],
    request_digest: params[2],
    plan_digest: params[3],
    database_name: params[4],
    system_identifier: params[5],
    executed_by_user_id: params[6],
    started_at: params[7],
    completed_at: params[8] || null,
    outcome: params[9],
    applied_count: params[10] || 0,
    result_identifiers: JSON.parse(params[11] || '[]'),
    before_ledger_state: JSON.parse(params[12] || '{}'),
    after_ledger_state: JSON.parse(params[13] || '{}'),
    failure_code: params[14] || null,
    ...overrides,
  };
}

function makeDatabase(row, options = {}) {
  const receipts = new Map();
  const queries = [];
  const state = {
    receiptTableAvailable: options.receiptTableAvailable !== false,
    receiptTableErrors: [],
    transactionEvents: [],
    transactionQueries: [],
    transactionAborted: false,
    sequence: options.sequence || [],
  };
  const database = {
    receipts,
    queries,
    state,
    async query(sql, params = []) {
      const text = String(sql);
      queries.push(text);
      if (
        !state.receiptTableAvailable &&
        /(?:SELECT execution_id|INSERT INTO core\.database_upgrade_apply_execution_receipts)/i.test(
          text.trim(),
        )
      ) {
        const error = new Error(
          options.receiptTableErrorMessage ||
            'relation "core.database_upgrade_apply_execution_receipts" does not exist',
        );
        error.code = options.receiptTableErrorCode || '42P01';
        state.receiptTableErrors.push({
          operation: /INSERT INTO/i.test(text) ? 'INSERT' : 'SELECT',
          error,
        });
        throw error;
      }
      if (/^SELECT execution_id/i.test(String(sql).trim())) {
        const receipt = receipts.get(params[0]);
        return { rowCount: receipt ? 1 : 0, rows: receipt ? [receipt] : [] };
      }
      if (
        /^INSERT INTO core\.database_upgrade_apply_execution_receipts/i.test(String(sql).trim())
      ) {
        const existing = receipts.get(params[1]);
        if (/ON CONFLICT \(request_id\) DO NOTHING/i.test(sql) && existing)
          return { rowCount: 0, rows: [] };
        const rowValue = receiptRow(params);
        receipts.set(params[1], rowValue);
        return { rowCount: 1, rows: [rowValue] };
      }
      if (/SELECT request_id/i.test(text)) return { rowCount: 1, rows: [row] };
      return { rowCount: 0, rows: [] };
    },
  };
  const client = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) {
        const command = text.toUpperCase();
        state.transactionEvents.push(command);
        state.transactionQueries.push(command);
        state.sequence.push(command);
        if (command === 'ROLLBACK') state.transactionAborted = false;
        return { rowCount: 0, rows: [] };
      }
      state.transactionQueries.push(text);
      state.sequence.push(
        text.startsWith('SELECT request_id')
          ? 'REQUEST_SELECT'
          : text.startsWith('SELECT execution_id')
            ? 'RECEIPT_SELECT'
            : 'SQL',
      );
      if (state.transactionAborted) {
        const error = new Error(
          'current transaction is aborted, commands ignored until end of transaction block',
        );
        error.code = '25P02';
        throw error;
      }
      if (/SELECT request_id/i.test(text)) return { rowCount: 1, rows: [row] };
      try {
        return await database.query(sql, params);
      } catch (error) {
        state.transactionAborted = true;
        throw error;
      }
    },
    release() {},
  };
  database.pool = { connect: async () => client };
  return database;
}

function assertSafeMetadata(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /sqlText|password|token|credential|connectionString|connection\s+string|absolutePath|\.env|CREATE\s+TABLE|INSERT\s+INTO|postgres(?:ql)?:\/\/|[A-Za-z]:[\\/]|(?:^|["'])\/(?:[^/]|$)/i,
    'safe audit/result metadata must not contain SQL, secrets, environment contents, or absolute paths',
  );
}

async function rejects(action, code) {
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

async function assertBootstrapRejected({
  requestId,
  requestChanges,
  planChanges = requestChanges,
  receiptTableErrorCode = '42P01',
  receiptTableErrorMessage,
  expectedCode = 'DATABASE_UPGRADE_EXECUTION_RECEIPT_INFRASTRUCTURE_MISSING',
}) {
  const database = makeDatabase(
    approvedRow({ request_id: requestId, pending_changes: requestChanges }),
    { receiptTableAvailable: false, receiptTableErrorCode, receiptTableErrorMessage },
  );
  let applyCalls = 0;
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId,
        body: { confirm: true },
        user: human,
        session: {},
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
        environment,
        database,
        upgradeExecutor: async () => planResult({ pendingChanges: planChanges }),
        applyExecutor: async () => {
          applyCalls += 1;
          return applyResult;
        },
        auditRecorder: async () => {},
      }),
    expectedCode,
  );
  assert.equal(applyCalls, 0, `${requestId} fails before D1 APPLY`);
  return database;
}

async function run() {
  assert.equal(service.getExecutionConfig({}).enabled, false, 'D2B.2 gate is default-off');
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        user: human,
        session: {},
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
        environment: {
          ...environment,
          SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED: 'false',
        },
        database: makeDatabase(approvedRow()),
      }),
    'ADMIN_DATABASE_UPGRADE_APPLY_EXECUTION_DISABLED',
  );
  assert.throws(
    () => service.assertExactExecutionBody({ confirm: false }),
    (error) => error.code === 'DATABASE_UPGRADE_EXECUTION_CONFIRMATION_REQUIRED',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        environment,
        database: makeDatabase(approvedRow()),
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_HUMAN_REQUIRED',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        user: { ...human, roleCodes: ['ADMIN'] },
        session: {},
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
        environment,
        database: makeDatabase(approvedRow()),
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_ROLE_REQUIRED',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        user: human,
        session: {},
        permissions: [],
        environment,
        database: makeDatabase(approvedRow()),
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_PERMISSION_REQUIRED',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        user: human,
        session: { authMode: 'ASSISTANT_SERVICE_TOKEN' },
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
        environment,
        database: makeDatabase(approvedRow()),
      }),
    'DATABASE_UPGRADE_APPLY_APPROVAL_HUMAN_REQUIRED',
  );

  for (const status of ['PENDING', 'REJECTED', 'STALE', 'EXPIRED', 'CANCELED']) {
    await rejects(
      () =>
        service.executeApprovedApplyRequest({
          requestId: 'request-1',
          body: { confirm: true },
          user: human,
          session: {},
          permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
          environment,
          database: makeDatabase(approvedRow({ status })),
        }),
      'DATABASE_UPGRADE_APPROVED_REQUEST_REQUIRED',
    );
  }
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        requestId: 'request-1',
        body: { confirm: true },
        user: human,
        session: {},
        permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
        environment,
        database: makeDatabase(
          approvedRow({ expires_at: new Date(Date.now() - 1000).toISOString() }),
        ),
      }),
    'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
  );

  const audit = [];
  const database = makeDatabase(approvedRow());
  const planCalls = [];
  let applyCalls = 0;
  const applyResult = {
    mode: 'APPLY',
    outcome: 'APPLIED',
    appliedCount: 1,
    databaseIdentity: { databaseName: 'skyserver_dev', systemIdentifier: '12345678901234567890' },
    ledger: {
      appliedCount: 4,
      receipts: [
        {
          changeId: 'change-132',
          ordinal: 132,
          kind: 'MIGRATION',
          relativePath: pendingChanges[0].relativePath,
          sha256: pendingChanges[0].sha256,
          planDigest: 'A'.repeat(64),
        },
      ],
    },
  };
  const runArgs = {
    requestId: 'request-1',
    body: { confirm: true },
    user: human,
    session: {},
    permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
    environment,
    database,
    upgradeExecutor: async () => {
      planCalls.push('PLAN');
      return planResult();
    },
    applyExecutor: async () => {
      applyCalls += 1;
      return applyResult;
    },
    auditRecorder: async (event) => audit.push(event),
  };
  const first = await service.executeApprovedApplyRequest(runArgs);
  assert.equal(first.receipt.outcome, 'APPLIED');
  assert.equal(applyCalls, 1);
  assert.equal(planCalls.length, 1);
  const repeated = await service.executeApprovedApplyRequest(runArgs);
  assert.equal(repeated.idempotent, true);
  assert.equal(applyCalls, 1, 'repeat returns the receipt without replaying D1 APPLY');
  assert.ok(audit.some((event) => event.eventType === 'DATABASE_UPGRADE_EXECUTION_REQUESTED'));
  assert.ok(audit.some((event) => event.eventType === 'DATABASE_UPGRADE_EXECUTION_STARTED'));
  assert.ok(audit.some((event) => event.eventType === 'DATABASE_UPGRADE_EXECUTION_SUCCEEDED'));
  audit.forEach((event) => assertSafeMetadata(event.metadata));
  assert.doesNotMatch(
    JSON.stringify(first.receipt),
    /sqlText|password|token|connectionString|absolutePath/i,
  );

  const bootstrapDatabase = makeDatabase(approvedRow({ request_id: 'bootstrap-request-1' }), {
    receiptTableAvailable: false,
  });
  const bootstrapAudit = [];
  const bootstrapPlanCalls = [];
  const bootstrapPlan = planResult();
  const bootstrapSequence = bootstrapDatabase.state.sequence;
  const bootstrapApplyArguments = [];
  let bootstrapApplyCalls = 0;
  const bootstrapArgs = {
    requestId: 'bootstrap-request-1',
    body: { confirm: true },
    user: human,
    session: {},
    permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
    environment,
    database: bootstrapDatabase,
    upgradeExecutor: async (args) => {
      bootstrapPlanCalls.push(args);
      bootstrapSequence.push('PLAN');
      return bootstrapPlan;
    },
    applyExecutor: async (args) => {
      bootstrapApplyCalls += 1;
      bootstrapSequence.push('APPLY');
      bootstrapApplyArguments.push(args);
      assert.equal(bootstrapDatabase.state.receiptTableAvailable, false);
      bootstrapDatabase.state.receiptTableAvailable = true;
      return applyResult;
    },
    auditRecorder: async (event) => bootstrapAudit.push(event),
  };
  const bootstrapResult = await service.executeApprovedApplyRequest(bootstrapArgs);
  assert.equal(bootstrapResult.request.status, 'APPROVED');
  assert.equal(bootstrapResult.request.humanDecisionUserId, human.userId);
  assert.equal(bootstrapResult.request.humanDecisionIdentity.userId, human.userId);
  assert.ok(
    bootstrapResult.request.humanDecisionAt,
    'approved request has human decision evidence',
  );
  assert.equal(bootstrapPlanCalls.length, 1, 'bootstrap performs one fresh D1 PLAN');
  assert.equal(bootstrapPlanCalls[0].mode, 'PLAN');
  assert.equal(bootstrapPlan.databaseIdentity.databaseName, bootstrapResult.request.databaseName);
  assert.equal(
    bootstrapPlan.databaseIdentity.systemIdentifier,
    bootstrapResult.request.systemIdentifier,
  );
  assert.equal(bootstrapPlan.baseline.ordinal, bootstrapResult.request.baselineOrdinal);
  assert.equal(bootstrapPlan.sourceRevision, bootstrapResult.request.sourceRevision);
  assert.equal(bootstrapPlan.pendingCount, bootstrapResult.request.pendingCount);
  assert.deepEqual(bootstrapPlan.pendingChanges, bootstrapResult.request.pendingChanges);
  assert.equal(bootstrapResult.request.planDigest, 'A'.repeat(64));
  assert.deepEqual(bootstrapResult.request.pendingChanges, pendingChanges);
  assert.equal(pendingChanges[0].ordinal, 132);
  assert.match(
    pendingChanges[0].relativePath,
    /00132__database_upgrade_apply_execution_receipt\.sql$/,
  );
  assert.deepEqual(
    bootstrapDatabase.state.receiptTableErrors.map(({ operation, error }) => ({
      operation,
      code: error.code,
      message: error.message,
    })),
    [
      {
        operation: 'SELECT',
        code: '42P01',
        message: 'relation "core.database_upgrade_apply_execution_receipts" does not exist',
      },
    ],
    'the transactional receipt SELECT propagates the exact PostgreSQL 42P01 once',
  );
  assert.deepEqual(
    bootstrapDatabase.state.transactionQueries.map((query) =>
      query === 'BEGIN'
        ? 'BEGIN'
        : query === 'ROLLBACK'
          ? 'ROLLBACK'
          : query.startsWith('SELECT request_id')
            ? 'REQUEST_SELECT'
            : query.startsWith('SELECT execution_id')
              ? 'RECEIPT_SELECT'
              : 'SQL',
    ),
    ['BEGIN', 'REQUEST_SELECT', 'RECEIPT_SELECT', 'ROLLBACK'],
    'no SQL is attempted on the aborted transaction before rollback',
  );
  assert.equal(bootstrapDatabase.state.transactionAborted, false);
  assert.ok(
    bootstrapSequence.indexOf('ROLLBACK') < bootstrapSequence.indexOf('PLAN'),
    'rollback occurs before fresh bootstrap PLAN validation',
  );
  assert.ok(
    bootstrapSequence.indexOf('PLAN') < bootstrapSequence.indexOf('APPLY'),
    'fresh bootstrap PLAN validation occurs before D1 APPLY continuation',
  );
  assert.deepEqual(
    bootstrapDatabase.state.transactionEvents,
    ['BEGIN', 'ROLLBACK'],
    'the failed receipt claim transaction is rolled back before D1 APPLY continues',
  );
  assert.equal(bootstrapApplyCalls, 1, 'D1 approved-request APPLY is invoked exactly once');
  assert.equal(bootstrapDatabase.state.receiptTableAvailable, true);
  assert.equal(bootstrapResult.receipt.outcome, 'APPLIED');
  assert.equal(bootstrapResult.receipt.requestId, bootstrapResult.request.requestId);
  assert.equal(bootstrapResult.receipt.requestDigest, bootstrapResult.request.requestDigest);
  assert.equal(bootstrapResult.receipt.planDigest, bootstrapResult.request.planDigest);
  assert.equal(bootstrapResult.receipt.databaseName, bootstrapResult.request.databaseName);
  assert.equal(bootstrapResult.receipt.systemIdentifier, bootstrapResult.request.systemIdentifier);
  assert.equal(bootstrapResult.receipt.executedByUserId, human.userId);
  assert.equal(bootstrapApplyArguments[0].approvedRequest.requestId, 'bootstrap-request-1');
  assert.equal(
    bootstrapApplyArguments[0].approvedRequest.requestDigest,
    bootstrapResult.request.requestDigest,
  );
  assert.equal(
    bootstrapApplyArguments[0].approvedRequest.planDigest,
    bootstrapResult.request.planDigest,
  );
  assert.ok(
    bootstrapDatabase.queries.some((query) =>
      /^INSERT INTO core\.database_upgrade_apply_execution_receipts/i.test(query.trim()),
    ),
    'receipt is persisted after simulated 00132 makes the table available',
  );
  bootstrapAudit.forEach((event) => assertSafeMetadata(event.metadata));
  assertSafeMetadata(bootstrapResult.receipt);

  const bootstrapRepeat = await service.executeApprovedApplyRequest(bootstrapArgs);
  assert.equal(bootstrapRepeat.idempotent, true);
  assert.equal(bootstrapRepeat.receipt.outcome, 'APPLIED');
  assert.equal(bootstrapRepeat.receipt.executionId, bootstrapResult.receipt.executionId);
  assert.equal(bootstrapApplyCalls, 1, 'repeat returns APPLIED without replaying D1 APPLY');

  const preBootstrapListDatabase = makeDatabase(
    approvedRow({ request_id: 'pre-00132-list-request' }),
    { receiptTableAvailable: false },
  );
  const preBootstrapList = await service.listApplyRequests({
    user: human,
    session: {},
    permissions: [{ permissionCode: 'DB_UPGRADE_APPLY_APPROVE' }],
    environment,
    database: preBootstrapListDatabase,
  });
  assert.equal(preBootstrapList.items.length, 1);
  assert.equal(preBootstrapList.items[0].execution, null);
  assert.equal(
    preBootstrapListDatabase.state.receiptTableErrors.length,
    1,
    'non-transactional missing receipt infrastructure remains a no-receipt list result',
  );

  await assertBootstrapRejected({
    requestId: 'bootstrap-later-migration-request',
    requestChanges: [laterPendingChange],
    planChanges: [laterPendingChange],
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-additional-pending-request',
    requestChanges: [pendingChanges[0], laterPendingChange],
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-wrong-ordinal-request',
    requestChanges: [{ ...pendingChanges[0], ordinal: 131 }],
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-wrong-path-request',
    requestChanges: [
      {
        ...pendingChanges[0],
        relativePath: 'packages/db_build/src/migrations/00132__other_migration.sql',
      },
    ],
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-wrong-kind-request',
    requestChanges: [{ ...pendingChanges[0], kind: 'SEED' }],
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-plan-mismatch-request',
    requestChanges: pendingChanges,
    planChanges: [laterPendingChange],
    expectedCode: 'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
  });
  await assertBootstrapRejected({
    requestId: 'bootstrap-wrong-relation-request',
    requestChanges: pendingChanges,
    receiptTableErrorMessage: 'relation "core.other_relation" does not exist',
    expectedCode: '42P01',
  });

  const nonUndefinedTableErrorDatabase = makeDatabase(
    approvedRow({ request_id: 'non-42p01-request' }),
    {
      receiptTableAvailable: false,
      receiptTableErrorCode: '23505',
    },
  );
  let nonUndefinedTableApplyCalls = 0;
  await assert.rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...bootstrapArgs,
        requestId: 'non-42p01-request',
        database: nonUndefinedTableErrorDatabase,
        applyExecutor: async () => {
          nonUndefinedTableApplyCalls += 1;
          return applyResult;
        },
        auditRecorder: async () => {},
      }),
    (error) => {
      assert.equal(error.code, '23505');
      return true;
    },
    'non-42P01 errors mentioning the receipt relation must not enter bootstrap continuation',
  );
  assert.equal(nonUndefinedTableApplyCalls, 0);

  const concurrentDatabase = makeDatabase(approvedRow({ request_id: 'request-2' }));
  let releaseApply;
  let concurrentApplyCalls = 0;
  const concurrentArgs = {
    ...runArgs,
    requestId: 'request-2',
    database: concurrentDatabase,
    applyExecutor: async () => {
      concurrentApplyCalls += 1;
      await new Promise((resolve) => {
        releaseApply = resolve;
      });
      return applyResult;
    },
  };
  const firstConcurrent = service.executeApprovedApplyRequest(concurrentArgs);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await rejects(
    () => service.executeApprovedApplyRequest(concurrentArgs),
    'DATABASE_UPGRADE_EXECUTION_IN_PROGRESS',
  );
  releaseApply();
  await firstConcurrent;
  assert.equal(concurrentApplyCalls, 1, 'concurrent calls cannot apply twice');

  const changedPlan = makeDatabase(approvedRow());
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        database: changedPlan,
        upgradeExecutor: async () => planResult({ planDigest: { digest: 'C'.repeat(64) } }),
        applyExecutor: async () => {
          throw new Error('must not apply');
        },
      }),
    'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        database: makeDatabase(approvedRow()),
        upgradeExecutor: async () =>
          planResult({
            databaseIdentity: {
              databaseName: 'other_database',
              systemIdentifier: environment.SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER,
            },
          }),
      }),
    'DATABASE_UPGRADE_OBSERVED_DATABASE_MISMATCH',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        database: makeDatabase(approvedRow()),
        upgradeExecutor: async () =>
          planResult({
            databaseIdentity: {
              databaseName: environment.SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE,
              systemIdentifier: '99999999999999999999',
            },
          }),
      }),
    'DATABASE_UPGRADE_OBSERVED_SYSTEM_IDENTIFIER_MISMATCH',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        database: makeDatabase(approvedRow()),
        upgradeExecutor: async () =>
          planResult({ pendingChanges: [{ ...pendingChanges[0], sha256: 'C'.repeat(64) }] }),
      }),
    'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
  );
  const tampered = makeDatabase(approvedRow({ request_digest: 'D'.repeat(64) }));
  await rejects(
    () => service.executeApprovedApplyRequest({ ...runArgs, database: tampered }),
    'DATABASE_UPGRADE_APPROVED_REQUEST_DIGEST_MISMATCH',
  );
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        requestId: 'request-identity',
        database: makeDatabase(
          approvedRow({
            request_id: 'request-identity',
            human_decision_identity: { userId: 'different-human' },
          }),
        ),
      }),
    'DATABASE_UPGRADE_HUMAN_DECISION_EVIDENCE_REQUIRED',
  );
  const recoveryDatabase = makeDatabase(approvedRow());
  const originalRecoveryQuery = recoveryDatabase.query;
  let receiptPersistenceAttempts = 0;
  recoveryDatabase.query = async (sql, params = []) => {
    if (/ON CONFLICT \(request_id\) DO UPDATE/i.test(sql)) {
      receiptPersistenceAttempts += 1;
      if (receiptPersistenceAttempts === 1) throw new Error('simulated receipt persistence outage');
    }
    return originalRecoveryQuery(sql, params);
  };
  let recoveryPlanCalls = 0;
  const recovered = await service.executeApprovedApplyRequest({
    ...runArgs,
    database: recoveryDatabase,
    upgradeExecutor: async () => {
      recoveryPlanCalls += 1;
      return recoveryPlanCalls === 1
        ? planResult()
        : planResult({
            pendingChanges: [],
            pendingCount: 0,
            planDigest: { digest: 'C'.repeat(64) },
            ledger: { appliedCount: 4, receipts: applyResult.ledger.receipts },
          });
    },
  });
  assert.equal(recovered.reconciled, true, 'receipt recovery reconciles D1 ledger evidence');
  assert.equal(applyCalls, 2, 'recovery invokes the approved D1 APPLY only once per request');
  assert.equal(receiptPersistenceAttempts, 2);
  const zeroPending = makeDatabase(approvedRow());
  await rejects(
    () =>
      service.executeApprovedApplyRequest({
        ...runArgs,
        database: zeroPending,
        upgradeExecutor: async () => planResult({ pendingChanges: [], pendingCount: 0 }),
      }),
    'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
  );

  const route = fs.readFileSync(
    path.join(ROOT, 'apps/api/src/routes/assistantIntegration.routes.js'),
    'utf8',
  );
  assert.doesNotMatch(
    route,
    /database-upgrade.*execute/i,
    'Assistant has no APPLY execution route',
  );
  assert.match(
    fs.readFileSync(path.join(ROOT, 'scripts/mcp/skycommandMcpGateway.js'), 'utf8'),
    /database_upgrade_apply_request/,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, 'scripts/mcp/skycommandMcpGateway.js'), 'utf8'),
    /database_upgrade_apply_execute|database_upgrade_apply\b.*execution/i,
  );
  const migration = fs.readFileSync(
    path.join(
      ROOT,
      'packages/db_build/src/migrations/00132__database_upgrade_apply_execution_receipt.sql',
    ),
    'utf8',
  );
  assert.match(migration, /UNIQUE INDEX.*request/i);
  assert.doesNotMatch(migration, /password|token|connection string|sql text|absolute path/i);
  assert.match(
    fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/admin.routes.js'), 'utf8'),
    /database-upgrade\/apply-requests\/:requestId\/execute/,
  );
  const assistantIntegration = require(
    path.join(ROOT, 'apps/api/src/services/assistantIntegrationService'),
  );
  const capabilities = assistantIntegration.getCapabilities({
    permissionCodes: ['DB_UPGRADE_PLAN', 'DB_UPGRADE_APPLY_REQUEST'],
    environment: {
      ...environment,
      SKYCOMMAND_ASSISTANT_DB_UPGRADE_PLAN_ENABLED: 'true',
      SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED: 'true',
    },
  });
  assert.equal(capabilities.databaseUpgradePlan.readOnly, true);
  assert.equal(capabilities.databaseUpgradePlan.applyExposed, false);
  assert.equal(capabilities.databaseUpgradeApplyRequest.applyExecutionExposed, false);
  assert.equal(capabilities.databaseUpgradeHumanExecution.agentCapability, false);
  const ui = fs.readFileSync(
    path.join(ROOT, 'apps/admin-web/src/pages/DatabaseUpgradeRequests.jsx'),
    'utf8',
  );
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /NOT EXECUTED/);
  assert.match(ui, /Execute approved PLAN/);
  assert.match(
    ui,
    /await loadRequests\(\);\s*setError\(executeError\.message/,
    'execution refusal remains visible after the request list refresh',
  );
  console.log('[database-upgrade-execution:self-test] PASS');
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
