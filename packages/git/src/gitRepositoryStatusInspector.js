const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
const CONFLICT_STATUS_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function normalizeTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 10000
    ? parsed
    : DEFAULT_GIT_COMMAND_TIMEOUT_MS;
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
  const allowedStatuses = new Set(options.allowedStatuses || [0]);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    timeout: timeoutMs,
    env: getGitEnvironment(),
  });

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    const error = new Error(
      timedOut
        ? `Git command timed out after ${timeoutMs} ms: git ${args.join(' ')}`
        : `Git command failed: ${result.error.message}`,
    );
    error.code = timedOut ? 'GIT_COMMAND_TIMEOUT' : 'GIT_COMMAND_ERROR';
    error.command = `git ${args.join(' ')}`;
    throw error;
  }

  if (!allowedStatuses.has(result.status)) {
    const detail = String(result.stderr || result.stdout || '').trim();
    const error = new Error(
      [`Git command failed: git ${args.join(' ')}`, detail].filter(Boolean).join(' - '),
    );
    error.code = 'GIT_COMMAND_FAILED';
    error.command = `git ${args.join(' ')}`;
    error.status = result.status;
    throw error;
  }

  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function tryExecuteGit(args, cwd, options = {}) {
  try {
    const result = executeGit(args, cwd, {
      ...options,
      allowedStatuses: options.allowedStatuses || [0, 1, 128],
    });

    return {
      ok: result.status === 0,
      ...result,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error.status ?? null,
      stdout: '',
      stderr: '',
      error,
    };
  }
}

function getGitOutput(args, cwd, options = {}) {
  return executeGit(args, cwd, options).stdout;
}

function nullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function getOptionalGitOutput(args, cwd, options = {}) {
  const result = tryExecuteGit(args, cwd, options);
  return result.ok ? nullableString(result.stdout) : null;
}

function parsePorcelainStatus(output = '') {
  const entries = String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const indexStatus = line[0] || ' ';
      const workTreeStatus = line[1] || ' ';
      const statusCode = `${indexStatus}${workTreeStatus}`;
      const filePath = line.length > 3 ? line.slice(3).trim() : '';
      const conflicted = CONFLICT_STATUS_CODES.has(statusCode);
      const untracked = statusCode === '??';
      const staged = !conflicted && !untracked && indexStatus !== ' ' && indexStatus !== '?';
      const modified = !conflicted && !untracked && workTreeStatus !== ' ' && workTreeStatus !== '?';

      return {
        path: filePath,
        indexStatus,
        workTreeStatus,
        staged,
        modified,
        untracked,
        conflicted,
      };
    });

  return {
    clean: entries.length === 0,
    hasChanges: entries.length > 0,
    staged: entries.filter((entry) => entry.staged).length,
    modified: entries.filter((entry) => entry.modified).length,
    untracked: entries.filter((entry) => entry.untracked).length,
    conflicted: entries.filter((entry) => entry.conflicted).length,
    totalChanges: entries.length,
    entries,
  };
}

function parseAheadBehind(output = '') {
  const [aheadValue, behindValue] = String(output || '').trim().split(/\s+/);
  const ahead = Number(aheadValue);
  const behind = Number(behindValue);

  return {
    ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : null,
    behind: Number.isFinite(behind) && behind >= 0 ? behind : null,
  };
}

function parseCommitRecord(record = '') {
  const [sha, shortSha, decorations, subject, authorName, authoredAt] = String(record || '')
    .replace(/\x1e+$/g, '')
    .split('\x1f');

  if (!sha) {
    return null;
  }

  return {
    sha: nullableString(sha),
    shortSha: nullableString(shortSha),
    decorations: nullableString(decorations),
    subject: nullableString(subject),
    authorName: nullableString(authorName),
    authoredAt: nullableString(authoredAt),
  };
}

function getCommit(ref, cwd, options = {}) {
  if (!ref) {
    return null;
  }

  const output = getOptionalGitOutput(
    ['show', '-s', '--format=%H%x1f%h%x1f%D%x1f%s%x1f%an%x1f%aI%x1e', ref],
    cwd,
    options,
  );

  return output ? parseCommitRecord(output) : null;
}

function getRecentCommits(cwd, options = {}) {
  const maxCount = Math.min(30, Math.max(1, Number(options.maxCount || 12)));
  const output = getOptionalGitOutput(
    [
      'log',
      '--all',
      `--max-count=${maxCount}`,
      '--format=%H%x1f%h%x1f%D%x1f%s%x1f%an%x1f%aI%x1e',
    ],
    cwd,
    options,
  );

  if (!output) {
    return [];
  }

  return output
    .split('\x1e')
    .map(parseCommitRecord)
    .filter(Boolean);
}

function getBranchStatus({ branchName, remote = 'origin', cwd, timeoutMs }) {
  const localRef = `refs/heads/${branchName}`;
  const remoteRef = `refs/remotes/${remote}/${branchName}`;
  const localSha = getOptionalGitOutput(['rev-parse', '--verify', localRef], cwd, { timeoutMs });
  const remoteSha = getOptionalGitOutput(['rev-parse', '--verify', remoteRef], cwd, { timeoutMs });
  let ahead = null;
  let behind = null;

  if (localSha && remoteSha) {
    const counts = getOptionalGitOutput(
      ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`],
      cwd,
      { timeoutMs },
    );

    if (counts) {
      ({ ahead, behind } = parseAheadBehind(counts));
    }
  }

  return {
    name: branchName,
    localSha,
    remoteSha,
    ahead,
    behind,
    localMatchesRemote: Boolean(localSha && remoteSha && localSha === remoteSha),
    latestLocalCommit: getCommit(localRef, cwd, { timeoutMs }),
    latestRemoteCommit: getCommit(remoteRef, cwd, { timeoutMs }),
  };
}

function isAncestor(ancestorRef, descendantRef, cwd, options = {}) {
  if (!ancestorRef || !descendantRef) {
    return null;
  }

  const result = tryExecuteGit(
    ['merge-base', '--is-ancestor', ancestorRef, descendantRef],
    cwd,
    {
      timeoutMs: options.timeoutMs,
      allowedStatuses: [0, 1, 128],
    },
  );

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  return null;
}

function resolveGitDirectory(cwd, options = {}) {
  const rawGitDir = getGitOutput(['rev-parse', '--git-dir'], cwd, options);
  const rawCommonDir = getGitOutput(['rev-parse', '--git-common-dir'], cwd, options);

  return {
    gitDir: path.isAbsolute(rawGitDir) ? rawGitDir : path.resolve(cwd, rawGitDir),
    commonDir: path.isAbsolute(rawCommonDir) ? rawCommonDir : path.resolve(cwd, rawCommonDir),
  };
}

function pathExistsInAnyDirectory(directories, relativePath) {
  return directories.some((directory) => fs.existsSync(path.join(directory, relativePath)));
}

function detectRepositoryState(cwd, options = {}) {
  const { gitDir, commonDir } = resolveGitDirectory(cwd, options);
  const directories = [...new Set([gitDir, commonDir])];
  const indexLockPresent = pathExistsInAnyDirectory(directories, 'index.lock');
  const mergeInProgress = pathExistsInAnyDirectory(directories, 'MERGE_HEAD');
  const rebaseInProgress =
    pathExistsInAnyDirectory(directories, 'rebase-merge') ||
    pathExistsInAnyDirectory(directories, 'rebase-apply');
  const cherryPickInProgress = pathExistsInAnyDirectory(directories, 'CHERRY_PICK_HEAD');
  const revertInProgress = pathExistsInAnyDirectory(directories, 'REVERT_HEAD');
  const bisectInProgress = pathExistsInAnyDirectory(directories, 'BISECT_LOG');

  return {
    gitDir,
    commonDir,
    indexLockPresent,
    mergeInProgress,
    rebaseInProgress,
    cherryPickInProgress,
    revertInProgress,
    bisectInProgress,
    operationInProgress:
      mergeInProgress ||
      rebaseInProgress ||
      cherryPickInProgress ||
      revertInProgress ||
      bisectInProgress,
  };
}

function buildRelationship({ mainBranch, devBranch, remote = 'origin', cwd, timeoutMs }) {
  const localMainRef = `refs/heads/${mainBranch.name}`;
  const localDevRef = `refs/heads/${devBranch.name}`;
  const remoteMainRef = `refs/remotes/${remote}/${mainBranch.name}`;
  const remoteDevRef = `refs/remotes/${remote}/${devBranch.name}`;
  const remoteRefsAvailable = Boolean(mainBranch.remoteSha && devBranch.remoteSha);
  const commonAncestorSha = remoteRefsAvailable
    ? getOptionalGitOutput(['merge-base', remoteMainRef, remoteDevRef], cwd, { timeoutMs })
    : null;

  return {
    localBranchesSynchronized: Boolean(
      mainBranch.localSha && devBranch.localSha && mainBranch.localSha === devBranch.localSha,
    ),
    remoteBranchesSynchronized: Boolean(
      mainBranch.remoteSha && devBranch.remoteSha && mainBranch.remoteSha === devBranch.remoteSha,
    ),
    localMainContainsDev: isAncestor(localDevRef, localMainRef, cwd, { timeoutMs }),
    localDevContainsMain: isAncestor(localMainRef, localDevRef, cwd, { timeoutMs }),
    mainContainsDev: remoteRefsAvailable
      ? isAncestor(remoteDevRef, remoteMainRef, cwd, { timeoutMs })
      : null,
    devContainsMain: remoteRefsAvailable
      ? isAncestor(remoteMainRef, remoteDevRef, cwd, { timeoutMs })
      : null,
    commonAncestorSha,
  };
}

function addUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function buildPromotionReadiness({
  currentBranch,
  expectedBranch,
  detachedHead,
  fetchSucceeded,
  workingTree,
  repositoryState,
  mainBranch,
  devBranch,
  relationship,
  remote = 'origin',
}) {
  const blockers = [];
  const advisories = [];
  const recommendedActions = [];
  const addBlocker = (code, message, action = null) => {
    blockers.push({ code, message });
    addUnique(recommendedActions, action);
  };

  if (!fetchSucceeded) {
    addBlocker(
      'REMOTE_REFRESH_FAILED',
      `The latest ${remote} tracking references could not be fetched.`,
      `Verify remote access, then run git fetch --prune ${remote}.`,
    );
  }

  if (detachedHead) {
    addBlocker(
      'DETACHED_HEAD',
      'The repository is in detached HEAD state.',
      expectedBranch ? `Run git switch ${expectedBranch}.` : 'Switch to the configured development branch.',
    );
  } else if (expectedBranch && currentBranch !== expectedBranch) {
    addBlocker(
      'WRONG_ACTIVE_BRANCH',
      `The active branch is ${currentBranch || 'unknown'}; ${expectedBranch} is required.`,
      `Run git switch ${expectedBranch}.`,
    );
  }

  if (repositoryState.indexLockPresent) {
    addBlocker(
      'INDEX_LOCK_PRESENT',
      'A Git index lock is present.',
      'Confirm no Git process is active, then remove .git/index.lock.',
    );
  }

  if (repositoryState.operationInProgress) {
    const operations = [
      repositoryState.mergeInProgress ? 'merge' : null,
      repositoryState.rebaseInProgress ? 'rebase' : null,
      repositoryState.cherryPickInProgress ? 'cherry-pick' : null,
      repositoryState.revertInProgress ? 'revert' : null,
      repositoryState.bisectInProgress ? 'bisect' : null,
    ].filter(Boolean);
    addBlocker(
      'GIT_OPERATION_IN_PROGRESS',
      `A Git ${operations.join(', ')} operation is still in progress.`,
      'Complete or safely abort the in-progress Git operation before promotion.',
    );
  }

  if (workingTree.conflicted > 0) {
    addBlocker(
      'MERGE_CONFLICTS_PRESENT',
      `${workingTree.conflicted} conflicted path(s) must be resolved.`,
      'Resolve Git conflicts before starting the promotion workflow.',
    );
  }

  if (!devBranch.localSha) {
    addBlocker(
      'LOCAL_DEV_REF_MISSING',
      `The local ${devBranch.name} branch does not exist.`,
      `Create or restore the local ${devBranch.name} branch from ${remote}/${devBranch.name}.`,
    );
  }

  if (!devBranch.remoteSha) {
    addBlocker(
      'REMOTE_DEV_REF_MISSING',
      `The ${remote}/${devBranch.name} tracking reference does not exist.`,
      `Fetch ${remote} and verify the ${devBranch.name} branch exists remotely.`,
    );
  }

  if (!mainBranch.remoteSha) {
    addBlocker(
      'REMOTE_MAIN_REF_MISSING',
      `The ${remote}/${mainBranch.name} tracking reference does not exist.`,
      `Fetch ${remote} and verify the ${mainBranch.name} branch exists remotely.`,
    );
  }

  if (Number(devBranch.behind || 0) > 0) {
    addBlocker(
      'LOCAL_DEV_BEHIND_REMOTE',
      `Local ${devBranch.name} is ${devBranch.behind} commit(s) behind ${remote}/${devBranch.name}.`,
      `Run git pull --ff-only ${remote} ${devBranch.name}.`,
    );
  }

  if (Number(devBranch.ahead || 0) > 0) {
    addBlocker(
      'LOCAL_DEV_AHEAD_REMOTE',
      `Local ${devBranch.name} is ${devBranch.ahead} commit(s) ahead of ${remote}/${devBranch.name}.`,
      `Review and push the existing ${devBranch.name} commits before starting a new promotion.`,
    );
  }

  if (
    mainBranch.remoteSha &&
    devBranch.remoteSha &&
    !relationship.remoteBranchesSynchronized
  ) {
    addBlocker(
      'REMOTE_BRANCHES_NOT_SYNCHRONIZED',
      `${remote}/${mainBranch.name} and ${remote}/${devBranch.name} do not point to the same approved baseline.`,
      'Complete or reconcile the existing development promotion before starting another one.',
    );
  }

  if (workingTree.hasChanges && workingTree.conflicted === 0) {
    advisories.push(
      `${workingTree.totalChanges} working-tree change(s) are available for the development commit stage.`,
    );
  } else if (workingTree.clean) {
    advisories.push('The working tree is clean before repository artifact generation.');
  }

  if (mainBranch.localSha && mainBranch.remoteSha && !mainBranch.localMatchesRemote) {
    advisories.push(
      `Local ${mainBranch.name} differs from ${remote}/${mainBranch.name}; the watcher-safe synchronization stage can refresh the local reference later.`,
    );
  }

  const readyForDevelopmentPromotion = blockers.length === 0;

  return {
    outcome: readyForDevelopmentPromotion ? 'READY' : 'BLOCKED',
    readyForDevelopmentPromotion,
    blockers,
    advisories,
    recommendedActions,
  };
}

function inspectGitRepository({
  repositoryCode,
  repositoryName,
  repositoryRoot,
  mainBranchName = 'main',
  devBranchName = 'dev',
  remote = 'origin',
  timeoutMs = DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  profileCode = null,
} = {}) {
  const startedAt = new Date().toISOString();
  const root = path.resolve(String(repositoryRoot || ''));

  if (!repositoryRoot || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    const error = new Error(`Repository path does not exist or is not a directory: ${root}`);
    error.code = 'REPOSITORY_PATH_INVALID';
    throw error;
  }

  const insideWorkTree = getGitOutput(['rev-parse', '--is-inside-work-tree'], root, { timeoutMs });
  if (insideWorkTree !== 'true') {
    const error = new Error(`Configured path is not a Git working tree: ${root}`);
    error.code = 'NOT_A_GIT_WORK_TREE';
    throw error;
  }

  const branchResult = tryExecuteGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root, {
    timeoutMs,
    allowedStatuses: [0, 1],
  });
  const detachedHead = branchResult.status !== 0;
  const currentBranch = detachedHead ? null : nullableString(branchResult.stdout);
  const fetchResult = tryExecuteGit(['fetch', '--prune', remote], root, {
    timeoutMs,
    allowedStatuses: [0, 1, 128],
  });
  const workingTree = parsePorcelainStatus(
    getGitOutput(['status', '--porcelain=v1', '--untracked-files=all'], root, { timeoutMs }),
  );
  const repositoryState = detectRepositoryState(root, { timeoutMs });
  const mainBranch = getBranchStatus({
    branchName: mainBranchName,
    remote,
    cwd: root,
    timeoutMs,
  });
  const devBranch = getBranchStatus({
    branchName: devBranchName,
    remote,
    cwd: root,
    timeoutMs,
  });
  const relationship = buildRelationship({
    mainBranch,
    devBranch,
    remote,
    cwd: root,
    timeoutMs,
  });
  const readiness = buildPromotionReadiness({
    currentBranch,
    expectedBranch: devBranchName,
    detachedHead,
    fetchSucceeded: fetchResult.ok,
    workingTree,
    repositoryState,
    mainBranch,
    devBranch,
    relationship,
    remote,
  });
  const completedAt = new Date().toISOString();
  const warnings = fetchResult.ok
    ? []
    : [
        `Remote fetch warning: ${
          fetchResult.error?.message || fetchResult.stderr || fetchResult.stdout || 'unknown failure'
        }`,
      ];

  return {
    ok: true,
    executionStrategy: 'CHECKOUT_FREE_INSPECTION',
    watcherSafe: true,
    outcome: readiness.outcome,
    repositoryCode: repositoryCode || null,
    repositoryName: repositoryName || repositoryCode || null,
    repositoryRoot: root,
    remote,
    expectedBranch: devBranchName,
    currentBranch,
    detachedHead,
    fetchPerformed: true,
    fetchSucceeded: fetchResult.ok,
    workingTree,
    branches: {
      main: mainBranch,
      dev: devBranch,
    },
    relationship,
    repositoryState,
    readyForDevelopmentPromotion: readiness.readyForDevelopmentPromotion,
    blockers: readiness.blockers,
    advisories: readiness.advisories,
    recommendedActions: readiness.recommendedActions,
    recentCommits: getRecentCommits(root, { timeoutMs, maxCount: 12 }),
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    warnings,
    profileCode,
  };
}

module.exports = {
  CONFLICT_STATUS_CODES,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  buildPromotionReadiness,
  buildRelationship,
  detectRepositoryState,
  executeGit,
  getBranchStatus,
  getRecentCommits,
  inspectGitRepository,
  parseAheadBehind,
  parseCommitRecord,
  parsePorcelainStatus,
  tryExecuteGit,
};
