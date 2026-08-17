#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function fail(message) {
  console.error(`[SkyCommand Docker] ${message}`);
  process.exit(1);
}

function getWorkspaceRoot() {
  const configured = String(process.env.SKYCOMMAND_DOCKER_WORKSPACE_ROOT || '').trim();

  if (!configured) {
    fail(
      'SKYCOMMAND_DOCKER_WORKSPACE_ROOT is required before starting the Docker Temporal worker. Use the host path to the SkyEco System folder.',
    );
  }

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail(`SKYCOMMAND_DOCKER_WORKSPACE_ROOT does not exist or is not a directory: ${resolved}`);
  }

  const skyCommandCandidate = path.join(resolved, 'SkyCommand System', 'SkyCommand', 'package.json');
  if (!fs.existsSync(skyCommandCandidate)) {
    fail(
      `The configured Docker workspace does not contain SkyCommand at "SkyCommand System/SkyCommand": ${resolved}`,
    );
  }

  return resolved;
}

function getDockerGitConfiguration() {
  const enabled = String(process.env.SKYCOMMAND_DOCKER_GIT_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
  const tokenFile = String(process.env.SKYCOMMAND_DOCKER_GITHUB_TOKEN_FILE || '').trim();
  const username = String(process.env.SKYCOMMAND_GITHUB_USERNAME || '').trim();
  const authorName = String(process.env.SKYCOMMAND_GIT_AUTHOR_NAME || '').trim();
  const authorEmail = String(process.env.SKYCOMMAND_GIT_AUTHOR_EMAIL || '').trim();

  if (!enabled) {
    return { enabled: false };
  }

  if (!tokenFile) {
    fail(
      'SKYCOMMAND_DOCKER_GITHUB_TOKEN_FILE is required when SKYCOMMAND_DOCKER_GIT_ENABLED=true. Point it at a local file containing only the GitHub token.',
    );
  }

  const resolvedTokenFile = path.resolve(tokenFile);
  if (!fs.existsSync(resolvedTokenFile) || !fs.statSync(resolvedTokenFile).isFile()) {
    fail(`Docker Git token file does not exist or is not a file: ${resolvedTokenFile}`);
  }
  if (fs.readFileSync(resolvedTokenFile, 'utf8').trim() === '') {
    fail(`Docker Git token file is empty: ${resolvedTokenFile}`);
  }
  if (!username) {
    fail('SKYCOMMAND_GITHUB_USERNAME is required when Docker Git automation is enabled.');
  }
  if (!authorName || !authorEmail) {
    fail(
      'SKYCOMMAND_GIT_AUTHOR_NAME and SKYCOMMAND_GIT_AUTHOR_EMAIL are required when Docker Git automation is enabled.',
    );
  }

  process.env.SKYCOMMAND_DOCKER_GITHUB_TOKEN_FILE = resolvedTokenFile;
  return {
    enabled: true,
    tokenFile: resolvedTokenFile,
    username,
    authorName,
    authorEmail,
  };
}

function runCompose(args) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    fail(`Docker Compose could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const action = String(process.argv[2] || 'up').trim().toLowerCase();

  if (['up', 'restart', 'stack-up'].includes(action)) {
    const workspaceRoot = getWorkspaceRoot();
    process.env.SKYCOMMAND_DOCKER_WORKSPACE_ROOT = workspaceRoot;
    const gitConfiguration = getDockerGitConfiguration();
    console.log(`[SkyCommand Docker] workspace=${workspaceRoot}`);
    console.log(`[SkyCommand Docker] gitAutomation=${gitConfiguration.enabled ? 'enabled' : 'disabled'}`);
  }

  switch (action) {
    case 'up':
      runCompose(['up', '-d', '--build', 'temporal-worker']);
      break;
    case 'restart':
      runCompose(['up', '-d', '--build', '--force-recreate', 'temporal-worker']);
      break;
    case 'stack-up':
      runCompose(['up', '-d', '--build', 'temporal', 'temporal-worker']);
      break;
    case 'git-check':
      getDockerGitConfiguration();
      runCompose([
        'exec',
        '-T',
        'temporal-worker',
        'node',
        'scripts/docker/temporalWorkerGitCheck.js',
      ]);
      break;
    default:
      fail(`Unsupported action '${action}'. Supported actions: up, restart, stack-up, git-check.`);
  }
}

main();
