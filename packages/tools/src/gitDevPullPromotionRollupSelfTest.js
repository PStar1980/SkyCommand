const assert = require('node:assert/strict');
const {
  buildGitPromotionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
  compactDomainOutput,
} = require('./gitDevPullPromotionRollup');

function toolResult(outputType, output, toolCode, durationMs = 100) {
  return {
    schemaVersion: '1.0',
    success: true,
    message: `${toolCode} completed successfully.`,
    outputType,
    output,
    warnings: [],
    error: null,
    metadata: {},
    kind: 'tool_execution',
    toolCode,
    status: 'SUCCESS',
    durationMs,
    executionId: `${toolCode}-execution`,
  };
}

function run() {
  const pulledHead = '2'.repeat(40);
  const synchronizedHead = '3'.repeat(40);
  const devPull = toolResult(
    'git_dev_pull_summary.v1',
    {
      operationKind: 'LOCAL_DEV_PULL',
      outcome: 'SYNCHRONIZED',
      repositoryCode: 'SkyCommand',
      repositoryName: 'SkyCommand',
      devBranch: 'dev',
      localDevBeforeSha: '1'.repeat(40),
      localDevAfterSha: pulledHead,
      remoteDevBeforeSha: pulledHead,
      remoteDevAfterSha: pulledHead,
      currentHeadSha: pulledHead,
      commitsPulled: 3,
      synchronized: true,
      workingTreeCleanAfter: true,
      durationMs: 250,
    },
    'local_dev_pull',
    250,
  );
  const branchSync = toolResult(
    'git_branch_sync_summary.v1',
    {
      outcome: 'SYNCHRONIZED',
      repositoryCode: 'SkyCommand',
      repositoryName: 'SkyCommand',
      sourceBranch: 'main',
      targetBranch: 'dev',
      synchronizedHeadSha: synchronizedHead,
      devHeadAfterSha: synchronizedHead,
      commitsApplied: 1,
      branchesSynchronized: true,
      localHostSyncRequired: true,
      deferredLocalBranches: ['main', 'dev'],
      durationMs: 500,
    },
    'main_merge',
    500,
  );
  const localSync = toolResult(
    'git_local_sync_summary.v1',
    {
      outcome: 'SYNCHRONIZED',
      repositoryCode: 'SkyCommand',
      expectedLocalDevSha: pulledHead,
      expectedSynchronizedHeadSha: synchronizedHead,
      localMainAfterSha: synchronizedHead,
      localDevAfterSha: synchronizedHead,
      remoteMainAfterSha: synchronizedHead,
      remoteDevAfterSha: synchronizedHead,
      fourWaySynchronized: true,
      workingTreeCleanAfter: true,
      durationMs: 200,
    },
    'local_repo_sync',
    200,
  );

  const compact = compactDomainOutput(devPull);
  assert.equal(compact.currentHeadSha, pulledHead);
  assert.equal(compact.commitsPulled, 3);
  assert.equal(compact.synchronized, true);

  const keyOutputs = buildSummaryKeyOutputs({ local_dev_pull_node: devPull });
  assert.equal(keyOutputs.local_dev_pull_node.output.currentHeadSha, pulledHead);
  assert.equal(keyOutputs.local_dev_pull_node.output.commitsPulled, 3);

  const standalone = buildGitPromotionRollup({ local_dev_pull_node: devPull });
  assert.equal(standalone.outcome, 'SYNCHRONIZED');
  assert.equal(standalone.developmentBaselineSource, 'LOCAL_DEV_PULL');
  assert.equal(standalone.devCommitSha, pulledHead);
  assert.equal(standalone.stages[0].stageCode, 'LOCAL_DEV_PULL');

  const promotion = buildGitPromotionRollup({
    local_dev_pull_node: devPull,
    merge_sync_node: branchSync,
    local_repo_sync_node: localSync,
  });
  assert.equal(promotion.outcome, 'PROMOTED');
  assert.equal(promotion.repositoryCode, 'SkyCommand');
  assert.equal(promotion.developmentBaselineSource, 'LOCAL_DEV_PULL');
  assert.equal(promotion.developmentBaselineSha, pulledHead);
  assert.equal(promotion.devCommitSha, pulledHead);
  assert.equal(promotion.commitsPulled, 3);
  assert.equal(promotion.devPull.synchronized, true);
  assert.equal(promotion.stages[0].stageCode, 'LOCAL_DEV_PULL');
  assert.equal(promotion.localSyncCompleted, true);

  const structured = buildStructuredResultRollup({
    local_dev_pull_node: devPull,
    merge_sync_node: branchSync,
    local_repo_sync_node: localSync,
  });
  assert.equal(structured.outputTypes['git_dev_pull_summary.v1'], 1);
  assert.equal(structured.gitPromotion.outcome, 'PROMOTED');
  assert.equal(structured.gitPromotion.commitsPulled, 3);

  const scheduled = buildScheduledToolResultSummary(devPull);
  assert.equal(scheduled.gitDevPull.currentHeadSha, pulledHead);
  assert.equal(scheduled.gitDevPull.commitsPulled, 3);

  console.log('[SkyCommand] Git Dev Pull promotion rollup self-test passed.');
}

run();
