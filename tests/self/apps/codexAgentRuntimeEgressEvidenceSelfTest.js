'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_RETAINED_EVENTS, sanitizeBoundary, validatedSnapshot, readEgressSnapshot,
  initialEgressBoundary, egressWindowEvidence,
} = require('../../../apps/codex-agent-runtime-worker/src/runtimeEgressEvidence');
const { AuthAbPhaseJournal } = require('../../../apps/codex-egress-proxy/src/authAbDiagnostics');
const crypto = require('node:crypto');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const generationA = '0380b16a-418a-4147-868b-7404949ad27e';
const generationB = '08f0a2c5-d0ac-47da-9701-d59ad9e47f10';
const ts = '2026-09-30T06:00:00.000Z';
const digest = 'A'.repeat(64);
const makeEvent = (cursor, extras = {}) => ({
  cursor, host: 'api.openai.com', destinationFingerprint: digest,
  port: 443, decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED', observedAt: ts,
  ...extras,
});
const rawSnapshot = ({ generation = generationA, cursor = 0, events = [], earliestRetainedCursor = 1, pendingConnects = 0 } = {}) => ({
  generation, cursor, earliestRetainedCursor, pendingConnects, events,
});
const snap = (args) => validatedSnapshot(rawSnapshot(args), ts);
const before = initialEgressBoundary(snap());
assert.deepEqual(sanitizeBoundary(before), before);
assert.equal(sanitizeBoundary({ ...before, generation: '../../etc/passwd' }), null);
assert.equal(sanitizeBoundary({ ...before, pendingConnects: -1 }), null);
assert.equal(validatedSnapshot({ ...rawSnapshot(), credentials: 'DROP', generation: 'invalid' }), null);

const empty = egressWindowEvidence(before, snap());
assert.equal(empty.availability, 'COMPLETE');
assert.equal(empty.observedCount, 0);
assert.equal(empty.runAttribution, 'NOT_ESTABLISHED');
assert.equal(empty.scope, 'PROXY_WIDE_CONNECT_WINDOW');
assert.equal(empty.events.length, 0);

const one = egressWindowEvidence(before, snap({ cursor: 1, events: [makeEvent(1)] }));
assert.equal(one.availability, 'COMPLETE');
assert.equal(one.events.length, 1);
assert.equal(one.events[0].destinationHost, 'api.openai.com');
assert.equal(one.events[0].port, 443);
assert.equal(one.events[0].reason, 'HOST_NOT_ALLOWLISTED');

const untrustedHost = 'private-tokenlike-segment.attacker.invalid';
const unknown = egressWindowEvidence(before, snap({ cursor: 1, events: [makeEvent(1, {
  host: untrustedHost, credential: 'test-egress-credential-placeholder', destinationFingerprint: 'b'.repeat(64),
})] }));
assert.equal(unknown.availability, 'COMPLETE');
assert.equal(unknown.events[0].destinationClassification, 'OTHER_HOST_REDACTED');
assert.equal(Object.hasOwn(unknown.events[0], 'destinationHost'), false);
assert.ok(!JSON.stringify(unknown).includes(untrustedHost));
assert.ok(!JSON.stringify(unknown).includes('test-egress-credential-placeholder'));

assert.equal(egressWindowEvidence(before, snap({ generation: generationB })).completenessReason, 'PROXY_GENERATION_CHANGED');
assert.equal(egressWindowEvidence(before, snap({ cursor: 5, events: [makeEvent(5)] })).completenessReason, 'EVENT_SEQUENCE_INCOMPLETE');
assert.equal(egressWindowEvidence(before, snap({ cursor: 2, earliestRetainedCursor: 2, events: [makeEvent(2)] })).completenessReason, 'JOURNAL_OVERWRITTEN');
assert.equal(egressWindowEvidence(before, snap({ cursor: 1, events: [makeEvent(1)], pendingConnects: 1 })).completenessReason, 'CONNECTIONS_IN_FLIGHT');
const pendingStart = initialEgressBoundary(snap({ pendingConnects: 1 }));
assert.equal(egressWindowEvidence(pendingStart, snap()).completenessReason, 'CONNECTIONS_IN_FLIGHT');
assert.equal(egressWindowEvidence(null, snap()).availability, 'UNAVAILABLE');
assert.equal(egressWindowEvidence(before, null).availability, 'UNAVAILABLE');
assert.equal(egressWindowEvidence(before, snap({ cursor: 1, events: [makeEvent(1, { destinationFingerprint: 'BAD' })] })).completenessReason, 'EVENT_PROJECTION_INVALID');
const many = Array.from({ length: MAX_RETAINED_EVENTS + 1 }, (_, i) => makeEvent(i + 1));
const capped = egressWindowEvidence(before, snap({ cursor: many.length, events: many }));
assert.equal(capped.availability, 'INCOMPLETE');
assert.equal(capped.completenessReason, 'EVIDENCE_OUTPUT_CAPPED');
assert.equal(capped.events.length, MAX_RETAINED_EVENTS);

const journal = new AuthAbPhaseJournal({ key: crypto.randomBytes(32), now: () => ts });
const connect = journal.beginConnect();
assert.equal(journal.safeSnapshot().pendingConnects, 1);
journal.finishConnect(connect, 'api.openai.com', 443, 'DENY', 'HOST_NOT_ALLOWLISTED');
assert.equal(journal.safeSnapshot().pendingConnects, 0);
assert.equal(journal.safeSnapshot().events[0].cursor, 1);

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const worker = read('apps/codex-agent-runtime-worker/src/index.js');
const proxy = read('apps/codex-egress-proxy/src/index.js');
const workflow = read('packages/temporal/src/workflows/agentRunWorkflow.js');
const activities = read('packages/temporal/src/activities/agentRunActivities.js');
const recovery = read('apps/api/src/services/agentExecutionService.js');
const fingerprint = read('apps/api/src/services/managedCodexBootstrapService.js');
const runtimeActivity = read('apps/agent-runtime-worker/src/activities.js');
assert.match(proxy, /generation: proxyGeneration/);
assert.match(proxy, /earliestRetainedCursor/);
assert.match(proxy, /pendingConnects: phaseJournal\.pendingConnects/);
assert.match(worker, /boundary = initialEgressBoundary\(await readEgressSnapshot\(\)\)/);
assert.match(worker, /egressEvidence = result\.providerTerminalStatus/);
assert.match(worker, /runtimeEvidenceBoundary: started\.runtimeEvidenceBoundary/);
assert.match(activities, /'runtimeEvidenceBoundary', \$6::jsonb/);
assert.match(activities, /PROVIDER_EGRESS_OBSERVATION/);
assert.match(activities, /egressEvidence: runtimeResult\?\.egressEvidence/);
assert.match(workflow, /runtimeEvidenceBoundary: startResponse\.runtimeEvidenceBoundary/);
assert.match(runtimeActivity, /runtimeEvidenceBoundary: input\.runtimeEvidenceBoundary/);
assert.match(recovery, /po\.outcome AS provider_operation_outcome/);
assert.match(recovery, /row\.provider_operation_outcome\.runtimeEvidenceBoundary/);
assert.match(fingerprint, /apps\/codex-agent-runtime-worker\/src\/runtimeEgressEvidence\.js/);
assert.match(fingerprint, /egressDiagnosticCaptureReady: health\?\.egressDiagnosticCaptureReady === true/);
assert.match(fingerprint, /apps\/codex-egress-proxy\/src\/authAbDiagnostics\.js/);
assert.doesNotMatch(workflow, /codex-read-only-pilot/);
assert.doesNotMatch(workflow, /runtimeKind\s*===\s*['"]OPENAI_CODEX_APP_SERVER['"]/);


// Black-box regression: exercise the real proxy HTTP handler in its default
// production mode, not a mock diagnostics payload. The previous implementation
// called setHeader after writeHead; /healthz passed while /diagnostics caused
// ERR_HTTP_HEADERS_SENT and terminated the proxy process. No CONNECT or
// external network request is made by this loopback-only test.
async function testLiveProxyDiagnosticsRoute() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-c5c-proxy-'));
  const allowlistPath = path.join(scratch, 'allowlist.txt');
  fs.writeFileSync(allowlistPath, 'auth.openai.com\nchatgpt.com\n', 'utf8');
  const reserve = net.createServer();
  let child = null;
  let stderr = '';
  try {
    await new Promise((resolve, reject) => {
      reserve.once('error', reject);
      reserve.listen(0, '127.0.0.1', resolve);
    });
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    child = spawn(process.execPath, [path.join(root, 'apps/codex-egress-proxy/src/index.js')], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_EGRESS_PROXY_PORT: String(port),
        CODEX_EGRESS_ALLOWLIST_PATH: allowlistPath,
        CODEX_EGRESS_AUTH_AB_MODE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', () => {}); // Drain the bounded startup log.
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1600); });
    async function readJson(route) {
      return new Promise((resolve, reject) => {
        const request = http.get(`http://127.0.0.1:${port}${route}`, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) response.destroy(new Error('Unexpected oversized diagnostics response.'));
          });
          response.on('end', () => {
            try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }); }
            catch (error) { reject(error); }
          });
          response.on('error', reject);
        });
        request.setTimeout(900, () => request.destroy(new Error('Proxy test request timed out.')));
        request.on('error', reject);
      });
    }
    const deadline = Date.now() + 4000;
    let online = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const health = await readJson('/healthz');
        online = health.status === 200 && health.body.ok === true;
        if (online) break;
      } catch (_error) { /* The child may still be starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assert.ok(online, `Isolated proxy did not become healthy: ${stderr}`);
    for (let i = 0; i < 2; i += 1) {
      const diagnostic = await readJson('/diagnostics');
      assert.equal(diagnostic.status, 200, 'default-mode diagnostics GET must succeed');
      assert.equal(diagnostic.headers['cache-control'], 'no-store');
      assert.ok(validatedSnapshot(diagnostic.body), 'runtime must accept the real diagnostics response');
      assert.equal(diagnostic.body.cursor, 0);
      assert.equal(diagnostic.body.pendingConnects, 0);
      assert.deepEqual(diagnostic.body.events, []);
      assert.equal(child.exitCode, null, 'diagnostics GET must not terminate the proxy');
    }
  } finally {
    if (reserve.listening) await new Promise((resolve) => reserve.close(resolve));
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
        child.kill();
      });
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

(async () => {
  let requests = 0;
  const snapshot = await readEgressSnapshot(async (url, options) => {
    assert.equal(url, 'http://skycommand-codex-egress-proxy:3128/diagnostics');
    assert.equal(options.method, 'GET');
    requests += 1;
    return { ok: true, json: async () => ({ ...rawSnapshot(), accessToken: 'test-egress-access-token-placeholder' }) };
  });
  assert.equal(requests, 1);
  assert.equal(snapshot.accessToken, undefined);
  assert.equal(await readEgressSnapshot(async () => { throw new Error('offline'); }), null);
  // Behavioral seam test: a real adapter invocation (using a mocked provider)
  // transports the explicit start boundary to terminal observation, before
  // subsequent account-telemetry RPCs. It must not depend on a hidden Map.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-c5b-test-'));
  const tokenFile = path.join(temp, 'runtime-control-token');
  fs.writeFileSync(tokenFile, 'x'.repeat(64), { mode: 0o600 });
  const originalTokenFile = process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE;
  const originalFetch = global.fetch;
  process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE = tokenFile;
  const { startCodexRuntime, observeCodexRuntime } = require('../../../apps/codex-agent-runtime-worker/src/index');
  let observationGets = 0;
  const order = [];
  const testClient = {
    executionEnabled: true,
    identity: () => ({ runtimeGeneration: 'generation-test-1' }),
    submitManagedTurn: async () => {
      order.push('turn/start');
      return {
        sendAcceptance: 'ACKNOWLEDGED', outcomeCertainty: 'ACKNOWLEDGED',
        providerTurnId: 'turn-123', providerSessionReference: 'session-123',
        threadId: 'thread-123', providerOperationReference: 'codex:operation-test',
      };
    },
    observeManagedTurn: async () => {
      order.push('terminal');
      return {
        sendAcceptance: 'ACKNOWLEDGED', outcomeCertainty: 'ACKNOWLEDGED',
        providerTerminalStatus: 'FAILED', providerTerminalFailure: true,
        providerTurnId: 'turn-123', providerSessionReference: 'session-123',
      };
    },
    readRateLimits: async () => { order.push('rateLimits'); return null; },
    readUsage: async () => { order.push('usage'); return null; },
    events: [],
  };
  global.fetch = async (url) => {
    if (url.endsWith('/diagnostics')) {
      observationGets += 1;
      order.push('egress-snapshot');
      return {
        ok: true,
        json: async () => observationGets === 1 ? rawSnapshot() : rawSnapshot({
          cursor: 1, events: [makeEvent(1)],
        }),
      };
    }
    if (url.endsWith('/context/bind')) {
      order.push('mcp-bind');
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/context/result')) {
      order.push('mcp-read');
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error('Unexpected mock request: ' + url);
  };
  try {
    const started = await startCodexRuntime({
      operationId: 'f74f98c3-60a8-40af-824a-27addcdf02fb',
      instruction: 'readonly status snapshot',
      managedCapabilityRequest: { effectId: 'test-effect', capabilityCode: 'command-center-status-snapshot', credential: 'fake-secret-must-not-persist' },
    }, testClient);
    assert.equal(started.sendAcceptance, 'ACKNOWLEDGED');
    assert.deepEqual(sanitizeBoundary(started.runtimeEvidenceBoundary), started.runtimeEvidenceBoundary);
    assert.ok(order.indexOf('egress-snapshot') < order.indexOf('turn/start'));
    const observed = await observeCodexRuntime({
      operationId: 'f74f98c3-60a8-40af-824a-27addcdf02fb',
      providerTurnId: started.providerTurnId,
      runtimeEvidenceBoundary: started.runtimeEvidenceBoundary,
    }, testClient);
    assert.equal(observed.sendAcceptance, 'ACKNOWLEDGED');
    assert.equal(observed.providerTerminalFailure, true);
    assert.equal(observed.egressEvidence.availability, 'COMPLETE');
    assert.equal(observed.egressEvidence.events[0].destinationHost, 'api.openai.com');
    assert.ok(order.indexOf('terminal') < order.lastIndexOf('egress-snapshot'));
    assert.ok(order.lastIndexOf('egress-snapshot') < order.indexOf('rateLimits'));
    assert.equal(JSON.stringify(observed).includes('fake-secret-must-not-persist'), false);
    const submitCountBeforeFailure = order.filter((step) => step === 'turn/start').length;
    global.fetch = async (url) => {
      if (url.endsWith('/context/bind')) return { ok: true, json: async () => ({ ok: true }) };
      throw new Error('proxy diagnostics currently unreachable');
    };
    const blocked = await startCodexRuntime({
      operationId: 'f74f98c3-60a8-40af-824a-27addcdf02fb',
      instruction: 'readonly status snapshot',
      managedCapabilityRequest: { effectId: 'test-effect', capabilityCode: 'command-center-status-snapshot', credential: 'fake-secret-must-not-persist' },
    }, testClient);
    assert.equal(blocked.sendAcceptance, 'REJECTED_BEFORE_ACCEPTANCE');
    assert.equal(blocked.providerErrorCode, 'CODEX_EGRESS_DIAGNOSTICS_UNAVAILABLE');
    assert.equal(blocked.egressEvidence.availability, 'UNAVAILABLE');
    assert.equal(order.filter((step) => step === 'turn/start').length, submitCountBeforeFailure,
      'missing diagnostic boundary must not spend a provider Turn');
  } finally {
    global.fetch = originalFetch;
    if (originalTokenFile === undefined) delete process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE;
    else process.env.CODEX_RUNTIME_CONTROL_TOKEN_FILE = originalTokenFile;
    fs.rmSync(temp, { recursive: true, force: true });
  }
  await testLiveProxyDiagnosticsRoute();
  console.log('Phase 19.3A1-C5C proxy HTTP diagnostics regression and C5B evidence tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
