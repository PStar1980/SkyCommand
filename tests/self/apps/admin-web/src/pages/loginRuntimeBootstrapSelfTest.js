#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(sourceDir, '../../../..');
const login = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/Login.jsx'), 'utf8');
const service = fs.readFileSync(path.join(root, 'apps/admin-web/src/services/supervisorService.js'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');

function composeServiceBlock(source, serviceName) {
  const lines = source.split(/\r?\n/);
  const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const servicePattern = new RegExp(`^  ${escaped}:\\s*$`);
  const start = lines.findIndex((line) => servicePattern.test(line));
  assert.notEqual(start, -1, `Compose service ${serviceName} must exist.`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_-]+:\s*$/.test(lines[index]) || /^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

const webService = composeServiceBlock(compose, 'web');

assert.match(login, /SkyCommand runtime offline/);
assert.match(login, /Start SkyCommand/);
assert.match(login, /supervisorService\.getRuntimeStatus/);
assert.match(login, /supervisorService\.startRuntime/);
assert.match(login, /runtimeStatus === 'ONLINE'/);
assert.match(service, /127\.0\.0\.1:17170/);
assert.match(service, /X-SkyCommand-Bootstrap/);
assert.match(service, /\/runtime\/status/);
assert.match(service, /\/runtime\/start/);
assert.doesNotMatch(webService, /^    depends_on:\s*$[\s\S]*?^      api:\s*$/m);

console.log('✅ SkyCommand login runtime-bootstrap self-test passed.');
