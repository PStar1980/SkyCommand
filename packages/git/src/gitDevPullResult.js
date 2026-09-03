const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');
const { normalizePerformanceTelemetry } = require('./gitPerformanceTelemetry');

const GIT_DEV_PULL_OUTPUT_TYPE = 'git_dev_pull_summary.v1';

function nullable(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeError(error) {
  return error
    ? {
        code: String(error.code || 'LOCAL_DEV_PULL_FAILED'),
        message: String(error.message || error),
      }
    : null;
}

function normalizeSafeguards(value = {}) {
  return {
    hostProfileVerified: Boolean(value.hostProfileVerified),
    repositoryLockAcquired: Boolean(value.repositoryLockAcquired),
    gitOperationClear: Boolean(value.gitOperationClear),
    workingTreeClean: Boolean(value.workingTreeClean),
    devBranchCheckedOut: Boolean(value.devBranchCheckedOut),
    worktreeOwnershipSafe: Boolean(value.worktreeOwnershipSafe),
    remoteDevAhead: Boolean(value.remoteDevAhead),
    fastForwardSafe: Boolean(value.fastForwardSafe),
    localStateReverifiedBeforeMutation: Boolean(value.localStateReverifiedBeforeMutation),
    remoteReverifiedBeforeMutation: Boolean(value.remoteReverifiedBeforeMutation),
    finalRemoteEqualityVerified: Boolean(value.finalRemoteEqualityVerified),
  };
}

function normalizeSteps(value = {}) {
  return {
    remoteInspected: Boolean(value.remoteInspected),
    fetched: Boolean(value.fetched),
    lineageVerified: Boolean(value.lineageVerified),
    remoteReverified: Boolean(value.remoteReverified),
    fastForwardMerged: Boolean(value.fastForwardMerged),
    postVerified: Boolean(value.postVerified),
  };
}

function normalizeCommits(value = []) {
  return (Array.isArray(value) ? value : []).map((commit) => ({
    sha: String(commit?.sha || ''),
    subject: String(commit?.subject || ''),
  }));
}

function createGitDevPullToolResult(result = {}) {
  const success = result.ok !== false;
  const outcome = String(result.outcome || (success ? 'SYNCHRONIZED' : 'FAILED')).toUpperCase();
  const repositoryLabel = result.repositoryCode || result.repositoryName || 'repository';
  const devBranch = result.devBranch || 'dev';
  const performanceTelemetry = normalizePerformanceTelemetry(result.performanceTelemetry);
  const transportTelemetry = normalizePerformanceTelemetry(result.transportTelemetry);
  const message = success
    ? `${repositoryLabel} local ${devBranch} was safely fast-forwarded to origin/${devBranch} (${normalizeNumber(result.commitsPulled)} commit${normalizeNumber(result.commitsPulled) === 1 ? '' : 's'}).`
    : outcome === 'BLOCKED'
      ? `${repositoryLabel} local ${devBranch} pull was blocked by a safety guardrail.`
      : `${repositoryLabel} local ${devBranch} pull failed.`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GIT_DEV_PULL_OUTPUT_TYPE,
    output: {
      operationKind: 'LOCAL_DEV_PULL',
      executionTarget: 'HOST',
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      repositoryRoot: nullable(result.repositoryRoot),
      profileCode: nullable(result.profileCode),
      remote: String(result.remote || 'origin'),
      devBranch: nullable(devBranch),
      currentBranch: nullable(result.currentBranch),
      localDevBeforeSha: nullable(result.localDevBeforeSha),
      remoteDevBeforeSha: nullable(result.remoteDevBeforeSha),
      fetchedRemoteDevSha: nullable(result.fetchedRemoteDevSha),
      localDevAfterSha: nullable(result.localDevAfterSha),
      remoteDevAfterSha: nullable(result.remoteDevAfterSha),
      currentHeadSha: nullable(result.currentHeadSha || result.localDevAfterSha),
      commitsPulled: normalizeNumber(result.commitsPulled),
      commits: normalizeCommits(result.commits),
      stashCount: normalizeNumber(result.stashCount),
      workingTreeCleanBefore: Boolean(result.workingTreeCleanBefore),
      workingTreeCleanAfter: Boolean(result.workingTreeCleanAfter),
      synchronized: Boolean(result.synchronized),
      safeguards: normalizeSafeguards(result.safeguards),
      steps: normalizeSteps(result.steps),
      startedAt: nullable(result.startedAt),
      completedAt: nullable(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
      ...(performanceTelemetry ? { performanceTelemetry } : {}),
      ...(transportTelemetry ? { transportTelemetry } : {}),
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      profileCode: nullable(result.profileCode),
      transport: String(result.transport || 'git_cli'),
      executionTarget: 'HOST',
    },
  });
}

function createGitDevPullFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;
  const state = error?.syncResult || {};

  return createGitDevPullToolResult({
    ...state,
    ok: false,
    outcome: error?.code?.startsWith('LOCAL_DEV_PULL_BLOCKED_') ? 'BLOCKED' : 'FAILED',
    startedAt: state.startedAt || beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    transportTelemetry: state.transportTelemetry || error?.transportTelemetry,
    error,
  });
}

module.exports = {
  GIT_DEV_PULL_OUTPUT_TYPE,
  createGitDevPullFailureToolResult,
  createGitDevPullToolResult,
};
