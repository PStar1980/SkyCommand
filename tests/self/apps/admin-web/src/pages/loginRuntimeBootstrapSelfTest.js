#!/usr/bin/env node

const { sourceDirectoryForTest } = require('../../../../../_support/sourceTestBootstrap.js');
const sourceDir = sourceDirectoryForTest(__filename);


const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
assert.match(login, /RUNTIME_ONE_SHOT_SERVICES/);
assert.match(login, /Start SkyCommand/);
assert.match(login, /supervisorService\.getRuntimeStatus/);
assert.match(login, /supervisorService\.startRuntime/);
assert.match(login, /supervisorService\.waitForOperationCompletion/);
assert.match(login, /runtimeStartFailureMessage/);
assert.match(login, /runtimeStatus === 'ONLINE'/);
assert.match(service, /127\.0\.0\.1:17170/);
assert.match(service, /X-SkyCommand-Bootstrap/);
assert.match(service, /\/runtime\/status/);
assert.match(service, /\/runtime\/start/);
assert.doesNotMatch(webService, /^    depends_on:\s*$[\s\S]*?^      api:\s*$/m);

function sourceBetween(startMarker, endMarker) {
  const start = login.indexOf(startMarker);
  const end = login.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Login source must contain ${startMarker}.`);
  return login.slice(start, end);
}

function runtimeHarness() {
  const state = { runtimeStatus: null, runtimeError: '', startingRuntime: false };
  const timers = [];
  const supervisorService = {};
  const functions = vm.runInNewContext(`(() => {
    let active = true;
    let controller = null;
    let timerId = null;
    ${sourceBetween('const SUPERVISOR_POLL_MS', 'function Login()')}
    ${sourceBetween('async function refreshRuntimeStatus()', '\n\n    refreshRuntimeStatus();')}
    ${sourceBetween('async function handleStartRuntime()', '\n\n  async function handleSubmit')}
    function visibleRuntimeServices(runtimeStatus) {
      ${sourceBetween('const runtimeServices =', '\n  const runtimeHeading =')}
      return runtimeServices;
    }
    return { refreshRuntimeStatus, handleStartRuntime, runtimeStartFailureMessage, visibleRuntimeServices };
  })()`, {
    AbortController,
    supervisorService,
    setRuntimeStatus: (value) => { state.runtimeStatus = value; },
    setRuntimeError: (value) => { state.runtimeError = value; },
    setStartingRuntime: (value) => { state.startingRuntime = value; },
    window: { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; } },
  });
  return { ...functions, state, supervisorService, timers };
}

async function testRuntimeBootstrapBehavior() {
  const harness = runtimeHarness();
  const failedStartMessage = 'Managed Codex did not become healthy.';
  harness.state.runtimeError = failedStartMessage;
  harness.state.startingRuntime = true;

  for (const runtimeStatus of ['PARTIAL', 'DEGRADED']) {
    const status = { runtimeStatus, engineStatus: 'ONLINE', services: [] };
    harness.supervisorService.getRuntimeStatus = async () => status;
    await harness.refreshRuntimeStatus();
    assert.equal(harness.state.runtimeStatus, status);
    assert.equal(harness.state.runtimeError, failedStartMessage, `${runtimeStatus} polling must retain failed START feedback.`);
    assert.equal(harness.state.startingRuntime, true, 'A non-ONLINE poll must not release an active START wait.');
  }

  harness.supervisorService.getRuntimeStatus = async () => { throw new Error('Transient Supervisor connection failure.'); };
  await harness.refreshRuntimeStatus();
  assert.equal(harness.state.runtimeStatus, null, 'An unavailable optional Supervisor must preserve ordinary login fallback.');
  assert.equal(harness.state.runtimeError, failedStartMessage, 'A polling failure must retain the last START error.');

  const partialAfterReconnect = { runtimeStatus: 'PARTIAL', engineStatus: 'ONLINE' };
  harness.supervisorService.getRuntimeStatus = async () => partialAfterReconnect;
  await harness.refreshRuntimeStatus();
  assert.equal(harness.state.runtimeError, failedStartMessage, 'Failed START feedback must survive Supervisor reconnection.');

  const online = { runtimeStatus: 'ONLINE', engineStatus: 'ONLINE' };
  harness.supervisorService.getRuntimeStatus = async () => online;
  await harness.refreshRuntimeStatus();
  assert.equal(harness.state.runtimeStatus, online);
  assert.equal(harness.state.runtimeError, '', 'An ONLINE poll must clear stale START feedback.');
  assert.equal(harness.state.startingRuntime, false);
  assert.equal(harness.timers.length, 5);
  assert(harness.timers.every((timer) => timer.delay === 2000), 'Status polling must continue after success and failure.');

  const completedPartial = {
    runtimeStatus: 'PARTIAL',
    services: [
      { service: 'temporal-volume-init', running: false, health: 'NONE' },
      { service: 'codex-managed-volume-init', running: false, health: 'NONE' },
      { service: 'api', running: true, health: 'HEALTHY' },
      { service: 'codex-managed', running: true, health: 'UNHEALTHY' },
      { service: 'node-worker', running: false, health: 'NONE' },
    ],
  };
  harness.supervisorService.startRuntime = async () => ({ operation: { requestedAt: '2026-10-03T22:00:00Z' } });
  harness.supervisorService.waitForOperationCompletion = async (request) => {
    assert.equal(harness.state.startingRuntime, true);
    assert.equal(harness.state.runtimeError, '', 'A new START attempt must clear previous feedback.');
    assert.equal(request.action, 'START');
    assert.equal(request.requestedAt, '2026-10-03T22:00:00Z');
    assert.equal(request.timeoutMs, 210000);
    return completedPartial;
  };
  await harness.handleStartRuntime();
  assert.equal(harness.state.runtimeStatus, completedPartial);
  assert.equal(harness.state.startingRuntime, false, 'A completed non-ONLINE START must release the waiting button.');
  assert.equal(harness.state.runtimeError, 'SkyCommand runtime start completed with status PARTIAL. Persistent services not ready: codex-managed, node-worker.');
  assert.deepEqual(Array.from(harness.visibleRuntimeServices(completedPartial), (item) => item.service), ['api', 'codex-managed', 'node-worker']);
  assert.equal(harness.runtimeStartFailureMessage({ runtimeStatus: 'PARTIAL', services: completedPartial.services.slice(0, 3) }), 'SkyCommand runtime start completed with status PARTIAL.');

  harness.supervisorService.waitForOperationCompletion = async () => { throw new Error(failedStartMessage); };
  await harness.handleStartRuntime();
  assert.equal(harness.state.runtimeError, failedStartMessage);
  assert.equal(harness.state.startingRuntime, false, 'A failed START operation must release the waiting button.');
  harness.supervisorService.getRuntimeStatus = async () => completedPartial;
  await harness.refreshRuntimeStatus();
  assert.equal(harness.state.runtimeError, failedStartMessage, 'Subsequent polling must preserve the actual START failure.');
  assert.equal(harness.state.startingRuntime, false);
}

testRuntimeBootstrapBehavior().then(() => {
  console.log('✅ SkyCommand login runtime-bootstrap self-test passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
