#!/usr/bin/env node

/**
 * Safely fast-forwards the host-owned local development branch to the exact
 * current origin development head. This is the bootstrap/convergence primitive
 * for workflows that begin with commits already present on origin/dev.
 *
 * The operation is intentionally strict:
 *   - host execution only (Docker dispatches through the Host Agent),
 *   - clean/idle working tree,
 *   - configured dev branch must be checked out in the configured worktree,
 *   - origin/dev must be strictly ahead of local dev,
 *   - local dev must be a fast-forward ancestor of origin/dev,
 *   - local and remote heads are reverified immediately before mutation,
 *   - the workflow fails if origin/dev moves again before final verification.
 *
 * Usage:
 *   node local_dev_pull.js <repoName>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createGitDevPullFailureToolResult,
  createGitDevPullToolResult,
} = require('./gitDevPullResult');
const { createGitPerformanceTelemetry } = require('./gitPerformanceTelemetry');
const { getTemporalConfig } = require('../../temporal/src/config');
const { DEFAULT_HOST_AGENT_TASK_QUEUE } = require('../../host-agent/src/config');

const SKY_COMMAND_ROOT = path.resolve(__dirname, '../../..');
const TOOL_CODE = 'local_dev_pull';
const OUTPUT_TYPE = 'git_dev_pull_summary.v1';
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL';
const MAX_COMMIT_DETAILS = 100;

dotenv.config({ path: path.join(SKY_COMMAND_ROOT, '.env') });
const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYCOMMAND_LOCAL_DEV_PULL_PROFILE ||
  process.env.SKYCOMMAND_LOCAL_SYNC_PROFILE ||
  process.env.SKYCOMMAND_CONFIG_PROFILE ||
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const GIT_COMMAND_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.SKYCOMMAND_GIT_COMMAND_TIMEOUT_MS || DEFAULT_GIT_COMMAND_TIMEOUT_MS),
);
const LOCK_STALE_MS = Math.max(
  60000,
  Number(process.env.SKYCOMMAND_LOCAL_SYNC_LOCK_STALE_MS || DEFAULT_LOCK_STALE_MS),
);

function toBoolean(value) {
  return (
    value === true ||
    value === 1 ||
    String(value || '').trim().toLowerCase() === 'true' ||
    String(value || '').trim() === '1'
  );
}

function isDockerRuntime() {
  return String(process.env.SKYCOMMAND_RUNTIME_ENV || '').trim().toLowerCase() === 'docker';
}

function getHostAgentTaskQueue() {
  return (
    String(process.env.SKYCOMMAND_HOST_AGENT_TASK_QUEUE || DEFAULT_HOST_AGENT_TASK_QUEUE).trim() ||
    DEFAULT_HOST_AGENT_TASK_QUEUE
  );
}

function createPullError(code, message, state = {}) {
  const error = new Error(message);
  error.code = code;
  error.syncResult = { ...state };
  return error;
}

function block(codeSuffix, message, state = {}) {
  throw createPullError(`LOCAL_DEV_PULL_BLOCKED_${codeSuffix}`, message, state);
}

function getGitEnvironment() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
  };
}

function executeGit(args, cwd, options = {}) {
  const capture = options.capture !== false;
  const allowedStatuses = new Set(options.allowedStatuses || [0]);
  if (options.printCommand !== false) {
    console.log(`> git ${args.join(' ')}`);
  }

  const result = spawnSync('git', args, {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    shell: false,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    env: getGitEnvironment(),
  });

  if (capture && options.echoOutput === true) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    throw createPullError(
      timedOut ? 'LOCAL_DEV_PULL_GIT_TIMEOUT' : 'LOCAL_DEV_PULL_GIT_FAILED',
      timedOut
        ? `Git command timed out after ${GIT_COMMAND_TIMEOUT_MS} ms: git ${args.join(' ')}`
        : `Git command failed: ${result.error.message}`,
    );
  }

  if (!allowedStatuses.has(result.status)) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw createPullError(
      'LOCAL_DEV_PULL_GIT_FAILED',
      [`Git command failed: git ${args.join(' ')}`, detail].filter(Boolean).join(' - '),
    );
  }

  return result;
}

function getGitOutput(args, cwd, options = {}) {
  const result = executeGit(args, cwd, {
    capture: true,
    allowedStatuses: options.allowedStatuses || [0],
    printCommand: options.printCommand === true,
    echoOutput: options.echoOutput === true,
  });
  return String(result.stdout || '').trim();
}

function isGitAncestor(ancestorRef, descendantRef, cwd) {
  const result = executeGit(['merge-base', '--is-ancestor', ancestorRef, descendantRef], cwd, {
    capture: true,
    allowedStatuses: [0, 1],
    printCommand: false,
  });
  return result.status === 0;
}

function normalizePathForComparison(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getGitDirectory(cwd) {
  const raw = getGitOutput(['rev-parse', '--git-dir'], cwd);
  return path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
}

function findGitOperationBlockers(cwd) {
  const markers = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
    'index.lock',
  ];
  const gitDirectory = getGitDirectory(cwd);
  return markers.filter((marker) => fs.existsSync(path.join(gitDirectory, marker)));
}

function getWorkingTreeStatus(cwd) {
  return getGitOutput(
    ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'],
    cwd,
  );
}

function getStashCount(cwd) {
  const output = getGitOutput(['stash', 'list', '--format=%gd'], cwd);
  return output ? output.split(/\r?\n/).filter(Boolean).length : 0;
}

function parseWorktrees(cwd) {
  const output = getGitOutput(['worktree', 'list', '--porcelain'], cwd);
  const records = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) records.push(current);
      current = { path: line.slice('worktree '.length), branch: null, head: null };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    }
  }

  if (current) records.push(current);
  return records;
}

function assertDevWorktreeOwnershipSafe({ cwd, devBranch, state }) {
  const root = normalizePathForComparison(cwd);
  const devRef = `refs/heads/${devBranch}`;
  const conflicts = parseWorktrees(cwd).filter(
    (entry) => entry.branch === devRef && normalizePathForComparison(entry.path) !== root,
  );

  if (conflicts.length > 0) {
    block(
      'DEV_CHECKED_OUT_ELSEWHERE',
      `Refusing local dev pull because ${devRef} is checked out in another worktree: ${conflicts.map((entry) => entry.path).join(', ')}.`,
      state,
    );
  }
}

function processAppearsAlive(pid) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireRepositoryLock(repoCode) {
  const safeRepoCode = String(repoCode || 'repository').replace(/[^A-Za-z0-9_.-]+/g, '_');
  const lockDirectory = path.join(os.homedir(), '.skycommand', 'locks', 'repositories');
  // Deliberately share the same lock with local_repo_sync so the two host Git
  // mutation primitives can never race each other for the same repository.
  const lockPath = path.join(lockDirectory, `${safeRepoCode}.local-sync.lock`);
  fs.mkdirSync(lockDirectory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      const payload = {
        pid: process.pid,
        hostname: os.hostname(),
        repoCode,
        operation: TOOL_CODE,
        acquiredAt: new Date().toISOString(),
      };
      fs.writeFileSync(descriptor, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fs.closeSync(descriptor);
      return {
        path: lockPath,
        release() {
          try {
            fs.unlinkSync(lockPath);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {
        existing = null;
      }
      const acquiredAtMs = existing?.acquiredAt ? new Date(existing.acquiredAt).getTime() : 0;
      const stale = !Number.isFinite(acquiredAtMs) || Date.now() - acquiredAtMs > LOCK_STALE_MS;
      const sameHost = !existing?.hostname || existing.hostname === os.hostname();
      const live = sameHost && processAppearsAlive(existing?.pid);

      if (attempt === 0 && stale && !live) {
        fs.unlinkSync(lockPath);
        continue;
      }

      block(
        'LOCK_HELD',
        `Repository mutation lock is already held for ${repoCode}: ${lockPath}`,
      );
    }
  }

  block('LOCK_HELD', `Unable to acquire repository mutation lock for ${repoCode}.`);
}

async function listAvailableRepositories() {
  const result = await pool.query(
    `SELECT r.repo_code
       FROM core.repositories r
       JOIN core.repository_paths rp ON rp.repo_id = r.repo_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
      ORDER BY r.display_order, r.repo_code`,
    [PROFILE_CODE],
  );
  return result.rows.map((row) => row.repo_code);
}

async function loadRepository(repoName) {
  if (!repoName) {
    throw createPullError(
      'LOCAL_DEV_PULL_REPOSITORY_REQUIRED',
      'Missing repoName. Usage: node local_dev_pull.js <repoName>',
    );
  }

  const result = await pool.query(
    `SELECT r.repo_code, r.repo_name, r.dev_branch, rp.root_path
       FROM core.repositories r
       JOIN core.repository_paths rp ON rp.repo_id = r.repo_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
        AND (LOWER(r.repo_code) = LOWER($2) OR LOWER(r.repo_name) = LOWER($2))
      LIMIT 1`,
    [PROFILE_CODE, repoName],
  );

  if (result.rowCount === 0) {
    throw createPullError(
      'LOCAL_DEV_PULL_REPOSITORY_UNKNOWN',
      `Unknown repo '${repoName}'. Available repos: ${(await listAvailableRepositories()).join(', ')}`,
    );
  }

  const row = result.rows[0];
  if (!row.root_path || !fs.existsSync(row.root_path)) {
    throw createPullError(
      'LOCAL_DEV_PULL_REPOSITORY_PATH_MISSING',
      `Repository path does not exist: ${row.root_path}`,
    );
  }

  return {
    repoCode: row.repo_code,
    repoName: row.repo_name,
    devBranch: row.dev_branch || 'dev',
    rootPath: row.root_path,
  };
}

function assertHostExecutionProfile(state = {}) {
  if (String(PROFILE_CODE || '').trim().toUpperCase() === DOCKER_LOCAL_PROFILE) {
    block(
      'HOST_REQUIRED',
      'Local Dev Pull is host-only and refuses DOCKER_LOCAL execution. Docker callers must route through the SkyCommand Host Agent.',
      state,
    );
  }
}

function assertRepositoryRoot(repo, state) {
  const topLevel = getGitOutput(['rev-parse', '--show-toplevel'], repo.rootPath);
  if (normalizePathForComparison(topLevel) !== normalizePathForComparison(repo.rootPath)) {
    block(
      'REPOSITORY_ROOT_MISMATCH',
      `Configured repository root ${repo.rootPath} does not match Git top-level ${topLevel}.`,
      state,
    );
  }
}

function assertCleanAndIdle(cwd, state) {
  const blockers = findGitOperationBlockers(cwd);
  if (blockers.length > 0) {
    block(
      'GIT_OPERATION_IN_PROGRESS',
      `Refusing local dev pull while Git operation markers are present: ${blockers.join(', ')}.`,
      state,
    );
  }
  state.safeguards.gitOperationClear = true;

  const status = getWorkingTreeStatus(cwd);
  if (status) {
    block(
      'WORKING_TREE_DIRTY',
      `Refusing local dev pull because the working tree has staged, unstaged, untracked, deleted, renamed, or submodule changes.\n${status}`,
      state,
    );
  }
  state.safeguards.workingTreeClean = true;
  state.workingTreeCleanBefore = true;
}

function getRemoteDevSha(remote, devBranch, cwd) {
  const ref = `refs/heads/${devBranch}`;
  const output = getGitOutput(['ls-remote', '--heads', remote, ref], cwd, { printCommand: true });
  const line = String(output || '')
    .split(/\r?\n/)
    .find(Boolean);
  const [sha, returnedRef] = String(line || '').trim().split(/\s+/);

  if (!sha || returnedRef !== ref) {
    throw createPullError(
      'LOCAL_DEV_PULL_REMOTE_DEV_MISSING',
      `Remote branch ${remote}/${devBranch} was not found.`,
    );
  }

  return sha.toLowerCase();
}

function getCommitDetails(cwd, localSha, remoteSha) {
  const output = getGitOutput(
    ['log', '--reverse', '--format=%H%x09%s', `${localSha}..${remoteSha}`],
    cwd,
  );

  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, MAX_COMMIT_DETAILS)
    .map((line) => {
      const tabIndex = line.indexOf('\t');
      return {
        sha: (tabIndex >= 0 ? line.slice(0, tabIndex) : line).trim().toLowerCase(),
        subject: (tabIndex >= 0 ? line.slice(tabIndex + 1) : '').trim().slice(0, 500),
      };
    });
}

async function executeLocalDevPullViaHostAgent(args = []) {
  const transportStartedUptimeMs = process.uptime() * 1000;
  const transportTelemetry = createGitPerformanceTelemetry();
  const positional = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const [repoName] = positional;

  if (!toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
    throw createPullError(
      'LOCAL_DEV_PULL_BLOCKED_HOST_AGENT_DISABLED',
      'SkyCommand Host Agent dispatch is disabled. Set SKYCOMMAND_HOST_AGENT_ENABLED=true and start the Host Agent before running Local Dev Pull.',
      {
        ok: false,
        outcome: 'BLOCKED',
        repositoryCode: repoName || null,
        profileCode: PROFILE_CODE,
        transport: 'temporal_host_agent',
      },
    );
  }

  const { temporal, hostTaskQueue, workflowId } = transportTelemetry.measureSync(
    'TEMPORAL_DISPATCH_SETUP',
    'Temporal configuration / dispatch setup',
    () => ({
      temporal: getTemporalConfig(),
      hostTaskQueue: getHostAgentTaskQueue(),
      workflowId: [
        'skycommand-host-local-dev-pull',
        String(repoName || 'repository').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80),
        randomUUID().slice(0, 8),
      ].join('-'),
    }),
  );
  const { Connection, Client } = transportTelemetry.measureSync(
    'TEMPORAL_CLIENT_LOAD',
    'Temporal client module load',
    () => require('@temporalio/client'),
  );

  console.log('');
  console.log(`[SkyCommand Host Agent] Dispatching ${TOOL_CODE} to host task queue ${hostTaskQueue}`);
  console.log(`[SkyCommand Host Agent] Temporal address=${temporal.address}`);
  console.log(`[SkyCommand Host Agent] workflowId=${workflowId}`);

  let connection = null;
  let routedResult = null;
  let routedError = null;

  try {
    connection = await transportTelemetry.measure(
      'TEMPORAL_CONNECTION',
      'Temporal connection',
      () => Connection.connect({ address: temporal.address }),
    );
    const client = new Client({ connection, namespace: temporal.namespace });
    const response = await transportTelemetry.measure(
      'HOST_WORKFLOW_DISPATCH_WAIT',
      'Host workflow dispatch + wait',
      () =>
        client.workflow.execute('skyCommandHostAgentToolWorkflow', {
          taskQueue: temporal.taskQueue,
          workflowId,
          args: [
            {
              toolCode: TOOL_CODE,
              repoName,
              hostTaskQueue,
            },
          ],
        }),
    );

    if (!response?.ok) {
      const remoteError = response?.error || {};
      throw createPullError(
        remoteError.code || 'LOCAL_DEV_PULL_HOST_AGENT_FAILED',
        remoteError.message || 'SkyCommand Host Agent failed to synchronize local dev.',
        remoteError.syncResult || {
          repositoryCode: repoName || null,
          profileCode: PROFILE_CODE,
          transport: 'temporal_host_agent',
        },
      );
    }

    routedResult = {
      ...(response.result || {}),
      transport: 'temporal_host_agent',
    };
  } catch (error) {
    if (error?.code && String(error.code).startsWith('LOCAL_DEV_PULL_')) {
      routedError = error;
    } else {
      routedError = createPullError(
        'LOCAL_DEV_PULL_HOST_AGENT_UNAVAILABLE',
        `SkyCommand Host Agent dispatch failed: ${error?.message || String(error)}`,
        {
          ok: false,
          outcome: 'FAILED',
          repositoryCode: repoName || null,
          profileCode: PROFILE_CODE,
          transport: 'temporal_host_agent',
        },
      );
    }
  } finally {
    if (connection) {
      try {
        await transportTelemetry.measure(
          'TEMPORAL_CONNECTION_SHUTDOWN',
          'Temporal connection shutdown',
          () => connection.close(),
        );
      } catch (closeError) {
        if (!routedError) {
          routedError = createPullError(
            'LOCAL_DEV_PULL_HOST_AGENT_UNAVAILABLE',
            `SkyCommand Host Agent connection shutdown failed: ${closeError?.message || String(closeError)}`,
            {
              ok: false,
              outcome: 'FAILED',
              repositoryCode: repoName || null,
              profileCode: PROFILE_CODE,
              transport: 'temporal_host_agent',
            },
          );
        }
      }
    }
  }

  const transportSnapshot = {
    ...transportTelemetry.snapshot(),
    processUptimeAtStartMs: transportStartedUptimeMs,
    processUptimeAtCompleteMs: process.uptime() * 1000,
  };

  if (routedError) {
    routedError.transportTelemetry = transportSnapshot;
    routedError.syncResult = {
      ...(routedError.syncResult || {}),
      transportTelemetry: transportSnapshot,
    };
    throw routedError;
  }

  return {
    ...routedResult,
    transportTelemetry: transportSnapshot,
  };
}

async function executeLocalDevPullRouted(args = []) {
  if (isDockerRuntime()) {
    return executeLocalDevPullViaHostAgent(args);
  }

  return executeLocalDevPull(args);
}

async function executeLocalDevPull(args = []) {
  const startedAt = new Date().toISOString();
  const telemetry = createGitPerformanceTelemetry();
  const positional = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const [repoName] = positional;
  const repo = await telemetry.measure(
    'CONFIGURATION_REPOSITORY_RESOLUTION',
    'Configuration / repository resolution',
    () => loadRepository(repoName),
  );
  const state = {
    ok: true,
    outcome: 'SYNCHRONIZED',
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    profileCode: PROFILE_CODE,
    remote: 'origin',
    devBranch: repo.devBranch,
    currentBranch: null,
    localDevBeforeSha: null,
    remoteDevBeforeSha: null,
    fetchedRemoteDevSha: null,
    localDevAfterSha: null,
    remoteDevAfterSha: null,
    currentHeadSha: null,
    commitsPulled: 0,
    commits: [],
    stashCount: 0,
    workingTreeCleanBefore: false,
    workingTreeCleanAfter: false,
    synchronized: false,
    safeguards: {
      hostProfileVerified: false,
      repositoryLockAcquired: false,
      gitOperationClear: false,
      workingTreeClean: false,
      devBranchCheckedOut: false,
      worktreeOwnershipSafe: false,
      remoteDevAhead: false,
      fastForwardSafe: false,
      localStateReverifiedBeforeMutation: false,
      remoteReverifiedBeforeMutation: false,
      finalRemoteEqualityVerified: false,
    },
    steps: {
      remoteInspected: false,
      fetched: false,
      lineageVerified: false,
      remoteReverified: false,
      fastForwardMerged: false,
      postVerified: false,
    },
    startedAt,
    warnings: [],
    transport: 'git_cli',
    performanceTelemetry: null,
  };

  telemetry.measureSync('HOST_REPOSITORY_PREFLIGHT', 'Host / repository preflight', () => {
    assertHostExecutionProfile(state);
    state.safeguards.hostProfileVerified = true;
    assertRepositoryRoot(repo, state);
  });

  const lock = telemetry.measureSync('REPOSITORY_LOCK', 'Repository lock acquisition', () =>
    acquireRepositoryLock(repo.repoCode),
  );
  state.safeguards.repositoryLockAcquired = true;

  try {
    console.log('');
    console.log(`🔒 Starting guarded Local Dev Pull for ${repo.repoCode}`);
    console.log(`📂 Repository: ${repo.rootPath}`);
    console.log(`🌿 Required checked-out branch: ${repo.devBranch}`);
    console.log(`🎯 Target: exact current origin/${repo.devBranch} head`);
    console.log('🛡️ Policy: remote must be strictly ahead; fast-forward only; no stash, reset, clean, force checkout, or local ref rewrite.');
    console.log('');

    telemetry.measureSync('LOCAL_SAFETY_PREFLIGHT', 'Local repository safety preflight', () => {
      state.currentBranch = getGitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repo.rootPath);
      if (state.currentBranch !== repo.devBranch) {
        block(
          'DEV_BRANCH_NOT_CHECKED_OUT',
          `Local Dev Pull requires ${repo.devBranch} to be checked out so the working tree used by Repo Map/ZIP is refreshed. Current branch: ${state.currentBranch || 'detached HEAD'}.`,
          state,
        );
      }
      state.safeguards.devBranchCheckedOut = true;

      assertCleanAndIdle(repo.rootPath, state);
      assertDevWorktreeOwnershipSafe({
        cwd: repo.rootPath,
        devBranch: repo.devBranch,
        state,
      });
      state.safeguards.worktreeOwnershipSafe = true;

      state.localDevBeforeSha = getGitOutput(
        ['rev-parse', '--verify', `refs/heads/${repo.devBranch}`],
        repo.rootPath,
      ).toLowerCase();
      const headSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath).toLowerCase();
      if (headSha !== state.localDevBeforeSha) {
        block(
          'DEV_HEAD_MISMATCH',
          `Checked-out HEAD ${headSha} does not match local ${repo.devBranch} ${state.localDevBeforeSha}.`,
          state,
        );
      }

      state.stashCount = getStashCount(repo.rootPath);
      if (state.stashCount > 0) {
        state.warnings.push(
          `${state.stashCount} Git stash entr${state.stashCount === 1 ? 'y exists' : 'ies exist'}; stashes were not modified.`,
        );
      }
    });

    state.remoteDevBeforeSha = telemetry.measureSync(
      'REMOTE_DEV_INSPECTION',
      'Authoritative origin/dev inspection',
      () => getRemoteDevSha('origin', repo.devBranch, repo.rootPath),
    );
    state.steps.remoteInspected = true;

    if (state.remoteDevBeforeSha === state.localDevBeforeSha) {
      block(
        'REMOTE_NOT_AHEAD',
        `origin/${repo.devBranch} is not ahead of local ${repo.devBranch}; both are already at ${state.localDevBeforeSha}. This workflow is intended only for remote-ahead convergence.`,
        state,
      );
    }

    telemetry.measureSync('REMOTE_FETCH', 'Fetch origin/dev', () => {
      executeGit(
        [
          'fetch',
          '--no-tags',
          'origin',
          `+refs/heads/${repo.devBranch}:refs/remotes/origin/${repo.devBranch}`,
        ],
        repo.rootPath,
        { capture: true, echoOutput: true },
      );
    });
    state.steps.fetched = true;
    state.fetchedRemoteDevSha = getGitOutput(
      ['rev-parse', '--verify', `refs/remotes/origin/${repo.devBranch}`],
      repo.rootPath,
    ).toLowerCase();

    if (state.fetchedRemoteDevSha !== state.remoteDevBeforeSha) {
      block(
        'FETCHED_REMOTE_MISMATCH',
        `Fetched origin/${repo.devBranch} ${state.fetchedRemoteDevSha} does not match authoritative remote head ${state.remoteDevBeforeSha}.`,
        state,
      );
    }

    telemetry.measureSync('LINEAGE_VERIFICATION', 'Remote-ahead fast-forward lineage verification', () => {
      if (!isGitAncestor(state.localDevBeforeSha, state.remoteDevBeforeSha, repo.rootPath)) {
        if (isGitAncestor(state.remoteDevBeforeSha, state.localDevBeforeSha, repo.rootPath)) {
          block(
            'LOCAL_DEV_AHEAD',
            `Local ${repo.devBranch} at ${state.localDevBeforeSha} is ahead of origin/${repo.devBranch} at ${state.remoteDevBeforeSha}; refusing to rewrite or push either side.`,
            state,
          );
        }

        block(
          'DEV_DIVERGED',
          `Local ${repo.devBranch} ${state.localDevBeforeSha} and origin/${repo.devBranch} ${state.remoteDevBeforeSha} have diverged. Manual reconciliation is required.`,
          state,
        );
      }

      state.commitsPulled = Number(
        getGitOutput(
          ['rev-list', '--count', `${state.localDevBeforeSha}..${state.remoteDevBeforeSha}`],
          repo.rootPath,
        ),
      );
      if (!Number.isInteger(state.commitsPulled) || state.commitsPulled < 1) {
        block(
          'REMOTE_NOT_AHEAD',
          `origin/${repo.devBranch} did not contain one or more fast-forward commits beyond local ${repo.devBranch}.`,
          state,
        );
      }

      state.commits = getCommitDetails(
        repo.rootPath,
        state.localDevBeforeSha,
        state.remoteDevBeforeSha,
      );
      if (state.commitsPulled > MAX_COMMIT_DETAILS) {
        state.warnings.push(
          `${state.commitsPulled} commits will be pulled; structured commit detail is capped at the first ${MAX_COMMIT_DETAILS}.`,
        );
      }
      state.safeguards.remoteDevAhead = true;
      state.safeguards.fastForwardSafe = true;
      state.steps.lineageVerified = true;
    });

    telemetry.measureSync('LOCAL_REVERIFICATION', 'Local compare-and-swap re-verification', () => {
      assertCleanAndIdle(repo.rootPath, state);
      const currentBranch = getGitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repo.rootPath);
      const currentLocalDev = getGitOutput(
        ['rev-parse', '--verify', `refs/heads/${repo.devBranch}`],
        repo.rootPath,
      ).toLowerCase();
      const currentHead = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath).toLowerCase();

      if (currentBranch !== repo.devBranch) {
        block(
          'DEV_BRANCH_CHANGED_DURING_PULL',
          `Checked-out branch changed during Local Dev Pull preflight. Expected ${repo.devBranch}, found ${currentBranch}.`,
          state,
        );
      }
      if (currentLocalDev !== state.localDevBeforeSha || currentHead !== state.localDevBeforeSha) {
        block(
          'LOCAL_DEV_CHANGED_DURING_PULL',
          `Local ${repo.devBranch} changed during Local Dev Pull preflight. Expected ${state.localDevBeforeSha}, found ref ${currentLocalDev} / HEAD ${currentHead}.`,
          state,
        );
      }
      state.safeguards.localStateReverifiedBeforeMutation = true;
    });

    const remoteImmediatelyBeforeMutation = telemetry.measureSync(
      'REMOTE_REVERIFICATION',
      'Remote dev re-verification',
      () => getRemoteDevSha('origin', repo.devBranch, repo.rootPath),
    );
    state.steps.remoteReverified = true;
    if (remoteImmediatelyBeforeMutation !== state.remoteDevBeforeSha) {
      block(
        'REMOTE_CHANGED_DURING_PULL',
        `origin/${repo.devBranch} moved from ${state.remoteDevBeforeSha} to ${remoteImmediatelyBeforeMutation} before local mutation. No local branch was changed; rerun against the new head.`,
        state,
      );
    }
    state.safeguards.remoteReverifiedBeforeMutation = true;

    telemetry.measureSync('FAST_FORWARD_MERGE', 'Fast-forward local dev working tree', () => {
      executeGit(['merge', '--ff-only', state.remoteDevBeforeSha], repo.rootPath, {
        capture: true,
        echoOutput: true,
      });
    });
    state.steps.fastForwardMerged = true;

    telemetry.measureSync('POST_PULL_LOCAL_VERIFICATION', 'Post-pull local verification', () => {
      state.localDevAfterSha = getGitOutput(
        ['rev-parse', '--verify', `refs/heads/${repo.devBranch}`],
        repo.rootPath,
      ).toLowerCase();
      state.currentHeadSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath).toLowerCase();
      state.workingTreeCleanAfter = getWorkingTreeStatus(repo.rootPath) === '';

      if (
        state.localDevAfterSha !== state.remoteDevBeforeSha ||
        state.currentHeadSha !== state.remoteDevBeforeSha
      ) {
        throw createPullError(
          'LOCAL_DEV_PULL_POSTCHECK_LOCAL_MISMATCH',
          `Local ${repo.devBranch} did not finish at the verified remote target ${state.remoteDevBeforeSha}.`,
          state,
        );
      }
      if (!state.workingTreeCleanAfter) {
        throw createPullError(
          'LOCAL_DEV_PULL_POSTCHECK_DIRTY',
          'Working tree became dirty during Local Dev Pull.',
          state,
        );
      }
    });

    state.remoteDevAfterSha = telemetry.measureSync(
      'POST_PULL_REMOTE_VERIFICATION',
      'Post-pull authoritative remote verification',
      () => getRemoteDevSha('origin', repo.devBranch, repo.rootPath),
    );

    if (state.remoteDevAfterSha !== state.localDevAfterSha) {
      throw createPullError(
        'LOCAL_DEV_PULL_REMOTE_MOVED_AFTER_SYNC',
        `Local ${repo.devBranch} safely reached ${state.localDevAfterSha}, but origin/${repo.devBranch} moved again to ${state.remoteDevAfterSha} before final verification. Workflow execution must stop and Local Dev Pull should be rerun.`,
        state,
      );
    }

    state.safeguards.finalRemoteEqualityVerified = true;
    state.synchronized = true;
    state.steps.postVerified = true;
    state.completedAt = new Date().toISOString();
    state.durationMs = Math.max(0, new Date(state.completedAt) - new Date(startedAt));
    state.performanceTelemetry = telemetry.snapshot();

    console.log('');
    console.log(`✅ Local ${repo.devBranch} fast-forwarded by ${state.commitsPulled} commit${state.commitsPulled === 1 ? '' : 's'}.`);
    console.log(`   before: ${state.localDevBeforeSha}`);
    console.log(`   after:  ${state.localDevAfterSha}`);
    console.log(`   origin/${repo.devBranch}: ${state.remoteDevAfterSha}`);
    console.log('');

    return state;
  } catch (error) {
    state.performanceTelemetry = telemetry.snapshot();
    error.syncResult = { ...state, ...(error.syncResult || {}) };
    throw error;
  } finally {
    lock.release();
  }
}

function printLocalDevPullResult(result) {
  console.log(
    `📋 Structured result: ${result.repositoryCode} local ${result.devBranch} synchronized to ${result.currentHeadSha} from origin/${result.devBranch} (${result.commitsPulled} commit${result.commitsPulled === 1 ? '' : 's'}).`,
  );
}

async function closePool() {
  try {
    await pool.end();
  } catch {
    /* CLI shutdown */
  }
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  try {
    return await runToolCli({
      toolCode: TOOL_CODE,
      outputType: OUTPUT_TYPE,
      args,
      execute: executeLocalDevPullRouted,
      createToolResult: createGitDevPullToolResult,
      createFailureToolResult: (error) =>
        createGitDevPullFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printLocalDevPullResult,
    });
  } finally {
    await closePool();
  }
}

async function flushWritableStream(stream) {
  if (!stream || stream.destroyed || stream.writableEnded) return;
  await new Promise((resolve) => {
    stream.write('', () => resolve());
  });
}

async function runCliEntrypoint(args = process.argv.slice(2)) {
  try {
    await main(args);
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }

  if (!isDockerRuntime()) return;

  await Promise.all([flushWritableStream(process.stdout), flushWritableStream(process.stderr)]);
  process.exit(process.exitCode || 0);
}

if (require.main === module) {
  void runCliEntrypoint();
}

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  executeLocalDevPull,
  executeLocalDevPullRouted,
  executeLocalDevPullViaHostAgent,
  getRemoteDevSha,
  main,
  printLocalDevPullResult,
  runCliEntrypoint,
};
