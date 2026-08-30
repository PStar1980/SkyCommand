const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');
const { normalizePerformanceTelemetry } = require('./gitPerformanceTelemetry');

const GIT_LOCAL_SYNC_OUTPUT_TYPE = 'git_local_sync_summary.v1';

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
        code: String(error.code || 'LOCAL_REPOSITORY_SYNC_FAILED'),
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
    worktreeOwnershipSafe: Boolean(value.worktreeOwnershipSafe),
    devBaselineMatched: Boolean(value.devBaselineMatched),
    remoteTargetMatched: Boolean(value.remoteTargetMatched),
    localMainFastForwardSafe: Boolean(value.localMainFastForwardSafe),
    localDevFastForwardSafe: Boolean(value.localDevFastForwardSafe),
    remoteReverifiedBeforeMutation: Boolean(value.remoteReverifiedBeforeMutation),
  };
}

function normalizeSteps(value = {}) {
  return {
    remoteInspected: Boolean(value.remoteInspected),
    fetched: Boolean(value.fetched),
    mainRefUpdated: Boolean(value.mainRefUpdated),
    devRefUpdated: Boolean(value.devRefUpdated),
    remoteReverified: Boolean(value.remoteReverified),
    postVerified: Boolean(value.postVerified),
  };
}

function createGitLocalSyncToolResult(result = {}) {
  const success = result.ok !== false;
  const performanceTelemetry = normalizePerformanceTelemetry(result.performanceTelemetry);
  const transportTelemetry = normalizePerformanceTelemetry(result.transportTelemetry);
  const outcome = String(
    result.outcome || (success ? 'SYNCHRONIZED' : 'FAILED'),
  ).toUpperCase();
  const repositoryLabel = result.repositoryCode || result.repositoryName || 'repository';
  const message = success
    ? outcome === 'ALREADY_SYNCHRONIZED'
      ? `${repositoryLabel} local main/dev refs were already synchronized with the approved remote head.`
      : `${repositoryLabel} local main/dev refs were safely synchronized with the approved remote head.`
    : outcome === 'BLOCKED'
      ? `${repositoryLabel} local synchronization was blocked by a safety guardrail.`
      : `${repositoryLabel} local repository synchronization failed.`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GIT_LOCAL_SYNC_OUTPUT_TYPE,
    output: {
      operationKind: 'LOCAL_REPOSITORY_SYNC',
      executionTarget: 'HOST',
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      repositoryRoot: nullable(result.repositoryRoot),
      profileCode: nullable(result.profileCode),
      remote: String(result.remote || 'origin'),
      mainBranch: nullable(result.mainBranch),
      devBranch: nullable(result.devBranch),
      currentBranch: nullable(result.currentBranch),
      expectedLocalDevSha: nullable(result.expectedLocalDevSha),
      expectedSynchronizedHeadSha: nullable(result.expectedSynchronizedHeadSha),
      devBaselineState: nullable(result.devBaselineState),
      localMainBeforeSha: nullable(result.localMainBeforeSha),
      localDevBeforeSha: nullable(result.localDevBeforeSha),
      remoteMainBeforeSha: nullable(result.remoteMainBeforeSha),
      remoteDevBeforeSha: nullable(result.remoteDevBeforeSha),
      localMainAfterSha: nullable(result.localMainAfterSha),
      localDevAfterSha: nullable(result.localDevAfterSha),
      remoteMainAfterSha: nullable(result.remoteMainAfterSha),
      remoteDevAfterSha: nullable(result.remoteDevAfterSha),
      stashCount: normalizeNumber(result.stashCount),
      workingTreeCleanBefore: Boolean(result.workingTreeCleanBefore),
      workingTreeCleanAfter: Boolean(result.workingTreeCleanAfter),
      mainRefUpdated: Boolean(result.mainRefUpdated),
      devRefUpdated: Boolean(result.devRefUpdated),
      checkedOutBranchUpdated: Boolean(result.checkedOutBranchUpdated),
      fourWaySynchronized: Boolean(result.fourWaySynchronized),
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

function createGitLocalSyncFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;
  const state = error?.syncResult || {};

  return createGitLocalSyncToolResult({
    ...state,
    ok: false,
    outcome: error?.code?.startsWith('LOCAL_REPOSITORY_SYNC_BLOCKED_') ? 'BLOCKED' : 'FAILED',
    startedAt: state.startedAt || beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    transportTelemetry: state.transportTelemetry || error?.transportTelemetry,
    error,
  });
}

module.exports = {
  GIT_LOCAL_SYNC_OUTPUT_TYPE,
  createGitLocalSyncFailureToolResult,
  createGitLocalSyncToolResult,
};
