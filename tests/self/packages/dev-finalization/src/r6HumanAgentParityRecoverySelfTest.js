const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../../../');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
require('dotenv').config({ path: path.join(repoRoot, '.env'), quiet: true });
const preflight = require(path.join(repoRoot, 'packages/dev-finalization/src/promotionPreflight'));

const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTION_ADMISSION_ID = '33333333-3333-4333-8333-333333333333';
const DIGEST = 'A'.repeat(64);

function humanAdmission(overrides = {}) {
  return {
    workflow_run_record_id: WORKFLOW_RUN_ID,
    workflow_definition_id: '44444444-4444-4444-8444-444444444444',
    workflow_version_id: '55555555-5555-4555-8555-555555555555',
    workflow_code: 'skyserver_dev_commit',
    version_number: 22,
    workflow_run_status: 'RUNNING',
    status: 'RUNNING',
    run_source: 'manual',
    trigger_type: 'MANUAL',
    started_by_user_id: USER_ID,
    workflow_execution_admission_id: null,
    repository_code: 'SkyCommand',
    environment_code: 'DOCKER_LOCAL',
    config_profile_code: 'DOCKER_LOCAL',
    validated_parameters: {
      repoName: 'SkyCommand',
      finalizationWorkflowRunId: '66666666-6666-4666-8666-666666666666',
    },
    actor_permission_codes: [...preflight.PROMOTION_REQUIRED_PERMISSION_CODES],
    request_context: {
      authorization: {
        source: 'HUMAN_UI',
        actorUserId: USER_ID,
        environmentCode: 'DOCKER_LOCAL',
        configProfileCode: 'DOCKER_LOCAL',
      },
    },
    ...overrides,
  };
}

function assistantAdmission(overrides = {}) {
  return {
    ...humanAdmission({
      run_source: 'assistant',
      trigger_type: 'ASSISTANT',
      started_by_user_id: null,
      workflow_execution_admission_id: EXECUTION_ADMISSION_ID,
      admission_status: 'STARTED',
      principal_code: 'assistant-http',
      principal_status: 'ACTIVE',
      grant_status: 'ACTIVE',
      grant_repository_code: 'SkyCommand',
      grant_workflow_code: 'skyserver_dev_commit',
      grant_environment_code: 'DOCKER_LOCAL',
      grant_config_profile_code: 'DOCKER_LOCAL',
      grant_permission_codes: [...preflight.PROMOTION_REQUIRED_PERMISSION_CODES],
      request_context: {
        executionContext: {
          principalId: EXECUTION_ADMISSION_ID,
          principalCode: 'assistant-http',
          authMode: 'ASSISTANT_SERVICE_TOKEN',
        },
      },
    }),
    ...overrides,
  };
}

async function testTerminalSettlementPreservesFailedAuthorization() {
  let updateSeen = false;
  const queryFn = async (sql) => {
    if (sql.startsWith('SELECT a.dev_promotion_admission_id')) {
      return {
        rows: [{
          dev_promotion_admission_id: '77777777-7777-4777-8777-777777777777',
          status: 'AUTHORIZED',
          workflow_run_record_id: WORKFLOW_RUN_ID,
          terminal_run_status: 'FAILED',
        }],
      };
    }
    if (sql.startsWith('UPDATE worker.dev_promotion_admissions')) {
      updateSeen = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 90)}`);
  };

  const result = await preflight.settlePromotionAdmission({ workflowRunRecordId: WORKFLOW_RUN_ID, queryFn });
  assert.equal(result.settled, false);
  assert.equal(result.reason, 'FAILED_ADMISSION_PRESERVED_FOR_RECOVERY');
  assert.equal(result.evidence.recoveryAuthorizationPreserved, true);
  assert.equal(updateSeen, false);
}

async function testPollingDoesNotDisableFailedAdmission() {
  let updateSeen = false;
  const queryFn = async (sql) => {
    if (sql.startsWith('SELECT a.workflow_run_record_id')) {
      return { rows: [{ workflow_run_record_id: WORKFLOW_RUN_ID, terminal_run_status: 'FAILED' }] };
    }
    if (sql.startsWith('SELECT a.dev_promotion_admission_id')) {
      return {
        rows: [{
          dev_promotion_admission_id: '77777777-7777-4777-8777-777777777777',
          status: 'AUTHORIZED',
          workflow_run_record_id: WORKFLOW_RUN_ID,
          terminal_run_status: 'FAILED',
        }],
      };
    }
    if (sql.startsWith('UPDATE worker.dev_promotion_admissions')) updateSeen = true;
    return { rows: [] };
  };

  const result = await preflight.reconcileActivePromotionAdmissions({
    repositoryCode: 'SkyCommand',
    environmentCode: 'DOCKER_LOCAL',
    configProfileCode: 'DOCKER_LOCAL',
  }, queryFn);
  assert.equal(result[0].reason, 'FAILED_ADMISSION_PRESERVED_FOR_RECOVERY');
  assert.equal(updateSeen, false);
}

async function run() {
  assert.equal(preflight.assertPromotionRunAuthorization(humanAdmission()), 'HUMAN_UI');
  assert.equal(preflight.assertPromotionRunAuthorization(assistantAdmission()), 'ASSISTANT_ADMISSION');

  assert.throws(
    () => preflight.assertPromotionRunAuthorization(humanAdmission({ actor_permission_codes: ['WORKFLOW_RUN'] })),
    (error) => error.code === 'R6_PROMOTION_AUTHORIZATION_INVALID',
  );
  assert.throws(
    () => preflight.assertPromotionRunAuthorization(humanAdmission({ request_context: {} })),
    (error) => error.code === 'R6_PROMOTION_AUTHORIZATION_INVALID',
  );
  assert.throws(
    () => preflight.assertPromotionRunAuthorization(assistantAdmission({ grant_config_profile_code: 'DEV_LOCAL' })),
    (error) => error.code === 'R6_PROMOTION_AUTHORIZATION_INVALID',
  );
  assert.throws(
    () => preflight.getPromotionAuthorizationScope(humanAdmission({ config_profile_code: '' })),
    (error) => error.code === 'R6_PROMOTION_SCOPE_INVALID',
  );

  const migration = read('packages/db_build/src/migrations/00146__r6_human_agent_parity_and_recovery.sql');
  assert.match(migration, /ALTER COLUMN workflow_execution_admission_id DROP NOT NULL/);
  assert.match(migration, /authorization_source/);
  assert.match(migration, /HUMAN_UI/);
  assert.match(migration, /ASSISTANT_ADMISSION/);

  const preflightSource = read('packages/dev-finalization/src/promotionPreflight.js');
  const executorSource = read('apps/api/src/services/workflowExecutorService.js');
  const agentSource = read('apps/api/src/services/workflowAgentExecutionService.js');
  const temporalSource = read('packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js');
  assert.match(preflightSource, /LEFT JOIN worker\.workflow_execution_admissions/);
  assert.match(preflightSource, /authorization_source/);
  assert.match(preflightSource, /sourceIdentityProfileCode: governanceScope\.configProfileCode/);
  assert.match(executorSource, /authorization: buildWorkflowRunAuthorization/);
  assert.match(executorSource, /permissionCodes: \[\.\.\.getPermissionSet\(permissions\)\]/);
  assert.doesNotMatch(agentSource, /reconcileActivePromotionAdmissions/);
  assert.equal((temporalSource.match(/settleDevPromotionAdmissionActivity/g) || []).length, 1);

  await testTerminalSettlementPreservesFailedAuthorization();
  await testPollingDoesNotDisableFailedAdmission();
  console.log('[r6-human-agent-parity-recovery:self-test] PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
