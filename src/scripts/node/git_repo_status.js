#!/usr/bin/env node

/**
 * git_repo_status.js
 *
 * Sequential dual-branch health checker for git repositories.
 * - Validates repo name against config
 * - Checks DEV branch first
 * - Checks MAIN branch next
 * - Always returns to DEV before exiting
 * - Provides full verbose status report (Option B)
 *
 * Author: Sky & Paul 💙🔥
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// -------------------------------------------------------------
// Utility to run git commands safely
// -------------------------------------------------------------
function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

// -------------------------------------------------------------
// Parse arguments
// -------------------------------------------------------------
const [repoName, configPath] = process.argv.slice(2);

if (!repoName || !configPath) {
  console.error(`
Usage:
  node git_repo_status.js <repoName> <configPath>

Example:
  node git_repo_status.js SkyServer C:\\path\\to\\repo_paths.json
`);
  process.exit(1);
}

// -------------------------------------------------------------
// Load & validate config
// -------------------------------------------------------------
let config;
try {
  const fixedJson = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(fixedJson);
} catch (err) {
  console.error('❌ Failed to load config file:', err.message);
  process.exit(1);
}

if (!config[repoName]) {
  console.error(`❌ Repo name "${repoName}" not found in config.`);
  console.error('Available repos:', Object.keys(config).join(', '));
  process.exit(1);
}

const repoRoot = config[repoName];

// -------------------------------------------------------------
// Function to collect branch status
// -------------------------------------------------------------
function collectBranchStatus(repoRoot, branchName) {
  // Switch branch
  run(`git switch ${branchName}`, repoRoot);

  // Fetch remote
  run(`git fetch origin`, repoRoot);

  // Branch verification
  const currentBranch = run(`git branch --show-current`, repoRoot);

  // Ahead/Behind counts
  const ahead = run(
    `git rev-list --left-only --count ${branchName}...origin/${branchName}`,
    repoRoot,
  );
  const behind = run(
    `git rev-list --right-only --count ${branchName}...origin/${branchName}`,
    repoRoot,
  );

  // Latest commit
  const latestCommit = run(`git log -1 --oneline`, repoRoot);

  // Working directory
  const modified = run(`git ls-files -m`, repoRoot)
    .split('\n')
    .filter((f) => f.trim().length > 0 && !f.startsWith('ERROR'));

  const untracked = run(`git ls-files --others --exclude-standard`, repoRoot)
    .split('\n')
    .filter((f) => f.trim().length > 0 && !f.startsWith('ERROR'));

  return {
    branch: currentBranch,
    ahead: ahead === 'ERROR' ? '?' : ahead,
    behind: behind === 'ERROR' ? '?' : behind,
    latestCommit,
    modified,
    untracked,
  };
}

// -------------------------------------------------------------
// Perform DEV check
// -------------------------------------------------------------
const devStatus = collectBranchStatus(repoRoot, 'dev');

// -------------------------------------------------------------
// Perform MAIN check
// -------------------------------------------------------------
const mainStatus = collectBranchStatus(repoRoot, 'main');

// -------------------------------------------------------------
// Always return to DEV (safety guarantee)
// -------------------------------------------------------------
run(`git switch dev`, repoRoot);

// -------------------------------------------------------------
// Display report
// -------------------------------------------------------------
const pad = (n) => (n < 10 ? '0' + n : n);
const now = new Date();
const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
  now.getDate(),
)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

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
    ${devStatus.modified.length ? devStatus.modified.map((f) => `- ${f}`).join('\n    ') : 'None'}

  Untracked:
    ${devStatus.untracked.length ? devStatus.untracked.map((f) => `- ${f}`).join('\n    ') : 'None'}


[ MAIN BRANCH ]
-----------------------------------------
Branch: ${mainStatus.branch}
Latest commit: ${mainStatus.latestCommit}
Ahead: ${mainStatus.ahead}
Behind: ${mainStatus.behind}

Working Directory:
  Modified:
    ${mainStatus.modified.length ? mainStatus.modified.map((f) => `- ${f}`).join('\n    ') : 'None'}

  Untracked:
    ${mainStatus.untracked.length ? mainStatus.untracked.map((f) => `- ${f}`).join('\n    ') : 'None'}

-----------------------------------------
Status check completed.
Returned to dev branch safely.
=========================================
`);
