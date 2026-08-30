const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {
  GIT_BRANCH_SYNC_OUTPUT_TYPE,
  createGitBranchSyncFailureToolResult,
  createGitBranchSyncToolResult,
} = require('./gitBranchSyncResult');
const { validateToolResult } = require('../../tools/src/toolResultContract');

function run() {
  const outputSchema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../tools/contracts/git_branch_sync_summary.v1.schema.json'),
      'utf8',
    ),
  );
  const synchronized = createGitBranchSyncToolResult({
    ok: true,
    outcome: 'SYNCHRONIZED',
    repositoryCode: 'SkyCommand',
    repositoryName: 'SkyCommand',
    repositoryRoot: 'C:/Projects/SkyCommand',
    executionStrategy: 'CHECKOUT_FREE_REMOTE_SYNC',
    watcherSafe: true,
    currentBranch: 'dev',
    localHeadBeforeSha: '3'.repeat(40),
    localHeadAfterSha: '2'.repeat(40),
    mainBranch: 'main',
    devBranch: 'dev',
    sourceBranch: 'main',
    targetBranch: 'dev',
    mainHeadBeforeSha: '1'.repeat(40),
    mainHeadSha: '2'.repeat(40),
    localDevHeadBeforeSha: '3'.repeat(40),
    remoteDevHeadBeforeSha: '3'.repeat(40),
    remoteDevHeadAfterSha: '2'.repeat(40),
    devHeadBeforePullSha: '3'.repeat(40),
    devHeadBeforeSha: '3'.repeat(40),
    devHeadAfterSha: '2'.repeat(40),
    commitsApplied: 1,
    devAdvanced: true,
    branchesSynchronized: true,
    localMainRefUpdated: true,
    localDevRefUpdated: true,
    localWorkspaceUpdated: true,
    localWorkspaceRefreshRequired: false,
    localRefreshCommand: null,
    durationMs: 250,
    fetched: true,
    mainBranchSelected: true,
    mainBranchPulled: true,
    devBranchSelected: true,
    devBranchPulled: true,
    fastForwardMerged: true,
    mainBranchPushed: true,
    devBranchPushed: true,
    remoteFastForwardVerified: true,
    profileCode: 'DOCKER_LOCAL',
    executionTarget: 'DOCKER',
    transport: 'git_cli',
    performanceTelemetry: {
      instrumentedTotalMs: 120,
      phases: [
        { code: 'REMOTE_HEAD_INSPECTION', label: 'Remote main/dev head inspection', durationMs: 40 },
        { code: 'REMOTE_DEV_PUSH', label: 'Remote development fast-forward', durationMs: 80 },
      ],
    },
    transportTelemetry: {
      instrumentedTotalMs: 150,
      processUptimeAtStartMs: 20,
      processUptimeAtCompleteMs: 170,
      phases: [
        { code: 'HOST_WORKFLOW_DISPATCH_WAIT', label: 'Host workflow dispatch + wait', durationMs: 150 },
      ],
    },
  });

  assert.equal(synchronized.outputType, GIT_BRANCH_SYNC_OUTPUT_TYPE);
  assert.equal(synchronized.success, true);
  assert.equal(synchronized.output.outcome, 'SYNCHRONIZED');
  assert.equal(synchronized.output.commitsApplied, 1);
  assert.equal(synchronized.output.branchesSynchronized, true);
  assert.equal(synchronized.output.executionStrategy, 'CHECKOUT_FREE_REMOTE_SYNC');
  assert.equal(synchronized.output.watcherSafe, true);
  assert.equal(synchronized.output.localWorkspaceRefreshRequired, false);
  assert.equal(synchronized.output.synchronizedHeadSha, '2'.repeat(40));
  assert.equal(synchronized.output.performanceTelemetry.instrumentedTotalMs, 120);
  assert.equal(synchronized.output.performanceTelemetry.phases.length, 2);
  assert.equal(synchronized.output.transportTelemetry.instrumentedTotalMs, 150);
  assert.equal(synchronized.output.transportTelemetry.processUptimeAtStartMs, 20);
  assert.equal(synchronized.metadata.executionTarget, 'DOCKER');
  assert.equal(synchronized.metadata.transport, 'git_cli');
  validateToolResult(synchronized, {
    expectedOutputType: GIT_BRANCH_SYNC_OUTPUT_TYPE,
    outputSchema,
  });

  const deferredHostSync = createGitBranchSyncToolResult({
    ok: true,
    outcome: 'SYNCHRONIZED',
    repositoryCode: 'SkyCommand',
    repositoryName: 'SkyCommand',
    repositoryRoot: '/workspace/SkyEco System/SkyCommand System/SkyCommand',
    executionStrategy: 'CHECKOUT_FREE_REMOTE_SYNC',
    watcherSafe: true,
    mainBranch: 'main',
    devBranch: 'dev',
    sourceBranch: 'main',
    targetBranch: 'dev',
    synchronizedHeadSha: '2'.repeat(40),
    branchesSynchronized: true,
    localWorkspaceUpdated: false,
    localWorkspaceRefreshRequired: false,
    localHostSyncRequired: true,
    deferredLocalBranches: ['main', 'dev'],
    localSyncCommandTemplate:
      'npm run repository:sync:local -- SkyCommand <expectedLocalDevSha> ' + '2'.repeat(40),
  });
  assert.equal(deferredHostSync.success, true);
  assert.equal(deferredHostSync.output.localHostSyncRequired, true);
  assert.deepEqual(deferredHostSync.output.deferredLocalBranches, ['main', 'dev']);
  assert.match(deferredHostSync.output.localSyncCommandTemplate, /expectedLocalDevSha/);
  validateToolResult(deferredHostSync, {
    expectedOutputType: GIT_BRANCH_SYNC_OUTPUT_TYPE,
    outputSchema,
  });

  const tagged = createGitBranchSyncToolResult({
    ok: true,
    outcome: 'TAGGED',
    repositoryCode: 'SkyCommand',
    sourceBranch: 'main',
    targetBranch: 'dev',
    tagName: 'v1.0.0',
    tagCreated: true,
    tagsPushed: true,
  });
  assert.equal(tagged.output.tagCreated, true);
  assert.match(tagged.message, /v1\.0\.0/);

  const mainMergeSource = fs.readFileSync(path.resolve(__dirname, 'main_merge.js'), 'utf8');
  assert.match(mainMergeSource, /rev-list', '--left-right', '--count'/);
  assert.match(mainMergeSource, /executeMainMergeViaHostAgent/);
  assert.match(mainMergeSource, /executeMainMergeRouted/);
  assert.doesNotMatch(mainMergeSource, /merge-base', '--is-ancestor'/);
  assert.doesNotMatch(mainMergeSource, /rev-list', '--count'/);

  const failure = createGitBranchSyncFailureToolResult({
    error: new Error('Fast-forward failed.'),
    startedAt: '2026-07-17T20:00:00.000Z',
    completedAt: '2026-07-17T20:00:01.000Z',
  });
  assert.equal(failure.success, false);
  assert.equal(failure.output.outcome, 'FAILED');
  assert.equal(failure.error.code, 'MAIN_BRANCH_SYNC_FAILED');

  console.log('[SkyCommand] Git branch synchronization result self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
