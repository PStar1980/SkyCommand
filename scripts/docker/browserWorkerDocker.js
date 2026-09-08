#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function fail(message) {
  console.error(`[SkyCommand Browser Worker] ${message}`);
  process.exit(1);
}

function getWorkspaceRoot() {
  const configured = String(process.env.SKYCOMMAND_DOCKER_WORKSPACE_ROOT || '').trim();
  if (!configured) {
    fail(
      'SKYCOMMAND_DOCKER_WORKSPACE_ROOT is required before starting the Browser Worker so Playwright artifacts can be persisted to the host repository.',
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

function runCompose(args) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) fail(`Docker Compose could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const action = String(process.argv[2] || 'up').trim().toLowerCase();

  if (['up', 'restart', 'stack-up'].includes(action)) {
    const workspaceRoot = getWorkspaceRoot();
    process.env.SKYCOMMAND_DOCKER_WORKSPACE_ROOT = workspaceRoot;
    console.log(`[SkyCommand Browser Worker] workspace=${workspaceRoot}`);
    console.log(
      `[SkyCommand Browser Worker] taskQueue=${String(process.env.SKYCOMMAND_BROWSER_TASK_QUEUE || 'skycommand-browser-local').trim()}`,
    );
  }

  switch (action) {
    case 'up':
      runCompose(['up', '-d', '--build', 'browser-worker']);
      break;
    case 'restart':
      runCompose(['up', '-d', '--build', '--force-recreate', 'browser-worker']);
      break;
    case 'stack-up':
      runCompose(['up', '-d', '--build', 'temporal', 'web', 'browser-worker']);
      break;
    default:
      fail(`Unsupported action '${action}'. Supported actions: up, restart, stack-up.`);
  }
}

main();
