#!/usr/bin/env node

/**
 * Safely synchronizes host-owned local main/dev Git refs after a Docker-executed
 * Development Promotion has already synchronized the authoritative remote.
 *
 * Host execution mutates local refs directly. Docker execution never mutates the
 * mounted host .git tree; it dispatches the same guarded operation to the dedicated
 * SkyCommand Host Agent Temporal activity queue.
 *
 * Usage:
 *   node local_repo_sync.js <repoName> <expectedLocalDevSha> <expectedSynchronizedHeadSha>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createGitLocalSyncFailureToolResult,
  createGitLocalSyncToolResult,
} = require('./gitLocalSyncResult');
const { getTemporalConfig } = require('../../temporal/src/config');
const {
  DEFAULT_HOST_AGENT_TASK_QUEUE,
} = require('../../host-agent/src/config');

const SKY_COMMAND_ROOT = path.resolve(__dirname, '../../..');
const TOOL_CODE = 'local_repo_sync';
const OUTPUT_TYPE = 'git_local_sync_summary.v1';
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL';

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

dotenv.config({ path: path.join(SKY_COMMAND_ROOT, '.env') });
const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
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

function normalizeSha(value, label) {
  const sha = String(value || '').trim();
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    const error = new Error(`${label} must be a full 40- or 64-character Git object ID.`);
    error.code = 'LOCAL_REPOSITORY_SYNC_SHA_INVALID';
    throw error;
  }
  return sha.toLowerCase();
}

function createSyncError(code, message, state = {}) {
  const error = new Error(message);
  error.code = code;
  error.syncResult = { ...state };
  return error;
}

function block(codeSuffix, message, state = {}) {
  throw createSyncError(`LOCAL_REPOSITORY_SYNC_BLOCKED_${codeSuffix}`, message, state);
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
    throw createSyncError(
      timedOut ? 'LOCAL_REPOSITORY_SYNC_GIT_TIMEOUT' : 'LOCAL_REPOSITORY_SYNC_GIT_FAILED',
      timedOut
        ? `Git command timed out after ${GIT_COMMAND_TIMEOUT_MS} ms: git ${args.join(' ')}`
        : `Git command failed: ${result.error.message}`,
    );
  }

  if (!allowedStatuses.has(result.status)) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_GIT_FAILED',
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

function tryGetGitOutput(args, cwd) {
  const result = executeGit(args, cwd, {
    capture: true,
    allowedStatuses: [0, 1, 128],
    printCommand: false,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function isGitAncestor(ancestorRef, descendantRef, cwd) {
  const result = executeGit(['merge-base', '--is-ancestor', ancestorRef, descendantRef], cwd, {
    capture: true,
    allowedStatuses: [0, 1],
    printCommand: false,
  });
  return result.status === 0;
}

function getRemoteBranchSha(remote, branch, cwd) {
  const ref = `refs/heads/${branch}`;
  const output = getGitOutput(['ls-remote', '--heads', remote, ref], cwd, {
    printCommand: true,
  });
  const [sha] = String(output || '').split(/\s+/);
  if (!sha) {
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_REMOTE_BRANCH_MISSING',
      `Remote branch ${remote}/${branch} was not found.`,
    );
  }
  return sha.toLowerCase();
}

function normalizePathForComparison(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getGitPath(cwd, gitPathName) {
  const raw = getGitOutput(['rev-parse', '--git-path', gitPathName], cwd);
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
  return markers.filter((marker) => fs.existsSync(getGitPath(cwd, marker)));
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

function assertWorktreeOwnershipSafe({ cwd, mainBranch, devBranch, state }) {
  const root = normalizePathForComparison(cwd);
  const protectedRefs = new Set([
    `refs/heads/${mainBranch}`,
    `refs/heads/${devBranch}`,
  ]);
  const conflicts = parseWorktrees(cwd).filter(
    (entry) =>
      protectedRefs.has(entry.branch) && normalizePathForComparison(entry.path) !== root,
  );

  if (conflicts.length > 0) {
    block(
      'BRANCH_CHECKED_OUT_ELSEWHERE',
      `Refusing local synchronization because ${conflicts.map((entry) => `${entry.branch} is checked out at ${entry.path}`).join('; ')}.`,
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
  const lockPath = path.join(lockDirectory, `${safeRepoCode}.local-sync.lock`);
  fs.mkdirSync(lockDirectory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      const payload = {
        pid: process.pid,
        hostname: os.hostname(),
        repoCode,
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

      throw createSyncError(
        'LOCAL_REPOSITORY_SYNC_BLOCKED_LOCK_HELD',
        `Local repository synchronization lock is already held for ${repoCode}: ${lockPath}`,
      );
    }
  }

  throw createSyncError(
    'LOCAL_REPOSITORY_SYNC_BLOCKED_LOCK_HELD',
    `Unable to acquire local repository synchronization lock for ${repoCode}.`,
  );
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
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_REPOSITORY_REQUIRED',
      'Missing repoName. Usage: node local_repo_sync.js <repoName> <expectedLocalDevSha> <expectedSynchronizedHeadSha>',
    );
  }
  const result = await pool.query(
    `SELECT r.repo_code, r.repo_name, r.main_branch, r.dev_branch, rp.root_path
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
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_REPOSITORY_UNKNOWN',
      `Unknown repo '${repoName}'. Available repos: ${(await listAvailableRepositories()).join(', ')}`,
    );
  }

  const row = result.rows[0];
  if (!row.root_path || !fs.existsSync(row.root_path)) {
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_REPOSITORY_PATH_MISSING',
      `Repository path does not exist: ${row.root_path}`,
    );
  }

  return {
    repoCode: row.repo_code,
    repoName: row.repo_name,
    mainBranch: row.main_branch || 'main',
    devBranch: row.dev_branch || 'dev',
    rootPath: row.root_path,
  };
}

function assertHostExecutionProfile(state = {}) {
  if (String(PROFILE_CODE || '').trim().toUpperCase() === DOCKER_LOCAL_PROFILE) {
    block(
      'HOST_REQUIRED',
      'Local Repository Sync is host-only and refuses DOCKER_LOCAL execution. Run it from the host CLI/host agent using a host repository profile.',
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
      `Refusing local synchronization while Git operation markers are present: ${blockers.join(', ')}.`,
      state,
    );
  }
  state.safeguards.gitOperationClear = true;

  const status = getWorkingTreeStatus(cwd);
  if (status) {
    block(
      'WORKING_TREE_DIRTY',
      `Refusing local synchronization because the working tree has staged, unstaged, untracked, deleted, renamed, or submodule changes.\n${status}`,
      state,
    );
  }
  state.safeguards.workingTreeClean = true;
  state.workingTreeCleanBefore = true;
}

function assertCommitExists(sha, cwd, label, state) {
  const result = executeGit(['cat-file', '-e', `${sha}^{commit}`], cwd, {
    capture: true,
    allowedStatuses: [0, 1, 128],
    printCommand: false,
  });
  if (result.status !== 0) {
    block('EXPECTED_COMMIT_MISSING', `${label} commit ${sha} is not available locally.`, state);
  }
}

function updateNonCheckedOutBranch({ branch, targetSha, expectedOldSha, cwd, state }) {
  const ref = `refs/heads/${branch}`;
  if (expectedOldSha === targetSha) return false;

  const objectFormat = tryGetGitOutput(['rev-parse', '--show-object-format'], cwd) || 'sha1';
  const zeroOid = '0'.repeat(objectFormat === 'sha256' ? 64 : 40);
  executeGit(['update-ref', ref, targetSha, expectedOldSha || zeroOid], cwd, {
    capture: true,
    echoOutput: true,
  });
  return true;
}

function updateCheckedOutBranch({ branch, targetSha, cwd }) {
  console.log(`> git merge --ff-only ${targetSha}  # checked-out ${branch}`);
  const result = executeGit(['merge', '--ff-only', targetSha], cwd, {
    capture: true,
    printCommand: false,
    echoOutput: true,
  });
  return result.status === 0;
}

async function executeLocalRepositorySyncViaHostAgent(args = []) {
  const positional = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const [repoName, rawExpectedLocalDevSha, rawExpectedSynchronizedHeadSha] = positional;
  const expectedLocalDevSha = normalizeSha(rawExpectedLocalDevSha, 'expectedLocalDevSha');
  const expectedSynchronizedHeadSha = normalizeSha(
    rawExpectedSynchronizedHeadSha,
    'expectedSynchronizedHeadSha',
  );

  if (!toBoolean(process.env.SKYCOMMAND_HOST_AGENT_ENABLED)) {
    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_BLOCKED_HOST_AGENT_DISABLED',
      'SkyCommand Host Agent dispatch is disabled. Set SKYCOMMAND_HOST_AGENT_ENABLED=true and start npm run host-agent on the repository host.',
      {
        ok: false,
        outcome: 'BLOCKED',
        repositoryCode: repoName || null,
        expectedLocalDevSha,
        expectedSynchronizedHeadSha,
        profileCode: PROFILE_CODE,
        transport: 'temporal_host_agent',
      },
    );
  }

  const temporal = getTemporalConfig();
  const hostTaskQueue = getHostAgentTaskQueue();
  const workflowId = [
    'skycommand-host-local-sync',
    String(repoName || 'repository').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80),
    expectedSynchronizedHeadSha.slice(0, 12),
    randomUUID().slice(0, 8),
  ].join('-');
  const { Connection, Client } = require('@temporalio/client');

  console.log('');
  console.log(`[SkyCommand Host Agent] Dispatching ${TOOL_CODE} to host task queue ${hostTaskQueue}`);
  console.log(`[SkyCommand Host Agent] Temporal address=${temporal.address}`);
  console.log(`[SkyCommand Host Agent] workflowId=${workflowId}`);

  let connection = null;
  try {
    connection = await Connection.connect({ address: temporal.address });
    const client = new Client({
      connection,
      namespace: temporal.namespace,
    });
    const response = await client.workflow.execute('skyCommandHostAgentToolWorkflow', {
      taskQueue: temporal.taskQueue,
      workflowId,
      args: [
        {
          toolCode: TOOL_CODE,
          repoName,
          expectedLocalDevSha,
          expectedSynchronizedHeadSha,
          hostTaskQueue,
        },
      ],
    });

    if (!response?.ok) {
      const remoteError = response?.error || {};
      const error = createSyncError(
        remoteError.code || 'LOCAL_REPOSITORY_SYNC_HOST_AGENT_FAILED',
        remoteError.message || 'SkyCommand Host Agent failed to synchronize the local repository.',
        remoteError.syncResult || {
          repositoryCode: repoName || null,
          expectedLocalDevSha,
          expectedSynchronizedHeadSha,
          profileCode: PROFILE_CODE,
          transport: 'temporal_host_agent',
        },
      );
      throw error;
    }

    return {
      ...(response.result || {}),
      transport: 'temporal_host_agent',
    };
  } catch (error) {
    if (error?.code && String(error.code).startsWith('LOCAL_REPOSITORY_SYNC_')) {
      throw error;
    }

    throw createSyncError(
      'LOCAL_REPOSITORY_SYNC_HOST_AGENT_UNAVAILABLE',
      `SkyCommand Host Agent dispatch failed: ${error?.message || String(error)}`,
      {
        ok: false,
        outcome: 'FAILED',
        repositoryCode: repoName || null,
        expectedLocalDevSha,
        expectedSynchronizedHeadSha,
        profileCode: PROFILE_CODE,
        transport: 'temporal_host_agent',
      },
    );
  } finally {
    if (connection) {
      await connection.close();
    }
  }
}

async function executeLocalRepositorySyncRouted(args = []) {
  if (isDockerRuntime()) {
    return executeLocalRepositorySyncViaHostAgent(args);
  }

  return executeLocalRepositorySync(args);
}

async function executeLocalRepositorySync(args = []) {
  const startedAt = new Date().toISOString();
  const positional = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const [repoName, rawExpectedLocalDevSha, rawExpectedSynchronizedHeadSha] = positional;
  const expectedLocalDevSha = normalizeSha(rawExpectedLocalDevSha, 'expectedLocalDevSha');
  const expectedSynchronizedHeadSha = normalizeSha(
    rawExpectedSynchronizedHeadSha,
    'expectedSynchronizedHeadSha',
  );
  const repo = await loadRepository(repoName);
  const state = {
    ok: true,
    outcome: 'SYNCHRONIZED',
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    profileCode: PROFILE_CODE,
    remote: 'origin',
    mainBranch: repo.mainBranch,
    devBranch: repo.devBranch,
    currentBranch: null,
    expectedLocalDevSha,
    expectedSynchronizedHeadSha,
    localMainBeforeSha: null,
    localDevBeforeSha: null,
    remoteMainBeforeSha: null,
    remoteDevBeforeSha: null,
    localMainAfterSha: null,
    localDevAfterSha: null,
    remoteMainAfterSha: null,
    remoteDevAfterSha: null,
    stashCount: 0,
    workingTreeCleanBefore: false,
    workingTreeCleanAfter: false,
    mainRefUpdated: false,
    devRefUpdated: false,
    checkedOutBranchUpdated: false,
    fourWaySynchronized: false,
    safeguards: {
      hostProfileVerified: false,
      repositoryLockAcquired: false,
      gitOperationClear: false,
      workingTreeClean: false,
      worktreeOwnershipSafe: false,
      devBaselineMatched: false,
      remoteTargetMatched: false,
      localMainFastForwardSafe: false,
      localDevFastForwardSafe: false,
      remoteReverifiedBeforeMutation: false,
    },
    steps: {
      remoteInspected: false,
      fetched: false,
      mainRefUpdated: false,
      devRefUpdated: false,
      remoteReverified: false,
      postVerified: false,
    },
    startedAt,
    warnings: [],
  };

  assertHostExecutionProfile(state);
  state.safeguards.hostProfileVerified = true;
  assertRepositoryRoot(repo, state);

  const lock = acquireRepositoryLock(repo.repoCode);
  state.safeguards.repositoryLockAcquired = true;

  try {
    console.log('');
    console.log(`🔒 Starting guarded host repository synchronization for ${repo.repoCode}`);
    console.log(`📂 Repository: ${repo.rootPath}`);
    console.log(`🌿 Local dev baseline: ${expectedLocalDevSha}`);
    console.log(`🎯 Approved synchronized head: ${expectedSynchronizedHeadSha}`);
    console.log('🛡️ Policy: fast-forward-only; no reset --hard, clean, forced checkout, or blind ref rewrite.');
    console.log('');

    state.currentBranch = getGitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], repo.rootPath);
    assertCleanAndIdle(repo.rootPath, state);
    assertWorktreeOwnershipSafe({
      cwd: repo.rootPath,
      mainBranch: repo.mainBranch,
      devBranch: repo.devBranch,
      state,
    });
    state.safeguards.worktreeOwnershipSafe = true;

    state.stashCount = getStashCount(repo.rootPath);
    if (state.stashCount > 0) {
      state.warnings.push(
        `${state.stashCount} Git stash entr${state.stashCount === 1 ? 'y exists' : 'ies exist'}; stashes were not modified.`,
      );
    }

    state.localMainBeforeSha = tryGetGitOutput(
      ['rev-parse', '--verify', `refs/heads/${repo.mainBranch}`],
      repo.rootPath,
    );
    state.localDevBeforeSha = tryGetGitOutput(
      ['rev-parse', '--verify', `refs/heads/${repo.devBranch}`],
      repo.rootPath,
    );

    if (!state.localDevBeforeSha) {
      block('LOCAL_DEV_MISSING', `Local ${repo.devBranch} branch does not exist.`, state);
    }
    if (
      state.localDevBeforeSha !== expectedLocalDevSha &&
      state.localDevBeforeSha !== expectedSynchronizedHeadSha
    ) {
      block(
        'LOCAL_DEV_CHANGED',
        `Local ${repo.devBranch} changed after the trusted Dev Commit baseline. Expected ${expectedLocalDevSha} (or already-synchronized ${expectedSynchronizedHeadSha}), found ${state.localDevBeforeSha}. No refs were modified.`,
        state,
      );
    }
    state.safeguards.devBaselineMatched = true;

    state.remoteMainBeforeSha = getRemoteBranchSha('origin', repo.mainBranch, repo.rootPath);
    state.remoteDevBeforeSha = getRemoteBranchSha('origin', repo.devBranch, repo.rootPath);
    state.steps.remoteInspected = true;
    if (
      state.remoteMainBeforeSha !== expectedSynchronizedHeadSha ||
      state.remoteDevBeforeSha !== expectedSynchronizedHeadSha
    ) {
      block(
        'REMOTE_CHANGED',
        `Remote main/dev no longer match the approved synchronized head ${expectedSynchronizedHeadSha}. origin/${repo.mainBranch}=${state.remoteMainBeforeSha}; origin/${repo.devBranch}=${state.remoteDevBeforeSha}.`,
        state,
      );
    }

    executeGit(['fetch', '--prune', '--no-tags', 'origin'], repo.rootPath, {
      capture: true,
      echoOutput: true,
    });
    state.steps.fetched = true;

    const trackingMainSha = getGitOutput(
      ['rev-parse', `refs/remotes/origin/${repo.mainBranch}`],
      repo.rootPath,
    ).toLowerCase();
    const trackingDevSha = getGitOutput(
      ['rev-parse', `refs/remotes/origin/${repo.devBranch}`],
      repo.rootPath,
    ).toLowerCase();
    if (
      trackingMainSha !== expectedSynchronizedHeadSha ||
      trackingDevSha !== expectedSynchronizedHeadSha
    ) {
      block(
        'REMOTE_TRACKING_MISMATCH',
        `Fetched remote-tracking refs do not match approved head ${expectedSynchronizedHeadSha}.`,
        state,
      );
    }
    state.safeguards.remoteTargetMatched = true;

    assertCommitExists(expectedLocalDevSha, repo.rootPath, 'Trusted local-dev baseline', state);
    assertCommitExists(expectedSynchronizedHeadSha, repo.rootPath, 'Approved synchronized head', state);

    if (!isGitAncestor(expectedLocalDevSha, expectedSynchronizedHeadSha, repo.rootPath)) {
      block(
        'DEV_NOT_FAST_FORWARD',
        `Trusted local dev baseline ${expectedLocalDevSha} is not an ancestor of approved head ${expectedSynchronizedHeadSha}.`,
        state,
      );
    }
    state.safeguards.localDevFastForwardSafe = true;

    if (
      state.localMainBeforeSha &&
      state.localMainBeforeSha !== expectedSynchronizedHeadSha &&
      !isGitAncestor(state.localMainBeforeSha, expectedSynchronizedHeadSha, repo.rootPath)
    ) {
      block(
        'LOCAL_MAIN_DIVERGED',
        `Local ${repo.mainBranch} at ${state.localMainBeforeSha} is not a fast-forward ancestor of ${expectedSynchronizedHeadSha}.`,
        state,
      );
    }
    state.safeguards.localMainFastForwardSafe = true;

    // Re-check all host-owned state immediately before any ref mutation. This is
    // the compare-and-swap guard against a manual commit/file edit during the run.
    assertCleanAndIdle(repo.rootPath, state);
    const devImmediatelyBeforeMutation = getGitOutput(
      ['rev-parse', `refs/heads/${repo.devBranch}`],
      repo.rootPath,
    ).toLowerCase();
    const mainImmediatelyBeforeMutation = tryGetGitOutput(
      ['rev-parse', '--verify', `refs/heads/${repo.mainBranch}`],
      repo.rootPath,
    );
    if (devImmediatelyBeforeMutation !== state.localDevBeforeSha) {
      block(
        'LOCAL_DEV_CHANGED_DURING_SYNC',
        `Local ${repo.devBranch} changed during synchronization preflight. Expected ${state.localDevBeforeSha}, found ${devImmediatelyBeforeMutation}.`,
        state,
      );
    }
    if ((mainImmediatelyBeforeMutation || null) !== (state.localMainBeforeSha || null)) {
      block(
        'LOCAL_MAIN_CHANGED_DURING_SYNC',
        `Local ${repo.mainBranch} changed during synchronization preflight.`,
        state,
      );
    }

    const remoteMainImmediatelyBeforeMutation = getRemoteBranchSha(
      'origin',
      repo.mainBranch,
      repo.rootPath,
    );
    const remoteDevImmediatelyBeforeMutation = getRemoteBranchSha(
      'origin',
      repo.devBranch,
      repo.rootPath,
    );
    state.steps.remoteReverified = true;
    if (
      remoteMainImmediatelyBeforeMutation !== expectedSynchronizedHeadSha ||
      remoteDevImmediatelyBeforeMutation !== expectedSynchronizedHeadSha
    ) {
      block(
        'REMOTE_CHANGED_DURING_SYNC',
        `Remote branch heads changed during local synchronization preflight. No local refs were modified.`,
        state,
      );
    }
    state.safeguards.remoteReverifiedBeforeMutation = true;

    const alreadySynchronized =
      state.localMainBeforeSha === expectedSynchronizedHeadSha &&
      state.localDevBeforeSha === expectedSynchronizedHeadSha;

    if (!alreadySynchronized) {
      if (state.currentBranch === repo.mainBranch) {
        state.mainRefUpdated = state.localMainBeforeSha !== expectedSynchronizedHeadSha
          ? updateCheckedOutBranch({
              branch: repo.mainBranch,
              targetSha: expectedSynchronizedHeadSha,
              cwd: repo.rootPath,
            })
          : false;
        state.checkedOutBranchUpdated ||= state.mainRefUpdated;
      } else {
        state.mainRefUpdated = updateNonCheckedOutBranch({
          branch: repo.mainBranch,
          targetSha: expectedSynchronizedHeadSha,
          expectedOldSha: state.localMainBeforeSha,
          cwd: repo.rootPath,
          state,
        });
      }
      state.steps.mainRefUpdated = state.mainRefUpdated;

      if (state.currentBranch === repo.devBranch) {
        state.devRefUpdated = state.localDevBeforeSha !== expectedSynchronizedHeadSha
          ? updateCheckedOutBranch({
              branch: repo.devBranch,
              targetSha: expectedSynchronizedHeadSha,
              cwd: repo.rootPath,
            })
          : false;
        state.checkedOutBranchUpdated ||= state.devRefUpdated;
      } else {
        state.devRefUpdated = updateNonCheckedOutBranch({
          branch: repo.devBranch,
          targetSha: expectedSynchronizedHeadSha,
          expectedOldSha: state.localDevBeforeSha,
          cwd: repo.rootPath,
          state,
        });
      }
      state.steps.devRefUpdated = state.devRefUpdated;
    }

    const finalStatus = getWorkingTreeStatus(repo.rootPath);
    state.workingTreeCleanAfter = finalStatus === '';
    if (!state.workingTreeCleanAfter) {
      throw createSyncError(
        'LOCAL_REPOSITORY_SYNC_POSTCHECK_DIRTY',
        `Working tree became dirty during local synchronization.\n${finalStatus}`,
        state,
      );
    }

    state.localMainAfterSha = getGitOutput(
      ['rev-parse', `refs/heads/${repo.mainBranch}`],
      repo.rootPath,
    ).toLowerCase();
    state.localDevAfterSha = getGitOutput(
      ['rev-parse', `refs/heads/${repo.devBranch}`],
      repo.rootPath,
    ).toLowerCase();
    state.remoteMainAfterSha = getRemoteBranchSha('origin', repo.mainBranch, repo.rootPath);
    state.remoteDevAfterSha = getRemoteBranchSha('origin', repo.devBranch, repo.rootPath);

    state.fourWaySynchronized = [
      state.localMainAfterSha,
      state.localDevAfterSha,
      state.remoteMainAfterSha,
      state.remoteDevAfterSha,
    ].every((sha) => sha === expectedSynchronizedHeadSha);

    if (!state.fourWaySynchronized) {
      throw createSyncError(
        'LOCAL_REPOSITORY_SYNC_POSTCHECK_MISMATCH',
        'Post-sync verification failed: local main/dev and origin main/dev are not all at the approved synchronized head.',
        state,
      );
    }
    state.steps.postVerified = true;
    state.outcome = alreadySynchronized ? 'ALREADY_SYNCHRONIZED' : 'SYNCHRONIZED';
    state.completedAt = new Date().toISOString();
    state.durationMs = Math.max(0, new Date(state.completedAt) - new Date(startedAt));

    console.log('');
    console.log(`✅ Four-way repository synchronization verified at ${expectedSynchronizedHeadSha}.`);
    console.log(`   local ${repo.mainBranch}:  ${state.localMainAfterSha}`);
    console.log(`   local ${repo.devBranch}:   ${state.localDevAfterSha}`);
    console.log(`   origin/${repo.mainBranch}: ${state.remoteMainAfterSha}`);
    console.log(`   origin/${repo.devBranch}:  ${state.remoteDevAfterSha}`);
    console.log('');

    return state;
  } catch (error) {
    error.syncResult = { ...state, ...(error.syncResult || {}) };
    throw error;
  } finally {
    lock.release();
  }
}

function printLocalRepositorySyncResult(result) {
  console.log(
    `📋 Structured result: ${result.repositoryCode} local main/dev ${String(result.outcome || 'synchronized').toLowerCase()} at ${result.expectedSynchronizedHeadSha}.`,
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
      execute: executeLocalRepositorySyncRouted,
      createToolResult: createGitLocalSyncToolResult,
      createFailureToolResult: (error) =>
        createGitLocalSyncFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printLocalRepositorySyncResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  executeLocalRepositorySync,
  executeLocalRepositorySyncRouted,
  executeLocalRepositorySyncViaHostAgent,
  main,
  normalizeSha,
  printLocalRepositorySyncResult,
};
