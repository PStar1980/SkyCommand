#!/usr/bin/env node

/**
 * main_merge.js
 *
 * Fast-forwards dev from main for a configured repository.
 *
 * Config:
 *   ./config/repo_path.json
 *
 * Usage:
 *   node main_merge.js <repoName> [tagName]
 *
 * Examples:
 *   node main_merge.js SkyServer
 *   node main_merge.js SkyServer "v1.2.0"
 *   node main_merge.js SkyServer "skyserver-refactor"
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

function validateRepo(repoPaths, repoName) {
  if (!repoName) {
    fail('Missing repoName. Usage: node main_merge.js <repoName> [tagName]');
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
const [repoName, tagName] = process.argv.slice(2);

const repoPaths = loadRepoPaths();
const repoRoot = validateRepo(repoPaths, repoName);

console.log('');
console.log(`🚀 Starting main → dev merge for repo: ${repoName}`);
console.log(`📂 Repo root: ${repoRoot}`);
console.log('');

runGit(['fetch', 'origin'], repoRoot);

runGit(['switch', 'main'], repoRoot);
runGit(['pull', 'origin', 'main'], repoRoot);

runGit(['switch', 'dev'], repoRoot);
runGit(['pull', 'origin', 'dev'], repoRoot);

console.log('\n🔄 Attempting fast-forward merge from main → dev...');
runGit(['merge', '--ff-only', 'main'], repoRoot);

let createdTag = false;

if (tagName && tagName.trim() !== '') {
  console.log(`\n🏷️ Creating tag: ${tagName.trim()}`);
  runGit(['tag', tagName.trim()], repoRoot);
  createdTag = true;
}

console.log('\n📤 Pushing updated branches to origin...');
runGit(['push', 'origin', 'main'], repoRoot);
runGit(['push', 'origin', 'dev'], repoRoot);

if (createdTag) {
  console.log('📤 Pushing tags...');
  runGit(['push', '--tags'], repoRoot);
}

console.log('');
console.log('🎉 Main → dev merge completed successfully!');
console.log('');
