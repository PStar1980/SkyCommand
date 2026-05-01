#!/usr/bin/env node

/**
 * dev_commit.js
 *
 * Commits and pushes changes to the dev branch for a configured repository.
 *
 * Config:
 *   ./config/repo_path.json
 *
 * Usage:
 *   node dev_commit.js <repoName> <commitMessage>
 *
 * Example:
 *   node dev_commit.js SkyServer "Updated SkyServer Core config flow"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

  return result.stdout.trim();
}

function validateRepo(repoPaths, repoName) {
  if (!repoName) {
    fail('Missing repoName. Usage: node dev_commit.js <repoName> <commitMessage>');
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

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
const [repoName, commitMessage] = process.argv.slice(2);

if (!commitMessage || commitMessage.trim() === '') {
  fail('Missing commitMessage. Usage: node dev_commit.js <repoName> <commitMessage>');
}

const repoPaths = loadRepoPaths();
const repoRoot = validateRepo(repoPaths, repoName);

console.log('');
console.log(`🚀 Starting dev commit for repo: ${repoName}`);
console.log(`📂 Repo path: ${repoRoot}`);
console.log('');

runGit(['fetch', 'origin'], repoRoot);
runGit(['switch', 'dev'], repoRoot);
runGit(['pull', 'origin', 'dev'], repoRoot);

const status = getGitOutput(['status', '--porcelain'], repoRoot);

if (status === '') {
  console.log('✨ Nothing to commit — working directory clean.');
  process.exit(0);
}

runGit(['add', '-A'], repoRoot);
runGit(['commit', '-m', commitMessage], repoRoot);
runGit(['push', 'origin', 'dev'], repoRoot);

console.log('');
console.log('🎉 Dev commit completed successfully!');
console.log('');
