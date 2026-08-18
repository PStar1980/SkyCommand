#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env') });

function fail(message) {
  console.error(`[SkyCommand Docker] ${message}`);
  process.exit(1);
}

function getWebPort() {
  const raw = String(process.env.SKYCOMMAND_WEB_PORT || '5171').trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`SKYCOMMAND_WEB_PORT must be a valid TCP port. Received: ${raw}`);
  }
  process.env.SKYCOMMAND_WEB_PORT = String(port);
  return port;
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

function announceWebPort() {
  const port = getWebPort();
  console.log(`[SkyCommand Docker] web=http://localhost:${port}`);
  console.log(
    `[SkyCommand Docker] Stop the host Vite process before Docker Web startup if it is already using port ${port}.`,
  );
}

function main() {
  const action = String(process.argv[2] || 'up').trim().toLowerCase();

  switch (action) {
    case 'up':
      announceWebPort();
      runCompose(['up', '-d', '--build', 'web']);
      break;
    case 'restart':
      announceWebPort();
      runCompose(['up', '-d', '--build', '--force-recreate', 'web']);
      break;
    case 'stack-up':
      announceWebPort();
      runCompose([
        'up',
        '-d',
        '--build',
        'postgres',
        'temporal',
        'temporal-worker',
        'node-worker',
        'api',
        'web',
      ]);
      break;
    case 'stack-restart':
      announceWebPort();
      console.log('[SkyCommand Docker] Rebuilding and recreating the full six-container runtime.');
      runCompose([
        'up',
        '-d',
        '--build',
        '--force-recreate',
        'postgres',
        'temporal',
        'temporal-worker',
        'node-worker',
        'api',
        'web',
      ]);
      break;
    default:
      fail(`Unsupported action '${action}'. Supported actions: up, restart, stack-up, stack-restart.`);
  }
}

main();
