const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');
const { normalizePerformanceTelemetry } = require('./gitPerformanceTelemetry');

const GIT_COMMIT_OUTPUT_TYPE = 'git_commit_summary.v1';

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function nullable(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}
function normalizeError(error) {
  return error
    ? { code: String(error.code || 'DEV_COMMIT_FAILED'), message: String(error.message || error) }
    : null;
}
function normalizeChanges(value = {}) {
  return {
    added: normalizeNumber(value.added),
    modified: normalizeNumber(value.modified),
    deleted: normalizeNumber(value.deleted),
    renamed: normalizeNumber(value.renamed),
    untracked: normalizeNumber(value.untracked),
    other: normalizeNumber(value.other),
  };
}

function parseGitStatusPorcelain(status = '') {
  const summary = { added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0, other: 0 };
  const lines = String(status || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    const code = line.slice(0, 2);
    if (code === '??') summary.untracked += 1;
    else if (code.includes('R')) summary.renamed += 1;
    else if (code.includes('A')) summary.added += 1;
    else if (code.includes('D')) summary.deleted += 1;
    else if (code.includes('M')) summary.modified += 1;
    else summary.other += 1;
  }
  return { changedFiles: lines.length, changes: summary };
}

function createGitCommitToolResult(result = {}) {
  const success = result.ok !== false;
  const performanceTelemetry = normalizePerformanceTelemetry(result.performanceTelemetry);
  const outcome = String(result.outcome || (success ? 'PUSHED' : 'FAILED')).toUpperCase();
  const repositoryLabel = result.repositoryCode || result.repositoryName || 'repository';
  const message =
    outcome === 'NO_CHANGES'
      ? `${repositoryLabel} had no changes to commit.`
      : success
        ? `${repositoryLabel} changes were committed and pushed successfully.`
        : `${repositoryLabel} dev commit failed.`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GIT_COMMIT_OUTPUT_TYPE,
    output: {
      operationKind: 'DEV_COMMIT',
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      repositoryRoot: nullable(result.repositoryRoot),
      branch: nullable(result.branch),
      remote: String(result.remote || 'origin'),
      commitMessage: nullable(result.commitMessage),
      previousHeadSha: nullable(result.previousHeadSha),
      currentHeadSha: nullable(result.currentHeadSha),
      commitSha: nullable(result.commitSha),
      startedAt: nullable(result.startedAt),
      completedAt: nullable(result.completedAt),
      durationMs: normalizeNumber(result.durationMs),
      changedFiles: normalizeNumber(result.changedFiles),
      changes: normalizeChanges(result.changes),
      ...(performanceTelemetry ? { performanceTelemetry } : {}),
      steps: {
        fetched: Boolean(result.fetched),
        switchedBranch: Boolean(result.switchedBranch),
        pulled: Boolean(result.pulled),
        staged: Boolean(result.staged),
        committed: Boolean(result.committed),
        pushed: Boolean(result.pushed),
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

function createGitCommitFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;
  return createGitCommitToolResult({
    ok: false,
    outcome: 'FAILED',
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    error,
  });
}

module.exports = {
  GIT_COMMIT_OUTPUT_TYPE,
  createGitCommitFailureToolResult,
  createGitCommitToolResult,
  parseGitStatusPorcelain,
};
