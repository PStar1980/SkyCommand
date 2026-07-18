const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');

const GIT_REPOSITORY_STATUS_OUTPUT_TYPE = 'git_repository_status.v1';

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullable(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeError(error) {
  return error
    ? {
        code: String(error.code || 'GIT_REPOSITORY_STATUS_FAILED'),
        message: String(error.message || error),
      }
    : null;
}

function normalizeCommit(value = {}) {
  if (!value || typeof value !== 'object' || !value.sha) {
    return null;
  }

  return {
    sha: nullable(value.sha),
    shortSha: nullable(value.shortSha),
    decorations: nullable(value.decorations),
    subject: nullable(value.subject),
    authorName: nullable(value.authorName),
    authoredAt: nullable(value.authoredAt),
  };
}

function normalizeWorkingTree(value = {}) {
  const entries = Array.isArray(value.entries)
    ? value.entries.slice(0, 100).map((entry) => ({
        path: String(entry.path || ''),
        indexStatus: String(entry.indexStatus || ' ').slice(0, 1),
        workTreeStatus: String(entry.workTreeStatus || ' ').slice(0, 1),
        staged: normalizeBoolean(entry.staged),
        modified: normalizeBoolean(entry.modified),
        untracked: normalizeBoolean(entry.untracked),
        conflicted: normalizeBoolean(entry.conflicted),
      }))
    : [];

  return {
    clean: normalizeBoolean(value.clean),
    hasChanges: normalizeBoolean(value.hasChanges),
    staged: normalizeNumber(value.staged),
    modified: normalizeNumber(value.modified),
    untracked: normalizeNumber(value.untracked),
    conflicted: normalizeNumber(value.conflicted),
    totalChanges: normalizeNumber(value.totalChanges),
    entries,
  };
}

function normalizeBranch(value = {}) {
  const ahead = value.ahead === null || value.ahead === undefined ? null : normalizeNumber(value.ahead);
  const behind = value.behind === null || value.behind === undefined ? null : normalizeNumber(value.behind);

  return {
    name: nullable(value.name),
    localSha: nullable(value.localSha),
    remoteSha: nullable(value.remoteSha),
    ahead,
    behind,
    localMatchesRemote: normalizeBoolean(value.localMatchesRemote),
    latestLocalCommit: normalizeCommit(value.latestLocalCommit),
    latestRemoteCommit: normalizeCommit(value.latestRemoteCommit),
  };
}

function normalizeRelationship(value = {}) {
  const nullableBoolean = (candidate) =>
    candidate === null || candidate === undefined ? null : Boolean(candidate);

  return {
    localBranchesSynchronized: normalizeBoolean(value.localBranchesSynchronized),
    remoteBranchesSynchronized: normalizeBoolean(value.remoteBranchesSynchronized),
    localMainContainsDev: nullableBoolean(value.localMainContainsDev),
    localDevContainsMain: nullableBoolean(value.localDevContainsMain),
    mainContainsDev: nullableBoolean(value.mainContainsDev),
    devContainsMain: nullableBoolean(value.devContainsMain),
    commonAncestorSha: nullable(value.commonAncestorSha),
  };
}

function normalizeRepositoryState(value = {}) {
  return {
    gitDir: nullable(value.gitDir),
    commonDir: nullable(value.commonDir),
    indexLockPresent: normalizeBoolean(value.indexLockPresent),
    mergeInProgress: normalizeBoolean(value.mergeInProgress),
    rebaseInProgress: normalizeBoolean(value.rebaseInProgress),
    cherryPickInProgress: normalizeBoolean(value.cherryPickInProgress),
    revertInProgress: normalizeBoolean(value.revertInProgress),
    bisectInProgress: normalizeBoolean(value.bisectInProgress),
    operationInProgress: normalizeBoolean(value.operationInProgress),
  };
}

function createGitRepositoryStatusToolResult(result = {}) {
  const success = result.ok !== false;
  const outcome = String(result.outcome || (success ? 'READY' : 'FAILED')).toUpperCase();
  const repositoryLabel = result.repositoryCode || result.repositoryName || 'Repository';
  const blockerCount = Array.isArray(result.blockers) ? result.blockers.length : 0;
  const message = !success
    ? `${repositoryLabel} repository inspection failed.`
    : outcome === 'READY'
      ? `${repositoryLabel} is ready for development promotion.`
      : `${repositoryLabel} repository inspection found ${blockerCount} promotion blocker(s).`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
    output: {
      operationKind: 'REPOSITORY_STATUS',
      executionStrategy: String(result.executionStrategy || 'CHECKOUT_FREE_INSPECTION'),
      watcherSafe: result.watcherSafe !== false,
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      repositoryRoot: nullable(result.repositoryRoot),
      remote: String(result.remote || 'origin'),
      expectedBranch: nullable(result.expectedBranch),
      currentBranch: nullable(result.currentBranch),
      detachedHead: normalizeBoolean(result.detachedHead),
      fetchPerformed: normalizeBoolean(result.fetchPerformed),
      fetchSucceeded: normalizeBoolean(result.fetchSucceeded),
      workingTree: normalizeWorkingTree(result.workingTree),
      branches: {
        main: normalizeBranch(result.branches?.main),
        dev: normalizeBranch(result.branches?.dev),
      },
      relationship: normalizeRelationship(result.relationship),
      repositoryState: normalizeRepositoryState(result.repositoryState),
      readyForDevelopmentPromotion: normalizeBoolean(result.readyForDevelopmentPromotion),
      blockers: Array.isArray(result.blockers)
        ? result.blockers.map((blocker) => ({
            code: String(blocker.code || 'REPOSITORY_BLOCKER'),
            message: String(blocker.message || blocker),
          }))
        : [],
      advisories: Array.isArray(result.advisories) ? result.advisories.map(String) : [],
      recommendedActions: Array.isArray(result.recommendedActions)
        ? result.recommendedActions.map(String)
        : [],
      recentCommits: Array.isArray(result.recentCommits)
        ? result.recentCommits.map(normalizeCommit).filter(Boolean).slice(0, 30)
        : [],
      startedAt: nullable(result.startedAt),
      completedAt: nullable(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      profileCode: nullable(result.profileCode),
      transport: 'git_cli',
    },
  });
}

function createGitRepositoryStatusFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;

  return createGitRepositoryStatusToolResult({
    ok: false,
    outcome: 'FAILED',
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    error,
  });
}

module.exports = {
  GIT_REPOSITORY_STATUS_OUTPUT_TYPE,
  createGitRepositoryStatusFailureToolResult,
  createGitRepositoryStatusToolResult,
};
