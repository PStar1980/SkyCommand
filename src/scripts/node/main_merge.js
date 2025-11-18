#!/usr/bin/env node

/**
 * main_merge.js
 *
 * Usage:
 *   node main_merge.js <repoName> <configPath> [tagName]
 *
 * Examples:
 *   node main_merge.js SkyServer "C:\\Path\\To\\repo_path.json"
 *   node main_merge.js SkyServer "C:\\Path\\To\\repo_path.json" "v1.2.0"
 *   node main_merge.js SkyServer "./repo_path.json" "skyserver-refactor"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ------------------------------------------------------------
// Utility: Run git commands with consistent logging + safety
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

if (args.length < 2) {
  console.error('❌ Missing parameters.');
  console.error('Usage: node main_merge.js <repoName> <configPath> [tagName]');
  process.exit(1);
}

const [repoName, configPath, tagName] = args;

// ------------------------------------------------------------
// 2. Validate configPath
// ------------------------------------------------------------
const resolvedConfigPath = path.resolve(configPath);

if (!fs.existsSync(resolvedConfigPath)) {
  console.error(`❌ Config file not found at: ${resolvedConfigPath}`);
  process.exit(1);
}

// Load + parse JSON
let repoPaths;
try {
  const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
  repoPaths = JSON.parse(raw);
} catch (err) {
  console.error('❌ Invalid JSON in config file.');
  process.exit(1);
}

// ------------------------------------------------------------
// 3. Validate repoName
// ------------------------------------------------------------
if (!repoPaths[repoName]) {
  console.error(`❌ Error: Unknown repo name '${repoName}'.`);
  console.error(`Available repos: ${Object.keys(repoPaths).join(', ')}`);
  process.exit(1);
}

const repoRoot = repoPaths[repoName];

if (!fs.existsSync(repoRoot)) {
  console.error(`❌ Repo path does not exist:\n${repoRoot}`);
  process.exit(1);
}

// ------------------------------------------------------------
// 4. Begin Merge Process
// ------------------------------------------------------------
console.log('');
console.log(`🚀 Starting main → dev merge for repo: ${repoName}`);
console.log(`📂 Repo root: ${repoRoot}`);
console.log('');

// Step A: Fetch latest from origin
runGit(['fetch', 'origin'], repoRoot);

// Step B: Update local main
runGit(['switch', 'main'], repoRoot);
runGit(['pull', 'origin', 'main'], repoRoot);

// Step C: Update local dev
runGit(['switch', 'dev'], repoRoot);
runGit(['pull', 'origin', 'dev'], repoRoot);

// Step D: Fast-forward dev from main
console.log('\n🔄 Attempting fast-forward merge from main → dev...');
runGit(['merge', '--ff-only', 'main'], repoRoot);

// Step E (optional): Tag creation if tagName provided
let createdTag = false;

if (tagName && tagName.trim() !== '') {
  console.log(`\n🏷️ Creating tag: ${tagName}`);
  runGit(['tag', tagName.trim()], repoRoot);
  createdTag = true;
}

// Step F: Push everything
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
