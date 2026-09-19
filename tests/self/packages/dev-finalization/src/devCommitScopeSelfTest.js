const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env'), quiet: true });

const preflight = require('../../../../../packages/dev-finalization/src/promotionPreflight');

const DIGEST = 'A'.repeat(64);
const OTHER_DIGEST = 'B'.repeat(64);
const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';
const FINALIZATION_RUN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_RUN_ID = '33333333-3333-4333-8333-333333333333';
const HOST_ENVIRONMENT = {
  SKYCOMMAND_CONFIG_PROFILE: 'DEV_LOCAL',
  SKYCOMMAND_ENVIRONMENT_CODE: 'DEV_LOCAL',
};

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

function sourceValidationDependencies(sourceIdentity, capture) {
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
    buildSourceIdentity: async (input) => {
      capture.identityProfileCode = input.identityProfileCode;
      return sourceIdentity;
    },
    runGit: (_repositoryRoot, args) => {
      if (args[0] === 'branch') return 'dev';
      if (args[0] === 'rev-parse') return sourceIdentity.baseRevision;
      if (args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/heads/main`;
      return null;
    },
  };
}

function fixture() {
  const finalization = finalizationBinding();
  const admission = {
    workflow_execution_admission_id: '44444444-4444-4444-8444-444444444444',
    workflow_run_record_id: WORKFLOW_RUN_ID,
    workflow_code: 'skyserver_dev_commit',
    workflow_version_id: '55555555-5555-4555-8555-555555555555',
    version_number: 22,
    workflow_run_status: 'RUNNING',
    admission_status: 'STARTED',
    run_source: 'assistant',
    trigger_type: 'ASSISTANT',
    principal_code: 'assistant-http',
    principal_status: 'ACTIVE',
    grant_status: 'ACTIVE',
    grant_repository_code: 'SkyCommand',
    grant_workflow_code: 'skyserver_dev_commit',
    grant_environment_code: 'DOCKER_LOCAL',
    grant_config_profile_code: 'DOCKER_LOCAL',
    grant_permission_codes: [...preflight.PROMOTION_REQUIRED_PERMISSION_CODES],
    repository_code: 'SkyCommand',
    environment_code: 'DOCKER_LOCAL',
    config_profile_code: 'DOCKER_LOCAL',
    validated_parameters: {
      repoName: 'SkyCommand',
      finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    },
  };
  const promotionAdmission = {
    dev_promotion_admission_id: '66666666-6666-4666-8666-666666666666',
    workflow_execution_admission_id: admission.workflow_execution_admission_id,
    workflow_run_record_id: WORKFLOW_RUN_ID,
    repository_code: 'SkyCommand',
    environment_code: 'DOCKER_LOCAL',
    config_profile_code: 'DOCKER_LOCAL',
    workflow_code: 'skyserver_dev_commit',
    workflow_version_id: admission.workflow_version_id,
    version_number: 22,
    finalization_workflow_run_record_id: FINALIZATION_RUN_ID,
    finalization_receipt_sha256: DIGEST,
    finalization_source_identity_digest: DIGEST,
    authorization_source: 'ASSISTANT_ADMISSION',
    status: 'AUTHORIZED',
  };
  return { finalization, admission, promotionAdmission, currentIdentity: reviewedSourceIdentity() };
}

async function runBoundary(state) {
  const capture = {};
  const result = await preflight.validatePromotionCommitBoundary({
    workflowRunId: WORKFLOW_RUN_ID,
    finalizationWorkflowRunId: FINALIZATION_RUN_ID,
    hostEnvironment: HOST_ENVIRONMENT,
    queryFn: async () => ({ rows: [] }),
    dependencies: {
      loadPromotionAdmission: async () => state.admission,
      loadDevPromotionAdmission: async () => state.promotionAdmission,
      assertFinalizationReceipt: async (input) => {
        capture.governanceScope = input.governanceScope;
        return state.finalization;
      },
      currentSourceDependencies: sourceValidationDependencies(state.currentIdentity, capture),
    },
  });
  return { result, capture };
}

async function expectCode(state, code) {
  await assert.rejects(
    () => runBoundary(state),
    (error) => error instanceof preflight.PromotionPreflightError && error.code === code,
  );
}

async function run() {
  const valid = fixture();
  const validResult = await runBoundary(valid);
  assert.equal(validResult.result.current.sourceIdentity.digest, DIGEST);
  assert.equal(validResult.result.current.binding.repositoryRoot, 'C:/skycommand');
  assert.equal(validResult.capture.identityProfileCode, 'DOCKER_LOCAL');
  assert.deepEqual(validResult.capture.governanceScope, {
    repositoryCode: 'SkyCommand',
    environmentCode: 'DOCKER_LOCAL',
    configProfileCode: 'DOCKER_LOCAL',
  });

  const mismatchedFinalization = fixture();
  mismatchedFinalization.promotionAdmission.finalization_workflow_run_record_id = OTHER_RUN_ID;
  await expectCode(mismatchedFinalization, 'R6_PROMOTION_COMMIT_BOUNDARY_INVALID');

  const mismatchedScope = fixture();
  mismatchedScope.promotionAdmission.config_profile_code = 'DEV_LOCAL';
  await expectCode(mismatchedScope, 'R6_PROMOTION_COMMIT_SCOPE_INVALID');

  const changedSource = fixture();
  changedSource.currentIdentity = { ...reviewedSourceIdentity(), digest: OTHER_DIGEST };
  await expectCode(changedSource, 'R6_PROMOTION_SOURCE_DRIFT');

  const unauthorized = fixture();
  unauthorized.promotionAdmission.status = 'PREFLIGHT_RUNNING';
  await expectCode(unauthorized, 'R6_PROMOTION_COMMIT_ADMISSION_UNAUTHORIZED');

  const unrelatedRepository = fixture();
  unrelatedRepository.admission.repository_code = 'OtherRepository';
  await expectCode(unrelatedRepository, 'R6_PROMOTION_COMMIT_ADMISSION_INVALID');

  const unrelatedProfile = fixture();
  unrelatedProfile.promotionAdmission.config_profile_code = 'OTHER_LOCAL';
  await expectCode(unrelatedProfile, 'R6_PROMOTION_COMMIT_SCOPE_INVALID');

  console.log('[r6-dev-commit-scope:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
