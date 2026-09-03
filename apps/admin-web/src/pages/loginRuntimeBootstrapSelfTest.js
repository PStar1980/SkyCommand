#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../../..');
const login = fs.readFileSync(path.join(root, 'apps/admin-web/src/pages/Login.jsx'), 'utf8');
const service = fs.readFileSync(path.join(root, 'apps/admin-web/src/services/supervisorService.js'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');

assert.match(login, /SkyCommand runtime offline/);
assert.match(login, /Start SkyCommand/);
assert.match(login, /supervisorService\.getRuntimeStatus/);
assert.match(login, /supervisorService\.startRuntime/);
assert.match(login, /runtimeStatus === 'ONLINE'/);
assert.match(service, /127\.0\.0\.1:17170/);
assert.match(service, /X-SkyCommand-Bootstrap/);
assert.match(service, /\/runtime\/status/);
assert.match(service, /\/runtime\/start/);
assert.doesNotMatch(compose, /web:[\s\S]*?depends_on:[\s\S]*?api:/);

console.log('✅ SkyCommand login runtime-bootstrap self-test passed.');
