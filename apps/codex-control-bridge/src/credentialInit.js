'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const apiTokenDirectory = process.env.CODEX_BRIDGE_TOKEN_DIR || '/run/codex-api-bridge';
const runtimeTokenDirectory = process.env.CODEX_RUNTIME_TOKEN_DIR || '/run/codex-runtime-control';
const managedHome = process.env.CODEX_MANAGED_HOME || '/var/lib/codex';

function ensureToken(directory, filename) {
  const tokenPath = path.join(directory, filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(tokenPath, `${crypto.randomBytes(48).toString('base64url')}\n`, { flag: 'wx', mode: 0o400 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const stats = fs.statSync(tokenPath);
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!stats.isFile() || token.length < 40) throw new Error('Managed control credential store is invalid.');
  fs.chmodSync(tokenPath, 0o400);
  fs.chownSync(tokenPath, 1000, 1000);
}

function initialize() {
  ensureToken(apiTokenDirectory, 'api-bridge-token');
  ensureToken(runtimeTokenDirectory, 'runtime-control-token');
  fs.mkdirSync(managedHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(managedHome, 0o700);
  fs.chownSync(managedHome, 1000, 1000);
}

if (require.main === module) {
  try {
    initialize();
    process.stdout.write(`${JSON.stringify({ service: 'codex-control-credential-init', status: 'READY' })}\n`);
  } catch (_error) {
    process.stderr.write(`${JSON.stringify({ service: 'codex-control-credential-init', status: 'FAILED' })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ensureToken, initialize };
