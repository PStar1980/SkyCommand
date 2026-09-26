'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { addressIsPublic, hostAllowed, parseAuthority } = require('../../../apps/codex-egress-proxy/src/policy');
const { CONTRACT } = require('../../../docker/codex-compat-probe/contract');
const {
  ALLOWED_METHODS,
  AUTH_BOUNDARY_PHASES,
  APPROVED_PROVIDER_HOST,
  APPROVED_PROVIDER_PORT,
  APPROVED_PREFLIGHT_PROVIDER_HOSTS,
  AuthBoundaryError,
  AuthBoundaryRun,
  CODEX_VERSION,
  createFreshExperimentIdentity,
  projectDisposableRuntimeEvidence,
  projectReadOnlyPreflight,
} = require('../../../docker/codex-compat-probe/auth-boundary-contract');

const ROOT = path.resolve(__dirname, '../../..');
const iso = '2026-09-24T12:00:00.000Z';
const later = '2026-09-24T12:01:00.000Z';
const expId = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const operationId = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
const lifecycleId = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';
const loginId = 'transient-login-reference-only';
const userCode = 'TRANSIENT-CODE';
const secretHost = 'unknown-provider.invalid';

function preflight(overrides = {}) {
  return {
    schema: 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1',
    readOnly: true,
    observedAt: iso,
    installationCode: 'phase19-3a0-managed-codex',
    sources: { database: 'READ_ONLY', supervisor: 'READ_ONLY', runtime: 'READ_ONLY' },
    installation: {
      installationId: 'd4d4d4d4-4444-4444-8444-d4d4d4d4d4d4',
      installationCode: 'phase19-3a0-managed-codex',
      runtimeCode: 'OPENAI_CODEX_APP_SERVER',
      executionEnabled: false,
    },
    enrollment: {
      totalCount: 0, activeCount: 0, unresolvedCount: 0, unknownStateCount: 0,
      allStatesClassified: true, evidenceTruncated: false, operations: [],
    },
    accountBinding: {
      bindingId: 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5',
      accountCode: 'phase19-3a0-managed-account', state: 'UNCONFIGURED', executionEnabled: false,
    },
    runtime: {
      codexVersion: CODEX_VERSION,
      expectedCodexVersion: CODEX_VERSION,
      certificationState: 'CERTIFIED',
      freshness: 'CURRENT',
      workerHealth: 'HEALTHY',
      bridgeHealth: 'HEALTHY',
      containment: 'CURRENT',
      mcp: 'CURRENT',
      identityAttestation: 'VERIFIED',
      executionEnabled: false,
      runtimeObservationCurrent: true,
      networkPolicyCurrent: true,
      expectedServicesRunning: true,
      readiness: 'BLOCKED',
      readinessBlockers: ['ACCOUNT_UNENROLLED', 'PROVIDER_REACHABILITY_UNKNOWN'],
    },
    supervisor: {
      online: true,
      runtimeStatus: 'ONLINE',
      activeOperationPresent: false,
      activeOperationId: null,
      lastOperationKnown: true,
      lastOperation: { operationId: lifecycleId, status: 'SUCCEEDED', completedAt: iso },
    },
    lifecycle: {
      active: false,
      outcomeKnown: true,
      operationId: lifecycleId,
      attemptCount: 1,
      state: 'SUCCEEDED',
      supervisorOperationId: lifecycleId,
      completedAt: iso,
      terminalReconciledAt: iso,
      fingerprintStatus: 'BOUND',
      sourceConfigurationFingerprint: 'A'.repeat(64),
      lifecycleSchemaVersion: 2,
      terminalReconciliationBasis: null,
      historyValid: true,
      historyCount: 0,
    },
    providerPolicy: { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: 'B'.repeat(64) },
    ...overrides,
  };
}

function readyRun(ids = { experimentId: expId, providerOperationId: operationId }) {
  const run = new AuthBoundaryRun(ids);
  run.acceptPreflight(preflight());
  run.acceptIsolatedRuntime(runtimeEvidence(ids.experimentId));
  run.initialized({
    appServerGeneration: 'generation-19-3a0-isolated-01',
    observedVersion: CODEX_VERSION,
    executionEnabled: false,
    observedAt: iso,
  });
  return run;
}

function runtimeEvidence(experimentId, overrides = {}) {
  return {
    schema: 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_RUNTIME_V1',
    projectName: `skycommand-codex-auth-boundary-${experimentId.slice(0, 8)}`,
    containerId: 'f'.repeat(64),
    imageId: `sha256:${'e'.repeat(64)}`,
    codexVersion: CODEX_VERSION,
    containerCreatedAt: '2026-09-24T12:00:01.000Z',
    projectWasFresh: true,
    containerWasFresh: true,
    homeWasFresh: true,
    uid: 10001,
    rootReadOnly: true,
    capabilitiesDroppedAll: true,
    noNewPrivileges: true,
    mounts: [
      { target: '/tmp', type: 'tmpfs', readOnly: false },
      { target: '/probe-home', type: 'tmpfs', readOnly: false },
    ],
    productionCredentialsPresent: false,
    databaseCredentialsPresent: false,
    supervisorCredentialsPresent: false,
    hostAgentCredentialsPresent: false,
    providerCredentialsMounted: false,
    secretEnvironmentVariablesPresent: false,
    productionManagedHomeMounted: false,
    dockerSocketMounted: false,
    gitAvailable: false,
    browserAvailable: false,
    executionEnabled: false,
    turnStartEnabled: false,
    browserTaskExecutionEnabled: false,
    mcpTaskExecutionEnabled: false,
    defaultRoutePresent: false,
    providerProxyOnly: true,
    networks: ['auth_client'],
    allowedProviderHosts: ['auth.openai.com'],
    allowedProviderPorts: [443],
    ...overrides,
  };
}

function safePhaseEvent(overrides = {}) {
  return {
    cursor: 1,
    destinationClassification: 'OTHER_HOST_REDACTED',
    destinationFingerprint: 'D'.repeat(64),
    port: 443,
    decision: 'DENY',
    reason: 'HOST_NOT_ALLOWLISTED',
    observedAt: iso,
    observedMonotonicNs: '200',
    count: 1,
    hostname: secretHost,
    authorization: 'BEARER_SECRET',
    ...overrides,
  };
}

function safePhase(phase, event) {
  return {
    phase,
    boundarySource: 'PROXY_PHASE_CURSOR',
    startedMonotonicNs: '100',
    endedMonotonicNs: '300',
    beforeCursor: 0,
    afterCursor: event ? 1 : 0,
    beforeCount: 0,
    afterCount: event ? 1 : 0,
    count: event ? 1 : 0,
    events: event ? [event] : [],
    rawMessage: 'NEVER_PROJECT_THIS',
  };
}

function cleanup(run) {
  run.markTeardownVerified({ containerRemoved: true, disposableHomeDiscarded: true, proxyRemoved: true });
}

async function main() {
  assert.equal(CODEX_VERSION, '0.154.0');
  assert.equal(CONTRACT.baseline.wrapperVersion, '0.155.0-alpha.9.2', 'historical sterile baseline remains unchanged');
  assert.equal(CONTRACT.candidate.wrapperVersion, '0.156.1');
  assert.equal(APPROVED_PROVIDER_HOST, 'auth.openai.com');
  assert.equal(APPROVED_PROVIDER_PORT, 443);
  assert.deepEqual(APPROVED_PREFLIGHT_PROVIDER_HOSTS, ['auth.openai.com', 'chatgpt.com']);
  assert.deepEqual(ALLOWED_METHODS, ['initialize', 'account/login/start', 'account/read']);
  assert.deepEqual(AUTH_BOUNDARY_PHASES, [
    'APP_SERVER_STARTUP', 'INITIALIZE', 'POST_INITIALIZE_IDLE', 'ACCOUNT_LOGIN_START',
    'DEVICE_CODE_USER_CODE_REQUEST', 'POST_REQUEST_PROCESSING',
  ]);

  const allowlist = fs.readFileSync(path.join(ROOT, 'docker/codex-provider-allowlist.txt'), 'utf8')
    .split(/\r?\n/).map((item) => item.replace(/#.*$/, '').trim()).filter(Boolean);
  assert.deepEqual(allowlist, ['auth.openai.com', 'chatgpt.com'], 'provider source policy contains only the exact observed authentication/provider hostnames');
  assert.equal(hostAllowed(APPROVED_PROVIDER_HOST, allowlist), true);
  assert.equal(hostAllowed('chatgpt.com', allowlist), true, 'the observed provider host is explicitly allowlisted');
  for (const host of ['openai.com', 'other.auth.openai.com', 'auth.openai.com.evil.invalid', 'other.chatgpt.com', 'chatgpt.com.evil.invalid', '127.0.0.1']) {
    assert.equal(hostAllowed(host, allowlist), false, `${host} remains denied`);
  }
  assert.deepEqual(parseAuthority('auth.openai.com:443'), { host: 'auth.openai.com', port: 443 });
  assert.equal(parseAuthority('auth.openai.com:443').port, APPROVED_PROVIDER_PORT);
  assert.notEqual(parseAuthority('auth.openai.com:80').port, APPROVED_PROVIDER_PORT);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.2', '::1', 'fc00::1']) {
    assert.equal(addressIsPublic(ip), false, `${ip} remains non-public`);
  }

  const generated = ['d4d4d4d4-4444-4444-8444-d4d4d4d4d4d4', 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5'];
  const freshIdentity = createFreshExperimentIdentity(() => generated.shift());
  assert.notEqual(freshIdentity.experimentId, freshIdentity.providerOperationId);
  assert.match(freshIdentity.experimentId, /^[0-9a-f-]{36}$/);
  assert.match(freshIdentity.providerOperationId, /^[0-9a-f-]{36}$/);
  assert.throws(() => new AuthBoundaryRun({ experimentId: expId, providerOperationId: expId }), AuthBoundaryError);

  const projectedPreflight = projectReadOnlyPreflight(preflight());
  assert.equal(projectedPreflight.enrollment.activeCount, 0);
  assert.equal(projectedPreflight.accountBinding.state, 'UNCONFIGURED');
  assert.equal(projectedPreflight.preflightRole, 'VETO_ONLY');
  assert.equal(projectedPreflight.accountBinding.role, 'OBSERVATION_ONLY');
  assert.equal(projectedPreflight.executionEnabled, false);
  assert.equal(Object.hasOwn(projectedPreflight, 'userCode'), false);
  for (const [changed, expectedCode] of [
    [preflight({ enrollment: { ...preflight().enrollment, activeCount: 1 } }), 'AUTH_BOUNDARY_ENROLLMENT_ACTIVE'],
    [preflight({ enrollment: { ...preflight().enrollment, unresolvedCount: 1 } }), 'AUTH_BOUNDARY_ENROLLMENT_UNRESOLVED'],
    [preflight({ enrollment: { ...preflight().enrollment, unknownStateCount: 1 } }), 'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED'],
    [preflight({ enrollment: { ...preflight().enrollment, allStatesClassified: false } }), 'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED'],
  ]) {
    assert.throws(() => projectReadOnlyPreflight(changed), (error) => error.code === expectedCode);
  }
  assert.throws(() => projectReadOnlyPreflight(preflight({ readOnly: false })),
    (error) => error.code === 'AUTH_BOUNDARY_PREFLIGHT_INVALID');
  assert.throws(() => projectReadOnlyPreflight(preflight({ supervisor: {
    ...preflight().supervisor, activeOperationPresent: true, activeOperationId: expId,
  } })), (error) => error.code === 'AUTH_BOUNDARY_SUPERVISOR_OPERATION_ACTIVE');
  assert.throws(() => projectReadOnlyPreflight(preflight({
    supervisor: { ...preflight().supervisor, lastOperation: { operationId: lifecycleId, status: 'FAILED', completedAt: iso } },
  })), (error) => error.code === 'AUTH_BOUNDARY_LIFECYCLE_CONTRADICTORY');
  assert.throws(() => projectReadOnlyPreflight(preflight({ runtime: { ...preflight().runtime, readiness: 'UNKNOWN' } })),
    (error) => error.code === 'AUTH_BOUNDARY_RUNTIME_NOT_CURRENT');

  const projectedRuntime = projectDisposableRuntimeEvidence(runtimeEvidence(expId), expId, iso);
  assert.equal(projectedRuntime.projectName, `skycommand-codex-auth-boundary-${expId.slice(0, 8)}`);
  assert.deepEqual(projectedRuntime.mounts, [
    { target: '/probe-home', type: 'tmpfs', readOnly: false },
    { target: '/tmp', type: 'tmpfs', readOnly: false },
  ]);
  for (const changedRuntime of [
    runtimeEvidence(expId, { productionCredentialsPresent: true }),
    runtimeEvidence(expId, { databaseCredentialsPresent: true }),
    runtimeEvidence(expId, { supervisorCredentialsPresent: true }),
    runtimeEvidence(expId, { hostAgentCredentialsPresent: true }),
    runtimeEvidence(expId, { providerCredentialsMounted: true }),
    runtimeEvidence(expId, { secretEnvironmentVariablesPresent: true }),
    runtimeEvidence(expId, { productionManagedHomeMounted: true }),
    runtimeEvidence(expId, { dockerSocketMounted: true }),
    runtimeEvidence(expId, { gitAvailable: true }),
    runtimeEvidence(expId, { browserAvailable: true }),
    runtimeEvidence(expId, { executionEnabled: true }),
    runtimeEvidence(expId, { turnStartEnabled: true }),
    runtimeEvidence(expId, { mcpTaskExecutionEnabled: true }),
    runtimeEvidence(expId, { defaultRoutePresent: true }),
    runtimeEvidence(expId, { networks: ['auth_client', 'codex_provider_internal'] }),
    runtimeEvidence(expId, { allowedProviderHosts: ['*.openai.com'] }),
    runtimeEvidence(expId, { allowedProviderPorts: [80, 443] }),
    runtimeEvidence(expId, { mounts: [
      { target: '/tmp', type: 'tmpfs', readOnly: false },
      { target: '/probe-home', type: 'tmpfs', readOnly: false },
      { target: '/var/lib/codex', type: 'volume', readOnly: false },
    ] }),
    runtimeEvidence(expId, { containerWasFresh: false }),
    runtimeEvidence(expId, { homeWasFresh: false }),
    runtimeEvidence(expId, { codexVersion: '0.156.1' }),
    runtimeEvidence(expId, { containerCreatedAt: '2026-09-24T11:59:59.000Z' }),
  ]) {
    assert.throws(() => projectDisposableRuntimeEvidence(changedRuntime, expId, iso),
      (error) => error.code === 'AUTH_BOUNDARY_PREFLIGHT_BLOCKED');
  }
  const missingPreflightRuntime = new AuthBoundaryRun({ experimentId: expId, providerOperationId: operationId });
  assert.throws(() => missingPreflightRuntime.acceptIsolatedRuntime(runtimeEvidence(expId)),
    (error) => error.code === 'AUTH_BOUNDARY_ORDER_INVALID');

  const loginFailure = readyRun();
  loginFailure.beginLoginStart(402, later);
  loginFailure.recordLoginStartFailure({
    failureCode: 'DEVICE_AUTH_RPC_ERROR', rpcCode: -32603, requestId: 402, observedAt: later,
  });
  assert.equal(loginFailure.outcomeCategory, 'LOGIN_START_FAILURE');
  assert.equal(loginFailure.loginStartCount, 1);
  assert.equal(loginFailure.accountReadCount, 0);
  assert.throws(() => loginFailure.beginLoginStart(403, later), AuthBoundaryError,
    'a terminal login-start failure cannot be retried');
  cleanup(loginFailure);
  const loginFailureEvidence = loginFailure.safeEvidence({
    packageLockSha256: '1'.repeat(64), installedArtifactSha256: '2'.repeat(64), observedAt: later,
  });
  assert.equal(loginFailureEvidence.rpc.method, 'account/login/start');
  assert.equal(loginFailureEvidence.rpc.rpcCode, -32603);
  assert.equal(loginFailureEvidence.accountReadCount, 0);

  const success = readyRun();
  success.beginLoginStart(402, later);
  const transientOutput = [];
  success.presentCheckpoint({
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode,
    loginId,
    expiresAt: '2026-09-24T13:00:00.000Z',
  }, { requestId: 402, observedAt: later }, (checkpoint) => transientOutput.push(checkpoint));
  assert.equal(transientOutput.length, 1, 'checkpoint is presented once through the transient sink');
  assert.equal(success.state, 'WAITING_FOR_PROVIDER_COMPLETION');
  assert.equal(success.accountReadCount, 0);
  assert.equal(typeof success.humanConfirmed, 'undefined', 'human assertion is not an account-read authorization method');
  assert.throws(() => success.beginAccountRead(403, later),
    (error) => error.code === 'AUTH_BOUNDARY_ORDER_INVALID');
  assert.deepEqual(success.observeNotification({ type: 'account/updated', observedAt: later }), {
    accepted: false, state: 'WAITING_FOR_PROVIDER_COMPLETION',
  }, 'account/updated alone does not authorize account/read');
  assert.equal(success.accountReadCount, 0);

  assert.deepEqual(success.observeNotification({
    type: 'account/login/completed',
    experimentId: expId,
    providerOperationId: operationId,
    appServerGeneration: 'generation-19-3a0-isolated-01',
    loginId,
    success: true,
    observedAt: '2026-09-24T12:02:00.000Z',
  }), { accepted: true, state: 'LOGIN_COMPLETION_OBSERVED' });
  success.beginAccountRead(403, '2026-09-24T12:02:01.000Z');
  assert.equal(success.accountReadCount, 1);
  assert.throws(() => success.beginAccountRead(404, '2026-09-24T12:02:02.000Z'), AuthBoundaryError,
    'account/read cannot be submitted twice');

  const event = safePhaseEvent();
  success.recordAccountReadResult({
    requestId: 403,
    observedAt: '2026-09-24T12:02:02.000Z',
    accountState: 'ACCOUNT_PRESENT',
    authenticated: true,
    rawAccount: { accessToken: 'ACCOUNT_TOKEN_SECRET' },
  });
  assert.equal(success.outcomeCategory, 'AUTHENTICATED_ACCOUNT_READ_SUCCESS');
  cleanup(success);
  const safeEvidence = success.safeEvidence({
    packageLockSha256: '1'.repeat(64),
    installedArtifactSha256: '2'.repeat(64),
    phaseEgress: [safePhase('ACCOUNT_LOGIN_START', event)],
    observedAt: '2026-09-24T12:02:03.000Z',
  });
  const safeJson = JSON.stringify(safeEvidence);
  for (const forbidden of [userCode, 'https://auth.openai.com/codex/device', loginId,
    'ACCOUNT_TOKEN_SECRET', 'BEARER_SECRET', secretHost, 'NEVER_PROJECT_THIS']) {
    assert.equal(safeJson.includes(forbidden), false, `${forbidden} is not projected or persisted`);
  }
  assert.equal(safeEvidence.executionEnabled, false);
  assert.equal(safeEvidence.isolatedRuntime.providerProxyOnly, true);
  assert.equal(safeEvidence.identity.expectedVersion, '0.154.0');
  assert.equal(safeEvidence.identity.wrapperIntegrity, CONTRACT.baseline.wrapperIntegrity);
  assert.equal(safeEvidence.identity.platformIntegrity, CONTRACT.baseline.platformIntegrity);
  assert.equal(safeEvidence.turnStartCount, 0);
  assert.equal(safeEvidence.browserTaskCount, 0);
  assert.equal(safeEvidence.loginStartCount, 1);
  assert.equal(safeEvidence.accountReadCount, 1);
  assert.deepEqual(safeEvidence.protocolMethods, ['initialize', 'account/login/start', 'account/read']);
  assert.deepEqual(Object.keys(safeEvidence.phaseEgress[0].events[0]).sort(), [
    'count', 'cursor', 'decision', 'destinationClassification', 'destinationFingerprint',
    'observedAt', 'observedMonotonicNs', 'port', 'reason',
  ].sort());

  const uncertain = readyRun();
  uncertain.beginLoginStart(402, later);
  uncertain.presentCheckpoint({
    verificationUrl: 'https://auth.openai.com/codex/device', userCode, loginId,
    expiresAt: '2026-09-24T13:00:00.000Z',
  }, { requestId: 402, observedAt: later }, () => {});
  const wrongOperation = uncertain.observeNotification({
    type: 'account/login/completed', experimentId: expId, providerOperationId: lifecycleId,
    appServerGeneration: 'generation-19-3a0-isolated-01', loginId, success: true,
    observedAt: '2026-09-24T12:02:00.000Z',
  });
  assert.deepEqual(wrongOperation, { accepted: false, state: 'TERMINAL' });
  assert.equal(uncertain.outcomeCategory, 'PROVIDER_OUTCOME_UNCERTAIN');
  assert.equal(uncertain.accountReadCount, 0);
  assert.throws(() => uncertain.beginAccountRead(403, later), AuthBoundaryError);

  const failedLogin = readyRun();
  failedLogin.beginLoginStart(402, later);
  failedLogin.presentCheckpoint({
    verificationUrl: 'https://auth.openai.com/codex/device', userCode, loginId,
    expiresAt: '2026-09-24T13:00:00.000Z',
  }, { requestId: 402, observedAt: later }, () => {});
  failedLogin.observeNotification({
    type: 'account/login/completed', experimentId: expId, providerOperationId: operationId,
    appServerGeneration: 'generation-19-3a0-isolated-01', loginId, success: false,
    observedAt: '2026-09-24T12:02:00.000Z',
  });
  assert.equal(failedLogin.outcomeCategory, 'PROVIDER_LOGIN_FAILURE');
  assert.equal(failedLogin.accountReadCount, 0);

  const timeout = readyRun();
  timeout.beginLoginStart(402, later);
  timeout.presentCheckpoint({
    verificationUrl: 'https://auth.openai.com/codex/device', userCode, loginId,
    expiresAt: '2026-09-24T13:00:00.000Z',
  }, { requestId: 402, observedAt: later }, () => {});
  timeout.markProviderOutcomeUncertain('2026-09-24T12:16:00.000Z');
  assert.equal(timeout.outcomeCategory, 'PROVIDER_OUTCOME_UNCERTAIN');
  assert.equal(timeout.accountReadCount, 0);

  const readFailure = readyRun();
  readFailure.beginLoginStart(402, later);
  readFailure.presentCheckpoint({
    verificationUrl: 'https://auth.openai.com/codex/device', userCode, loginId,
    expiresAt: '2026-09-24T13:00:00.000Z',
  }, { requestId: 402, observedAt: later }, () => {});
  readFailure.observeNotification({
    type: 'account/login/completed', experimentId: expId, providerOperationId: operationId,
    appServerGeneration: 'generation-19-3a0-isolated-01', loginId, success: true,
    observedAt: '2026-09-24T12:02:00.000Z',
  });
  readFailure.beginAccountRead(403, '2026-09-24T12:02:01.000Z');
  readFailure.recordAccountReadFailure({
    failureCode: 'ACCOUNT_READ_RPC_ERROR', rpcCode: -32603, requestId: 403,
    observedAt: '2026-09-24T12:02:02.000Z',
  });
  assert.equal(readFailure.outcomeCategory, 'AUTHENTICATED_ACCOUNT_READ_FAILURE');
  assert.equal(readFailure.rpc.method, 'account/read');
  assert.equal(readFailure.rpc.rpcCode, -32603);
  assert.throws(() => readFailure.markTeardownVerified({ containerRemoved: true, disposableHomeDiscarded: true, proxyRemoved: false }),
    (error) => error.code === 'AUTH_BOUNDARY_CLEANUP_UNVERIFIED');

  const compose = YAML.parse(fs.readFileSync(path.join(ROOT, 'docker/codex-compat-probe/auth-ab/compose.yaml'), 'utf8'));
  const isolationTemplate = compose.services['auth-ab-baseline'];
  assert.equal(isolationTemplate.read_only, true);
  assert.equal(isolationTemplate.user, '10001:10001');
  assert.deepEqual(isolationTemplate.cap_drop, ['ALL']);
  assert.ok(isolationTemplate.tmpfs.includes('/probe-home:rw,noexec,nosuid,nodev,size=96m,uid=10001,gid=10001,mode=0700'));
  assert.deepEqual(isolationTemplate.networks, ['auth_client']);
  assert.equal(isolationTemplate.logging.driver, 'none');
  assert.equal(Object.hasOwn(isolationTemplate, 'volumes'), false);
  assert.equal(isolationTemplate.environment.SKYCOMMAND_PROBE_EXECUTION_DISABLED, '1');
  assert.equal(isolationTemplate.environment.SKYCOMMAND_AUTH_AB_EXECUTION_DISABLED, '1');
  assert.deepEqual(compose.networks.auth_client, { internal: true });
  const proxyTemplate = compose.services['auth-egress-proxy'];
  assert.deepEqual(Object.keys(proxyTemplate.networks).sort(), ['auth_client', 'auth_uplink']);
  assert.equal(proxyTemplate.environment.CODEX_EGRESS_ALLOWLIST_PATH, '/etc/skycommand/provider-allowlist.txt');
  assert.equal(proxyTemplate.volumes.length, 1);
  assert.equal(proxyTemplate.volumes[0].read_only, true);
  assert.equal(proxyTemplate.volumes[0].target, '/etc/skycommand/provider-allowlist.txt');
  const newContractSource = fs.readFileSync(path.join(ROOT, 'docker/codex-compat-probe/auth-boundary-contract.js'), 'utf8');
  assert.doesNotMatch(newContractSource, /require\(['"](?:pg|node:child_process)['"]\)|fetch\s*\(/,
    'the policy/state contract cannot read/write the database, spawn Docker, or contact a service');
  assert.doesNotMatch(newContractSource, /turn\/start|browserAutomation|managedCodex.*(?:start|reconcile)/i,
    'the contract exposes no Turn, Browser, managed-enrollment, or lifecycle action');

  process.stdout.write('Codex one-leg authentication-boundary contract self-test passed; preflight vetoes, unique identities, single-call budgets, completion correlation, safe checkpoint projection, exact egress, phase diagnostics, and isolated-runtime template boundaries verified. No Docker/provider/runtime action was run.\n');
}

main().catch((error) => {
  process.stderr.write(`Codex one-leg authentication-boundary contract self-test failed: ${error.message}\n`);
  process.exitCode = 1;
});
