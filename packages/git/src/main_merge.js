#!/usr/bin/env node

/**
 * Synchronizes the configured development branch from the repository main branch.
 * This tool is intended to run after the pull request into main has been completed.
 *
 * The synchronization is deliberately checkout-free. SkyCommand workers and Vite
 * can watch the repository while this tool runs without being restarted by branch
 * switches or working-tree rewrites.
 *
 * Usage: node main_merge.js <repoName> [tagName]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createGitBranchSyncFailureToolResult,
  createGitBranchSyncToolResult,
} = require('./gitBranchSyncResult');

const SCRIPT_DIR = __dirname;
const SKY_SERVER_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');
const TOOL_CODE = 'main_merge';
const OUTPUT_TYPE = 'git_branch_sync_summary.v1';
const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 60000;
const DOCKER_LOCAL_PROFILE = 'DOCKER_LOCAL';

dotenv.config({ path: ENV_PATH });

const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYCOMMAND_CONFIG_PROFILE || process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYCOMMAND_CORE_PROFILE || process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const GIT_COMMAND_TIMEOUT_MS = Math.max(
  10000,
  Number(process.env.SKYCOMMAND_GIT_COMMAND_TIMEOUT_MS || DEFAULT_GIT_COMMAND_TIMEOUT_MS),
);

function fail(message) {
  throw new Error(message);
}

function getGitEnvironment() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_EDITOR: 'true',
    GIT_MERGE_AUTOEDIT: 'no',
  };

  if (isDockerLocalProfile()) {
    // Docker reads a Windows-hosted working tree through a bind mount. Disable
    // optional index/ref refresh locks for read-oriented Git commands; required
    // remote writes still use Git's normal locking on the remote repository.
    env.GIT_OPTIONAL_LOCKS = '0';
  }

  return env;
}

function executeGit(args, cwd, options = {}) {
  const capture = options.capture === true;
  const allowedStatuses = new Set(options.allowedStatuses || [0]);
  const printCommand = options.printCommand !== false;

  if (printCommand) {
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
    fail(
      timedOut
        ? `Git command timed out after ${GIT_COMMAND_TIMEOUT_MS} ms: git ${args.join(' ')}`
        : `Git command failed: ${result.error.message}`,
    );
  }

  if (!allowedStatuses.has(result.status)) {
    const detail = capture
      ? String(result.stderr || result.stdout || '').trim()
      : '';
    fail(
      [`Git command failed: git ${args.join(' ')}`, detail]
        .filter(Boolean)
        .join(' - '),
    );
  }

  return result;
}

function runGit(args, cwd) {
  return executeGit(args, cwd);
}

function getGitOutput(args, cwd, options = {}) {
  const result = executeGit(args, cwd, {
    capture: true,
    printCommand: options.printCommand === true,
    allowedStatuses: options.allowedStatuses || [0],
  });

  return String(result.stdout || '').trim();
}

function isDockerLocalProfile(profileCode = PROFILE_CODE) {
  return String(profileCode || '').trim().toUpperCase() === DOCKER_LOCAL_PROFILE;
}

function getRemoteUrl(remote, cwd) {
  const remoteUrl = getGitOutput(['remote', 'get-url', remote], cwd);
  if (!remoteUrl) {
    fail(`Git remote '${remote}' does not have a configured URL.`);
  }
  return remoteUrl;
}

function pushRemoteRef({ remote = 'origin', refspec, cwd }) {
  if (!refspec) fail('Missing Git push refspec.');

  if (!isDockerLocalProfile()) {
    runGit(['push', remote, refspec], cwd);
    return;
  }

  // A named-remote push also attempts to advance the local remote-tracking ref.
  // With a Windows repository bind-mounted into a Linux container, that extra
  // local ref write can collide with the host Git client / VS Code. Pushing to
  // the configured URL preserves the exact remote operation without mutating
  // refs/remotes/* inside the host-owned working copy.
  const remoteUrl = getRemoteUrl(remote, cwd);
  console.log(`> git push ${remote} ${refspec} [Docker URL transport]`);
  executeGit(['push', remoteUrl, refspec], cwd, { printCommand: false });
}

function getRemoteBranchSha(remote, branch, cwd) {
  const branchRef = `refs/heads/${branch}`;
  const output = getGitOutput(['ls-remote', '--heads', remote, branchRef], cwd, {
    printCommand: true,
  });
  const [sha] = String(output || '').split(/\s+/);

  if (!sha) {
    fail(`Remote branch verification failed: ${remote}/${branch} was not found.`);
  }

  return sha;
}

function fetchRemoteBranchObjects({ remote = 'origin', branches = [], cwd }) {
  const branchRefs = [...new Set((branches || []).map((branch) => String(branch || '').trim()).filter(Boolean))]
    .map((branch) => `refs/heads/${branch}`);

  if (branchRefs.length === 0) {
    fail('At least one branch is required for Git object transfer.');
  }

  if (!isDockerLocalProfile()) {
    runGit(['fetch', '--prune', remote], cwd);
    return;
  }

  // Fetch the commit/tree objects required for ancestry/count checks without
  // updating refs/remotes/* or FETCH_HEAD in the Windows-owned bind-mounted
  // repository. This closes the remaining Docker/host ref-lock race exposed by
  // an initial `git fetch --prune origin` after full containerization.
  const args = ['fetch', '--no-tags', '--no-write-fetch-head', remote, ...branchRefs];
  console.log(`> git ${args.join(' ')} [Docker object transfer only]`);
  executeGit(args, cwd, { printCommand: false });
}

function createDeferredLocalBranchRefState({ branch, targetSha, currentBranch, cwd }) {
  const localSha = tryGetGitOutput(['rev-parse', '--verify', `refs/heads/${branch}`], cwd);
  const differsFromTarget = localSha !== targetSha;

  return {
    branch,
    updated: false,
    workspaceUpdated: false,
    refreshRequired: currentBranch === branch && differsFromTarget,
    differsFromTarget,
    localSha,
    reason: differsFromTarget
      ? `Docker-local execution intentionally left refs/heads/${branch} unchanged.`
      : null,
  };
}

function tryGetGitOutput(args, cwd) {
  const result = executeGit(args, cwd, {
    capture: true,
    printCommand: false,
    allowedStatuses: [0, 1, 128],
  });

  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function isGitAncestor(ancestorRef, descendantRef, cwd) {
  const result = executeGit(['merge-base', '--is-ancestor', ancestorRef, descendantRef], cwd, {
    capture: true,
    printCommand: false,
    allowedStatuses: [0, 1],
  });

  return result.status === 0;
}

function getTreeSha(ref, cwd) {
  return getGitOutput(['rev-parse', `${ref}^{tree}`], cwd);
}

function getCurrentBranch(cwd) {
  return getGitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

function assertCleanWorkingTree(cwd) {
  const status = getGitOutput(['status', '--porcelain'], cwd);

  if (status) {
    fail(
      'Main Merge requires a clean working tree. Complete or stash local changes before branch synchronization.',
    );
  }
}

function updateLocalBranchRefWithoutCheckout({
  branch,
  targetSha,
  currentBranch,
  cwd,
}) {
  const branchRef = `refs/heads/${branch}`;
  const branchExists = Boolean(tryGetGitOutput(['rev-parse', '--verify', branchRef], cwd));

  if (currentBranch !== branch) {
    runGit(branchExists ? ['branch', '-f', branch, targetSha] : ['branch', branch, targetSha], cwd);
    return {
      branch,
      updated: true,
      workspaceUpdated: false,
      refreshRequired: false,
      reason: null,
    };
  }

  const currentTreeSha = getTreeSha('HEAD', cwd);
  const targetTreeSha = getTreeSha(targetSha, cwd);

  if (currentTreeSha !== targetTreeSha) {
    return {
      branch,
      updated: false,
      workspaceUpdated: false,
      refreshRequired: true,
      reason: `The checked-out ${branch} tree differs from ${targetSha}.`,
    };
  }

  // The trees are identical (the usual PR merge case), so moving the branch
  // pointer does not rewrite files and therefore does not disturb watchers.
  runGit(['reset', '--soft', targetSha], cwd);
  assertCleanWorkingTree(cwd);

  return {
    branch,
    updated: true,
    workspaceUpdated: true,
    refreshRequired: false,
    reason: null,
  };
}

async function listAvailableRepositories() {
  const result = await pool.query(
    `
      SELECT r.repo_code
      FROM core.repositories r
      JOIN core.repository_paths rp
        ON rp.repo_id = r.repo_id
      JOIN core.config_profiles cp
        ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
      ORDER BY r.display_order, r.repo_code
    `,
    [PROFILE_CODE],
  );

  return result.rows.map((row) => row.repo_code);
}

async function loadRepository(repoName) {
  if (!repoName) {
    fail('Missing repoName. Usage: node main_merge.js <repoName> [tagName]');
  }

  const result = await pool.query(
    `
      SELECT
        r.repo_code,
        r.repo_name,
        r.main_branch,
        r.dev_branch,
        rp.root_path
      FROM core.repositories r
      JOIN core.repository_paths rp
        ON rp.repo_id = r.repo_id
      JOIN core.config_profiles cp
        ON cp.profile_id = rp.profile_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND r.active = TRUE
        AND rp.active = TRUE
        AND (
          LOWER(r.repo_code) = LOWER($2)
          OR LOWER(r.repo_name) = LOWER($2)
        )
      LIMIT 1
    `,
    [PROFILE_CODE, repoName],
  );

  if (result.rowCount === 0) {
    const availableRepos = await listAvailableRepositories();
    fail(`Unknown repo '${repoName}'. Available repos: ${availableRepos.join(', ')}`);
  }

  const repo = result.rows[0];

  if (!repo.root_path || !fs.existsSync(repo.root_path)) {
    fail(`Repo path does not exist: ${repo.root_path}`);
  }

  return {
    repoCode: repo.repo_code,
    repoName: repo.repo_name,
    mainBranch: repo.main_branch || 'main',
    devBranch: repo.dev_branch || 'dev',
    rootPath: repo.root_path,
  };
}

function createLocalRefreshCommand(repo) {
  return `git switch ${repo.devBranch} && git pull --ff-only origin ${repo.devBranch}`;
}

async function executeMainMerge(args = []) {
  const startedAt = new Date().toISOString();
  const [repoName, rawTagName] = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const tagName = String(rawTagName || '').trim();
  const repo = await loadRepository(repoName);
  const warnings = [];

  console.log('');
  console.log(
    `🚀 Starting checkout-free ${repo.mainBranch} → ${repo.devBranch} synchronization for repo: ${repo.repoCode}`,
  );
  console.log('ℹ️ This step is intended to run after the pull request into main is complete.');
  console.log('🛡️ Working-tree branch switches are intentionally avoided so live SkyCommand processes are not restarted.');
  console.log(`📂 Repo root: ${repo.rootPath}`);
  console.log(`🌿 Main branch: ${repo.mainBranch}`);
  console.log(`🌿 Dev branch: ${repo.devBranch}`);
  console.log('');

  assertCleanWorkingTree(repo.rootPath);

  const currentBranch = getCurrentBranch(repo.rootPath);
  const localHeadBeforeSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  const mainHeadBeforeSha = tryGetGitOutput(
    ['rev-parse', '--verify', `refs/heads/${repo.mainBranch}`],
    repo.rootPath,
  );
  const localDevHeadBeforeSha = tryGetGitOutput(
    ['rev-parse', '--verify', `refs/heads/${repo.devBranch}`],
    repo.rootPath,
  );

  let mainHeadSha;
  let remoteDevHeadBeforeSha;

  if (isDockerLocalProfile()) {
    // Remote-tracking refs inside this repository belong to the Windows host.
    // Read authoritative branch heads directly from the remote, then transfer
    // only the referenced Git objects required for local graph calculations.
    mainHeadSha = getRemoteBranchSha('origin', repo.mainBranch, repo.rootPath);
    remoteDevHeadBeforeSha = getRemoteBranchSha('origin', repo.devBranch, repo.rootPath);
    fetchRemoteBranchObjects({
      remote: 'origin',
      branches: [repo.mainBranch, repo.devBranch],
      cwd: repo.rootPath,
    });
  } else {
    runGit(['fetch', '--prune', 'origin'], repo.rootPath);
    const remoteMainRef = `refs/remotes/origin/${repo.mainBranch}`;
    const remoteDevRef = `refs/remotes/origin/${repo.devBranch}`;
    mainHeadSha = getGitOutput(['rev-parse', remoteMainRef], repo.rootPath);
    remoteDevHeadBeforeSha = getGitOutput(['rev-parse', remoteDevRef], repo.rootPath);
  }

  if (!isGitAncestor(remoteDevHeadBeforeSha, mainHeadSha, repo.rootPath)) {
    fail(
      `origin/${repo.devBranch} cannot be fast-forwarded to origin/${repo.mainBranch}. The branches have diverged and require manual reconciliation.`,
    );
  }

  const commitsApplied = Number(
    getGitOutput(
      ['rev-list', '--count', `${remoteDevHeadBeforeSha}..${mainHeadSha}`],
      repo.rootPath,
    ) || 0,
  );
  const devAdvanced = remoteDevHeadBeforeSha !== mainHeadSha;

  if (devAdvanced) {
    console.log(
      `\n🔄 Fast-forwarding origin/${repo.devBranch} to the approved origin/${repo.mainBranch} head without checking out either branch...`,
    );
    pushRemoteRef({
      remote: 'origin',
      refspec: `${mainHeadSha}:refs/heads/${repo.devBranch}`,
      cwd: repo.rootPath,
    });
  } else {
    console.log(`\n✨ origin/${repo.devBranch} is already synchronized with origin/${repo.mainBranch}.`);
  }

  let tagCreated = false;

  if (tagName) {
    console.log(`\n🏷️ Creating tag ${tagName} at ${mainHeadSha}...`);
    if (isDockerLocalProfile()) {
      pushRemoteRef({
        remote: 'origin',
        refspec: `${mainHeadSha}:refs/tags/${tagName}`,
        cwd: repo.rootPath,
      });
    } else {
      runGit(['tag', tagName, mainHeadSha], repo.rootPath);
      runGit(['push', 'origin', `refs/tags/${tagName}`], repo.rootPath);
    }
    tagCreated = true;
  }

  // Verify the authoritative remote directly. A second fetch is unnecessary and
  // would rewrite refs/remotes/* inside the bind-mounted host repository.
  const remoteMainHeadAfterSha = getRemoteBranchSha('origin', repo.mainBranch, repo.rootPath);
  const remoteDevHeadAfterSha = getRemoteBranchSha('origin', repo.devBranch, repo.rootPath);
  const branchesSynchronized =
    remoteMainHeadAfterSha === mainHeadSha && remoteDevHeadAfterSha === mainHeadSha;

  if (!branchesSynchronized) {
    fail(
      `Remote branch verification failed: origin/${repo.devBranch} does not match origin/${repo.mainBranch}.`,
    );
  }

  let mainRefUpdate;
  let devRefUpdate;

  if (isDockerLocalProfile()) {
    // The host working copy owns refs/heads/*. Updating those refs from Linux can
    // race Windows Git/VS Code and surface as "couldn't set refs/heads/..." even
    // after the remote synchronization has already succeeded. Keep Docker's Git
    // responsibility remote-only and let the host refresh its checked-out branch.
    mainRefUpdate = createDeferredLocalBranchRefState({
      branch: repo.mainBranch,
      targetSha: mainHeadSha,
      currentBranch,
      cwd: repo.rootPath,
    });
    devRefUpdate = createDeferredLocalBranchRefState({
      branch: repo.devBranch,
      targetSha: remoteDevHeadAfterSha,
      currentBranch,
      cwd: repo.rootPath,
    });

    const deferredBranches = [mainRefUpdate, devRefUpdate]
      .filter((state) => state.differsFromTarget)
      .map((state) => state.branch);

    if (deferredBranches.length > 0) {
      warnings.push(
        `DOCKER_LOCAL synchronized the remote branches but intentionally left host-owned local branch references unchanged: ${deferredBranches.join(', ')}.`,
      );
    }
  } else {
    mainRefUpdate = updateLocalBranchRefWithoutCheckout({
      branch: repo.mainBranch,
      targetSha: mainHeadSha,
      currentBranch,
      cwd: repo.rootPath,
    });
    devRefUpdate = updateLocalBranchRefWithoutCheckout({
      branch: repo.devBranch,
      targetSha: remoteDevHeadAfterSha,
      currentBranch,
      cwd: repo.rootPath,
    });
  }
  const localWorkspaceRefreshRequired =
    mainRefUpdate.refreshRequired || devRefUpdate.refreshRequired;
  const localWorkspaceUpdated =
    mainRefUpdate.workspaceUpdated || devRefUpdate.workspaceUpdated;
  const localRefreshCommand = localWorkspaceRefreshRequired
    ? createLocalRefreshCommand(repo)
    : null;

  if (localWorkspaceRefreshRequired) {
    warnings.push(
      `Remote branches are synchronized, but the checked-out workspace contains a different tree. After the workflow completes, run: ${localRefreshCommand}`,
    );
  }

  const localHeadAfterSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  const completedAt = new Date().toISOString();
  const outcome = tagCreated
    ? 'TAGGED'
    : devAdvanced
      ? 'SYNCHRONIZED'
      : 'ALREADY_SYNCHRONIZED';

  console.log('');
  console.log(
    `🎉 origin/${repo.mainBranch} → origin/${repo.devBranch} synchronization completed successfully!`,
  );
  console.log(`🔖 Synchronized head: ${remoteDevHeadAfterSha}`);
  console.log(`📈 Commits applied to ${repo.devBranch}: ${commitsApplied}`);
  if (localWorkspaceRefreshRequired) {
    console.log(`⚠️ Local workspace refresh required after workflow completion: ${localRefreshCommand}`);
  } else if (isDockerLocalProfile()) {
    console.log('✅ Remote synchronization verified; Docker left host-owned local branch references untouched.');
  } else {
    console.log('✅ Local branch references were synchronized without rewriting watched files.');
  }
  console.log('');

  return {
    ok: true,
    outcome,
    executionStrategy: 'CHECKOUT_FREE_REMOTE_SYNC',
    watcherSafe: true,
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    remote: 'origin',
    sourceBranch: repo.mainBranch,
    targetBranch: repo.devBranch,
    mainBranch: repo.mainBranch,
    devBranch: repo.devBranch,
    currentBranch,
    localHeadBeforeSha,
    localHeadAfterSha,
    mainHeadBeforeSha,
    mainHeadSha,
    localDevHeadBeforeSha,
    remoteDevHeadBeforeSha,
    remoteDevHeadAfterSha,
    devHeadBeforePullSha: remoteDevHeadBeforeSha,
    devHeadBeforeSha: remoteDevHeadBeforeSha,
    devHeadAfterSha: remoteDevHeadAfterSha,
    synchronizedHeadSha: remoteDevHeadAfterSha,
    commitsApplied,
    devAdvanced,
    branchesSynchronized,
    localMainRefUpdated: mainRefUpdate.updated,
    localDevRefUpdated: devRefUpdate.updated,
    localWorkspaceUpdated,
    localWorkspaceRefreshRequired,
    localRefreshCommand,
    tagName: tagName || null,
    tagCreated,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
    fetched: true,
    mainBranchSelected: false,
    mainBranchPulled: false,
    devBranchSelected: false,
    devBranchPulled: false,
    fastForwardMerged: true,
    mainBranchPushed: false,
    devBranchPushed: devAdvanced,
    remoteFastForwardVerified: true,
    tagsPushed: tagCreated,
    warnings,
    profileCode: PROFILE_CODE,
  };
}

function printMainMergeResult(result) {
  const tagSummary = result.tagCreated ? ` Tag ${result.tagName} was pushed.` : '';
  const refreshSummary = result.localWorkspaceRefreshRequired
    ? ` Local refresh required: ${result.localRefreshCommand}.`
    : ' Local references were updated without a working-tree rewrite.';
  console.log(
    `📋 Structured result: ${result.repositoryCode} ${result.sourceBranch} → ${result.targetBranch} ${String(result.outcome || 'synchronized').toLowerCase()}.${tagSummary}${refreshSummary}`,
  );
}

async function closePool() {
  try {
    await pool.end();
  } catch {
    // Nothing useful to do during CLI shutdown.
  }
}

async function main(args = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();

  try {
    return await runToolCli({
      toolCode: TOOL_CODE,
      outputType: OUTPUT_TYPE,
      args,
      execute: executeMainMerge,
      createToolResult: createGitBranchSyncToolResult,
      createFailureToolResult: (error) =>
        createGitBranchSyncFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printMainMergeResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  createDeferredLocalBranchRefState,
  executeMainMerge,
  fetchRemoteBranchObjects,
  getRemoteBranchSha,
  isDockerLocalProfile,
  main,
  printMainMergeResult,
  pushRemoteRef,
};
