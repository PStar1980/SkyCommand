#!/usr/bin/env node

const fs = require('node:fs');

function normalizeToken(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function readRequest() {
  return fs
    .readFileSync(0, 'utf8')
    .split(/\r?\n/)
    .reduce((request, line) => {
      const separator = line.indexOf('=');
      if (separator > 0) {
        request[line.slice(0, separator)] = line.slice(separator + 1);
      }
      return request;
    }, {});
}

const action = String(process.argv[2] || 'get').trim().toLowerCase();
if (action === 'store' || action === 'erase') {
  process.exit(0);
}
if (action !== 'get') {
  process.exit(0);
}

const request = readRequest();
const expectedHost = String(process.env.SKYCOMMAND_GITHUB_HOST || 'github.com').trim();
const tokenFile = String(
  process.env.SKYCOMMAND_GITHUB_TOKEN_FILE || '/run/secrets/skycommand_github_token',
).trim();
const username = String(process.env.SKYCOMMAND_GITHUB_USERNAME || '').trim();

if (request.protocol !== 'https' || request.host !== expectedHost || !username) {
  process.exit(0);
}

let token = '';
try {
  token = normalizeToken(fs.readFileSync(tokenFile, 'utf8'));
} catch {
  process.exit(0);
}

if (!token) {
  process.exit(0);
}

process.stdout.write(`username=${username}\n`);
process.stdout.write(`password=${token}\n`);
