const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../../.env'), quiet: true });
const { sourceDirectoryForTest } = require('../../../../_support/sourceTestBootstrap.js');

const sourceDir = sourceDirectoryForTest(__filename);
const repoRoot = path.resolve(sourceDir, '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const acceptedR6 = read('packages/db_build/src/migrations/00142__dev_promotion_r6_workflow_simplification.sql');
const correction = read('packages/db_build/src/migrations/00143__github_dev_pr_merge_r6_correction.sql');
const nodeOrderCorrection = read('packages/db_build/src/migrations/00144__r6_promotion_node_order_correction.sql');
const preflightSource = read('packages/dev-finalization/src/promotionPreflight.js');
const commitSource = read('packages/git/src/dev_commit.js');
const workflowSource = read('packages/temporal/src/workflows/skyCommandWorkflowExecutorWorkflow.js');
const activitiesSource = read('packages/temporal/src/activities/skyCommandWorkflowActivities.js');
const hostActivities = read('packages/host-agent/src/activities.js');
const envExample = read('.env.example');

assert.equal(
  crypto.createHash('sha256').update(acceptedR6).digest('hex').toUpperCase(),
  'B6AF797D874E78A285D1533922A8F418717AA181F220EA54B6A57F3C664A7475',
);
assert.equal(
  crypto.createHash('sha256').update(correction).digest('hex').toUpperCase(),
  'CB10BF211C5521834B55EA97D6EEAC08C9B39988B7C096F85D2076082EF122A5',
);
assert.match(correction, /00143__github_dev_pr_merge_r6_correction/);
assert.match(correction, /GIT_DEV_PR_MERGE_RUN/);
assert.match(correction, /github_dev_pr_merge_summary\.v1/);
assert.match(correction, /github_dev_pr_merge_node/);
assert.match(correction, /version_number = 21/);
assert.match(correction, /version_number = 7/);
assert.match(correction, /local_repo_sync_node/);
assert.match(correction, /dev_promotion_summary/);
assert.match(correction, /old_from\.workflow_node_id/);
assert.match(correction, /old_to\.workflow_node_id/);
assert.match(correction, /requires_confirmation = FALSE/);
assert.doesNotMatch(correction, /DO\s+\$[A-Za-z0-9_]+\$/);
assert.doesNotMatch(correction, /(?<![A-Za-z0-9_])(?:COMMIT|ROLLBACK|START\s+TRANSACTION)(?![A-Za-z0-9_])/i);

assert.match(preflightSource, /skyserver_dev_commit:\s*22/);
assert.match(preflightSource, /skycommand-dev-promo-alt.*:\s*8/);
assert.match(preflightSource, /github_dev_pr_merge_node/);
assert.match(preflightSource, /R6_PROMOTION_REMOTE_MAIN_UNAVAILABLE/);
assert.match(preflightSource, /terminal_receipt/);
assert.match(preflightSource, /reconcileActivePromotionAdmissions/);
assert.match(commitSource, /validatePromotionCommitBoundary/);
assert.match(commitSource, /commitBoundary/);
assert.match(workflowSource, /settleDevPromotionAdmissionActivity/);
assert.match(activitiesSource, /settleDevPromotionAdmissionActivity/);
assert.match(hostActivities, /GITHUB_DEV_PR_MERGE_TOOL_CODE/);
assert.match(hostActivities, /executeGithubDevPrMerge/);
assert.match(envExample, /SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED=false/);
assert.match(envExample, /SKYCOMMAND_ASSISTANT_PERMISSION_CODES=BROWSER_AUTOMATION_READ,BROWSER_AUTOMATION_RUN/);

assert.match(nodeOrderCorrection, /expected_old_version := CASE[\s\S]*skyserver_dev_commit.*THEN 21[\s\S]*ELSE 7/);
assert.match(nodeOrderCorrection, /new_version_number := expected_old_version \+ 1/);
assert.match(nodeOrderCorrection, /display_order = display_order \+ display_shift/);
assert.match(nodeOrderCorrection, /WHEN 'github_dev_pr_merge_node' THEN commit_order \+ 1/);
assert.match(nodeOrderCorrection, /WHEN 'merge_sync_node' THEN commit_order \+ 2/);
assert.match(nodeOrderCorrection, /WHEN 'local_repo_sync_node' THEN commit_order \+ 3/);
assert.match(nodeOrderCorrection, /WHEN 'dev_promotion_summary' THEN commit_order \+ 4/);
assert.match(nodeOrderCorrection, /display_order = to_node\.display_order/);
assert.match(nodeOrderCorrection, /snapshot_nodes IS DISTINCT FROM live_nodes/);
assert.match(nodeOrderCorrection, /pinnedVersionNumber', 22/);
assert.doesNotMatch(nodeOrderCorrection, /DO\s+\$[A-Za-z0-9_]+\$/);
assert.doesNotMatch(nodeOrderCorrection, /(?<![A-Za-z0-9_])(?:COMMIT|ROLLBACK|START\s+TRANSACTION)(?![A-Za-z0-9_])/i);

async function testDurableSettlement() {
  const runId = '11111111-1111-4111-8111-111111111111';
  let updateSeen = false;
  const queryFn = async (sql) => {
    if (sql.startsWith('SELECT a.dev_promotion_admission_id')) {
      return {
        rows: [{
          dev_promotion_admission_id: '22222222-2222-4222-8222-222222222222',
          status: 'AUTHORIZED',
          workflow_run_record_id: runId,
          terminal_run_status: 'COMPLETED',
        }],
      };
    }
    if (sql.startsWith('UPDATE worker.dev_promotion_admissions')) {
      updateSeen = true;
      return { rows: [{ status: 'COMPLETED' }] };
    }
    throw new Error(`Unexpected settlement query: ${sql.slice(0, 80)}`);
  };
  const { settlePromotionAdmission } = require(path.join(repoRoot, 'packages/dev-finalization/src/promotionPreflight'));
  const result = await settlePromotionAdmission({ workflowRunRecordId: runId, queryFn });
  assert.equal(result.settled, true);
  assert.equal(result.evidence.terminalOutcome, 'COMPLETED');
  assert.equal(updateSeen, true);
}

testDurableSettlement()
  .then(() => console.log('[r6-correction:self-test] PASS'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
