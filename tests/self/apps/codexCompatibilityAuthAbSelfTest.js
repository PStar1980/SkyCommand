'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough, Writable } = require('node:stream');
const YAML = require('yaml');
const { CONTRACT } = require('../../../docker/codex-compat-probe/contract');
const { hostAllowed, parseAuthority } = require('../../../apps/codex-egress-proxy/src/policy');
const {
  AUTH_AB_PHASES: PROXY_AUTH_AB_PHASES,
  AuthAbPhaseJournal,
  destinationFingerprint,
  projectAuthAbEvent,
} = require('../../../apps/codex-egress-proxy/src/authAbDiagnostics');
const { isRpcMethodAllowedForProfile } = require('../../../docker/codex-compat-probe/probe');
const {
  AUTH_AB_PHASES,
  AUTH_AB_METHODS,
  AuthAbError,
  AuthAbSequencer,
  AuthAbStageState,
  isAcceptedBaselineDeviceAuthFailure,
  projectSafeStageEvidence,
} = require('../../../docker/codex-compat-probe/auth-ab/contract');
const {
  validateAuthAbSnapshot,
  validateDeviceCheckpoint,
  POLICY_DIGEST,
  aliasDeviceUserCodePhase,
  captureProxyPhase,
  classifyAuthTransportDiagnostic,
  waitForHumanConfirmation,
} = require('../../../docker/codex-compat-probe/auth-ab/runner');
const {
  continueWithRecordedBaseline,
  DockerComposeAdapter,
  correlateStageEgress,
  hasEgressPolicyViolation,
  parseStageResultMarker,
  projectSafeProxySnapshot,
  main: authAbMain,
  validateSourcePolicy,
} = require('../../../docker/codex-compat-probe/auth-ab/orchestrator');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const AUTH_DIR = path.join(REPO_ROOT, 'docker/codex-compat-probe/auth-ab');
const iso = '2026-09-24T12:00:00.000Z';
const uuid = '11111111-1111-4111-8111-111111111111';
const digest = 'A'.repeat(64);
const EXPECTED_POLICY_HOSTS = Object.freeze(['auth.openai.com', 'chatgpt.com']);

function stageEvidence(stage, extras = {}) {
  const identity = CONTRACT[stage];
  return {
    stage,
    outcome: 'OBSERVED',
    identity: {
      expectedVersion: identity.wrapperVersion,
      observedVersion: identity.wrapperVersion,
      wrapperIntegrity: identity.wrapperIntegrity,
      platformIntegrity: identity.platformIntegrity,
      packageLockSha256: digest,
      installedArtifactSha256: digest,
      schemaTreeSha256: digest,
    },
    attemptId: uuid,
    protocolMethods: ['initialize', 'account/login/start', 'account/read'],
    authenticatedState: 'AUTHENTICATED',
    accountState: 'ACCOUNT_PRESENT',
    accountReadRpc: { method: 'account/read', requestId: 303, outcome: 'RESULT', rpcCode: null, observedAt: iso },
    latestRelevantNotification: { type: 'account/login/completed', observedAt: iso },
    timestamps: {
      initializedAt: iso,
      deviceAuthStartedAt: iso,
      checkpointPresentedAt: iso,
      humanConfirmedAt: iso,
      accountReadAt: iso,
    },
    egressPolicyDigest: POLICY_DIGEST,
    observedAt: iso,
    ...extras,
  };
}

function baselineLoginRpcFailure(extras = {}) {
  return {
    stage: 'baseline',
    outcome: 'FAIL',
    failureCode: 'DEVICE_AUTH_RPC_ERROR',
    attemptId: uuid,
    protocolMethods: ['initialize', 'account/login/start'],
    rpc: {
      method: 'account/login/start',
      requestId: 302,
      outcome: 'JSON_RPC_ERROR',
      rpcCode: -32603,
      observedAt: iso,
    },
    observedAt: iso,
    ...extras,
  };
}

function encodedBaselineMarker(result = baselineLoginRpcFailure()) {
  const safe = projectSafeStageEvidence(result, 'baseline');
  const marker = `SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify(safe)}\n`;
  return Buffer.from(marker, 'utf8').toString('base64url');
}

function markerLine(stage) {
  return `SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify(stageEvidence(stage))}`;
}

function proxySnapshotText(events = [], healthOverrides = {}, extras = {}) {
  return JSON.stringify({
    health: {
      ok: true,
      profile: 'CODEX_PROVIDER_ALLOWLIST',
      allowedHostCount: EXPECTED_POLICY_HOSTS.length,
      policyDigest: POLICY_DIGEST,
      ...healthOverrides,
    },
    cursor: events.at(-1)?.cursor || 0,
    count: events.length,
    events,
    ...extras,
  });
}

function safeProxyEvent(overrides = {}) {
  return {
    cursor: 1,
    destinationClassification: 'APPROVED_AUTH_HOST',
    destinationFingerprint: 'A'.repeat(64),
    port: 443,
    decision: 'ALLOW',
    reason: 'PUBLIC_ALLOWLISTED_TLS',
    observedAt: iso,
    observedMonotonicNs: '123456789',
    count: 1,
    ...overrides,
  };
}

function mockedChild(output) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => {};
  queueMicrotask(() => {
    if (output) child.stdout.write(output);
    child.stdout.end();
    child.emit('close', 0, null);
  });
  return child;
}

function mockedDockerAdapter(stageOutputs, calls = { execFile: [], spawn: [] }, imageOutput = 'sha256:runtime\nsha256:egress\n', diagnosticsOutputs = []) {
  const adapter = new DockerComposeAdapter({
    execFile: async (binary, args, options) => {
      calls.execFile.push({ binary, args: [...args], options });
      if (args[0] === 'image' && args[1] === 'inspect') return { stdout: imageOutput };
      if (args[0] === 'compose' && args.includes('exec')) {
        return { stdout: diagnosticsOutputs.shift() || proxySnapshotText() };
      }
      return { stdout: '' };
    },
    spawn: (binary, args, options) => {
      calls.spawn.push({ binary, args: [...args], options });
      return mockedChild(stageOutputs.shift());
    },
  });
  return { adapter, calls };
}

function fakeAdapter(events, options = {}) {
  const discarded = new Set();
  const resources = new Map();
  const diagnosticReads = new Map();
  return {
    async assertFresh() { events.push('assertFresh'); },
    async startProxy(stage) {
      if (stage === 'candidate') assert.ok(discarded.has('baseline'), 'baseline teardown must be verified first');
      events.push(`proxy:${stage}`);
    },
    async runVersion(stage) {
      if (stage === 'candidate') assert.ok(discarded.has('baseline'));
      const resource = { container: crypto.randomUUID(), home: crypto.randomUUID(), alive: true };
      resources.set(stage, resource);
      events.push(`run:${stage}`);
      if (options.stageResults?.[stage]) return options.stageResults[stage];
      if (options.failStage === stage) return { stage, outcome: 'FAIL', failureCode: 'ACCOUNT_READ_RPC_ERROR' };
      return stageEvidence(stage);
    },
    async captureProxyDiagnostics(stage) {
      events.push(`diagnostics:${stage}`);
      if (options.diagnosticsFailureStage === stage) throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
      const read = diagnosticReads.get(stage) || 0;
      diagnosticReads.set(stage, read + 1);
      const stageEvents = options.egressEvents?.[stage] || [];
      const projected = read === 0 ? [] : stageEvents;
      return {
        stage,
        cursor: projected.at(-1)?.cursor || 0,
        count: projected.length,
        events: projected,
      };
    },
    correlateStageEgress,
    hasEgressPolicyViolation,
    async teardown(stage) {
      events.push(`teardown:${stage}`);
      if (options.teardownFailure === stage) throw new Error('simulated teardown failure');
      const resource = resources.get(stage);
      if (resource) resource.alive = false;
    },
    async verifyDiscarded(stage) {
      events.push(`verify:${stage}`);
      assert.equal(resources.get(stage)?.alive || false, false);
      discarded.add(stage);
    },
    async markDiscarded(stage) { assert.ok(discarded.has(stage)); events.push(`discarded:${stage}`); },
    resources,
  };
}

async function main() {
  validateSourcePolicy();
  assert.equal(POLICY_DIGEST, '855E57700B5CC7C377934BADA5884B811A5DCFA58C9F6AA8655EBA7B119E0879');
  assert.deepEqual(AUTH_AB_METHODS, ['initialize', 'account/read', 'account/login/start']);
  assert.equal(isRpcMethodAllowedForProfile('account/login/start', 'AUTH_AB'), true);
  assert.equal(isRpcMethodAllowedForProfile('turn/start', 'AUTH_AB'), false);
  assert.equal(isRpcMethodAllowedForProfile('account/logout', 'AUTH_AB'), false);
  assert.equal(isRpcMethodAllowedForProfile('account/login/start'), false);

  for (const host of EXPECTED_POLICY_HOSTS) {
    assert.equal(hostAllowed(host, EXPECTED_POLICY_HOSTS), true, `${host} is an exact allowed hostname`);
  }
  for (const host of ['openai.com', 'other.auth.openai.com', 'auth.openai.com.evil.invalid',
    'other.chatgpt.com', 'chatgpt.com.evil.invalid', '127.0.0.1']) {
    assert.equal(hostAllowed(host, EXPECTED_POLICY_HOSTS), false, `${host} is not an exact allowed hostname`);
  }
  assert.deepEqual(parseAuthority('auth.openai.com:443'), { host: 'auth.openai.com', port: 443 });
  assert.deepEqual(parseAuthority('auth.openai.com:80'), { host: 'auth.openai.com', port: 80 });
  assert.deepEqual(PROXY_AUTH_AB_PHASES, [
    'APP_SERVER_STARTUP', 'INITIALIZE', 'POST_INITIALIZE_IDLE', 'ACCOUNT_LOGIN_START', 'POST_REQUEST_PROCESSING',
  ]);
  assert.deepEqual(AUTH_AB_PHASES, [
    'APP_SERVER_STARTUP', 'INITIALIZE', 'POST_INITIALIZE_IDLE', 'ACCOUNT_LOGIN_START',
    'DEVICE_CODE_USER_CODE_REQUEST', 'POST_REQUEST_PROCESSING',
  ]);

  const fingerprintKey = Buffer.alloc(32, 0x5a);
  const fingerprintA = destinationFingerprint('auth.openai.com', fingerprintKey);
  assert.equal(destinationFingerprint('AUTH.OPENAI.COM.', fingerprintKey), fingerprintA,
    'destination fingerprint is stable for normalized hostnames within one experiment key');
  assert.notEqual(destinationFingerprint('other.invalid', fingerprintKey), fingerprintA);
  const redactedEvent = projectAuthAbEvent({
    host: 'private-destination.invalid', cursor: 1, port: 443, decision: 'DENY',
    reason: 'HOST_NOT_ALLOWLISTED', observedAt: iso, observedMonotonicNs: '123456789',
  }, fingerprintKey);
  assert.equal(redactedEvent.destinationClassification, 'OTHER_HOST_REDACTED');
  assert.equal(Object.hasOwn(redactedEvent, 'host'), false);
  assert.equal(JSON.stringify(redactedEvent).includes('private-destination.invalid'), false);
  assert.equal(redactedEvent.destinationFingerprint, destinationFingerprint('private-destination.invalid', fingerprintKey));

  let monotonic = 100n;
  const journal = new AuthAbPhaseJournal({
    key: fingerprintKey,
    now: () => iso,
    monotonicNs: () => (monotonic++).toString(),
  });
  const startupBoundary = journal.beginPhase('APP_SERVER_STARTUP');
  const startupToken = journal.beginConnect();
  journal.finishConnect(startupToken, 'private-destination.invalid', 443, 'DENY', 'HOST_NOT_ALLOWLISTED');
  const startupDelta = await journal.endPhase(startupBoundary.token);
  assert.equal(startupDelta.phase, 'APP_SERVER_STARTUP');
  assert.equal(startupDelta.beforeCursor, 0);
  assert.equal(startupDelta.afterCursor, 1);
  assert.equal(startupDelta.beforeCount, 0);
  assert.equal(startupDelta.afterCount, 1);
  assert.equal(startupDelta.count, 1);
  assert.equal(startupDelta.events[0].destinationClassification, 'OTHER_HOST_REDACTED');
  assert.equal(JSON.stringify(startupDelta).includes('private-destination.invalid'), false);
  const idleBoundary = journal.beginPhase('POST_INITIALIZE_IDLE');
  const idleToken = journal.beginConnect();
  journal.finishConnect(idleToken, 'auth.openai.com', 443, 'ALLOW', 'PUBLIC_ALLOWLISTED_TLS');
  const idleDelta = await journal.endPhase(idleBoundary.token);
  assert.equal(idleDelta.beforeCursor, 1);
  assert.equal(idleDelta.afterCursor, 2);
  assert.equal(idleDelta.events.length, 1, 'phase events are delta-correlated from the phase cursor');
  const pendingBoundary = journal.beginPhase('ACCOUNT_LOGIN_START');
  const pendingToken = journal.beginConnect();
  const pendingPhase = journal.endPhase(pendingBoundary.token);
  await Promise.resolve();
  journal.finishConnect(pendingToken, 'auth.openai.com', 443, 'ALLOW', 'PUBLIC_ALLOWLISTED_TLS');
  const pendingDelta = await pendingPhase;
  assert.equal(pendingDelta.count, 1, 'phase completion waits for in-flight CONNECT diagnostics');
  assert.throws(() => journal.beginPhase('NOT_A_PHASE'), TypeError);

  const phaseCalls = [];
  const phaseEvent = safeProxyEvent();
  const phaseFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    phaseCalls.push({ action: url.endsWith('/begin') ? 'begin' : 'end', body });
    return {
      ok: true,
      json: async () => url.endsWith('/begin')
        ? { ok: true, phase: body.phase, token: uuid, startedMonotonicNs: '100', beforeCursor: 0, beforeCount: 0 }
        : {
          ok: true, phase: 'INITIALIZE', startedMonotonicNs: '100', endedMonotonicNs: '200',
          beforeCursor: 0, afterCursor: 1, beforeCount: 0, afterCount: 1, count: 1, events: [phaseEvent],
          credentials: 'SHOULD_NOT_ESCAPE',
        },
    };
  };
  const phaseActionOrder = [];
  const capturedPhase = await captureProxyPhase('INITIALIZE', async () => {
    phaseActionOrder.push('action');
    return 'rpc-result';
  }, { fetch: phaseFetch, onPhase: (value) => phaseActionOrder.push(value.phase) });
  assert.deepEqual(phaseCalls.map((call) => call.action), ['begin', 'end']);
  assert.equal(phaseCalls[0].body.phase, 'INITIALIZE');
  assert.equal(phaseCalls[1].body.token, uuid);
  assert.equal(capturedPhase.result, 'rpc-result');
  assert.deepEqual(phaseActionOrder, ['action', 'INITIALIZE']);
  assert.equal(capturedPhase.phaseEvidence.count, 1);
  assert.equal(JSON.stringify(capturedPhase).includes('SHOULD_NOT_ESCAPE'), false);
  const userCodeAlias = aliasDeviceUserCodePhase(capturedPhase.phaseEvidence);
  assert.equal(userCodeAlias.phase, 'DEVICE_CODE_USER_CODE_REQUEST');
  assert.equal(userCodeAlias.boundarySource, 'RPC_ENVELOPE_ALIAS');
  assert.equal(userCodeAlias.correlatedPhase, 'ACCOUNT_LOGIN_START');

  const allowedAuthPhase = { events: [safeProxyEvent()] };
  const statusDiagnostic = classifyAuthTransportDiagnostic(-32603,
    'device code request failed with status 503 Internal Server Error; token=RAW_TOKEN_SECRET; https://auth.openai.com/?code=DEVICE_SECRET',
    { ...allowedAuthPhase, rawResponse: 'RAW_PROVIDER_BODY_SECRET' });
  assert.deepEqual(statusDiagnostic, {
    method: 'account/login/start', rpcCode: -32603, transportClassification: 'HTTP_RESPONSE_RECEIVED',
    tlsOutcome: 'SUCCEEDED', httpResponse: 'RECEIVED', httpStatusClass: '5XX',
    responseParse: 'NOT_REACHED', rpcMapping: 'INTERNAL_ERROR',
  });
  const parseDiagnostic = classifyAuthTransportDiagnostic(-32603, 'expected value at line 1 column 4', allowedAuthPhase);
  assert.equal(parseDiagnostic.transportClassification, 'RESPONSE_PARSE_FAILURE');
  assert.equal(parseDiagnostic.httpStatusClass, '2XX');
  const tlsDiagnostic = classifyAuthTransportDiagnostic(-32603, 'TLS handshake failed: certificate verify failed', allowedAuthPhase);
  assert.equal(tlsDiagnostic.transportClassification, 'TLS_FAILURE');
  assert.equal(tlsDiagnostic.tlsOutcome, 'FAILED');
  const dnsDiagnostic = classifyAuthTransportDiagnostic(-32603, '', {
    events: [safeProxyEvent({ decision: 'DENY', reason: 'DNS_LOOKUP_FAILED' })],
  });
  assert.equal(dnsDiagnostic.transportClassification, 'DNS_FAILURE');
  const connectDiagnostic = classifyAuthTransportDiagnostic(-32603, '', {
    events: [safeProxyEvent({ decision: 'DENY', reason: 'UPSTREAM_CONNECT_FAILED' })],
  });
  assert.equal(connectDiagnostic.transportClassification, 'CONNECT_FAILURE');
  const unknownTransport = classifyAuthTransportDiagnostic(-32603, 'managed request failed', allowedAuthPhase);
  assert.equal(unknownTransport.transportClassification, 'RPC_MAPPING_FAILURE');
  assert.equal(unknownTransport.tlsOutcome, 'UNKNOWN', 'TCP CONNECT alone is not reported as TLS success');
  for (const secret of ['RAW_TOKEN_SECRET', 'DEVICE_SECRET', 'RAW_PROVIDER_BODY_SECRET', 'auth.openai.com/?code']) {
    assert.equal(JSON.stringify({ statusDiagnostic, parseDiagnostic, tlsDiagnostic, dnsDiagnostic, connectDiagnostic, unknownTransport }).includes(secret), false);
  }
  const projectedDiagnosticFailure = projectSafeStageEvidence({
    ...baselineLoginRpcFailure(),
    phaseEgress: [startupDelta],
    authTransportDiagnostic: statusDiagnostic,
    rawMessage: 'RAW_RPC_MESSAGE_SECRET',
    responseBody: 'RAW_PROVIDER_BODY_SECRET',
    credentials: { accessToken: 'ACCESS_TOKEN_SECRET' },
  }, 'baseline');
  assert.equal(projectedDiagnosticFailure.authTransportDiagnostic.httpStatusClass, '5XX');
  assert.equal(projectedDiagnosticFailure.phaseEgress[0].events[0].destinationClassification, 'OTHER_HOST_REDACTED');
  for (const secret of ['RAW_RPC_MESSAGE_SECRET', 'RAW_PROVIDER_BODY_SECRET', 'ACCESS_TOKEN_SECRET', 'private-destination.invalid']) {
    assert.equal(JSON.stringify(projectedDiagnosticFailure).includes(secret), false);
  }

  const proxyHealth = {
    ok: true,
    profile: 'CODEX_PROVIDER_ALLOWLIST',
    allowedHostCount: EXPECTED_POLICY_HOSTS.length,
    policyDigest: POLICY_DIGEST,
  };
  const proxyFingerprintKey = Buffer.alloc(32, 7);
  const approvedRawEvent = {
    host: 'auth.openai.com', cursor: 1, port: 443, decision: 'ALLOW',
    reason: 'PUBLIC_ALLOWLISTED_TLS', observedAt: iso, observedMonotonicNs: '123456789',
  };
  const approvedSafeEvent = projectAuthAbEvent(approvedRawEvent, proxyFingerprintKey);
  const proxySafe = projectSafeProxySnapshot({
    health: { ...proxyHealth, accessToken: 'PROXY_HEALTH_SECRET' },
    cursor: 1,
    count: 1,
    events: [{
      ...approvedSafeEvent,
      tunnelPayload: 'TUNNEL_SECRET', verificationUrl: 'https://auth.openai.com/?code=DEVICE_CODE_SECRET',
      credentials: { token: 'PROXY_TOKEN_SECRET' },
    }],
    rawProxyResponse: 'RAW_PROVIDER_SECRET',
  }, 'baseline');
  assert.deepEqual(proxySafe, {
    stage: 'baseline',
    cursor: 1,
    count: 1,
    events: [approvedSafeEvent],
  });
  const unknownRawEvent = {
    host: 'user-code-secret.auth.openai.com', cursor: 1, port: 443, decision: 'DENY',
    reason: 'HOST_NOT_ALLOWLISTED', observedAt: iso, observedMonotonicNs: '123456790',
  };
  const unknownSafeEvent = projectAuthAbEvent(unknownRawEvent, proxyFingerprintKey);
  const proxyOtherHostSafe = projectSafeProxySnapshot({
    health: proxyHealth,
    cursor: 1,
    count: 1,
    events: [{
      ...unknownSafeEvent,
      userCode: 'DEVICE_CODE_SECRET',
    }],
  }, 'candidate');
  assert.equal(proxyOtherHostSafe.events[0].destinationClassification, 'OTHER_HOST_REDACTED');
  for (const secret of ['PROXY_HEALTH_SECRET', 'TUNNEL_SECRET', 'DEVICE_CODE_SECRET', 'PROXY_TOKEN_SECRET', 'RAW_PROVIDER_SECRET', 'user-code-secret']) {
    assert.equal(JSON.stringify({ proxySafe, proxyOtherHostSafe }).includes(secret), false);
  }
  const beforeProxy = projectSafeProxySnapshot({ health: proxyHealth, cursor: 0, count: 0, events: [] }, 'baseline');
  const afterProxy = projectSafeProxySnapshot({
    health: proxyHealth,
    cursor: 1,
    count: 1,
    events: [approvedSafeEvent],
  }, 'baseline');
  const correlatedProxy = correlateStageEgress(beforeProxy, afterProxy, 'baseline');
  assert.deepEqual(correlatedProxy, {
    stage: 'baseline', beforeCursor: 0, afterCursor: 1, beforeCount: 0, afterCount: 1, count: 1,
    events: [approvedSafeEvent],
  });
  assert.equal(hasEgressPolicyViolation(correlatedProxy), false);
  assert.equal(hasEgressPolicyViolation(correlateStageEgress(beforeProxy,
    projectSafeProxySnapshot({ health: proxyHealth, cursor: 1, count: 1, events: [{
      ...approvedSafeEvent, decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED',
    }] }, 'baseline'),
  'baseline')), true);
  for (const invalidSnapshot of [
    { health: { ...proxyHealth, ok: false }, cursor: 0, count: 0, events: [] },
    { health: proxyHealth, cursor: 0, count: 0, events: null },
    { health: proxyHealth, cursor: 1, count: 1, events: [{ ...approvedSafeEvent, reason: 'UNKNOWN_RAW_REASON' }] },
    { health: proxyHealth, cursor: 1, count: 1, events: [{ ...approvedSafeEvent, host: 'https://auth.openai.com/?code=DEVICE_CODE_SECRET' }] },
  ]) {
    assert.throws(() => projectSafeProxySnapshot(invalidSnapshot, 'baseline'),
      (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_EGRESS_POLICY_MISMATCH');
  }

  const containedSnapshot = {
    uid: 10001,
    capabilitiesEffective: '0000000000000000',
    rootReadOnly: true,
    homeIsTmpfs: true,
    tempIsTmpfs: true,
    interfaces: ['eth0', 'lo'],
    defaultRoutes: 0,
    mountTargets: ['/', '/tmp', '/probe-home', '/proc', '/sys'],
    executionDisabled: true,
    productionCredentialsPresent: false,
  };
  const containedEnvironment = {
    SKYCOMMAND_AUTH_AB_EXECUTION_DISABLED: '1',
    HTTP_PROXY: 'http://codex-auth-ab-egress:3128',
    HTTPS_PROXY: 'http://codex-auth-ab-egress:3128',
    NO_PROXY: 'localhost,127.0.0.1,codex-auth-ab-egress',
  };
  assert.equal(validateAuthAbSnapshot(containedSnapshot, containedEnvironment), true);
  for (const snapshotChange of [
    { uid: 0 }, { capabilitiesEffective: '0000000000000001' }, { rootReadOnly: false },
    { homeIsTmpfs: false }, { interfaces: ['eth0', 'eth1', 'lo'] }, { defaultRoutes: 1 },
    { executionDisabled: false }, { productionCredentialsPresent: true },
    { mountTargets: ['/', '/probe-home', '/var/lib/codex'] },
  ]) assert.throws(() => validateAuthAbSnapshot({ ...containedSnapshot, ...snapshotChange }, containedEnvironment), AuthAbError);
  assert.throws(() => validateAuthAbSnapshot(containedSnapshot, { ...containedEnvironment, HTTPS_PROXY: 'http://public.invalid:3128' }), AuthAbError);

  const composeText = fs.readFileSync(path.join(AUTH_DIR, 'compose.yaml'), 'utf8');
  const compose = YAML.parse(composeText);
  for (const [stage, serviceName] of [['baseline', 'auth-ab-baseline'], ['candidate', 'auth-ab-candidate']]) {
    const service = compose.services[serviceName];
    assert.ok(service);
    assert.deepEqual(service.networks, ['auth_client']);
    assert.ok(service.tmpfs.some((entry) => entry.startsWith('/probe-home:rw,noexec,nosuid,nodev')));
    assert.ok(service.tmpfs.some((entry) => entry.startsWith('/tmp:rw,noexec,nosuid,nodev')));
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.logging, { driver: 'none' });
    assert.equal(service.user, '10001:10001');
    assert.equal(service.environment.SKYCOMMAND_PROBE_EXECUTION_DISABLED, '1');
    assert.equal(service.environment.SKYCOMMAND_AUTH_AB_EXECUTION_DISABLED, '1');
    assert.equal(service.environment.CODEX_HOME, '/probe-home/codex');
    assert.equal(service.command[0], stage);
    for (const forbidden of ['volumes', 'ports', 'env_file', 'secrets', 'privileged', 'extra_hosts']) {
      assert.equal(Object.hasOwn(service, forbidden), false, `${serviceName} must not define ${forbidden}`);
    }
    assert.equal(service.environment.HTTP_PROXY, 'http://codex-auth-ab-egress:3128');
    assert.equal(service.environment.HTTPS_PROXY, 'http://codex-auth-ab-egress:3128');
    assert.equal(service.environment.NO_PROXY, 'localhost,127.0.0.1,codex-auth-ab-egress');
    const environmentNames = Object.keys(service.environment).join('|');
    assert.doesNotMatch(environmentNames, /TOKEN|SECRET|CREDENTIAL|PASSWORD|AUTHORIZATION|API[_-]?KEY|COOKIE/i);
  }

  assert.deepEqual(compose.networks.auth_client, { internal: true });
  assert.equal(Object.hasOwn(compose.networks, 'codex_runtime_control'), false);
  assert.equal(Object.hasOwn(compose.networks, 'codex_provider_internal'), false);
  assert.equal(Object.hasOwn(compose.networks, 'codex_mcp_internal'), false);
  assert.deepEqual(Object.keys(compose.services['auth-egress-proxy'].networks).sort(), ['auth_client', 'auth_uplink']);
  const proxyMounts = compose.services['auth-egress-proxy'].volumes;
  assert.equal(proxyMounts.length, 1);
  assert.equal(proxyMounts[0].source, '../../codex-provider-allowlist.txt');
  assert.equal(proxyMounts[0].target, '/etc/skycommand/provider-allowlist.txt');
  assert.equal(proxyMounts[0].read_only, true);
  assert.doesNotMatch(composeText, /\/var\/lib\/codex|\/run\/codex-runtime-control|docker\.sock|provider_internal|mcp_internal/i);
  const allowlistText = fs.readFileSync(path.join(REPO_ROOT, 'docker/codex-provider-allowlist.txt'), 'utf8');
  const configuredHosts = allowlistText.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(configuredHosts, EXPECTED_POLICY_HOSTS);
  assert.equal(compose.services['auth-egress-proxy'].environment.CODEX_EGRESS_PROXY_PORT, '3128');
  assert.equal(compose.services['auth-egress-proxy'].environment.CODEX_EGRESS_AUTH_AB_MODE, '1');
  assert.match(compose.services['auth-egress-proxy'].environment.CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY, /CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY/);

  const runtimeDockerfile = fs.readFileSync(path.join(AUTH_DIR, 'Dockerfile'), 'utf8');
  const authRunner = fs.readFileSync(path.join(AUTH_DIR, 'runner.js'), 'utf8');
  const orchestrator = fs.readFileSync(path.join(AUTH_DIR, 'orchestrator.js'), 'utf8');
  const proxyDockerfile = fs.readFileSync(path.join(REPO_ROOT, 'apps/codex-egress-proxy/Dockerfile'), 'utf8');
  const proxyImplementation = fs.readFileSync(path.join(REPO_ROOT, 'apps/codex-egress-proxy/src/index.js'), 'utf8');
  const proxyDiagnostics = fs.readFileSync(path.join(REPO_ROOT, 'apps/codex-egress-proxy/src/authAbDiagnostics.js'), 'utf8');
  const rootCompose = fs.readFileSync(path.join(REPO_ROOT, 'compose.yaml'), 'utf8');
  assert.match(runtimeDockerfile, /COPY --from=package-build[\s\S]*package-attestations\.json/);
  assert.match(runtimeDockerfile, /USER 10001:10001/);
  assert.doesNotMatch(runtimeDockerfile, /COPY\s+\.\s|VOLUME\s|\.env|docker\.sock|\/var\/lib\/codex/i);
  assert.match(authRunner, /inspectStage\(stage, identity, packageAttestation, \{ skipRpcHandshake: true \}\)/);
  assert.match(authRunner, /account\/login\/start/);
  assert.match(authRunner, /chatgptDeviceCode/);
  assert.match(authRunner, /waitForHumanConfirmation/);
  assert.match(authRunner, /account\/read/);
  assert.match(authRunner, /postAuthAccountReadCompleted/);
  assert.doesNotMatch(authRunner, /turn\/start|REBUILD_CODEX_BOOTSTRAP|managedCodexBootstrap|provider_login_reference|INSERT\s+INTO|UPDATE\s+/i);
  assert.match(orchestrator, /--run-isolated-auth-ab/);
  assert.match(orchestrator, /--remove-orphans/);
  assert.doesNotMatch(orchestrator, /managedCodexBootstrap|provider_login_reference|\/api\/managed-codex|database\.query/i);
  assert.doesNotMatch(orchestrator, /REBUILD_BACKEND|REBUILD_CODEX_BOOTSTRAP|enrollment\/reconcile/i);
  assert.match(proxyDockerfile, /COPY src \.\/src/);
  assert.doesNotMatch(proxyDockerfile, /COPY\s+\.\s|docker\.sock|\.env/i);
  assert.match(proxyImplementation, /if \(port !== 443\)/);
  assert.match(proxyImplementation, /!addressIsPublic\(record\.address\)/);
  assert.match(proxyImplementation, /\/auth-ab\/phase\/begin/);
  assert.match(proxyImplementation, /\/auth-ab\/phase\/end/);
  assert.match(proxyDiagnostics, /process\.hrtime\.bigint/);
  assert.match(proxyDiagnostics, /createHmac\('sha256'/);
  assert.doesNotMatch(proxyImplementation, /JSON\.stringify\(\{ service: 'codex-egress-proxy', \.\.\.event \}\)/,
    'A/B proxy logs use a sanitized projection instead of raw event hostnames');
  assert.match(authRunner, /APP_SERVER_STARTUP/);
  assert.match(authRunner, /POST_INITIALIZE_IDLE/);
  assert.match(authRunner, /ACCOUNT_LOGIN_START/);
  assert.match(authRunner, /DEVICE_CODE_USER_CODE_REQUEST/);
  assert.match(authRunner, /POST_REQUEST_PROCESSING/);
  assert.match(authRunner, /classifyAuthTransportDiagnostic/);
  assert.match(rootCompose, /dockerfile:\s*docker\/codex-egress-proxy\.Dockerfile/,
    'production continues using its separately configured proxy image');

  const safe = projectSafeStageEvidence(stageEvidence('baseline', {
    verificationUrl: 'https://auth.openai.com/codex/device?secret=URL_SECRET',
    userCode: 'DEVICE_SECRET',
    loginReference: 'LOGIN_REFERENCE_SECRET',
    providerPayload: { accessToken: 'ACCESS_TOKEN_SECRET', refreshToken: 'REFRESH_SECRET' },
    credentialPath: '/var/lib/codex/auth.json',
  }), 'baseline');
  const serializedSafe = JSON.stringify(safe);
  for (const secret of ['URL_SECRET', 'DEVICE_SECRET', 'LOGIN_REFERENCE_SECRET', 'ACCESS_TOKEN_SECRET', 'REFRESH_SECRET', '/var/lib/codex/auth.json']) {
    assert.equal(serializedSafe.includes(secret), false, `safe evidence must omit ${secret}`);
  }
  assert.equal(safe.attemptId, uuid);
  assert.equal(safe.resultCategory, 'AUTHENTICATED');
  assert.equal(safe.packageIdentity.schemaTreeSha256, digest);
  assert.equal(safe.egressPolicyDigest, POLICY_DIGEST);
  assert.deepEqual(safe.protocolMethods, ['initialize', 'account/login/start', 'account/read']);

  const safeFailure = projectSafeStageEvidence({
    stage: 'candidate', outcome: 'FAIL', failureCode: 'ACCOUNT_READ_RPC_ERROR', attemptId: uuid,
    rpc: { method: 'account/read', requestId: 303, outcome: 'JSON_RPC_ERROR', rpcCode: -32603, observedAt: iso },
    rawMessage: 'secret bearer token', errorData: { code: 'private' },
  }, 'candidate');
  assert.deepEqual(safeFailure.rpc, { method: 'account/read', requestId: 303, outcome: 'JSON_RPC_ERROR', rpcCode: -32603, observedAt: iso });
  assert.equal(JSON.stringify(safeFailure).includes('secret bearer token'), false);
  assert.equal(JSON.stringify(safeFailure).includes('private'), false);
  assert.throws(() => projectSafeStageEvidence({ ...stageEvidence('baseline'), failureCode: 'UNSAFE_RAW_ERROR' }, 'baseline'), AuthAbError);

  const projectedBaselineRpcFailure = projectSafeStageEvidence(baselineLoginRpcFailure(), 'baseline');
  assert.equal(projectedBaselineRpcFailure.outcome, 'FAIL');
  assert.equal(projectedBaselineRpcFailure.failureCode, 'DEVICE_AUTH_RPC_ERROR');
  assert.equal(projectedBaselineRpcFailure.rpc.method, 'account/login/start');
  assert.equal(projectedBaselineRpcFailure.rpc.rpcCode, -32603);
  assert.equal(isAcceptedBaselineDeviceAuthFailure(projectedBaselineRpcFailure), true);
  assert.throws(() => parseStageResultMarker(
    `SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify({ ...projectedBaselineRpcFailure, humanCheckpointPending: true })}`,
    'baseline'),
  (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_STAGE_OUTPUT_INVALID');
  for (const rejectedBaseline of [
    { ...baselineLoginRpcFailure(), failureCode: 'DEVICE_AUTH_RESPONSE_INVALID' },
    { ...baselineLoginRpcFailure(), protocolMethods: ['initialize', 'account/login/start', 'account/read'] },
    { ...baselineLoginRpcFailure(), attemptId: 'not-a-uuid' },
    { ...baselineLoginRpcFailure(), observedAt: undefined },
    { ...baselineLoginRpcFailure(), rpc: { ...baselineLoginRpcFailure().rpc, method: 'account/read' } },
    { ...baselineLoginRpcFailure(), rpc: { ...baselineLoginRpcFailure().rpc, requestId: 303 } },
    { ...baselineLoginRpcFailure(), rpc: { ...baselineLoginRpcFailure().rpc, outcome: 'TRANSPORT_ERROR' } },
    { ...baselineLoginRpcFailure(), rpc: { ...baselineLoginRpcFailure().rpc, rpcCode: -32000 } },
  ]) {
    assert.equal(isAcceptedBaselineDeviceAuthFailure(projectSafeStageEvidence(rejectedBaseline, 'baseline')), false);
  }

  assert.deepEqual(validateDeviceCheckpoint({
    type: 'chatgptDeviceCode', verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-EFGH', loginId: 'transient-login-reference',
  }), {
    verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGH',
    loginId: 'transient-login-reference', expiresAt: undefined,
  });
  for (const invalid of [
    { type: 'chatgptDeviceCode', verificationUrl: 'https://evil.invalid/codex/device', userCode: 'ABCD', loginId: 'x' },
    { type: 'chatgptDeviceCode', verificationUrl: 'https://auth.openai.com/codex/device?token=x', userCode: 'ABCD', loginId: 'x' },
    { type: 'password', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD', loginId: 'x' },
  ]) assert.throws(() => validateDeviceCheckpoint(invalid), AuthAbError);

  const confirmationInput = new PassThrough();
  const confirmationOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const confirmation = waitForHumanConfirmation(null, confirmationInput, confirmationOutput);
  confirmationInput.write('AUTHENTICATION_COMPLETED\n');
  await confirmation;
  const closedInput = new PassThrough();
  const closedConfirmation = waitForHumanConfirmation(null, closedInput, confirmationOutput);
  closedInput.end();
  await assert.rejects(closedConfirmation,
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_HUMAN_CONFIRMATION_REQUIRED');

  const state = new AuthAbStageState('baseline');
  assert.throws(() => state.humanConfirmed(), AuthAbError, 'human confirmation is not bypassable');
  state.initialized();
  state.deviceAuthStarted();
  assert.throws(() => state.deviceAuthStarted(), AuthAbError, 'one device-auth start is allowed');
  state.checkpointPresented();
  assert.throws(() => state.postAuthAccountReadCompleted(), AuthAbError, 'account/read is blocked before human confirmation');
  state.humanConfirmed();
  state.postAuthAccountReadCompleted();
  assert.throws(() => state.postAuthAccountReadCompleted(), AuthAbError, 'post-login account/read is bounded to one');
  state.discarded();

  const order = [];
  const adapter = fakeAdapter(order);
  const result = await new AuthAbSequencer(adapter).execute();
  assert.equal(result.outcome, 'PASS');
  assert.deepEqual(result.stages.map((stage) => stage.stage), ['baseline', 'candidate']);
  assert.ok(order.indexOf('teardown:baseline') < order.indexOf('proxy:candidate'));
  assert.ok(order.indexOf('verify:baseline') < order.indexOf('run:candidate'));
  assert.ok(order.indexOf('discarded:baseline') < order.indexOf('run:candidate'));
  assert.notEqual(adapter.resources.get('baseline').home, adapter.resources.get('candidate').home);
  assert.equal(adapter.resources.get('baseline').alive, false);

  const baselineFailureOrder = [];
  await assert.rejects(new AuthAbSequencer(fakeAdapter(baselineFailureOrder, { failStage: 'baseline' })).execute(), AuthAbError);
  assert.ok(baselineFailureOrder.includes('teardown:baseline'));
  assert.equal(baselineFailureOrder.some((event) => event.endsWith(':candidate')), false);

  const teardownFailureOrder = [];
  await assert.rejects(new AuthAbSequencer(fakeAdapter(teardownFailureOrder, { teardownFailure: 'baseline' })).execute(), AuthAbError);
  assert.equal(teardownFailureOrder.some((event) => event.endsWith(':candidate')), false);

  const comparativeOrder = [];
  const comparativeAdapter = fakeAdapter(comparativeOrder, {
    stageResults: { baseline: baselineLoginRpcFailure() },
    egressEvents: { baseline: [safeProxyEvent()] },
  });
  const comparativeResult = await new AuthAbSequencer(comparativeAdapter).execute();
  assert.equal(comparativeResult.outcome, 'COMPARISON_COMPLETE', 'a failed A-side remains a failed comparative result');
  assert.equal(comparativeResult.stages[0].outcome, 'FAIL');
  assert.equal(comparativeResult.stages[0].failureCode, 'DEVICE_AUTH_RPC_ERROR');
  assert.equal(comparativeResult.stages[0].rpc.method, 'account/login/start');
  assert.equal(comparativeResult.stages[0].rpc.rpcCode, -32603);
  assert.deepEqual(comparativeResult.stages[0].egressDiagnostics, {
    stage: 'baseline', beforeCursor: 0, afterCursor: 1, beforeCount: 0, afterCount: 1, count: 1, events: [safeProxyEvent()],
  });
  assert.equal(comparativeOrder.filter((event) => event === 'run:baseline').length, 1, 'baseline authentication is never retried');
  assert.equal(comparativeOrder.filter((event) => event === 'run:candidate').length, 1, 'candidate executes at most once');
  assert.ok(comparativeOrder.indexOf('teardown:baseline') < comparativeOrder.indexOf('proxy:candidate'));
  assert.ok(comparativeOrder.indexOf('verify:baseline') < comparativeOrder.indexOf('run:candidate'));
  assert.ok(comparativeOrder.indexOf('discarded:baseline') < comparativeOrder.indexOf('run:candidate'));
  assert.equal(comparativeOrder.filter((event) => event === 'diagnostics:baseline').length, 2,
    'baseline proxy health/diagnostics are captured both before and after its single stage');
  assert.equal(comparativeOrder.filter((event) => event === 'diagnostics:candidate').length, 2,
    'candidate proxy health/diagnostics are captured both before and after its single stage');
  assert.equal(comparativeAdapter.resources.get('baseline').alive, false,
    'baseline disposable container/home is verified removed before candidate starts');
  assert.equal(JSON.stringify(comparativeResult).includes('rawProxyResponse'), false);

  const resumedCandidateOrder = [];
  const resumedCandidateAdapter = fakeAdapter(resumedCandidateOrder);
  const resumedCandidateResult = await continueWithRecordedBaseline(
    encodedBaselineMarker(), resumedCandidateAdapter);
  assert.equal(resumedCandidateResult.outcome, 'COMPARISON_COMPLETE');
  assert.equal(resumedCandidateResult.stages[0].outcome, 'FAIL');
  assert.equal(resumedCandidateResult.stages[0].failureCode, 'DEVICE_AUTH_RPC_ERROR');
  assert.equal(resumedCandidateResult.stages[0].rpc.rpcCode, -32603);
  assert.equal(resumedCandidateResult.stages[0].egressDiagnostics.availability, 'NOT_CAPTURED_PRIOR_RUN',
    'prior baseline egress is reported as unavailable rather than fabricated');
  assert.equal(resumedCandidateOrder.filter((event) => event === 'run:baseline').length, 0,
    'candidate continuation never retries baseline authentication');
  assert.equal(resumedCandidateOrder.filter((event) => event === 'run:candidate').length, 1);
  assert.ok(resumedCandidateOrder.indexOf('teardown:baseline') < resumedCandidateOrder.indexOf('verify:baseline'));
  assert.ok(resumedCandidateOrder.indexOf('verify:baseline') < resumedCandidateOrder.indexOf('proxy:candidate'),
    'candidate continuation verifies no baseline project resources remain before starting its proxy');

  const priorTeardownFailureOrder = [];
  await assert.rejects(continueWithRecordedBaseline(encodedBaselineMarker(), fakeAdapter(priorTeardownFailureOrder, {
    teardownFailure: 'baseline',
  })), AuthAbError);
  assert.equal(priorTeardownFailureOrder.some((event) => event.endsWith(':candidate')), false,
    'candidate continuation stops if baseline-project teardown does not succeed');

  const malformedBaseline = projectSafeStageEvidence(baselineLoginRpcFailure(), 'baseline');
  const injectedMarker = `SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify({
    ...malformedBaseline, userCode: 'DO_NOT_ECHO_DEVICE_CODE',
  })}`;
  const injectedMarkerEncoded = Buffer.from(injectedMarker, 'utf8').toString('base64url');
  const noRetryOrder = [];
  await assert.rejects(continueWithRecordedBaseline(injectedMarkerEncoded, fakeAdapter(noRetryOrder)), (error) => {
    assert.equal(error.code, 'AUTH_AB_STAGE_OUTPUT_INVALID');
    assert.equal(error.message.includes('DO_NOT_ECHO_DEVICE_CODE'), false);
    return true;
  });
  assert.equal(noRetryOrder.length, 0, 'unsafe prior markers fail before any stage or container action');

  let oldCommandOutput = '';
  const originalStdoutWrite = process.stdout.write;
  process.stdout.write = (chunk) => { oldCommandOutput += String(chunk); return true; };
  try { await authAbMain(['--run-isolated-auth-ab']); }
  finally { process.stdout.write = originalStdoutWrite; }
  assert.deepEqual(JSON.parse(oldCommandOutput), {
    schema: 'SKYCOMMAND_CODEX_AUTH_AB_RESULT_V1',
    outcome: 'NOT_STARTED',
    reason: 'BASELINE_RESULT_ALREADY_RECORDED',
  }, 'the old full-run command cannot silently start another baseline authentication');

  for (const baselineFailure of [
    { stage: 'baseline', outcome: 'FAIL', failureCode: 'DEVICE_AUTH_RESPONSE_INVALID', observedAt: iso },
    { stage: 'baseline', outcome: 'FAIL', failureCode: 'AUTH_AB_CONTAINMENT_FAILED', observedAt: iso },
    { stage: 'baseline', outcome: 'FAIL', failureCode: 'AUTH_AB_HUMAN_CONFIRMATION_REQUIRED', observedAt: iso },
    { ...baselineLoginRpcFailure(), rpc: { ...baselineLoginRpcFailure().rpc, rpcCode: -32000 } },
    { stage: 'baseline', outcome: 'UNKNOWN', failureCode: 'DEVICE_AUTH_RPC_ERROR' },
  ]) {
    const failedOrder = [];
    await assert.rejects(new AuthAbSequencer(fakeAdapter(failedOrder, { stageResults: { baseline: baselineFailure } })).execute(), AuthAbError);
    assert.equal(failedOrder.filter((event) => event === 'run:baseline').length, 1);
    assert.equal(failedOrder.some((event) => event.endsWith(':candidate')), false,
      'only the exact terminal pre-checkpoint baseline RPC failure may proceed to candidate');
  }

  const egressViolationOrder = [];
  const egressViolationAdapter = fakeAdapter(egressViolationOrder, {
    stageResults: { baseline: baselineLoginRpcFailure() },
    egressEvents: { baseline: [safeProxyEvent({
      destinationClassification: 'OTHER_HOST_REDACTED', decision: 'DENY', reason: 'HOST_NOT_ALLOWLISTED',
    })] },
  });
  await assert.rejects(new AuthAbSequencer(egressViolationAdapter).execute(),
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_EGRESS_POLICY_MISMATCH');
  assert.equal(egressViolationOrder.some((event) => event.endsWith(':candidate')), false,
    'egress-policy violations block candidate execution');

  const diagnosticsFailureOrder = [];
  const badDiagnosticsAdapter = fakeAdapter(diagnosticsFailureOrder, {
    diagnosticsFailureStage: 'baseline',
  });
  await assert.rejects(new AuthAbSequencer(badDiagnosticsAdapter).execute(), AuthAbError);
  assert.equal(diagnosticsFailureOrder.some((event) => event.endsWith(':candidate')), false,
    'missing/unsafe diagnostics block candidate execution');

  const rawDiagnosticSecret = 'RAW_DIAGNOSTIC_TOKEN_SECRET';
  const { adapter: invalidSnapshotAdapter } = mockedDockerAdapter([], undefined, undefined, [
    JSON.stringify({ accessToken: rawDiagnosticSecret, events: 'malformed' }),
  ]);
  await assert.rejects(invalidSnapshotAdapter.captureProxyDiagnostics('baseline'), (error) => {
    assert.equal(error.code, 'AUTH_AB_EGRESS_POLICY_MISMATCH');
    assert.equal(error.message.includes(rawDiagnosticSecret), false);
    return true;
  });

  const candidateFailureOrder = [];
  const candidateFailure = {
    stage: 'candidate', outcome: 'FAIL', failureCode: 'DEVICE_AUTH_RPC_ERROR', attemptId: uuid,
    protocolMethods: ['initialize', 'account/login/start'], rpc: {
      method: 'account/login/start', requestId: 302, outcome: 'JSON_RPC_ERROR', rpcCode: -32603, observedAt: iso,
    }, observedAt: iso,
  };
  await assert.rejects(new AuthAbSequencer(fakeAdapter(candidateFailureOrder, {
    stageResults: { baseline: baselineLoginRpcFailure(), candidate: candidateFailure },
  })).execute(), AuthAbError);
  assert.equal(candidateFailureOrder.filter((event) => event === 'run:candidate').length, 1,
    'a candidate pre-human failure is recorded without retry');

  const productionPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docker/codex-agent-runtime/package.json'), 'utf8'));
  assert.equal(productionPackage.dependencies['@openai/codex'], '0.154.0',
    'production managed runtime remains pinned to the promoted 0.154.0 certification target');
  assert.equal(CONTRACT.baseline.wrapperVersion, '0.155.0-alpha.9.2',
    'authenticated A/B historical baseline remains unchanged');
  assert.equal(CONTRACT.candidate.wrapperVersion, '0.156.1');
  assert.equal(crypto.createHash('sha256').update(allowlistText).digest('hex').toUpperCase(), POLICY_DIGEST);

  const dockerCalls = { execFile: [], spawn: [] };
  const { adapter: dockerAdapter } = mockedDockerAdapter([
    `${markerLine('baseline')}\n`,
    `${markerLine('candidate')}\n`,
  ], dockerCalls, 'sha256:runtime\nsha256:egress\n', [
    proxySnapshotText(),
    proxySnapshotText([{
      ...safeProxyEvent(),
      cookie: 'PROXY_COOKIE_SECRET', rawResponse: 'RAW_PROXY_DATA_SECRET',
    }]),
  ]);
  await dockerAdapter.assertFresh();
  const imageInspect = dockerCalls.execFile.find((call) => call.args[0] === 'image' && call.args[1] === 'inspect');
  assert.ok(imageInspect, 'preflight inspects the prebuilt images');
  assert.deepEqual(imageInspect.args.slice(2, 4), [
    'skycommand-codex-auth-ab-runtime:local',
    'skycommand-codex-auth-ab-egress:local',
  ]);

  await dockerAdapter.startProxy('baseline');
  const proxyUp = dockerCalls.execFile.find((call) => call.args[0] === 'compose' && call.args.includes('up'));
  assert.ok(proxyUp, 'proxy startup uses docker compose up');
  assert.ok(proxyUp.args.includes('--no-build'), 'proxy startup explicitly requires its prebuilt image');
  assert.equal(proxyUp.args.includes('--build'), false);
  const experimentFingerprintKey = proxyUp.options.env.CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY;
  assert.match(experimentFingerprintKey, /^[A-F0-9]{64}$/,
    'host creates a high-entropy HMAC key in memory for this experiment only');
  const baselineDiagnosticsBefore = await dockerAdapter.captureProxyDiagnostics('baseline');
  assert.deepEqual(baselineDiagnosticsBefore, { stage: 'baseline', cursor: 0, count: 0, events: [] });
  const diagnosticsCommand = dockerCalls.execFile.find((call) => call.args[0] === 'compose' && call.args.includes('exec'));
  assert.ok(diagnosticsCommand, 'host orchestration reads the proxy diagnostics endpoint through the isolated Compose service');
  assert.ok(diagnosticsCommand.args.includes('--no-TTY'));

  const parsedBaseline = await dockerAdapter.runVersion('baseline');
  assert.equal(parsedBaseline.stage, 'baseline');
  assert.equal(parsedBaseline.outcome, 'OBSERVED');
  const baselineDiagnosticsAfter = await dockerAdapter.captureProxyDiagnostics('baseline');
  const adapterCorrelated = dockerAdapter.correlateStageEgress(baselineDiagnosticsBefore, baselineDiagnosticsAfter, 'baseline');
  assert.equal(adapterCorrelated.stage, 'baseline');
  assert.equal(adapterCorrelated.count, 1);
  assert.deepEqual(adapterCorrelated.events[0], safeProxyEvent());
  assert.equal(JSON.stringify(adapterCorrelated).includes('PROXY_COOKIE_SECRET'), false);
  assert.equal(JSON.stringify(adapterCorrelated).includes('RAW_PROXY_DATA_SECRET'), false);
  const baselineRun = dockerCalls.spawn[0];
  assert.equal(baselineRun.binary, 'docker');
  assert.equal(baselineRun.args[0], 'compose');
  assert.ok(baselineRun.args.includes('run'), 'stage execution uses docker compose run');
  for (const required of ['--rm', '--no-deps', '--interactive', '--no-TTY']) {
    assert.ok(baselineRun.args.includes(required), `stage execution preserves ${required}`);
  }
  assert.equal(baselineRun.args.includes('--no-build'), false, 'compose run must not receive unsupported --no-build');
  assert.equal(baselineRun.args.includes('--build'), false, 'stage execution must not introduce an implicit build');
  assert.ok(baselineRun.args.includes('auth-ab-baseline'));

  await assert.rejects(dockerAdapter.startProxy('candidate'),
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_RUN_FAILED');
  await assert.rejects(dockerAdapter.runVersion('candidate'),
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_RUN_FAILED');
  assert.equal(dockerCalls.spawn.length, 1, 'candidate execution is blocked before baseline teardown');

  await dockerAdapter.teardown();
  await dockerAdapter.verifyDiscarded('baseline');
  await dockerAdapter.markDiscarded('baseline');
  const teardownIndex = dockerCalls.execFile.findIndex((call) => call.args[0] === 'compose' && call.args.includes('down'));
  assert.ok(teardownIndex > -1, 'baseline Compose project is torn down');
  await dockerAdapter.startProxy('candidate');
  const candidateProxyUp = dockerCalls.execFile.filter((call) => call.args[0] === 'compose' && call.args.includes('up')).at(-1);
  assert.equal(candidateProxyUp.options.env.CODEX_EGRESS_AUTH_AB_FINGERPRINT_KEY, experimentFingerprintKey,
    'baseline and candidate use one experiment-scoped fingerprint key across proxy recreation');
  const parsedCandidate = await dockerAdapter.runVersion('candidate');
  assert.equal(parsedCandidate.stage, 'candidate');
  const candidateRun = dockerCalls.spawn[1];
  assert.equal(candidateRun.args.includes('--no-build'), false);
  assert.equal(candidateRun.args.includes('--build'), false);
  assert.ok(candidateRun.args.includes('auth-ab-candidate'));

  assert.equal(parseStageResultMarker(markerLine('baseline'), 'baseline').stage, 'baseline');
  assert.throws(() => parseStageResultMarker('SKYCOMMAND_AUTH_AB_RESULT_V1 {not-json}', 'baseline'),
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_STAGE_OUTPUT_INVALID');
  for (const output of ['', 'ordinary attached output\n', 'SKYCOMMAND_AUTH_AB_RESULT_V1 {not-json}\n']) {
    const { adapter: invalidMarkerAdapter } = mockedDockerAdapter([output]);
    await assert.rejects(invalidMarkerAdapter.runVersion('baseline'),
      (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_STAGE_OUTPUT_INVALID');
  }

  const { adapter: missingImageAdapter } = mockedDockerAdapter([], undefined, 'sha256:runtime\n');
  await assert.rejects(missingImageAdapter.assertFresh(),
    (error) => error instanceof AuthAbError && error.code === 'AUTH_AB_RUN_FAILED');

  process.stdout.write('Codex authenticated A/B harness self-test passed; source-only checks confirm isolated sequential orchestration, strict egress, transient human checkpoint, safe evidence, teardown, and no production-state path. No build, container, provider login, or experiment was started.\n');
}

main().catch((error) => {
  process.stderr.write(`Codex authenticated A/B harness self-test failed: ${error.message}\n`);
  process.exitCode = 1;
});
