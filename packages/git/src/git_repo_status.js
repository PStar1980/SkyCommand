#!/usr/bin/env node

/**
 * git_repo_status.js
 *
 * Sequential dual-branch health checker for configured git repositories.
 *
 * Database config:
 *   core.repositories
 *   core.repository_paths
 *   core.config_profiles
 *
 * Environment:
 *   Loads .env from the SkyServer repository root:
 *   packages/git/src -> ../../.. -> SkyServer/.env
 *
 * Usage:
 *   node git_repo_status.js <repoName>
 *
 * Example:
 *   node git_repo_status.js SkyServer
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const SCRIPT_DIR = __dirname;
const SKY_SERVER_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');

dotenv.config({ path: ENV_PATH });

const { pool } = require('../../db/src/connection');

const PROFILE_CODE =
  process.env.SKYSERVER_CONFIG_PROFILE ||
  process.env.SKYSERVER_CORE_PROFILE ||
  process.env.CONFIG_PROFILE ||
  'DEV_LOCAL';

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------
function fail(message) {
  throw new Error(message);
}

function runGitCapture(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    return `ERROR: ${result.error.message}`;
  }

  if (result.status !== 0) {
    return `ERROR: ${result.stderr?.toString().trim() || `git ${args.join(' ')}`}`;
  }

  return result.stdout.trim();
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
    fail('Missing repoName. Usage: node git_repo_status.js <repoName>');
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

function cleanFileList(output) {
  if (!output || output.startsWith('ERROR:')) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectBranchStatus(repoRoot, branchName) {
  runGitCapture(['switch', branchName], repoRoot);
  runGitCapture(['fetch', 'origin'], repoRoot);

  const currentBranch = runGitCapture(['branch', '--show-current'], repoRoot);
  const ahead = runGitCapture(
    ['rev-list', '--left-only', '--count', `${branchName}...origin/${branchName}`],
    repoRoot,
  );
  const behind = runGitCapture(
    ['rev-list', '--right-only', '--count', `${branchName}...origin/${branchName}`],
    repoRoot,
  );
  const latestCommit = runGitCapture(['log', '-1', '--oneline'], repoRoot);

  const modified = cleanFileList(runGitCapture(['ls-files', '-m'], repoRoot));
  const untracked = cleanFileList(
    runGitCapture(['ls-files', '--others', '--exclude-standard'], repoRoot),
  );

  return {
    branch: currentBranch,
    ahead,
    behind,
    latestCommit,
    modified,
    untracked,
  };
}

function formatList(items) {
  if (!items.length) {
    return 'None';
  }

  return items.map((item) => `- ${item}`).join('\n    ');
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') +
    ' ' +
    [pad(date.getHours()), pad(date.getMinutes())].join(':')
  );
}

async function closePool() {
  try {
    await pool.end();
  } catch {
    // Nothing useful to do during CLI shutdown.
  }
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
async function main() {
  const [repoName] = process.argv.slice(2);

  const repo = await loadRepository(repoName);
  const originalBranch = runGitCapture(['branch', '--show-current'], repo.rootPath);

  const devStatus = collectBranchStatus(repo.rootPath, repo.devBranch);
  const mainStatus = collectBranchStatus(repo.rootPath, repo.mainBranch);

  // Safety default: return to configured dev branch if it exists.
  // If dev switch fails, return to original branch.
  const returnToDev = runGitCapture(['switch', repo.devBranch], repo.rootPath);

  if (returnToDev.startsWith('ERROR:') && originalBranch && !originalBranch.startsWith('ERROR:')) {
    runGitCapture(['switch', originalBranch], repo.rootPath);
  }

  const timestamp = formatTimestamp(new Date());

  console.log(`
=========================================
 Repo Status Report: ${repo.repoCode}
 Generated: ${timestamp}
 Profile: ${PROFILE_CODE}
 Root: ${repo.rootPath}
=========================================

[ ${repo.devBranch.toUpperCase()} BRANCH ]
-----------------------------------------
Branch: ${devStatus.branch}
Latest commit: ${devStatus.latestCommit}
Ahead: ${devStatus.ahead}
Behind: ${devStatus.behind}

Working Directory:
  Modified:
    ${formatList(devStatus.modified)}

  Untracked:
    ${formatList(devStatus.untracked)}


[ ${repo.mainBranch.toUpperCase()} BRANCH ]
-----------------------------------------
Branch: ${mainStatus.branch}
Latest commit: ${mainStatus.latestCommit}
Ahead: ${mainStatus.ahead}
Behind: ${mainStatus.behind}

Working Directory:
  Modified:
    ${formatList(mainStatus.modified)}

  Untracked:
    ${formatList(mainStatus.untracked)}

-----------------------------------------
Status check completed.
Returned to ${repo.devBranch} branch safely.
=========================================
`);
}

main()
  .catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
