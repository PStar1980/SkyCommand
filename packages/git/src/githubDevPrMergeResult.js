const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');

const GITHUB_DEV_PR_MERGE_OUTPUT_TYPE = 'github_dev_pr_merge_summary.v1';

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function nullable(value) {
  const normalized = text(value);
  return normalized || null;
}

function normalizeSha(value) {
  const normalized = text(value);
  return /^[a-f0-9]{7,64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeError(error) {
  if (!error) return null;
  return {
    code: text(error.code, 'GITHUB_DEV_PR_MERGE_FAILED'),
    message: text(error.message, 'GitHub DEV PR merge failed.').replace(/[A-Za-z]:[\\/][^\s]+/g, '[path-redacted]').slice(0, 500),
  };
}

function createGithubDevPrMergeToolResult(result = {}) {
  const outcome = text(result.outcome, result.ok === false ? 'FAILED' : 'MERGED').toUpperCase();
  const success = result.ok !== false && ['MERGED', 'ALREADY_MERGED'].includes(outcome);
  const repositoryLabel = text(result.repositoryCode || result.repositoryName, 'repository');
  const message = success
    ? `${repositoryLabel} DEV pull request ${outcome === 'ALREADY_MERGED' ? 'was already merged.' : 'was merged into main.'}`
    : `${repositoryLabel} DEV pull request merge failed.`;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message,
    outputType: GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
    output: {
      operationKind: 'GITHUB_DEV_PR_MERGE',
      outcome,
      repositoryCode: nullable(result.repositoryCode),
      repositoryName: nullable(result.repositoryName),
      remote: nullable(result.remote),
      githubRepository: nullable(result.githubRepository),
      baseBranch: nullable(result.baseBranch),
      headBranch: nullable(result.headBranch),
      expectedDevSha: normalizeSha(result.expectedDevSha),
      verifiedDevSha: normalizeSha(result.verifiedDevSha),
      expectedMainSha: normalizeSha(result.expectedMainSha),
      baseShaBeforeMerge: normalizeSha(result.baseShaBeforeMerge),
      mergedMainSha: normalizeSha(result.mergedMainSha),
      prNumber: normalizeNumber(result.prNumber),
      prUrl: nullable(result.prUrl),
      prCreated: Boolean(result.prCreated),
      createdByRun: nullable(result.createdByRun),
      mergeMethod: nullable(result.mergeMethod || 'merge'),
      startedAt: nullable(result.startedAt),
      completedAt: nullable(result.completedAt),
      durationMs: Math.max(0, Number(result.durationMs) || 0),
      verification: {
        remoteIdentityVerified: Boolean(result.verification?.remoteIdentityVerified),
        devHeadVerified: Boolean(result.verification?.devHeadVerified),
        baseHeadVerified: Boolean(result.verification?.baseHeadVerified),
        pullRequestHeadVerified: Boolean(result.verification?.pullRequestHeadVerified),
        mergeabilityVerified: Boolean(result.verification?.mergeabilityVerified),
        resultingMainVerified: Boolean(result.verification?.resultingMainVerified),
      },
    },
    warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
    error: success ? null : normalizeError(result.error),
    metadata: {
      valuesRedacted: true,
      transport: text(result.transport, 'gh_cli'),
      executionTarget: nullable(result.executionTarget),
    },
  });
}

function createGithubDevPrMergeFailureToolResult({ error, startedAt, completedAt } = {}) {
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;
  return createGithubDevPrMergeToolResult({
    ok: false,
    outcome: 'FAILED',
    startedAt: beganAt,
    completedAt: finishedAt,
    durationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(beganAt).getTime()),
    error,
  });
}

module.exports = {
  GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
  createGithubDevPrMergeFailureToolResult,
  createGithubDevPrMergeToolResult,
};
