const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.PGHOST ||= '127.0.0.1';
process.env.PGDATABASE ||= 'skycommand_self_test';
process.env.PGUSER ||= 'skycommand_self_test';
process.env.PGPASSWORD ||= 'skycommand_self_test';
process.env.SKYCOMMAND_ENVIRONMENT_CODE = 'DEV_LOCAL';
process.env.SKYCOMMAND_CONFIG_PROFILE = 'DEV_LOCAL';
process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_ENABLED = 'true';
process.env.SKYCOMMAND_ASSISTANT_DEV_PROMOTION_REPOSITORY = 'SkyCommand';

const ROOT = path.resolve(__dirname, '../../../../../..');
const startService = require(
  path.join(ROOT, 'apps/api/src/services/developmentPromotionStartService'),
);
const assistantService = require(
  path.join(ROOT, 'apps/api/src/services/assistantIntegrationService'),
);
const preflight = require(path.join(ROOT, 'packages/dev-finalization/src/promotionPreflight'));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FINALIZATION_RUN_ID = '33333333-3333-4333-8333-333333333333';
const WORKFLOW_RUN_ID = '44444444-4444-4444-8444-444444444444';
const WORKFLOW_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const WORKFLOW_DEFINITION_ID = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'A'.repeat(64);

function definition() {
  return {
    workflowDefinitionId: WORKFLOW_DEFINITION_ID,
    workflowCode: 'skyserver_dev_commit',
    publishedVersionId: WORKFLOW_VERSION_ID,
    publishedVersionNumber: 22,
  };
}

function finalization() {
  return {
    finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    scope: {
      repositoryCode: 'SkyCommand',
      environmentCode: 'DEV_LOCAL',
      configProfileCode: 'DEV_LOCAL',
    },
    receipt: { receiptSha256: DIGEST },
    sourceIdentity: { digest: DIGEST },
  };
}

function buildManualAdmission({ identity, requestDigest = identity.requestDigest } = {}) {
  return {
    workflow_run_record_id: WORKFLOW_RUN_ID,
    workflow_definition_id: WORKFLOW_DEFINITION_ID,
    workflow_version_id: WORKFLOW_VERSION_ID,
    workflow_code: 'skyserver_dev_commit',
    version_number: 22,
    workflow_run_status: 'RUNNING',
    status: 'RUNNING',
    run_source: 'manual',
    trigger_type: 'MANUAL',
    started_by_user_id: USER_ID,
    workflow_execution_admission_id: null,
    idempotency_key_hash: identity.idempotencyKeyHash,
    request_digest: requestDigest,
    principal_code: 'operator-ui',
    auth_mode: 'HUMAN_SESSION',
    repository_code: 'SkyCommand',
    environment_code: 'DEV_LOCAL',
    config_profile_code: 'DEV_LOCAL',
    validated_parameters: {
      repoName: 'SkyCommand',
      commitMessage: 'Manual promotion',
      finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    },
    actor_permission_codes: [...preflight.PROMOTION_REQUIRED_PERMISSION_CODES],
    request_context: {
      sessionId: SESSION_ID,
      authorization: {
        source: 'HUMAN_UI',
        actorUserId: USER_ID,
      },
      promotionAuthorization: {
        instructionSource: 'OPERATOR',
        triggerSource: 'ADMIN_WEB',
        triggerType: 'MANUAL',
        instructionRef: 'request-1',
        requestedAt: '2026-09-20T00:00:00.000Z',
      },
    },
  };
}

function buildAssistantAdmission({ identity }) {
  return {
    ...buildManualAdmission({ identity }),
    workflow_run_record_id: '77777777-7777-4777-8777-777777777777',
    run_source: 'assistant',
    trigger_type: 'ASSISTANT',
    started_by_user_id: null,
    workflow_execution_admission_id: '88888888-8888-4888-8888-888888888888',
    principal_code: 'assistant-http',
    auth_mode: 'ASSISTANT_SERVICE_TOKEN',
    admission_status: 'STARTED',
    principal_status: 'ACTIVE',
    grant_status: 'ACTIVE',
    grant_repository_code: 'SkyCommand',
    grant_workflow_code: 'skyserver_dev_commit',
    grant_environment_code: 'DEV_LOCAL',
    grant_config_profile_code: 'DEV_LOCAL',
    grant_permission_codes: [...preflight.PROMOTION_REQUIRED_PERMISSION_CODES],
    request_context: {
      executionContext: {
        principalId: '99999999-9999-4999-8999-999999999999',
        principalCode: 'assistant-http',
        authMode: 'ASSISTANT_SERVICE_TOKEN',
      },
      promotionAuthorization: {
        instructionSource: 'ASSISTANT',
        triggerSource: 'ASSISTANT',
        triggerType: 'ASSISTANT',
        agentId: 'codex-local',
        instructionRef: 'assistant-instruction-1',
        requestedAt: '2026-09-20T00:00:00.000Z',
      },
    },
  };
}

function admissionInsertHarness() {
  let inserted = null;
  return {
    get inserted() {
      return inserted;
    },
    queryFn: async (sql, params) => {
      if (sql.startsWith('INSERT INTO worker.dev_promotion_admissions')) {
        if (inserted) {
          const error = new Error('duplicate promotion admission');
          error.code = '23505';
          throw error;
        }
        inserted = {
          dev_promotion_admission_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
          workflow_run_record_id: params[2],
          idempotency_key_hash: params[11],
          request_digest: params[12],
          finalization_workflow_run_record_id: params[13],
          authorization_source: params[17],
          status: 'PREFLIGHT_RUNNING',
        };
        return { rows: [inserted] };
      }
      if (sql.startsWith('SELECT * FROM worker.dev_promotion_admissions')) {
        return { rows: inserted ? [inserted] : [] };
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
    },
  };
}

async function run() {
  const manualCalls = [];
  let existingManualRun = null;
  const manualWorkflowExecutor = {
    getWorkflowDefinition: async () => definition(),
    findWorkflowRunByPromotionIdentity: async () => existingManualRun,
    startWorkflowWithTemporal: async (request) => {
      manualCalls.push(request);
      return {
        ok: true,
        started: true,
        run: { workflowRunRecordId: WORKFLOW_RUN_ID },
        temporalWorkflow: { workflowId: 'temporal-manual', runId: 'run-manual' },
      };
    },
  };
  const manualResult = await startService.startManualDevelopmentPromotion({
    input: {
      runSource: 'manual',
      triggerType: 'MANUAL',
      params: {
        repoName: 'SkyCommand',
        commitMessage: 'Manual promotion',
        finalizationWorkflowRunId: FINALIZATION_RUN_ID,
      },
    },
    user: { userId: USER_ID, displayName: 'Paul' },
    session: { sessionId: SESSION_ID, authMode: 'SESSION' },
    permissions: [{ permissionCode: 'WORKFLOW_RUN' }],
    context: { requestId: 'request-1', ipAddress: '127.0.0.1', userAgent: 'self-test' },
    workflowExecutor: manualWorkflowExecutor,
    promotionValidator: async ({ finalizationWorkflowRunId, verifyCurrent }) => {
      assert.equal(finalizationWorkflowRunId, FINALIZATION_RUN_ID);
      assert.equal(verifyCurrent, true);
      return finalization();
    },
  });

  const manualInput = manualCalls[0].input;
  existingManualRun = {
    workflow_run_record_id: WORKFLOW_RUN_ID,
    input: manualInput,
  };
  const manualIdentity = manualInput.promotionRequest;
  assert.match(manualIdentity.idempotencyKeyHash, /^[A-F0-9]{64}$/);
  assert.match(manualIdentity.requestDigest, /^[A-F0-9]{64}$/);
  assert.equal(manualInput.runSource, 'manual');
  assert.equal(manualInput.triggerType, 'MANUAL');
  assert.equal(manualResult.promotionStart.authorizationSource, 'HUMAN_UI');
  assert.equal(manualResult.promotionStart.trustedAttribution.userId, USER_ID);
  assert.equal(manualResult.promotionStart.trustedAttribution.sessionId, SESSION_ID);
  assert.equal(manualResult.promotionStart.trustedAttribution.instructionRef, 'request-1');
  assert.equal('idempotencyKey' in manualInput, false);

  const reusedManualResult = await startService.startManualDevelopmentPromotion({
    input: manualInput,
    user: { userId: USER_ID, displayName: 'Paul' },
    session: { sessionId: SESSION_ID, authMode: 'SESSION' },
    context: { requestId: 'request-1' },
    workflowExecutor: manualWorkflowExecutor,
    promotionValidator: async () => finalization(),
  });
  assert.equal(reusedManualResult.reused, true);
  assert.equal(manualCalls.length, 1);

  await assert.rejects(
    () =>
      startService.startManualDevelopmentPromotion({
        input: {
          params: {
            repoName: 'SkyCommand',
            commitMessage: 'Different intentional promotion',
            finalizationWorkflowRunId: FINALIZATION_RUN_ID,
          },
        },
        user: { userId: USER_ID, displayName: 'Paul' },
        session: { sessionId: SESSION_ID, authMode: 'SESSION' },
        context: { requestId: 'request-1' },
        workflowExecutor: manualWorkflowExecutor,
        promotionValidator: async () => finalization(),
      }),
    (error) => error.details?.code === 'R6_PROMOTION_IDEMPOTENCY_CONFLICT',
  );
  assert.throws(
    () => preflight.resolvePromotionAdmissionIdentity({ workflow_run_record_id: WORKFLOW_RUN_ID }),
    (error) => error.code === 'R6_PROMOTION_IDEMPOTENCY_INVALID',
  );

  const sameManualIdentity = startService.buildManualPromotionIdentity({
    input: manualInput,
    user: { userId: USER_ID },
    session: { sessionId: SESSION_ID },
    context: { requestId: 'request-1' },
    workflowCode: 'skyserver_dev_commit',
    definition: definition(),
    environment: process.env,
  });
  const differentRequestIdentity = startService.buildManualPromotionIdentity({
    input: {
      params: {
        repoName: 'SkyCommand',
        commitMessage: 'Different intentional promotion',
        finalizationWorkflowRunId: FINALIZATION_RUN_ID,
      },
    },
    user: { userId: USER_ID },
    session: { sessionId: SESSION_ID },
    context: { requestId: 'request-1' },
    workflowCode: 'skyserver_dev_commit',
    definition: definition(),
    environment: process.env,
  });
  assert.equal(sameManualIdentity.idempotencyKeyHash, manualIdentity.idempotencyKeyHash);
  assert.equal(sameManualIdentity.requestDigest, manualIdentity.requestDigest);
  assert.equal(differentRequestIdentity.idempotencyKeyHash, manualIdentity.idempotencyKeyHash);
  assert.notEqual(differentRequestIdentity.requestDigest, manualIdentity.requestDigest);

  const manualAdmissionRow = buildManualAdmission({
    identity: manualIdentity,
    requestDigest: manualIdentity.requestDigest,
  });
  assert.equal(preflight.assertPromotionRunAuthorization(manualAdmissionRow), 'HUMAN_UI');
  const manualHarness = admissionInsertHarness();
  const manualPromotionAdmission = await preflight.beginPromotionAdmission({
    admission: manualAdmissionRow,
    finalization: finalization(),
    queryFn: manualHarness.queryFn,
  });
  assert.equal(manualPromotionAdmission.authorization_source, 'HUMAN_UI');
  assert.match(manualPromotionAdmission.idempotency_key_hash, /^[A-F0-9]{64}$/);
  assert.match(manualPromotionAdmission.request_digest, /^[A-F0-9]{64}$/);
  assert.equal(manualPromotionAdmission.finalization_workflow_run_record_id, FINALIZATION_RUN_ID);
  assert.equal(preflight.trustedAttribution(manualAdmissionRow).userId, USER_ID);
  assert.equal(preflight.trustedAttribution(manualAdmissionRow).instructionRef, 'request-1');

  const sameAdmission = await preflight.beginPromotionAdmission({
    admission: manualAdmissionRow,
    finalization: finalization(),
    queryFn: manualHarness.queryFn,
  });
  assert.equal(
    sameAdmission.dev_promotion_admission_id,
    manualPromotionAdmission.dev_promotion_admission_id,
  );

  await assert.rejects(
    () =>
      preflight.beginPromotionAdmission({
        admission: buildManualAdmission({
          identity: manualIdentity,
          requestDigest: differentRequestIdentity.requestDigest,
        }),
        finalization: finalization(),
        queryFn: manualHarness.queryFn,
      }),
    (error) => error.code === 'R6_PROMOTION_IDEMPOTENCY_CONFLICT',
  );

  let assistantCall = null;
  const assistantResult = await assistantService.startDevelopmentPromotion({
    body: {
      commitMessage: 'Assistant promotion',
      finalizationWorkflowRunId: FINALIZATION_RUN_ID,
      idempotencyKey: 'assistant-request-1',
    },
    permissions: preflight.PROMOTION_REQUIRED_PERMISSION_CODES.map((permissionCode) => ({
      permissionCode,
    })),
    actor: { userId: null, displayName: 'SkyCommand Agent' },
    session: { sessionId: null, authMode: 'ASSISTANT_SERVICE_TOKEN' },
    context: { instructionRef: 'assistant-instruction-1' },
    agentId: 'codex-local',
    promotionValidator: async () => finalization(),
    workflowAgentExecution: {
      startWorkflow: async (request) => {
        assistantCall = request;
        return {
          accepted: true,
          reused: false,
          status: 'STARTED',
          admissionId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
          workflowRunRecordId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
          idempotency: { keyHash: DIGEST, requestDigest: 'B'.repeat(64) },
        };
      },
    },
  });
  assert.equal(assistantResult.finalizationWorkflowRunId, FINALIZATION_RUN_ID);
  assert.equal(assistantCall.request.idempotencyKey, 'assistant-request-1');
  assert.equal(assistantResult.trustedAttribution.instructionRef, 'assistant-instruction-1');

  const assistantAdmissionRow = buildAssistantAdmission({
    identity: {
      idempotencyKeyHash: assistantResult.idempotency.keyHash,
      requestDigest: assistantResult.idempotency.requestDigest,
    },
  });
  assert.equal(
    preflight.assertPromotionRunAuthorization(assistantAdmissionRow),
    'ASSISTANT_ADMISSION',
  );
  const assistantHarness = admissionInsertHarness();
  const assistantPromotionAdmission = await preflight.beginPromotionAdmission({
    admission: assistantAdmissionRow,
    finalization: finalization(),
    queryFn: assistantHarness.queryFn,
  });
  assert.equal(assistantPromotionAdmission.authorization_source, 'ASSISTANT_ADMISSION');
  assert.match(assistantPromotionAdmission.idempotency_key_hash, /^[A-F0-9]{64}$/);
  assert.match(assistantPromotionAdmission.request_digest, /^[A-F0-9]{64}$/);
  assert.equal(
    preflight.trustedAttribution(assistantAdmissionRow).instructionRef,
    'assistant-instruction-1',
  );

  const preflightSource = fs.readFileSync(
    path.join(ROOT, 'packages/dev-finalization/src/promotionPreflight.js'),
    'utf8',
  );
  const promotionMigration = fs.readFileSync(
    path.join(
      ROOT,
      'packages/db_build/src/migrations/00142__dev_promotion_r6_workflow_simplification.sql',
    ),
    'utf8',
  );
  assert.match(promotionMigration, /idempotency_key_hash TEXT NOT NULL/);
  assert.match(
    preflightSource,
    /COALESCE\(a\.idempotency_key_hash, r\.input #>> '\{promotionRequest,idempotencyKeyHash\}'\)/,
  );
  assert.match(preflightSource, /R6_PROMOTION_IDEMPOTENCY_INVALID/);

  console.log('[development-promotion-start:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
