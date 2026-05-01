#!/usr/bin/env node

/**
 * git_repo_status.js
 *
 * Sequential dual-branch health checker for configured git repositories.
 *
 * Config:
 *   ./config/repo_path.json
 *
 * Usage:
 *   node git_repo_status.js <repoName>
 *
 * Example:
 *   node git_repo_status.js SkyServer
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_CONFIG_PATH = path.join(__dirname, 'config', 'repo_path.json');

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------
function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadRepoPaths() {
  if (!fs.existsSync(REPO_CONFIG_PATH)) {
    fail(`Repo config not found at: ${REPO_CONFIG_PATH}`);
  }

  try {
    return JSON.parse(fs.readFileSync(REPO_CONFIG_PATH, 'utf8'));
  } catch (err) {
    fail(`Invalid repo_path.json: ${err.message}`);
  }
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    return `ERROR: ${err.stderr?.toString().trim() || err.message}`;
  }
}

function validateRepo(repoPaths, repoName) {
  if (!repoName) {
    fail('Missing repoName. Usage: node git_repo_status.js <repoName>');
  }

  if (!repoPaths[repoName]) {
    fail(`Unknown repo '${repoName}'. Available repos: ${Object.keys(repoPaths).join(', ')}`);
  }

  const repoRoot = repoPaths[repoName];

  if (!fs.existsSync(repoRoot)) {
    fail(`Repo path does not exist: ${repoRoot}`);
  }

  return repoRoot;
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
  run(`git switch ${branchName}`, repoRoot);
  run('git fetch origin', repoRoot);

  const currentBranch = run('git branch --show-current', repoRoot);
  const ahead = run(
    `git rev-list --left-only --count ${branchName}...origin/${branchName}`,
    repoRoot,
  );
  const behind = run(
    `git rev-list --right-only --count ${branchName}...origin/${branchName}`,
    repoRoot,
  );
  const latestCommit = run('git log -1 --oneline', repoRoot);

  const modified = cleanFileList(run('git ls-files -m', repoRoot));
  const untracked = cleanFileList(run('git ls-files --others --exclude-standard', repoRoot));

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

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
const [repoName] = process.argv.slice(2);

const repoPaths = loadRepoPaths();
const repoRoot = validateRepo(repoPaths, repoName);

const originalBranch = run('git branch --show-current', repoRoot);

const devStatus = collectBranchStatus(repoRoot, 'dev');
const mainStatus = collectBranchStatus(repoRoot, 'main');

// Safety default: return to dev if it exists.
// If dev switch fails, return to original branch.
const returnToDev = run('git switch dev', repoRoot);

if (returnToDev.startsWith('ERROR:') && originalBranch && !originalBranch.startsWith('ERROR:')) {
  run(`git switch ${originalBranch}`, repoRoot);
}

const timestamp = formatTimestamp(new Date());

console.log(`
=========================================
 Repo Status Report: ${repoName}
 Generated: ${timestamp}
 Root: ${repoRoot}
=========================================

[ DEV BRANCH ]
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


[ MAIN BRANCH ]
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
Returned to dev branch safely.
=========================================
`);
