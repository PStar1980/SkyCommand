#!/usr/bin/env node

/**
 * dev_commit.js
 *
 * Usage:
 *   node dev_commit.js <repoName> <commitMessage> <configPath>
 *
 * Example:
 *   node dev_commit.js SkyServer "Updated API routes" "C:\\Path\\To\\repo_path.json"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ------------------------------------------------------------
// Utility: Run a git command with consistent logging
// ------------------------------------------------------------
function runGit(args, cwd) {
  console.log(`> git ${args.join(' ')}`);
  const result = spawnSync('git', args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`❌ Git command failed: git ${args.join(' ')}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------
// 1. Parse Parameters
// ------------------------------------------------------------
const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('❌ Error: Missing required parameters.');
  console.error('Usage: node dev_commit.js <repoName> <commitMessage> <configPath>');
  process.exit(1);
}

const [repoName, commitMessage, configPath] = args;

// ------------------------------------------------------------
// 2. Validate Config File
// ------------------------------------------------------------
const resolvedConfigPath = path.resolve(configPath);

if (!fs.existsSync(resolvedConfigPath)) {
  console.error(`❌ Error: Config file not found at: ${resolvedConfigPath}`);
  process.exit(1);
}

let repoPaths;

try {
  const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
  repoPaths = JSON.parse(raw);
} catch (err) {
  console.error('❌ Error: Invalid JSON format in config file.');
  process.exit(1);
}

// ------------------------------------------------------------
// 3. Validate repoName
// ------------------------------------------------------------
if (!repoPaths[repoName]) {
  console.error(`❌ Error: Unknown repo '${repoName}'.`);
  console.error(`Available repos: ${Object.keys(repoPaths).join(', ')}`);
  process.exit(1);
}

const repoRoot = repoPaths[repoName];

if (!fs.existsSync(repoRoot)) {
  console.error(`❌ Error: Repo path does not exist:\n${repoRoot}`);
  process.exit(1);
}

// ------------------------------------------------------------
// 4. Begin Dev Commit Process
// ------------------------------------------------------------
console.log('');
console.log(`🚀 Starting dev commit for repo: ${repoName}`);
console.log(`📂 Repo path: ${repoRoot}`);
console.log('');

// Step A: Fetch
runGit(['fetch', 'origin'], repoRoot);

// Step B: Switch to dev
runGit(['switch', 'dev'], repoRoot);

// Step C: Pull latest dev
runGit(['pull', 'origin', 'dev'], repoRoot);

// Step D: Check for changes
const status = spawnSync('git', ['status', '--porcelain'], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (status.status !== 0) {
  console.error('❌ Error: Failed to retrieve git status.');
  process.exit(1);
}

if (status.stdout.trim() === '') {
  console.log('✨ Nothing to commit — working directory clean.');
  process.exit(0);
}

// Step E: Stage all changes
runGit(['add', '-A'], repoRoot);

// Step F: Commit
runGit(['commit', '-m', commitMessage], repoRoot);

// Step G: Push
runGit(['push', 'origin', 'dev'], repoRoot);

console.log('');
console.log('🎉 Dev commit completed successfully!');
console.log('');
