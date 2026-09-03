#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  GIT_DEV_PULL_OUTPUT_TYPE,
  createGitDevPullFailureToolResult,
  createGitDevPullToolResult,
} = require('./gitDevPullResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');

function run() {
  const before = '1'.repeat(40);
  const after = '2'.repeat(40);
  const outputSchema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../tools/contracts/git_dev_pull_summary.v1.schema.json'),
      'utf8',
    ),
  );

  const result = createGitDevPullToolResult({
    repositoryCode: 'SkyCommand',
    repositoryName: 'SkyCommand',
    repositoryRoot: 'C:\\Development\\SkyCommand',
    profileCode: 'DEV_LOCAL',
    remote: 'origin',
    devBranch: 'dev',
    currentBranch: 'dev',
    localDevBeforeSha: before,
    remoteDevBeforeSha: after,
    fetchedRemoteDevSha: after,
    localDevAfterSha: after,
    remoteDevAfterSha: after,
    currentHeadSha: after,
    commitsPulled: 2,
    commits: [
      { sha: after, subject: 'Add guarded local dev pull' },
      { sha: '3'.repeat(40), subject: 'Wire Host Agent transport' },
    ],
    stashCount: 0,
    workingTreeCleanBefore: true,
    workingTreeCleanAfter: true,
    synchronized: true,
    safeguards: {
      hostProfileVerified: true,
      repositoryLockAcquired: true,
      gitOperationClear: true,
      workingTreeClean: true,
      devBranchCheckedOut: true,
      worktreeOwnershipSafe: true,
      remoteDevAhead: true,
      fastForwardSafe: true,
      localStateReverifiedBeforeMutation: true,
      remoteReverifiedBeforeMutation: true,
      finalRemoteEqualityVerified: true,
    },
    steps: {
      remoteInspected: true,
      fetched: true,
      lineageVerified: true,
      remoteReverified: true,
      fastForwardMerged: true,
      postVerified: true,
    },
    durationMs: 250,
  });

  assert.equal(result.outputType, GIT_DEV_PULL_OUTPUT_TYPE);
  assert.equal(result.success, true);
  assert.equal(result.output.operationKind, 'LOCAL_DEV_PULL');
  assert.equal(result.output.executionTarget, 'HOST');
  assert.equal(result.output.currentHeadSha, after);
  assert.equal(result.output.commitsPulled, 2);
  assert.equal(result.output.synchronized, true);
  validateToolResult(result, {
    expectedOutputType: GIT_DEV_PULL_OUTPUT_TYPE,
    outputSchema,
  });

  const blockedError = new Error('origin/dev is not ahead.');
  blockedError.code = 'LOCAL_DEV_PULL_BLOCKED_REMOTE_NOT_AHEAD';
  blockedError.syncResult = {
    repositoryCode: 'SkyCommand',
    devBranch: 'dev',
    localDevBeforeSha: before,
    remoteDevBeforeSha: before,
  };
  const blocked = createGitDevPullFailureToolResult({ error: blockedError });
  assert.equal(blocked.success, false);
  assert.equal(blocked.output.outcome, 'BLOCKED');
  assert.equal(blocked.error.code, blockedError.code);
  validateToolResult(blocked, {
    expectedOutputType: GIT_DEV_PULL_OUTPUT_TYPE,
    outputSchema,
  });

  const source = fs.readFileSync(path.resolve(__dirname, 'local_dev_pull.js'), 'utf8');
  assert.match(source, /DOCKER_LOCAL.*host-only|host-only.*DOCKER_LOCAL/s);
  assert.match(source, /status', '--porcelain=v1'/);
  assert.match(source, /worktree', 'list', '--porcelain'/);
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /REMOTE_NOT_AHEAD/);
  assert.match(source, /LOCAL_DEV_AHEAD/);
  assert.match(source, /DEV_DIVERGED/);
  assert.match(source, /merge', '--ff-only'/);
  assert.match(source, /ls-remote', '--heads'/);
  assert.match(source, /local-sync\.lock/);
  assert.match(source, /REMOTE_CHANGED_DURING_PULL/);
  assert.match(source, /LOCAL_DEV_PULL_REMOTE_MOVED_AFTER_SYNC/);
  assert.match(source, /skyCommandHostAgentToolWorkflow/);
  assert.match(source, /HOST_WORKFLOW_DISPATCH_WAIT/);
  assert.doesNotMatch(source, /reset', '--hard'/);
  assert.doesNotMatch(source, /clean', '-f/);
  assert.doesNotMatch(source, /checkout', '-f/);
  assert.doesNotMatch(source, /branch', '-f/);
  assert.doesNotMatch(source, /stash', 'push/);

  console.log('[SkyCommand] Guarded Local Dev Pull self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
