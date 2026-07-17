#!/usr/bin/env node

/**
 * Commits and pushes existing repository changes to the configured dev branch.
 * Repository-map and repository-zip generation are intentionally separate tools
 * and can be orchestrated before this tool by a SkyCommand workflow.
 *
 * Usage: node dev_commit.js <repoName> <commitMessage>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createGitCommitFailureToolResult,
  createGitCommitToolResult,
  parseGitStatusPorcelain,
} = require('./gitCommitResult');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');
const TOOL_CODE = 'dev_commit';
const OUTPUT_TYPE = 'git_commit_summary.v1';
dotenv.config({ path: path.join(SKY_SERVER_ROOT, '.env') });
const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

function fail(message) {
  throw new Error(message);
}

function runCommand(command, args, cwd, label = command) {
  console.log(`> ${label} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) fail(`${label} command failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} command failed: ${label} ${args.join(' ')}`);
}
function runGit(args, cwd) {
  runCommand('git', args, cwd, 'git');
}

function runGitCaptured(args, cwd) {
  console.log(`> git ${args.join(' ')}`);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`Git command failed: ${result.error.message}`);
  return result;
}

function isRetryableGitIndexFailure(result) {
  const message = `${result?.stdout || ''}
${result?.stderr || ''}`.toLowerCase();
  return (
    message.includes('unable to write new index file') ||
    message.includes('index.lock') ||
    message.includes('could not lock index') ||
    message.includes('another git process seems to be running')
  );
}

async function stageChangesWithRetry(cwd) {
  const delaysMs = [0, 500, 1000, 2000];

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (delaysMs[attempt] > 0) {
      console.log(`⏳ Git index is busy; retrying git add -A in ${delaysMs[attempt]} ms...`);
      await sleep(delaysMs[attempt]);
    }

    const result = runGitCaptured(['add', '-A'], cwd);
    if (result.status === 0) return;
    if (!isRetryableGitIndexFailure(result) || attempt === delaysMs.length - 1) {
      fail('git command failed: git add -A');
    }
  }
}

function getAheadCount(cwd, branch) {
  const output = getGitOutput(['rev-list', '--count', `origin/${branch}..${branch}`], cwd);
  const parsed = Number.parseInt(output, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
function getGitOutput(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.error) fail(`Git command failed: ${result.error.message}`);
  if (result.status !== 0) fail(`Git command failed: git ${args.join(' ')}`);
  return result.stdout.trim();
}

async function listAvailableRepositories() {
  const result = await pool.query(
    `SELECT r.repo_code FROM core.repositories r JOIN core.repository_paths rp ON rp.repo_id = r.repo_id JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id WHERE cp.profile_code = $1 AND cp.active = TRUE AND r.active = TRUE AND rp.active = TRUE ORDER BY r.display_order, r.repo_code`,
    [PROFILE_CODE],
  );
  return result.rows.map((row) => row.repo_code);
}

async function loadRepository(repoName) {
  if (!repoName) fail('Missing repoName. Usage: node dev_commit.js <repoName> <commitMessage>');
  const result = await pool.query(
    `SELECT r.repo_code, r.repo_name, r.main_branch, r.dev_branch, rp.root_path FROM core.repositories r JOIN core.repository_paths rp ON rp.repo_id = r.repo_id JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id WHERE cp.profile_code = $1 AND cp.active = TRUE AND r.active = TRUE AND rp.active = TRUE AND (LOWER(r.repo_code) = LOWER($2) OR LOWER(r.repo_name) = LOWER($2)) LIMIT 1`,
    [PROFILE_CODE, repoName],
  );
  if (result.rowCount === 0)
    fail(
      `Unknown repo '${repoName}'. Available repos: ${(await listAvailableRepositories()).join(', ')}`,
    );
  const repo = result.rows[0];
  if (!repo.root_path || !fs.existsSync(repo.root_path))
    fail(`Repo path does not exist: ${repo.root_path}`);
  return {
    repoCode: repo.repo_code,
    repoName: repo.repo_name,
    mainBranch: repo.main_branch || 'main',
    devBranch: repo.dev_branch || 'dev',
    rootPath: repo.root_path,
  };
}

async function executeDevCommit(args = []) {
  const startedAt = new Date().toISOString();
  const [repoName, commitMessage] = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  if (!commitMessage || commitMessage.trim() === '')
    fail('Missing commitMessage. Usage: node dev_commit.js <repoName> <commitMessage>');
  const repo = await loadRepository(repoName);

  console.log('');
  console.log(`🚀 Starting dev commit for repo: ${repo.repoCode}`);
  console.log(`📂 Repo path: ${repo.rootPath}`);
  console.log(`🌿 Dev branch: ${repo.devBranch}`);
  console.log('🧩 Repository map and zip generation are handled by separate workflow nodes.');
  console.log('');

  const previousHeadSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  runGit(['fetch', 'origin'], repo.rootPath);
  runGit(['switch', repo.devBranch], repo.rootPath);
  runGit(['pull', 'origin', repo.devBranch], repo.rootPath);
  const status = getGitOutput(['status', '--porcelain'], repo.rootPath);
  const changeSummary = parseGitStatusPorcelain(status);

  if (status === '') {
    const aheadCount = getAheadCount(repo.rootPath, repo.devBranch);
    let pushedExistingCommit = false;

    if (aheadCount > 0) {
      console.log(`📤 Working tree is clean, but ${aheadCount} local commit(s) still need to be pushed.`);
      runGit(['push', 'origin', repo.devBranch], repo.rootPath);
      pushedExistingCommit = true;
    }

    const completedAt = new Date().toISOString();
    console.log(
      pushedExistingCommit
        ? '🎉 Existing local commit(s) pushed successfully.'
        : '✨ Nothing to commit — working directory clean.',
    );
    return {
      ok: true,
      outcome: pushedExistingCommit ? 'PUSHED_EXISTING' : 'NO_CHANGES',
      repositoryCode: repo.repoCode,
      repositoryName: repo.repoName,
      repositoryRoot: repo.rootPath,
      branch: repo.devBranch,
      remote: 'origin',
      commitMessage,
      previousHeadSha,
      currentHeadSha: getGitOutput(['rev-parse', 'HEAD'], repo.rootPath),
      commitSha: null,
      startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
      ...changeSummary,
      fetched: true,
      switchedBranch: true,
      pulled: true,
      staged: false,
      committed: false,
      pushed: pushedExistingCommit,
      profileCode: PROFILE_CODE,
    };
  }

  await stageChangesWithRetry(repo.rootPath);
  runGit(['commit', '-m', commitMessage], repo.rootPath);
  const commitSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  runGit(['push', 'origin', repo.devBranch], repo.rootPath);
  const completedAt = new Date().toISOString();
  console.log('');
  console.log('🎉 Dev commit completed successfully!');
  console.log(`🔖 Commit: ${commitSha}`);
  console.log('');

  return {
    ok: true,
    outcome: 'PUSHED',
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    branch: repo.devBranch,
    remote: 'origin',
    commitMessage,
    previousHeadSha,
    currentHeadSha: commitSha,
    commitSha,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
    ...changeSummary,
    fetched: true,
    switchedBranch: true,
    pulled: true,
    staged: true,
    committed: true,
    pushed: true,
    profileCode: PROFILE_CODE,
  };
}

function printDevCommitResult(result) {
  if (result.outcome === 'NO_CHANGES') {
    console.log(`📋 Structured result: ${result.repositoryCode} had no changes to commit.`);
  } else {
    console.log(
      `📋 Structured result: ${result.changedFiles} changed file(s) committed to ${result.branch}.`,
    );
  }
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
      execute: executeDevCommit,
      createToolResult: createGitCommitToolResult,
      createFailureToolResult: (error) =>
        createGitCommitFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printDevCommitResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = { OUTPUT_TYPE, TOOL_CODE, executeDevCommit, main, printDevCommitResult };
