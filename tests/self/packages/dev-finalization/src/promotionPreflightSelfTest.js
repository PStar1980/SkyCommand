const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../../../.env'), quiet: true });

const preflight = require('../../../../../packages/dev-finalization/src/promotionPreflight');

const DIGEST = 'A'.repeat(64);
const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';
const FINALIZATION_RUN_ID = '22222222-2222-4222-8222-222222222222';

function reviewedSourceIdentity() {
  return {
    algorithm: 'SHA-256_R5_SOURCE_IDENTITY',
    digest: DIGEST,
    baseRevision: 'a'.repeat(40),
    sourceMode: 'GIT',
    manifestDigest: DIGEST,
    sqlManifestDigest: DIGEST,
    configurationRevision: { digest: DIGEST },
    fileCount: 1,
    excludedGeneratedOutputs: true,
    files: [{ path: 'apps/api/src/index.js', bytes: 10, sha256: DIGEST }],
  };
}

function finalizationBinding() {
  return preflight.normalizeFinalizationBinding({
    finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    scope: {
      repositoryCode: 'SkyCommand',
      environmentCode: 'DOCKER_LOCAL',
      configProfileCode: 'DOCKER_LOCAL',
    },
    receipt: {
      receiptSha256: DIGEST,
      outcome: 'COMPLETE',
      validationOutcome: 'PASS',
      readinessOutcome: 'READY',
      database: {
        manifestDigest: DIGEST,
        databaseName: 'skyserver_dev',
        systemIdentifier: '7675201995714228267',
      },
    },
    reviewedSourceIdentity: reviewedSourceIdentity(),
  });
}

function testSourceValidationDependencies(sourceIdentity) {
  const databasePlan = {
    outcome: 'PLAN_READY',
    pendingCount: 0,
    pendingChanges: [],
    planDigest: { digest: DIGEST },
    manifestDigest: { digest: DIGEST },
    databaseIdentity: {
      databaseName: 'skyserver_dev',
      systemIdentifier: '7675201995714228267',
    },
  };
  return {
    loadBinding: async () => ({ repositoryRoot: 'C:/skycommand', repoId: 'repo-1' }),
    loadRepositoryMetadata: async () => ({
      repo_code: 'SkyCommand',
      repo_id: 'repo-1',
      remote_url: 'https://github.com/PStar1980/SkyCommand.git',
      dev_branch: 'dev',
      main_branch: 'main',
    }),
    readDatabasePlan: async () => databasePlan,
    buildSourceIdentity: async () => sourceIdentity,
    runGit: (_repositoryRoot, args) => {
      if (args[0] === 'branch') return 'dev';
      if (args[0] === 'rev-parse') return sourceIdentity.baseRevision;
      if (args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/heads/main`;
      return null;
    },
  };
}

function readyOutput() {
  return {
    outcome: 'READY',
    workflowRunRecordId: WORKFLOW_RUN_ID,
    finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    repository: {
      repositoryCode: 'SkyCommand',
      environmentCode: 'DEV_LOCAL',
      configProfileCode: 'DEV_LOCAL',
      devBranch: 'dev',
      mainBranch: 'main',
      expectedMainSha: 'b'.repeat(40),
      remoteUrl: 'https://github.com/PStar1980/SkyCommand.git',
      currentRevision: 'a'.repeat(40),
    },
    workflow: {
      workflowCode: 'skyserver_dev_commit',
      workflowVersionId: '33333333-3333-4333-8333-333333333333',
      versionNumber: 22,
      mergeApprovalRequired: false,
      agentMustStop: false,
      terminalObservationRequired: true,
    },
    principal: {
      principalCode: 'assistant-http',
      principalId: '44444444-4444-4444-8444-444444444444',
      authMode: 'SERVER',
      userId: null,
      sessionId: null,
      agentId: 'codex-local',
      instructionSource: 'ASSISTANT',
      instructionRef: 'r6-self-test',
      triggerSource: 'assistant',
      triggerType: 'ASSISTANT',
      requestedAt: '2026-09-18T00:00:00.000Z',
    },
    authorization: {
      promotionAdmissionId: '55555555-5555-4555-8555-555555555555',
      workflowExecutionAdmissionId: '66666666-6666-4666-8666-666666666666',
      idempotencyKeyHash: DIGEST,
      requestDigest: DIGEST,
      status: 'AUTHORIZED',
    },
    finalizationReceipt: {
      receiptSha256: DIGEST,
      outcome: 'COMPLETE',
      validationOutcome: 'PASS',
      readinessOutcome: 'READY',
    },
    sourceIdentity: {
      digest: DIGEST,
      baseRevision: 'a'.repeat(40),
      manifestDigest: DIGEST,
      sqlManifestDigest: DIGEST,
      configurationRevisionDigest: DIGEST,
      fileCount: 12,
      excludedGeneratedOutputs: true,
    },
    database: {
      outcome: 'NO_CHANGES',
      pendingCount: 0,
      pendingOrdinals: [],
      planDigest: DIGEST,
      manifestDigest: DIGEST,
      databaseName: 'skyserver_dev',
      systemIdentifier: '7675201995714228267',
    },
    checks: [{ code: 'SOURCE_IDENTITY', status: 'PASS' }],
    changedPaths: [],
    timing: {
      startedAt: '2026-09-18T00:00:00.000Z',
      completedAt: '2026-09-18T00:00:01.000Z',
      durationMs: 1000,
    },
    warnings: [],
    error: null,
  };
}

async function run() {
  assert.deepEqual(
    preflight.parseArguments(['SkyCommand', WORKFLOW_RUN_ID, FINALIZATION_RUN_ID]),
    {
      repositoryName: 'SkyCommand',
      workflowRunId: WORKFLOW_RUN_ID,
      finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    },
  );
  assert.throws(
    () => preflight.parseArguments(['SkyCommand', 'not-a-uuid', FINALIZATION_RUN_ID]),
    (error) => error.code === 'R6_PROMOTION_RUN_ID_INVALID',
  );
  assert.throws(
    () => preflight.parseArguments(['SkyCommand', WORKFLOW_RUN_ID]),
    (error) => error.code === 'R6_PROMOTION_PREFLIGHT_ARGUMENTS_INVALID',
  );

  assert.equal(preflight.isSqlPath('packages/db_build/src/migrations/00142__r6.sql'), true);
  assert.equal(preflight.isSqlPath('apps/api/src/services/assistantIntegrationService.js'), false);
  assert.deepEqual(preflight.publicSourceIdentity({ digest: DIGEST.toLowerCase(), fileCount: '4', excludedGeneratedOutputs: true }), {
    digest: DIGEST,
    baseRevision: null,
    manifestDigest: null,
    sqlManifestDigest: null,
    configurationRevisionDigest: null,
    fileCount: 4,
    excludedGeneratedOutputs: true,
  });

  const attribution = preflight.trustedAttribution({
    principal_code: 'server-principal',
    auth_mode: 'SERVER',
    started_by_user_id: null,
    run_source: 'assistant',
    trigger_type: 'ASSISTANT',
    created_at: '2026-09-18T00:00:00.000Z',
    request_context: {
      callerLabel: 'must-not-be-authority',
      executionContext: {
        principalId: '77777777-7777-4777-8777-777777777777',
        principalCode: 'server-principal',
        authMode: 'SERVER',
      },
      promotionAuthorization: {
        agentId: 'codex-local',
        instructionRef: 'r6-self-test',
        requestedAt: '2026-09-18T00:00:00.000Z',
      },
    },
  });
  assert.equal(attribution.principalCode, 'server-principal');
  assert.equal(attribution.agentId, 'codex-local');
  assert.equal(attribution.userId, null);
  assert.equal(attribution.sessionId, null);
  assert.equal(JSON.stringify(attribution).includes('must-not-be-authority'), false);

  const ready = preflight.createToolResult(readyOutput());
  assert.equal(ready.success, true);
  assert.equal(ready.outputType, 'dev_promotion_preflight_summary.v1');
  assert.equal(ready.output.outcome, 'READY');
  assert.equal(ready.output.workflow.versionNumber, 22);
  assert.equal(ready.output.workflow.mergeApprovalRequired, false);
  assert.equal(ready.output.principal.userId, null);

  const failure = preflight.createFailureToolResult({
    code: 'R6_PROMOTION_SOURCE_DRIFT',
    message: 'The reviewed source identity is no longer current.',
  });
  assert.equal(failure.success, false);
  assert.equal(failure.output.outcome, 'FAILED');
  assert.equal(failure.error.code, 'R6_PROMOTION_SOURCE_DRIFT');

  const binding = finalizationBinding();
  assert.equal(binding.reviewedSourceIdentity.digest, DIGEST);
  assert.equal(binding.reviewedSourceIdentity.files.length, 1);
  assert.equal('run' in binding, false);

  const legacyValidReceiptShape = {
    finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    scope: binding.scope,
    receipt: binding.receipt,
    sourceIdentity: binding.sourceIdentity,
  };
  await assert.rejects(
    () =>
      preflight.validateCurrentSource({
        finalization: legacyValidReceiptShape,
        environment: {
          SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL',
          SKYCOMMAND_ENVIRONMENT_CODE: 'DOCKER_LOCAL',
        },
        dependencies: testSourceValidationDependencies(reviewedSourceIdentity()),
        queryFn: async () => ({ rows: [] }),
      }),
    (error) =>
      error.code === 'R6_PROMOTION_FINALIZATION_SOURCE_IDENTITY_INVALID' &&
      !error.message.includes('TypeError'),
  );

  const current = await preflight.validateCurrentSource({
    finalization: binding,
    environment: {
      SKYCOMMAND_CONFIG_PROFILE: 'DOCKER_LOCAL',
      SKYCOMMAND_ENVIRONMENT_CODE: 'DOCKER_LOCAL',
    },
    dependencies: testSourceValidationDependencies(binding.reviewedSourceIdentity),
    queryFn: async () => ({ rows: [] }),
  });
  assert.equal(current.sourceIdentity.digest, DIGEST);
  assert.deepEqual(current.changedPaths, []);

  assert.throws(
    () =>
      preflight.normalizeFinalizationBinding({
        finalizationWorkflowRunId: FINALIZATION_RUN_ID,
        scope: binding.scope,
        receipt: binding.receipt,
        reviewedSourceIdentity: { digest: DIGEST },
      }),
    (error) =>
      error.code === 'R6_PROMOTION_FINALIZATION_SOURCE_IDENTITY_INVALID' &&
      !error.message.includes('TypeError'),
  );

  console.log('[r6-promotion-preflight:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
