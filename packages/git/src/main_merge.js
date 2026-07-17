#!/usr/bin/env node

/**
 * Synchronizes the configured development branch from the repository main branch.
 * This tool is intended to run after the pull request into main has been completed.
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

dotenv.config({ path: ENV_PATH });

const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

function fail(message) {
  throw new Error(message);
}

function runGit(args, cwd) {
  console.log(`> git ${args.join(' ')}`);

  const result = spawnSync('git', args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    fail(`Git command failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Git command failed: git ${args.join(' ')}`);
  }
}

function getGitOutput(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    fail(`Git command failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Git command failed: git ${args.join(' ')}`);
  }

  return String(result.stdout || '').trim();
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

async function executeMainMerge(args = []) {
  const startedAt = new Date().toISOString();
  const [repoName, rawTagName] = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const tagName = String(rawTagName || '').trim();
  const repo = await loadRepository(repoName);

  console.log('');
  console.log(
    `🚀 Starting ${repo.mainBranch} → ${repo.devBranch} synchronization for repo: ${repo.repoCode}`,
  );
  console.log('ℹ️ This step is intended to run after the pull request into main is complete.');
  console.log(`📂 Repo root: ${repo.rootPath}`);
  console.log(`🌿 Main branch: ${repo.mainBranch}`);
  console.log(`🌿 Dev branch: ${repo.devBranch}`);
  console.log('');

  runGit(['fetch', 'origin'], repo.rootPath);

  runGit(['switch', repo.mainBranch], repo.rootPath);
  const mainHeadBeforeSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  runGit(['pull', 'origin', repo.mainBranch], repo.rootPath);
  const mainHeadSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);

  runGit(['switch', repo.devBranch], repo.rootPath);
  const devHeadBeforePullSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  runGit(['pull', 'origin', repo.devBranch], repo.rootPath);
  const devHeadBeforeSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  const commitsApplied = Number(
    getGitOutput(['rev-list', '--count', `${devHeadBeforeSha}..${mainHeadSha}`], repo.rootPath) || 0,
  );

  console.log(
    `\n🔄 Attempting fast-forward synchronization from ${repo.mainBranch} → ${repo.devBranch}...`,
  );
  runGit(['merge', '--ff-only', repo.mainBranch], repo.rootPath);
  const devHeadAfterSha = getGitOutput(['rev-parse', 'HEAD'], repo.rootPath);
  const devAdvanced = devHeadBeforeSha !== devHeadAfterSha;
  const branchesSynchronized = mainHeadSha === devHeadAfterSha;

  let tagCreated = false;

  if (tagName) {
    console.log(`\n🏷️ Creating tag: ${tagName}`);
    runGit(['tag', tagName], repo.rootPath);
    tagCreated = true;
  }

  console.log('\n📤 Pushing synchronized branches to origin...');
  runGit(['push', 'origin', repo.mainBranch], repo.rootPath);
  runGit(['push', 'origin', repo.devBranch], repo.rootPath);

  let tagsPushed = false;

  if (tagCreated) {
    console.log('📤 Pushing tags...');
    runGit(['push', '--tags'], repo.rootPath);
    tagsPushed = true;
  }

  const completedAt = new Date().toISOString();
  const outcome = tagCreated
    ? 'TAGGED'
    : devAdvanced
      ? 'SYNCHRONIZED'
      : 'ALREADY_SYNCHRONIZED';

  console.log('');
  console.log(
    `🎉 ${repo.mainBranch} → ${repo.devBranch} synchronization completed successfully!`,
  );
  console.log(`🔖 Synchronized head: ${devHeadAfterSha}`);
  console.log(`📈 Commits applied to ${repo.devBranch}: ${commitsApplied}`);
  if (!devAdvanced) {
    console.log('✨ Development branch was already synchronized with main.');
  }
  console.log('');

  return {
    ok: true,
    outcome,
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    remote: 'origin',
    sourceBranch: repo.mainBranch,
    targetBranch: repo.devBranch,
    mainBranch: repo.mainBranch,
    devBranch: repo.devBranch,
    mainHeadBeforeSha,
    mainHeadSha,
    devHeadBeforePullSha,
    devHeadBeforeSha,
    devHeadAfterSha,
    synchronizedHeadSha: devHeadAfterSha,
    commitsApplied,
    devAdvanced,
    branchesSynchronized,
    tagName: tagName || null,
    tagCreated,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt) - new Date(startedAt)),
    fetched: true,
    mainBranchSelected: true,
    mainBranchPulled: true,
    devBranchSelected: true,
    devBranchPulled: true,
    fastForwardMerged: true,
    mainBranchPushed: true,
    devBranchPushed: true,
    tagsPushed,
    profileCode: PROFILE_CODE,
  };
}

function printMainMergeResult(result) {
  const tagSummary = result.tagCreated ? ` Tag ${result.tagName} was pushed.` : '';
  console.log(
    `📋 Structured result: ${result.repositoryCode} ${result.sourceBranch} → ${result.targetBranch} ${String(result.outcome || 'synchronized').toLowerCase()}.${tagSummary}`,
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
  executeMainMerge,
  main,
  printMainMergeResult,
};
