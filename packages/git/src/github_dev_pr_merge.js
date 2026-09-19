#!/usr/bin/env node

/**
 * Merges exactly one registered SkyCommand DEV -> main GitHub pull request.
 * The tool is deliberately bound to the reviewed workflow output: the remote
 * DEV and main heads must match the preflight SHAs before GitHub is mutated.
 * Host-side `gh` authentication is used; credentials never enter arguments or
 * structured output.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const { getTemporalConfig } = require('../../temporal/src/config');
const { DEFAULT_HOST_AGENT_TASK_QUEUE } = require('../../host-agent/src/config');
const {
  GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
  createGithubDevPrMergeFailureToolResult,
  createGithubDevPrMergeToolResult,
} = require('./githubDevPrMergeResult');

const SKY_COMMAND_ROOT = path.resolve(__dirname, '../../..');
const TOOL_CODE = 'github_dev_pr_merge';
const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL';
const DEFAULT_GH_TIMEOUT_MS = 120000;
const DEFAULT_PR_SETTLEMENT_TIMEOUT_MS = 30000;
const DEFAULT_PR_SETTLEMENT_INTERVAL_MS = 1000;
const SHA_PATTERN = /^[a-f0-9]{40,64}$/i;

dotenv.config({ path: path.join(SKY_COMMAND_ROOT, '.env'), quiet: true });
const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYCOMMAND_GITHUB_DEV_PR_MERGE_PROFILE ||
  process.env.SKYCOMMAND_CONFIG_PROFILE ||
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

class GithubDevPrMergeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GithubDevPrMergeError';
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function isDockerRuntime() {
  return text(process.env.SKYCOMMAND_RUNTIME_ENV).toLowerCase() === 'docker';
}

function isDockerLocalProfile(profileCode = PROFILE_CODE) {
  return text(profileCode).toUpperCase() === DOCKER_LOCAL_PROFILE;
}

function toBoolean(value) {
  return value === true || value === 1 || ['true', '1'].includes(text(value).toLowerCase());
}

function normalizeSha(value, label) {
  const normalized = text(value).toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new GithubDevPrMergeError('GITHUB_DEV_PR_MERGE_SHA_INVALID', `${label} must be a full Git object id.`);
  }
  return normalized;
}

function parseArguments(args = []) {
  const values = (Array.isArray(args) ? args : [])
    .map((value) => String(value || ''))
    .filter((value) => !value.startsWith('--'));
  if (values.length !== 4 || values.some((value) => !value.trim())) {
    throw new GithubDevPrMergeError(
      'GITHUB_DEV_PR_MERGE_ARGUMENTS_INVALID',
      'GitHub DEV PR merge requires repository name, expected DEV SHA, workflow run id, and expected main SHA.',
    );
  }
  return {
    repositoryName: values[0].trim(),
    expectedDevSha: normalizeSha(values[1], 'expectedDevSha'),
    workflowRunId: values[2].trim(),
    expectedMainSha: normalizeSha(values[3], 'expectedMainSha'),
  };
}

function sanitizeErrorMessage(value) {
  return text(value, 'GitHub DEV PR merge failed.')
    .replace(/(token|authorization|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.startsWith('https://github.com/') ? url : '[url-redacted]')
    .slice(0, 500);
}

function fail(code, message, details = {}) {
  throw new GithubDevPrMergeError(code, message, details);
}

function getGitEnvironment() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
    ...(isDockerLocalProfile() ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
  };
}

function runGit(args, cwd, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: Number(process.env.SKYCOMMAND_GIT_COMMAND_TIMEOUT_MS || 60000),
    env: getGitEnvironment(),
  });
  if (result.error || result.status !== 0) {
    fail('GITHUB_DEV_PR_MERGE_GIT_REMOTE_INVALID', 'The configured local Git remote could not be verified.', {
      operation: args[0] || 'git',
      detail: sanitizeErrorMessage(result.error?.message || result.stderr),
    });
  }
  return text(result.stdout);
}

function normalizeRemote(value) {
  return text(value).replace(/\.git$/, '').replace(/\/$/, '');
}

function parseGithubRepository(remoteUrl) {
  const remote = normalizeRemote(remoteUrl);
  const match = remote.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i) ||
    remote.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i);
  if (!match) fail('GITHUB_DEV_PR_MERGE_REMOTE_INVALID', 'The registered repository remote is not a supported GitHub remote.');
  return `${match[1]}/${match[2]}`;
}

async function loadRepository(repoName, queryFn, profileCode = PROFILE_CODE) {
  if (text(repoName).toLowerCase() !== 'skycommand') {
    fail('GITHUB_DEV_PR_MERGE_REPOSITORY_SCOPE_INVALID', 'GitHub DEV PR merge is bound to the registered SkyCommand repository.');
  }
  const result = await queryFn(
    `SELECT r.repo_code, r.repo_name, r.remote_url, r.main_branch, r.dev_branch, rp.root_path
       FROM core.repositories r
       JOIN core.repository_paths rp ON rp.repo_id = r.repo_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1 AND cp.active = TRUE AND r.active = TRUE AND rp.active = TRUE
        AND r.is_skycommand_repository = TRUE AND LOWER(r.repo_code) = LOWER($2)
      LIMIT 1`,
    [profileCode, repoName],
  );
  const row = result.rows?.[0];
  if (!row) fail('GITHUB_DEV_PR_MERGE_REPOSITORY_NOT_FOUND', 'Registered SkyCommand repository metadata is unavailable.');
  if (!row.remote_url || !row.root_path || !fs.existsSync(row.root_path)) {
    fail('GITHUB_DEV_PR_MERGE_REPOSITORY_METADATA_INVALID', 'Registered SkyCommand repository metadata is incomplete.');
  }
  const githubRepository = parseGithubRepository(row.remote_url);
  const configuredRemote = runGit(['remote', 'get-url', 'origin'], row.root_path);
  if (normalizeRemote(configuredRemote).toLowerCase() !== normalizeRemote(row.remote_url).toLowerCase()) {
    fail('GITHUB_DEV_PR_MERGE_REMOTE_IDENTITY_MISMATCH', 'The local origin remote does not match registered repository metadata.');
  }
  return {
    repoCode: row.repo_code,
    repoName: row.repo_name,
    remoteUrl: row.remote_url,
    githubRepository,
    mainBranch: row.main_branch || 'main',
    devBranch: row.dev_branch || 'dev',
    rootPath: row.root_path,
    configuredRemote,
  };
}

function runGh(args, options = {}) {
  const result = spawnSync('gh', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: Number(process.env.SKYCOMMAND_GH_COMMAND_TIMEOUT_MS || DEFAULT_GH_TIMEOUT_MS),
    env: {
      ...process.env,
      GH_PAGER: 'cat',
      GH_PROMPT_DISABLED: '1',
    },
  });
  const detail = sanitizeErrorMessage(result.error?.message || result.stderr || result.stdout);
  if (result.error || result.status !== 0) {
    const error = new GithubDevPrMergeError(
      options.errorCode || 'GITHUB_DEV_PR_MERGE_GH_FAILED',
      detail || 'GitHub CLI operation failed.',
    );
    throw error;
  }
  return text(result.stdout);
}

function createGhAdapter({ cwd, githubRepository }) {
  const ghJson = (args, errorCode) => {
    try {
      return JSON.parse(runGh(args, { cwd, errorCode }));
    } catch (error) {
      if (error instanceof GithubDevPrMergeError) throw error;
      fail(errorCode, 'GitHub CLI returned invalid structured output.');
    }
  };
  const repoArgs = ['--repo', githubRepository];
  return {
    authStatus: () => runGh(['auth', 'status'], { cwd, errorCode: 'GITHUB_DEV_PR_MERGE_AUTH_UNAVAILABLE' }),
    getBranchSha: (branch) => {
      const output = runGh(['api', `repos/${githubRepository}/git/ref/heads/${branch}`, '--jq', '.object.sha'], { cwd, errorCode: 'GITHUB_DEV_PR_MERGE_GITHUB_READ_FAILED' });
      return text(output);
    },
    listOpenPrs: ({ baseBranch, headBranch }) => ghJson(['pr', 'list', ...repoArgs, '--state', 'open', '--base', baseBranch, '--head', headBranch, '--json', 'number,url,headRefName,baseRefName,headRefOid,baseRefOid,mergeable,mergeStateStatus,statusCheckRollup,isDraft'], 'GITHUB_DEV_PR_MERGE_PR_LIST_FAILED'),
    listMergedPrs: ({ baseBranch, headBranch }) => ghJson(['pr', 'list', ...repoArgs, '--state', 'merged', '--base', baseBranch, '--head', headBranch, '--limit', '20', '--json', 'number,url,headRefName,baseRefName,headRefOid,baseRefOid,mergedAt,mergeCommit'], 'GITHUB_DEV_PR_MERGE_PR_LIST_FAILED'),
    createPr: ({ baseBranch, headBranch, title, body }) => {
      const url = runGh(['pr', 'create', ...repoArgs, '--base', baseBranch, '--head', headBranch, '--title', title, '--body', body], { cwd, errorCode: 'GITHUB_DEV_PR_MERGE_PR_CREATE_FAILED' });
      return { url: text(url).split(/\r?\n/).filter(Boolean).pop() || null };
    },
    viewPr: (number) => ghJson(['pr', 'view', String(number), ...repoArgs, '--json', 'number,url,headRefName,baseRefName,headRefOid,baseRefOid,state,mergeable,mergeStateStatus,statusCheckRollup,isDraft,mergedAt,mergeCommit'], 'GITHUB_DEV_PR_MERGE_PR_READ_FAILED'),
    mergePr: ({ number, expectedDevSha }) => {
      runGh(['pr', 'merge', String(number), ...repoArgs, '--merge', '--match-head-commit', expectedDevSha], { cwd, errorCode: 'GITHUB_DEV_PR_MERGE_BLOCKED' });
      return { merged: true };
    },
  };
}

function normalizePr(value = {}) {
  const mergeCommit = value.mergeCommit;
  return {
    number: Number(value.number) || null,
    url: text(value.url) || null,
    headRefName: text(value.headRefName) || null,
    baseRefName: text(value.baseRefName) || null,
    headRefOid: text(value.headRefOid || value.headSha).toLowerCase() || null,
    baseRefOid: text(value.baseRefOid || value.baseSha).toLowerCase() || null,
    state: text(value.state).toUpperCase() || null,
    mergeable: text(value.mergeable).toUpperCase() || null,
    mergeStateStatus: text(value.mergeStateStatus).toUpperCase() || null,
    statusCheckRollup: Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup : [],
    isDraft: Boolean(value.isDraft),
    mergedAt: value.mergedAt || null,
    mergeCommitSha: text(mergeCommit?.oid || mergeCommit?.sha).toLowerCase() || null,
  };
}

function getSettlementNumber(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function getPrSettlementConfig(options = {}) {
  return {
    timeoutMs: getSettlementNumber(
      options.settlementTimeoutMs ?? process.env.SKYCOMMAND_GITHUB_DEV_PR_MERGE_SETTLEMENT_TIMEOUT_MS,
      DEFAULT_PR_SETTLEMENT_TIMEOUT_MS,
    ),
    intervalMs: getSettlementNumber(
      options.settlementIntervalMs ?? process.env.SKYCOMMAND_GITHUB_DEV_PR_MERGE_SETTLEMENT_INTERVAL_MS,
      DEFAULT_PR_SETTLEMENT_INTERVAL_MS,
    ),
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
    sleep: typeof options.sleep === 'function'
      ? options.sleep
      : (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
  };
}

function findFailedCheck(pr) {
  return pr.statusCheckRollup.find((check) =>
    ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(
      text(check.conclusion).toUpperCase(),
    ),
  );
}

function findIncompleteCheck(pr) {
  return pr.statusCheckRollup.find((check) => {
    const status = text(check.status).toUpperCase();
    return status && !['COMPLETED', 'SUCCESS'].includes(status);
  });
}

function assertHardMergeBlockers(pr) {
  if (pr.isDraft) fail('GITHUB_DEV_PR_MERGE_PR_DRAFT', 'The DEV pull request is still a draft.');
  if (['CONFLICTING', 'DIRTY'].includes(pr.mergeable) || ['BLOCKED', 'DIRTY', 'UNSTABLE'].includes(pr.mergeStateStatus)) {
    fail('GITHUB_DEV_PR_MERGE_BRANCH_PROTECTION', 'GitHub reports that the DEV pull request is not mergeable under current branch protection or conflict state.');
  }
  const failedCheck = findFailedCheck(pr);
  if (failedCheck) fail('GITHUB_DEV_PR_MERGE_CHECKS_FAILED', 'Required GitHub checks for the DEV pull request have not passed.');
}

function assessMergeability(pr) {
  assertHardMergeBlockers(pr);
  if (['UNKNOWN', null, ''].includes(pr.mergeable) || ['UNKNOWN', null, ''].includes(pr.mergeStateStatus)) {
    return { ready: false, reason: 'MERGEABILITY_UNKNOWN' };
  }
  const incompleteCheck = findIncompleteCheck(pr);
  if (incompleteCheck) return { ready: false, reason: 'CHECKS_PENDING' };
  if (pr.mergeable !== 'MERGEABLE') return { ready: false, reason: 'MERGEABILITY_UNSETTLED' };
  return { ready: true, reason: 'READY' };
}

function assertChecksAndMergeability(pr) {
  const assessment = assessMergeability(pr);
  if (!assessment.ready) {
    if (assessment.reason === 'CHECKS_PENDING') {
      fail('GITHUB_DEV_PR_MERGE_CHECKS_PENDING', 'Required GitHub checks for the DEV pull request are still pending.');
    }
    fail('GITHUB_DEV_PR_MERGE_NOT_READY_TIMEOUT', 'GitHub pull request mergeability metadata did not settle to a mergeable state.');
  }
}

async function waitForCreatedPullRequest({ listOpen, options }) {
  const config = getPrSettlementConfig(options);
  const deadline = config.now() + config.timeoutMs;
  let lastCount = 0;
  for (;;) {
    const openPrs = await listOpen();
    lastCount = openPrs.length;
    if (openPrs.length > 1) {
      fail('GITHUB_DEV_PR_MERGE_DUPLICATE_PR', 'More than one open DEV to main pull request exists after creation.');
    }
    if (openPrs.length === 1) return openPrs[0];
    if (config.now() >= deadline) {
      fail(
        'GITHUB_DEV_PR_MERGE_NOT_READY_TIMEOUT',
        'The newly created DEV pull request did not become visible within the bounded settlement window.',
        { stage: 'PR_VISIBILITY', observedOpenPullRequests: lastCount, timeoutMs: config.timeoutMs },
      );
    }
    await config.sleep(config.intervalMs);
  }
}

async function settlePullRequest({ adapter, pullRequest, options }) {
  const config = getPrSettlementConfig(options);
  const deadline = config.now() + config.timeoutMs;
  let current = pullRequest;
  for (;;) {
    current = normalizePr(await adapter.viewPr(current.number));
    if (current.state === 'MERGED' || current.mergedAt) return current;
    const assessment = assessMergeability(current);
    if (assessment.ready) return current;
    if (config.now() >= deadline) {
      fail(
        'GITHUB_DEV_PR_MERGE_NOT_READY_TIMEOUT',
        'GitHub pull request mergeability metadata did not settle within the bounded readiness window.',
        {
          stage: 'PR_SETTLEMENT',
          prNumber: current.number,
          mergeable: current.mergeable,
          mergeStateStatus: current.mergeStateStatus,
          checkPending: assessment.reason === 'CHECKS_PENDING',
          timeoutMs: config.timeoutMs,
        },
      );
    }
    await config.sleep(config.intervalMs);
  }
}

async function executeGithubDevPrMerge(args = [], options = {}) {
  const startedAt = new Date().toISOString();
  const input = options.input || parseArguments(args);
  const queryFn = options.queryFn || (async (...queryArgs) => pool.query(...queryArgs));
  const repository = options.repository || await loadRepository(input.repositoryName, queryFn, options.profileCode || PROFILE_CODE);
  const adapter = options.githubAdapter || createGhAdapter({ cwd: repository.rootPath, githubRepository: repository.githubRepository });
  const verification = {
    remoteIdentityVerified: true,
    devHeadVerified: false,
    baseHeadVerified: false,
    pullRequestHeadVerified: false,
    mergeabilityVerified: false,
    resultingMainVerified: false,
  };
  try {
    adapter.authStatus();
    const verifiedDevSha = normalizeSha(await adapter.getBranchSha(repository.devBranch), 'verifiedDevSha');
    if (verifiedDevSha !== input.expectedDevSha) fail('GITHUB_DEV_PR_MERGE_HEAD_MISMATCH', 'The GitHub DEV branch head differs from the reviewed commit boundary.', { expectedDevSha: input.expectedDevSha, verifiedDevSha });
    verification.devHeadVerified = true;
    const listOpen = async () => (await adapter.listOpenPrs({ baseBranch: repository.mainBranch, headBranch: repository.devBranch })).map(normalizePr);
    const listMerged = async () => (await adapter.listMergedPrs({ baseBranch: repository.mainBranch, headBranch: repository.devBranch })).map(normalizePr);
    const baseShaBeforeMerge = normalizeSha(await adapter.getBranchSha(repository.mainBranch), 'baseShaBeforeMerge');
    const buildAlreadyMergedResult = async (alreadyMerged) => {
      const currentMainSha = normalizeSha(await adapter.getBranchSha(repository.mainBranch), 'mergedMainSha');
      const mergedBaseSha = alreadyMerged.baseRefOid || baseShaBeforeMerge;
      verification.baseHeadVerified = mergedBaseSha === input.expectedMainSha;
      verification.pullRequestHeadVerified = true;
      verification.mergeabilityVerified = true;
      verification.resultingMainVerified = true;
      const completedAt = new Date().toISOString();
      return {
        ok: true,
        outcome: 'ALREADY_MERGED',
        repositoryCode: repository.repoCode,
        repositoryName: repository.repoName,
        remote: repository.remoteUrl,
        githubRepository: repository.githubRepository,
        baseBranch: repository.mainBranch,
        headBranch: repository.devBranch,
        expectedDevSha: input.expectedDevSha,
        verifiedDevSha,
        expectedMainSha: input.expectedMainSha,
        baseShaBeforeMerge: mergedBaseSha,
        mergedMainSha: currentMainSha,
        prNumber: alreadyMerged.number,
        prUrl: alreadyMerged.url,
        prCreated: false,
        createdByRun: input.workflowRunId,
        mergeMethod: 'merge',
        startedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(startedAt),
        verification,
        transport: options.transport || 'gh_cli',
        executionTarget: options.executionTarget || 'HOST',
      };
    };
    if (baseShaBeforeMerge !== input.expectedMainSha) {
      const alreadyMerged = (await listMerged()).find((candidate) => candidate.headRefOid === input.expectedDevSha);
      if (alreadyMerged) return buildAlreadyMergedResult(alreadyMerged);
      fail('GITHUB_DEV_PR_MERGE_BASE_CHANGED', 'The GitHub main branch changed after preflight.', { expectedMainSha: input.expectedMainSha, baseShaBeforeMerge });
    }
    verification.baseHeadVerified = true;

    let openPrs = await listOpen();
    let prCreated = false;
    let pr = null;
    if (openPrs.length > 1) fail('GITHUB_DEV_PR_MERGE_DUPLICATE_PR', 'More than one open DEV to main pull request exists.');
    if (openPrs.length === 1) {
      pr = openPrs[0];
    } else {
      const mergedPrs = await listMerged();
      const alreadyMerged = mergedPrs.find((candidate) => candidate.headRefOid === input.expectedDevSha);
      if (alreadyMerged) {
        return buildAlreadyMergedResult(alreadyMerged);
      }
      const title = `SkyCommand DEV promotion ${input.expectedDevSha.slice(0, 12)}`;
      const body = `Governed SkyCommand DEV promotion for workflow run ${input.workflowRunId}.`;
      await adapter.createPr({ baseBranch: repository.mainBranch, headBranch: repository.devBranch, title, body });
      prCreated = true;
      pr = await waitForCreatedPullRequest({ listOpen, options });
    }

    if (pr.baseRefName !== repository.mainBranch || pr.headRefName !== repository.devBranch) {
      fail('GITHUB_DEV_PR_MERGE_PR_DIRECTION_INVALID', 'The selected pull request does not target the registered DEV to main branch direction.');
    }
    if (pr.headRefOid !== input.expectedDevSha) fail('GITHUB_DEV_PR_MERGE_PR_HEAD_MISMATCH', 'The selected pull request head differs from the reviewed DEV commit.');
    verification.pullRequestHeadVerified = true;
    pr = await settlePullRequest({ adapter, pullRequest: pr, options });
    if (pr.state === 'MERGED' || pr.mergedAt) return buildAlreadyMergedResult(pr);
    if (pr.baseRefName !== repository.mainBranch || pr.headRefName !== repository.devBranch) {
      fail('GITHUB_DEV_PR_MERGE_PR_DIRECTION_INVALID', 'The settled pull request does not target the registered DEV to main branch direction.');
    }
    if (pr.headRefOid !== input.expectedDevSha) {
      fail('GITHUB_DEV_PR_MERGE_PR_HEAD_MISMATCH', 'The settled pull request head differs from the reviewed DEV commit.');
    }
    assertChecksAndMergeability(pr);
    verification.mergeabilityVerified = true;
    await adapter.mergePr({ number: pr.number, expectedDevSha: input.expectedDevSha });
    const mergedPr = normalizePr(await adapter.viewPr(pr.number));
    const mergedMainSha = normalizeSha(await adapter.getBranchSha(repository.mainBranch), 'mergedMainSha');
    if (mergedPr.state !== 'MERGED' && !mergedPr.mergedAt) fail('GITHUB_DEV_PR_MERGE_RESULT_UNCONFIRMED', 'GitHub did not confirm the pull request as merged.');
    verification.resultingMainVerified = true;
    const completedAt = new Date().toISOString();
    return {
      ok: true,
      outcome: 'MERGED',
      repositoryCode: repository.repoCode,
      repositoryName: repository.repoName,
      remote: repository.remoteUrl,
      githubRepository: repository.githubRepository,
      baseBranch: repository.mainBranch,
      headBranch: repository.devBranch,
      expectedDevSha: input.expectedDevSha,
      verifiedDevSha,
      expectedMainSha: input.expectedMainSha,
      baseShaBeforeMerge,
      mergedMainSha,
      prNumber: pr.number,
      prUrl: pr.url,
      prCreated,
      createdByRun: input.workflowRunId,
      mergeMethod: 'merge',
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      verification,
      transport: options.transport || 'gh_cli',
      executionTarget: options.executionTarget || 'HOST',
    };
  } catch (error) {
    if (error instanceof GithubDevPrMergeError) throw error;
    const wrapped = new GithubDevPrMergeError('GITHUB_DEV_PR_MERGE_FAILED', sanitizeErrorMessage(error?.message || error));
    throw wrapped;
  }
}

async function executeGithubDevPrMergeViaHostAgent(args = []) {
  if (!toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
    fail('GITHUB_DEV_PR_MERGE_HOST_AGENT_DISABLED', 'Host Agent dispatch is required for Docker-local GitHub authentication.');
  }
  const values = parseArguments(args);
  const { Connection, Client } = require('@temporalio/client');
  const temporal = getTemporalConfig();
  const hostTaskQueue = text(process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE, DEFAULT_HOST_AGENT_TASK_QUEUE);
  const workflowId = `skycommand-host-github-dev-pr-merge-${randomUUID()}`;
  let connection = null;
  try {
    connection = await Connection.connect({ address: temporal.address });
    const client = new Client({ connection, namespace: temporal.namespace });
    const response = await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporal.taskQueue,
      workflowId,
      args: [{
        toolCode: TOOL_CODE,
        repoName: values.repositoryName,
        expectedDevSha: values.expectedDevSha,
        workflowRunId: values.workflowRunId,
        expectedMainSha: values.expectedMainSha,
        hostTaskQueue,
      }],
    });
    if (!response?.ok) {
      const error = new GithubDevPrMergeError(response?.error?.code || 'GITHUB_DEV_PR_MERGE_HOST_AGENT_FAILED', response?.error?.message || 'Host Agent GitHub DEV PR merge failed.');
      throw error;
    }
    return { ...(response.result || {}), transport: 'temporal_host_agent', executionTarget: 'HOST' };
  } finally {
    if (connection) await connection.close();
  }
}

async function executeGithubDevPrMergeRouted(args = []) {
  if (isDockerRuntime() || isDockerLocalProfile()) {
    if (!toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
      fail('GITHUB_DEV_PR_MERGE_HOST_AGENT_DISABLED', 'Host Agent dispatch is required for Docker-local GitHub authentication.');
    }
    return executeGithubDevPrMergeViaHostAgent(args);
  }
  return executeGithubDevPrMerge(args, { executionTarget: 'HOST' });
}

function printResult(result) {
  console.log(`[SkyCommand GitHub DEV PR merge] ${text(result.outcome, 'FAILED')}: ${text(result.prUrl, 'pull request unavailable')}`);
}

async function closePool() {
  try { await pool.end(); } catch { /* CLI shutdown */ }
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  try {
    return await runToolCli({
      toolCode: TOOL_CODE,
      outputType: GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
      outputSchema: require('../../tools/contracts/github_dev_pr_merge_summary.v1.schema.json'),
      args,
      execute: executeGithubDevPrMergeRouted,
      createToolResult: createGithubDevPrMergeToolResult,
      createFailureToolResult: (error) => createGithubDevPrMergeFailureToolResult({ error, startedAt, completedAt: new Date().toISOString() }),
      renderConsole: printResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  GithubDevPrMergeError,
  GITHUB_DEV_PR_MERGE_OUTPUT_TYPE,
  TOOL_CODE,
  assertChecksAndMergeability,
  createGhAdapter,
  executeGithubDevPrMerge,
  executeGithubDevPrMergeRouted,
  executeGithubDevPrMergeViaHostAgent,
  loadRepository,
  main,
  normalizePr,
  parseArguments,
  parseGithubRepository,
};
