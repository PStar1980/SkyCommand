const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {
  GIT_LOCAL_SYNC_OUTPUT_TYPE,
  createGitLocalSyncFailureToolResult,
  createGitLocalSyncToolResult,
} = require('./gitLocalSyncResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');

function run() {
  const outputSchema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../tools/contracts/git_local_sync_summary.v1.schema.json'),
      'utf8',
    ),
  );
  const target = '2'.repeat(40);
  const baseline = '1'.repeat(40);
  const result = createGitLocalSyncToolResult({
    ok: true,
    outcome: 'SYNCHRONIZED',
    repositoryCode: 'SkyCommand',
    repositoryName: 'SkyCommand',
    repositoryRoot: 'C:/Projects/SkyCommand',
    profileCode: 'DEV_LOCAL',
    mainBranch: 'main',
    devBranch: 'dev',
    currentBranch: 'dev',
    expectedLocalDevSha: baseline,
    expectedSynchronizedHeadSha: target,
    devBaselineState: 'APPROVED_LINEAGE_INTERMEDIATE',
    localMainBeforeSha: baseline,
    localDevBeforeSha: baseline,
    remoteMainBeforeSha: target,
    remoteDevBeforeSha: target,
    localMainAfterSha: target,
    localDevAfterSha: target,
    remoteMainAfterSha: target,
    remoteDevAfterSha: target,
    stashCount: 1,
    workingTreeCleanBefore: true,
    workingTreeCleanAfter: true,
    mainRefUpdated: true,
    devRefUpdated: true,
    checkedOutBranchUpdated: true,
    fourWaySynchronized: true,
    safeguards: {
      hostProfileVerified: true,
      repositoryLockAcquired: true,
      gitOperationClear: true,
      workingTreeClean: true,
      worktreeOwnershipSafe: true,
      devBaselineMatched: true,
      remoteTargetMatched: true,
      localMainFastForwardSafe: true,
      localDevFastForwardSafe: true,
      remoteReverifiedBeforeMutation: true,
    },
    steps: {
      remoteInspected: true,
      fetched: true,
      mainRefUpdated: true,
      devRefUpdated: true,
      remoteReverified: true,
      postVerified: true,
    },
    durationMs: 100,
    performanceTelemetry: {
      instrumentedTotalMs: 85,
      phases: [
        { code: 'REMOTE_FETCH', label: 'Remote fetch / prune', durationMs: 55 },
        { code: 'POST_SYNC_REMOTE_VERIFICATION', label: 'Post-sync remote main/dev verification', durationMs: 30 },
      ],
    },
    transportTelemetry: {
      instrumentedTotalMs: 140,
      phases: [
        { code: 'TEMPORAL_CONNECTION', label: 'Temporal connection', durationMs: 10 },
        { code: 'HOST_WORKFLOW_DISPATCH_WAIT', label: 'Host workflow dispatch + wait', durationMs: 130 },
      ],
    },
  });

  assert.equal(result.outputType, GIT_LOCAL_SYNC_OUTPUT_TYPE);
  assert.equal(result.success, true);
  assert.equal(result.output.fourWaySynchronized, true);
  assert.equal(result.output.executionTarget, 'HOST');
  assert.equal(result.output.devBaselineState, 'APPROVED_LINEAGE_INTERMEDIATE');
  assert.equal(result.output.performanceTelemetry.instrumentedTotalMs, 85);
  assert.equal(result.output.performanceTelemetry.phases.length, 2);
  assert.equal(result.output.transportTelemetry.instrumentedTotalMs, 140);
  assert.equal(result.output.transportTelemetry.phases.length, 2);
  validateToolResult(result, {
    expectedOutputType: GIT_LOCAL_SYNC_OUTPUT_TYPE,
    outputSchema,
  });

  const blockedError = new Error('Local dev changed.');
  blockedError.code = 'LOCAL_REPOSITORY_SYNC_BLOCKED_LOCAL_DEV_CHANGED';
  blockedError.syncResult = {
    repositoryCode: 'SkyCommand',
    expectedLocalDevSha: baseline,
    expectedSynchronizedHeadSha: target,
  };
  const blocked = createGitLocalSyncFailureToolResult({ error: blockedError });
  assert.equal(blocked.success, false);
  assert.equal(blocked.output.outcome, 'BLOCKED');
  assert.equal(blocked.error.code, blockedError.code);
  validateToolResult(blocked, {
    expectedOutputType: GIT_LOCAL_SYNC_OUTPUT_TYPE,
    outputSchema,
  });

  const source = fs.readFileSync(path.resolve(__dirname, 'local_repo_sync.js'), 'utf8');
  assert.match(source, /DOCKER_LOCAL.*host-only|host-only.*DOCKER_LOCAL/s);
  assert.match(source, /status', '--porcelain=v1'/);
  assert.match(source, /worktree', 'list', '--porcelain'/);
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /APPROVED_LINEAGE_INTERMEDIATE/);
  assert.match(source, /classifyDevBaseline/);
  assert.match(source, /update-ref/);
  assert.match(source, /merge', '--ff-only'/);
  assert.match(source, /expectedLocalDevSha/);
  assert.match(source, /expectedSynchronizedHeadSha/);
  assert.match(source, /local-sync\.lock/);
  assert.match(source, /getRemoteBranchShas/);
  assert.match(source, /rev-parse', '--git-dir/);
  assert.doesNotMatch(source, /rev-parse', '--git-path/);
  assert.doesNotMatch(source, /reset', '--hard'/);
  assert.doesNotMatch(source, /clean', '-f/);
  assert.doesNotMatch(source, /branch', '-f/);
  assert.match(source, /HOST_WORKFLOW_DISPATCH_WAIT/);
  assert.match(source, /TEMPORAL_CONNECTION_SHUTDOWN/);
  assert.match(source, /transportTelemetry: transportSnapshot/);
  assert.match(source, /APPROVED_OBJECT_AVAILABILITY/);
  assert.match(source, /skipping redundant fetch/i);
  assert.match(source, /hasCommitObject\(expectedSynchronizedHeadSha/);
  assert.match(source, /state\.remoteMainBeforeSha \|\|= remoteMainImmediatelyBeforeMutation/);
  assert.match(source, /state\.safeguards\.remoteTargetMatched = true/);
  assert.match(source, /async function runCliEntrypoint/);
  assert.match(source, /process\.exit\(process\.exitCode \|\| 0\)/);
  assert.match(source, /flushWritableStream\(process\.stdout\)/);

  console.log('[SkyCommand] Guarded host Git local synchronization self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
