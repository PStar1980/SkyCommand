const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');
const { normalizePerformanceTelemetry } = require('./gitPerformanceTelemetry');

const GIT_BRANCH_SYNC_OUTPUT_TYPE = 'git_branch_sync_summary.v1';

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullable(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeError(error) {
  return error
    ? {
        code: String(error.code || 'MAIN_BRANCH_SYNC_FAILED'),
        message: String(error.message || error),
      }
    : null;
}

function createGitBranchSyncToolResult(result = {}) {
  const success = result.ok !== false;
  const performanceTelemetry = normalizePerformanceTelemetry(result.performanceTelemetry);
  const outcome = String(
    result.outcome || (success ? 'SYNCHRONIZED' : 'FAILED'),
  ).toUpperCase();
  const repositoryLabel = result.repositoryCode || result.repositoryName || 'repository';
  const sourceBranch = result.sourceBranch || result.mainBranch || 'main';
  const targetBranch = result.targetBranch || result.devBranch || 'dev';
  const message = success
    ? outcome === 'ALREADY_SYNCHRONIZED'
      ? `${repositoryLabel} ${sourceBranch} and ${targetBranch} were already synchronized.`
      : result.tagCreated
        ? `${repositoryLabel} ${sourceBranch} was synchronized into ${targetBranch} and tag ${result.tagName} was pushed.`
        : `${repositoryLabel} ${sourceBranch} was synchronized into ${targetBranch} successfully.`
    : `${repositoryLabel} branch synchronization failed.`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GIT_BRANCH_SYNC_OUTPUT_TYPE,
    output: {
      operationKind: 'MAIN_TO_DEV_SYNC',
      executionStrategy: String(result.executionStrategy || 'CHECKOUT_FREE_REMOTE_SYNC'),
      watcherSafe: result.watcherSafe !== false,
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      repositoryRoot: nullable(result.repositoryRoot),
      remote: String(result.remote || 'origin'),
      sourceBranch: nullable(sourceBranch),
      targetBranch: nullable(targetBranch),
      mainBranch: nullable(result.mainBranch || sourceBranch),
      devBranch: nullable(result.devBranch || targetBranch),
      currentBranch: nullable(result.currentBranch),
      localHeadBeforeSha: nullable(result.localHeadBeforeSha),
      localHeadAfterSha: nullable(result.localHeadAfterSha),
      mainHeadBeforeSha: nullable(result.mainHeadBeforeSha),
      mainHeadSha: nullable(result.mainHeadSha),
      localDevHeadBeforeSha: nullable(result.localDevHeadBeforeSha),
      remoteDevHeadBeforeSha: nullable(result.remoteDevHeadBeforeSha || result.devHeadBeforeSha),
      remoteDevHeadAfterSha: nullable(result.remoteDevHeadAfterSha || result.devHeadAfterSha),
      devHeadBeforePullSha: nullable(result.devHeadBeforePullSha),
      devHeadBeforeSha: nullable(result.devHeadBeforeSha),
      devHeadAfterSha: nullable(result.devHeadAfterSha),
      synchronizedHeadSha: nullable(result.synchronizedHeadSha || result.devHeadAfterSha),
      commitsApplied: normalizeNumber(result.commitsApplied),
      devAdvanced: Boolean(result.devAdvanced),
      branchesSynchronized: Boolean(result.branchesSynchronized),
      localMainRefUpdated: Boolean(result.localMainRefUpdated),
      localDevRefUpdated: Boolean(result.localDevRefUpdated),
      localWorkspaceUpdated: Boolean(result.localWorkspaceUpdated),
      localWorkspaceRefreshRequired: Boolean(result.localWorkspaceRefreshRequired),
      localRefreshCommand: nullable(result.localRefreshCommand),
      localHostSyncRequired: Boolean(result.localHostSyncRequired),
      deferredLocalBranches: Array.isArray(result.deferredLocalBranches)
        ? result.deferredLocalBranches.map(String)
        : [],
      localSyncCommandTemplate: nullable(result.localSyncCommandTemplate),
      tagName: nullable(result.tagName),
      tagCreated: Boolean(result.tagCreated),
      startedAt: nullable(result.startedAt),
      completedAt: nullable(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
      ...(performanceTelemetry ? { performanceTelemetry } : {}),
      steps: {
        fetched: Boolean(result.fetched),
        mainBranchSelected: Boolean(result.mainBranchSelected),
        mainBranchPulled: Boolean(result.mainBranchPulled),
        devBranchSelected: Boolean(result.devBranchSelected),
        devBranchPulled: Boolean(result.devBranchPulled),
        fastForwardMerged: Boolean(result.fastForwardMerged),
        mainBranchPushed: Boolean(result.mainBranchPushed),
        devBranchPushed: Boolean(result.devBranchPushed),
        remoteFastForwardVerified: Boolean(result.remoteFastForwardVerified),
        localMainRefUpdated: Boolean(result.localMainRefUpdated),
        localDevRefUpdated: Boolean(result.localDevRefUpdated),
        localWorkspaceUpdated: Boolean(result.localWorkspaceUpdated),
        tagCreated: Boolean(result.tagCreated),
        tagsPushed: Boolean(result.tagsPushed),
      },
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      profileCode: nullable(result.profileCode),
      transport: String(result.transport || 'git_cli'),
      executionTarget: nullable(result.executionTarget),
    },
  });
}

function createGitBranchSyncFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;

  return createGitBranchSyncToolResult({
    ok: false,
    outcome: 'FAILED',
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    error,
  });
}

module.exports = {
  GIT_BRANCH_SYNC_OUTPUT_TYPE,
  createGitBranchSyncFailureToolResult,
  createGitBranchSyncToolResult,
};
