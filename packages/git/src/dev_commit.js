#!/usr/bin/env node

/**
 * dev_commit.js
 *
 * Commits and pushes changes to the dev branch for a configured repository.
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
 *   node dev_commit.js <repoName> <commitMessage>
 *
 * Example:
 *   node dev_commit.js SkyServer "Updated SkyServer Core config flow"
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
    fail('Missing repoName. Usage: node dev_commit.js <repoName> <commitMessage>');
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
  const [repoName, commitMessage] = process.argv.slice(2);

  if (!commitMessage || commitMessage.trim() === '') {
    fail('Missing commitMessage. Usage: node dev_commit.js <repoName> <commitMessage>');
  }

  const repo = await loadRepository(repoName);

  console.log('');
  console.log(`🚀 Starting dev commit for repo: ${repo.repoCode}`);
  console.log(`📂 Repo path: ${repo.rootPath}`);
  console.log(`🌿 Dev branch: ${repo.devBranch}`);
  console.log('');

  runGit(['fetch', 'origin'], repo.rootPath);
  runGit(['switch', repo.devBranch], repo.rootPath);
  runGit(['pull', 'origin', repo.devBranch], repo.rootPath);

  const status = getGitOutput(['status', '--porcelain'], repo.rootPath);

  if (status === '') {
    console.log('✨ Nothing to commit — working directory clean.');
    return;
  }

  runGit(['add', '-A'], repo.rootPath);
  runGit(['commit', '-m', commitMessage], repo.rootPath);
  runGit(['push', 'origin', repo.devBranch], repo.rootPath);

  console.log('');
  console.log('🎉 Dev commit completed successfully!');
  console.log('');
}

main()
  .catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
