#!/usr/bin/env node

/**
 * Watcher-safe repository intelligence for configured Git repositories.
 *
 * The inspection is checkout-free: it never switches branches, pulls into the
 * working tree, resets files, or rewrites watched source paths. A remote fetch
 * refreshes tracking references, then structured evidence is collected for
 * branch synchronization, working-tree state, in-progress Git operations, and
 * development-promotion readiness.
 *
 * Usage: node git_repo_status.js <repoName>
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  inspectGitRepository,
} = require('./gitRepositoryStatusInspector');
const {
  createGitRepositoryStatusFailureToolResult,
  createGitRepositoryStatusToolResult,
} = require('./gitRepositoryStatusResult');

const SCRIPT_DIR = __dirname;
const SKY_SERVER_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');
const TOOL_CODE = 'git_repo_status';
const OUTPUT_TYPE = 'git_repository_status.v1';

// The configured repository database remains the runtime source of truth.
dotenv.config({ path: ENV_PATH });
const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';
const GIT_COMMAND_TIMEOUT_MS = Math.max(
  10000,
  Number(
    process.env.SKYCOMMAND_GIT_COMMAND_TIMEOUT_MS ||
      DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  ),
);

function fail(message, code = 'GIT_REPOSITORY_STATUS_FAILED') {
  const error = new Error(message);
  error.code = code;
  throw error;
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
    fail(
      'Missing repoName. Usage: node git_repo_status.js <repoName>',
      'REPOSITORY_NAME_REQUIRED',
    );
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
    fail(
      `Unknown repo '${repoName}'. Available repos: ${availableRepos.join(', ')}`,
      'REPOSITORY_NOT_REGISTERED',
    );
  }

  const repo = result.rows[0];

  if (!repo.root_path || !fs.existsSync(repo.root_path)) {
    fail(`Repo path does not exist: ${repo.root_path}`, 'REPOSITORY_PATH_INVALID');
  }

  return {
    repoCode: repo.repo_code,
    repoName: repo.repo_name,
    mainBranch: repo.main_branch || 'main',
    devBranch: repo.dev_branch || 'dev',
    rootPath: repo.root_path,
  };
}

function formatBoolean(value) {
  return value ? 'Yes' : 'No';
}

function formatCount(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function formatSha(value) {
  return value ? String(value).slice(0, 12) : 'missing';
}

function printBranchStatus(label, branch) {
  console.log(`[ ${label.toUpperCase()} ]`);
  console.log(`  Local head:  ${formatSha(branch.localSha)}`);
  console.log(`  Remote head: ${formatSha(branch.remoteSha)}`);
  console.log(`  Ahead: ${formatCount(branch.ahead)} · Behind: ${formatCount(branch.behind)}`);
  console.log(`  Local matches remote: ${formatBoolean(branch.localMatchesRemote)}`);
  if (branch.latestRemoteCommit?.subject) {
    console.log(
      `  Latest remote commit: ${branch.latestRemoteCommit.shortSha || formatSha(branch.remoteSha)} ${branch.latestRemoteCommit.subject}`,
    );
  }
  console.log('');
}

function printRepositoryStatusResult(result) {
  const workingTree = result.workingTree || {};
  const repositoryState = result.repositoryState || {};
  const relationship = result.relationship || {};

  console.log('');
  console.log('=========================================');
  console.log(` Repository Intelligence: ${result.repositoryCode}`);
  console.log(` Profile: ${PROFILE_CODE}`);
  console.log(` Root: ${result.repositoryRoot}`);
  console.log(' Strategy: checkout-free watcher-safe inspection');
  console.log('=========================================');
  console.log('');
  console.log(`Readiness: ${result.outcome}`);
  console.log(`Active branch: ${result.currentBranch || 'DETACHED HEAD'}`);
  console.log(`Expected branch: ${result.expectedBranch}`);
  console.log(`Remote fetch succeeded: ${formatBoolean(result.fetchSucceeded)}`);
  console.log('');
  console.log('[ WORKING TREE ]');
  console.log(`  Clean: ${formatBoolean(workingTree.clean)}`);
  console.log(
    `  Staged: ${workingTree.staged || 0} · Modified: ${workingTree.modified || 0} · Untracked: ${workingTree.untracked || 0} · Conflicted: ${workingTree.conflicted || 0}`,
  );
  console.log('');
  printBranchStatus(result.branches?.dev?.name || 'dev', result.branches?.dev || {});
  printBranchStatus(result.branches?.main?.name || 'main', result.branches?.main || {});
  console.log('[ BRANCH RELATIONSHIP ]');
  console.log(
    `  Remote branches synchronized: ${formatBoolean(relationship.remoteBranchesSynchronized)}`,
  );
  console.log(
    `  Main contains development: ${
      relationship.mainContainsDev === null ? 'Unknown' : formatBoolean(relationship.mainContainsDev)
    }`,
  );
  console.log(
    `  Development contains main: ${
      relationship.devContainsMain === null ? 'Unknown' : formatBoolean(relationship.devContainsMain)
    }`,
  );
  console.log('');
  console.log('[ REPOSITORY STATE ]');
  console.log(`  Index lock present: ${formatBoolean(repositoryState.indexLockPresent)}`);
  console.log(`  Git operation in progress: ${formatBoolean(repositoryState.operationInProgress)}`);
  console.log('');

  if (result.blockers?.length) {
    console.log('[ PROMOTION BLOCKERS ]');
    result.blockers.forEach((blocker) => {
      console.log(`  - ${blocker.code}: ${blocker.message}`);
    });
    console.log('');
  }

  if (result.advisories?.length) {
    console.log('[ ADVISORIES ]');
    result.advisories.forEach((advisory) => console.log(`  - ${advisory}`));
    console.log('');
  }

  if (result.recommendedActions?.length) {
    console.log('[ RECOMMENDED ACTIONS ]');
    result.recommendedActions.forEach((action) => console.log(`  - ${action}`));
    console.log('');
  }

  if (result.recentCommits?.length) {
    console.log('[ RECENT HISTORY ]');
    result.recentCommits.forEach((commit) => {
      const decorations = commit.decorations ? ` (${commit.decorations})` : '';
      console.log(`  ${commit.shortSha || formatSha(commit.sha)}${decorations} ${commit.subject || ''}`);
    });
    console.log('');
  }

  console.log(
    `📋 Structured result: ${result.repositoryCode} is ${
      result.readyForDevelopmentPromotion ? 'ready' : 'not ready'
    } for development promotion.`,
  );
  console.log('🛡️ No branch switch, pull, reset, checkout, or working-tree rewrite was performed.');
  console.log('');
}

async function executeRepositoryStatus(args = []) {
  const [repoName] = (Array.isArray(args) ? args : [])
    .map(String)
    .filter((arg) => !arg.startsWith('--'));
  const repo = await loadRepository(repoName);

  return inspectGitRepository({
    repositoryCode: repo.repoCode,
    repositoryName: repo.repoName,
    repositoryRoot: repo.rootPath,
    mainBranchName: repo.mainBranch,
    devBranchName: repo.devBranch,
    remote: 'origin',
    timeoutMs: GIT_COMMAND_TIMEOUT_MS,
    profileCode: PROFILE_CODE,
  });
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
      execute: executeRepositoryStatus,
      createToolResult: createGitRepositoryStatusToolResult,
      createFailureToolResult: (error) =>
        createGitRepositoryStatusFailureToolResult({
          error,
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      renderConsole: printRepositoryStatusResult,
    });
  } finally {
    await closePool();
  }
}

if (require.main === module) main();

module.exports = {
  OUTPUT_TYPE,
  TOOL_CODE,
  executeRepositoryStatus,
  loadRepository,
  main,
  printRepositoryStatusResult,
};
