const base = require('./workflowResultContext');

const GIT_DEV_PULL_OUTPUT_TYPE = 'git_dev_pull_summary.v1';

function getSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function findDevPullResult(nodeOutputsByKey = {}) {
  for (const [nodeKey, rawResult] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const result = getSafeObject(rawResult);

    if (!base.isToolResultEnvelope(result) || result.outputType !== GIT_DEV_PULL_OUTPUT_TYPE) {
      continue;
    }

    return {
      nodeKey,
      result,
      output: getSafeObject(base.getToolResultDomainOutput(result)),
    };
  }

  return null;
}

function compactDevPullOutput(result = {}) {
  const output = getSafeObject(base.getToolResultDomainOutput(result));

  return {
    outcome: output.outcome || null,
    repositoryCode: output.repositoryCode || null,
    devBranch: output.devBranch || null,
    currentHeadSha: output.currentHeadSha || output.localDevAfterSha || null,
    localDevBeforeSha: output.localDevBeforeSha || null,
    localDevAfterSha: output.localDevAfterSha || null,
    remoteDevAfterSha: output.remoteDevAfterSha || null,
    commitsPulled: normalizeNonNegativeNumber(output.commitsPulled),
    synchronized: Boolean(output.synchronized),
    workingTreeCleanAfter: Boolean(output.workingTreeCleanAfter),
    durationMs: base.getResultDurationMs(result, output),
  };
}

function compactDomainOutput(result = {}) {
  if (base.isToolResultEnvelope(result) && result.outputType === GIT_DEV_PULL_OUTPUT_TYPE) {
    return compactDevPullOutput(result);
  }

  return base.compactDomainOutput(result);
}

function buildSummaryKeyOutputs(nodeOutputsByKey = {}) {
  const summary = base.buildSummaryKeyOutputs(nodeOutputsByKey);

  for (const [nodeKey, rawResult] of Object.entries(getSafeObject(nodeOutputsByKey))) {
    const result = getSafeObject(rawResult);

    if (!base.isToolResultEnvelope(result) || result.outputType !== GIT_DEV_PULL_OUTPUT_TYPE) {
      continue;
    }

    if (summary[nodeKey]) {
      summary[nodeKey] = {
        ...summary[nodeKey],
        output: compactDevPullOutput(result),
      };
    }
  }

  return summary;
}

function buildDevPullStage(devPull) {
  const { nodeKey, result, output } = devPull;
  const commitsPulled = normalizeNonNegativeNumber(output.commitsPulled);
  const pulledHeadSha = output.currentHeadSha || output.localDevAfterSha || null;

  return {
    nodeKey,
    stageCode: 'LOCAL_DEV_PULL',
    label: 'Local development synchronization',
    status:
      result.success === false ? 'FAILED' : output.synchronized === false ? 'WARNING' : 'SUCCESS',
    outcome: output.outcome || null,
    summary: base.getResultSummary(result, output),
    outputType: result.outputType,
    durationMs: base.getResultDurationMs(result, output),
    evidence: `${commitsPulled} commit(s) pulled${pulledHeadSha ? ` · ${pulledHeadSha}` : ''}`,
  };
}

function buildStandaloneDevPullRollup(devPull) {
  const { nodeKey, result, output } = devPull;
  const stage = buildDevPullStage(devPull);
  const baselineSha = output.currentHeadSha || output.localDevAfterSha || null;
  const repositoryCode = output.repositoryCode || null;
  const repositoryName = output.repositoryName || repositoryCode;
  const developmentBranch = output.devBranch || null;

  return {
    outcome: result.success === false ? 'FAILED' : output.synchronized === false ? 'PARTIAL' : 'SYNCHRONIZED',
    repositoryCode,
    repositoryName,
    developmentBranch,
    mainBranch: null,
    pullRequestDirection: null,
    synchronizationDirection: null,
    developmentBaselineSource: 'LOCAL_DEV_PULL',
    developmentBaselineSha: baselineSha,
    devCommitSha: baselineSha,
    synchronizedHeadSha: null,
    changedFiles: 0,
    commitsPulled: normalizeNonNegativeNumber(output.commitsPulled),
    commitsApplied: 0,
    branchesSynchronized: false,
    executionStrategy: null,
    watcherSafe: true,
    localWorkspaceUpdated: false,
    localWorkspaceRefreshRequired: false,
    localRefreshCommand: null,
    localHostSyncRequired: false,
    deferredLocalBranches: [],
    localSyncCommandTemplate: null,
    localSyncCommand: null,
    localSyncInputs: null,
    localSyncCompleted: false,
    localSync: null,
    devPull: {
      nodeKey,
      outcome: output.outcome || null,
      devBranch: output.devBranch || null,
      localDevBeforeSha: output.localDevBeforeSha || null,
      localDevAfterSha: output.localDevAfterSha || null,
      remoteDevBeforeSha: output.remoteDevBeforeSha || null,
      remoteDevAfterSha: output.remoteDevAfterSha || null,
      currentHeadSha: baselineSha,
      commitsPulled: normalizeNonNegativeNumber(output.commitsPulled),
      synchronized: Boolean(output.synchronized),
      workingTreeCleanAfter: Boolean(output.workingTreeCleanAfter),
    },
    tagName: null,
    tagCreated: false,
    preflight: null,
    approval: null,
    artifacts: {
      repositoryMap: null,
      repositoryPackage: null,
    },
    durationMs: normalizeNonNegativeNumber(stage.durationMs),
    stages: [stage],
  };
}

function buildGitPromotionRollup(nodeOutputsByKey = {}) {
  const devPull = findDevPullResult(nodeOutputsByKey);
  const rollup = base.buildGitPromotionRollup(nodeOutputsByKey);

  if (!devPull) {
    return rollup;
  }

  if (!rollup) {
    return buildStandaloneDevPullRollup(devPull);
  }

  const { nodeKey, output } = devPull;
  const stage = buildDevPullStage(devPull);
  const baselineSha = output.currentHeadSha || output.localDevAfterSha || null;
  const repositoryCode = rollup.repositoryCode || output.repositoryCode || null;
  const repositoryName = rollup.repositoryName || output.repositoryName || repositoryCode;
  const developmentBranch = rollup.developmentBranch || output.devBranch || null;
  const mainBranch = rollup.mainBranch || null;
  const synchronizedHeadSha = rollup.synchronizedHeadSha || null;
  const stages = [stage, ...(Array.isArray(rollup.stages) ? rollup.stages : [])];
  const needsLocalSyncInputs =
    rollup.localHostSyncRequired && repositoryCode && baselineSha && synchronizedHeadSha;
  const escapedRepositoryCode = String(repositoryCode || '').replace(/"/g, '\\"');

  return {
    ...rollup,
    repositoryCode,
    repositoryName,
    developmentBranch,
    pullRequestDirection:
      developmentBranch && mainBranch ? `${developmentBranch} → ${mainBranch}` : rollup.pullRequestDirection,
    synchronizationDirection:
      mainBranch && developmentBranch ? `${mainBranch} → ${developmentBranch}` : rollup.synchronizationDirection,
    developmentBaselineSource: rollup.developmentBaselineSource || 'LOCAL_DEV_PULL',
    developmentBaselineSha: rollup.developmentBaselineSha || baselineSha,
    // Keep the historical field populated so existing renderers and local-sync consumers remain compatible.
    devCommitSha: rollup.devCommitSha || baselineSha,
    commitsPulled: normalizeNonNegativeNumber(output.commitsPulled),
    devPull: {
      nodeKey,
      outcome: output.outcome || null,
      devBranch: output.devBranch || null,
      localDevBeforeSha: output.localDevBeforeSha || null,
      localDevAfterSha: output.localDevAfterSha || null,
      remoteDevBeforeSha: output.remoteDevBeforeSha || null,
      remoteDevAfterSha: output.remoteDevAfterSha || null,
      currentHeadSha: baselineSha,
      commitsPulled: normalizeNonNegativeNumber(output.commitsPulled),
      synchronized: Boolean(output.synchronized),
      workingTreeCleanAfter: Boolean(output.workingTreeCleanAfter),
    },
    localSyncInputs: needsLocalSyncInputs
      ? {
          repoName: repositoryCode,
          expectedLocalDevSha: baselineSha,
          expectedSynchronizedHeadSha: synchronizedHeadSha,
        }
      : rollup.localSyncInputs,
    localSyncCommand: needsLocalSyncInputs
      ? `npm run repository:sync:local -- "${escapedRepositoryCode}" "${baselineSha}" "${synchronizedHeadSha}"`
      : rollup.localSyncCommand,
    durationMs:
      normalizeNonNegativeNumber(rollup.durationMs) + normalizeNonNegativeNumber(stage.durationMs),
    stages,
  };
}

function buildStructuredResultRollup(nodeOutputsByKey = {}) {
  const rollup = base.buildStructuredResultRollup(nodeOutputsByKey);

  return {
    ...rollup,
    gitPromotion: buildGitPromotionRollup(nodeOutputsByKey),
  };
}

function buildScheduledToolResultSummary(toolResult = {}) {
  const summary = base.buildScheduledToolResultSummary(toolResult);

  if (!summary || !base.isToolResultEnvelope(toolResult) || toolResult.outputType !== GIT_DEV_PULL_OUTPUT_TYPE) {
    return summary;
  }

  return {
    ...summary,
    gitDevPull: compactDevPullOutput(toolResult),
  };
}

module.exports = {
  GIT_DEV_PULL_OUTPUT_TYPE,
  buildGitPromotionRollup,
  buildScheduledToolResultSummary,
  buildStructuredResultRollup,
  buildSummaryKeyOutputs,
  compactDomainOutput,
};
