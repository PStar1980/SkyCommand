'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { CONTRACT, ProbeError, projectAccountRead, validateRpcEnvelope } = require('../contract');
const { createRpcProcess, inspectStage, probeContainment } = require('../probe');
const {
  AUTH_AB_METHODS,
  AuthAbError,
  AuthAbStageState,
  SAFE_FAILURE_CODES,
  VERSION_BY_STAGE,
  projectSafePhaseEgress,
  projectSafeStageEvidence,
} = require('./contract');

const ROOT = '/opt/codex-compat-probe';
const EXPECTED_POLICY_HOSTS = Object.freeze(['auth.openai.com', 'chatgpt.com']);
const POLICY_DIGEST = '855E57700B5CC7C377934BADA5884B811A5DCFA58C9F6AA8655EBA7B119E0879';
const RPC_IDS = Object.freeze({ initialize: 301, loginStart: 302, accountRead: 303 });
const CHECKPOINT_MAX_MS = 15 * 60 * 1000;
const APP_SERVER_STARTUP_SETTLE_MS = 250;
const POST_INITIALIZE_IDLE_MS = 750;
const PHASE_PROXY_BASE = 'http://codex-auth-ab-egress:3128/auth-ab/phase';

async function postPhaseBoundary(action, payload, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${PHASE_PROXY_BASE}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch (_error) { fail('AUTH_AB_EGRESS_POLICY_MISMATCH'); }
  let value;
  try { value = await response.json(); } catch (_error) { fail('AUTH_AB_EGRESS_POLICY_MISMATCH'); }
  if (!response.ok || value?.ok !== true) fail('AUTH_AB_EGRESS_POLICY_MISMATCH');
  return value;
}

async function captureProxyPhase(phase, action, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const begin = await postPhaseBoundary('begin', { phase }, fetchImpl);
  if (begin.phase !== phase || typeof begin.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(begin.token)
    || !/^\d{1,40}$/.test(begin.startedMonotonicNs || '')
    || !Number.isSafeInteger(begin.beforeCursor) || begin.beforeCursor < 0
    || !Number.isSafeInteger(begin.beforeCount) || begin.beforeCount < 0 || begin.beforeCount > 80) {
    fail('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  let result;
  let actionError;
  try { result = await action(); } catch (error) { actionError = error; }
  let phaseEvidence;
  try {
    const ended = await postPhaseBoundary('end', { token: begin.token }, fetchImpl);
    phaseEvidence = projectSafePhaseEgress({ ...ended, boundarySource: 'PROXY_PHASE_CURSOR' });
    if (phaseEvidence.phase !== phase || phaseEvidence.startedMonotonicNs !== begin.startedMonotonicNs
      || phaseEvidence.beforeCursor !== begin.beforeCursor || phaseEvidence.beforeCount !== begin.beforeCount) {
      fail('AUTH_AB_EGRESS_POLICY_MISMATCH');
    }
  } catch (_error) {
    fail('AUTH_AB_EGRESS_POLICY_MISMATCH');
  }
  options.onPhase?.(phaseEvidence);
  if (actionError) throw actionError;
  return { result, phaseEvidence };
}

function aliasDeviceUserCodePhase(accountLoginPhase) {
  return projectSafePhaseEgress({
    ...accountLoginPhase,
    phase: 'DEVICE_CODE_USER_CODE_REQUEST',
    boundarySource: 'RPC_ENVELOPE_ALIAS',
    correlatedPhase: 'ACCOUNT_LOGIN_START',
  });
}

function classifyAuthTransportDiagnostic(rpcCode, errorMessage, phaseEvidence = null) {
  const rawMessage = typeof errorMessage === 'string' ? errorMessage.slice(0, 8192) : '';
  const message = rawMessage.toLowerCase();
  const events = Array.isArray(phaseEvidence?.events) ? phaseEvidence.events : [];
  const approvedEvents = events.filter((event) => event.destinationClassification === 'APPROVED_AUTH_HOST');
  let transportClassification = 'UNKNOWN';
  let httpResponse = 'UNKNOWN';
  let httpStatusClass = null;
  let responseParse = 'UNKNOWN';
  let rpcMapping = rpcCode === -32603 ? 'INTERNAL_ERROR' : 'UNKNOWN';
  let tlsOutcome = 'UNKNOWN';

  if (approvedEvents.some((event) => event.reason === 'DNS_LOOKUP_FAILED')) {
    transportClassification = 'DNS_FAILURE';
    tlsOutcome = 'NOT_REACHED';
    httpResponse = 'NOT_OBSERVED';
    responseParse = 'NOT_REACHED';
  } else if (approvedEvents.some((event) => event.reason === 'UPSTREAM_CONNECT_FAILED')) {
    transportClassification = 'CONNECT_FAILURE';
    tlsOutcome = 'NOT_REACHED';
    httpResponse = 'NOT_OBSERVED';
    responseParse = 'NOT_REACHED';
  } else if (/(?:tls handshake|certificate verify failed|invalid peer certificate|certificate validation failed|tls alert)/i.test(rawMessage)) {
    transportClassification = 'TLS_FAILURE';
    tlsOutcome = 'FAILED';
    httpResponse = 'NOT_OBSERVED';
    responseParse = 'NOT_REACHED';
  } else {
    const statusMatch = rawMessage.match(/device code request failed with status\s+([1-5])\d\d\b/i);
    const disabledDeviceAuth = message.includes('device code login is not enabled for this codex server');
    if (statusMatch || disabledDeviceAuth) {
      transportClassification = 'HTTP_RESPONSE_RECEIVED';
      tlsOutcome = 'SUCCEEDED';
      httpResponse = 'RECEIVED';
      httpStatusClass = statusMatch ? `${statusMatch[1]}XX` : '4XX';
      responseParse = 'NOT_REACHED';
    } else if (/(?:expected value at line \d+ column \d+|eof while parsing|trailing characters at line \d+ column \d+|invalid type .* at line \d+ column \d+)/i.test(rawMessage)) {
      transportClassification = 'RESPONSE_PARSE_FAILURE';
      tlsOutcome = 'SUCCEEDED';
      httpResponse = 'RECEIVED';
      httpStatusClass = '2XX';
      responseParse = 'FAILED';
    } else if (approvedEvents.some((event) => event.reason === 'PUBLIC_ALLOWLISTED_TLS')) {
      // The proxy reason records TCP CONNECT establishment only; it is not proof of TLS success.
      transportClassification = 'RPC_MAPPING_FAILURE';
    } else if (rpcCode === -32603) {
      transportClassification = 'RPC_MAPPING_FAILURE';
    }
  }

  return {
    method: 'account/login/start',
    rpcCode: Number.isSafeInteger(rpcCode) ? rpcCode : null,
    transportClassification,
    tlsOutcome,
    httpResponse,
    httpStatusClass,
    responseParse,
    rpcMapping,
  };
}

function fail(code) {
  throw new AuthAbError(SAFE_FAILURE_CODES.has(code) ? code : 'AUTH_AB_RUN_FAILED');
}

function validateAuthAbSnapshot(snapshot, env = process.env) {
  const interfaces = snapshot.interfaces.filter((name) => name !== 'lo');
  const requiredMountsPresent = snapshot.homeIsTmpfs && snapshot.tempIsTmpfs;
  const forbiddenMount = snapshot.mountTargets.some((target) => [
    '/workspace', '/var/lib/codex', '/run/codex-runtime-control', '/run/secrets', '/var/run/docker.sock',
  ].includes(target));
  if (snapshot.uid <= 0 || snapshot.capabilitiesEffective !== '0000000000000000'
    || !snapshot.rootReadOnly || !requiredMountsPresent || interfaces.length !== 1
    || snapshot.interfaces.length !== 2 || !snapshot.interfaces.includes('lo')
    || snapshot.defaultRoutes !== 0 || !snapshot.executionDisabled
    || snapshot.productionCredentialsPresent || forbiddenMount
    || env.SKYCOMMAND_AUTH_AB_EXECUTION_DISABLED !== '1'
    || env.HTTP_PROXY !== 'http://codex-auth-ab-egress:3128'
    || env.HTTPS_PROXY !== 'http://codex-auth-ab-egress:3128'
    || env.NO_PROXY !== 'localhost,127.0.0.1,codex-auth-ab-egress') fail('AUTH_AB_CONTAINMENT_FAILED');
  return true;
}

function validateRuntimeContainment() {
  const { snapshot } = probeContainment();
  return validateAuthAbSnapshot(snapshot);
}

async function verifyEgressProxy(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('http://codex-auth-ab-egress:3128/healthz', { signal: AbortSignal.timeout(3000) });
  } catch (_error) { fail('AUTH_AB_EGRESS_POLICY_MISMATCH'); }
  let health;
  try { health = await response.json(); } catch (_error) { fail('AUTH_AB_EGRESS_POLICY_MISMATCH'); }
  if (!response.ok || health?.ok !== true || health.profile !== 'CODEX_PROVIDER_ALLOWLIST'
    || health.allowedHostCount !== EXPECTED_POLICY_HOSTS.length
    || health.policyDigest !== process.env.CODEX_AUTH_AB_EXPECTED_POLICY_DIGEST
    || health.policyDigest !== POLICY_DIGEST) fail('AUTH_AB_EGRESS_POLICY_MISMATCH');
  return { policyDigest: health.policyDigest, allowedHostCount: health.allowedHostCount };
}

function validateInitializeResult(value) {
  const fields = ['userAgent', 'codexHome', 'platformFamily', 'platformOs'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !fields.every((field) => typeof value[field] === 'string'
      && value[field].trim().length > 0 && value[field].length <= 4096)) fail('INITIALIZE_RESULT_INVALID');
}

function validateDeviceCheckpoint(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.type !== 'chatgptDeviceCode') {
    fail('DEVICE_AUTH_RESPONSE_INVALID');
  }
  let url;
  try { url = new URL(result.verificationUrl); } catch (_error) { url = null; }
  if (!url || url.origin !== 'https://auth.openai.com' || url.pathname !== '/codex/device'
    || url.search || url.hash || typeof result.userCode !== 'string'
    || !/^[A-Za-z0-9-]{3,32}$/.test(result.userCode)
    || typeof result.loginId !== 'string' || result.loginId.length < 1 || result.loginId.length > 100) {
    fail('DEVICE_AUTH_RESPONSE_INVALID');
  }
  return { verificationUrl: url.toString(), userCode: result.userCode, loginId: result.loginId, expiresAt: result.expiresAt };
}

function expiryMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string' && value.length <= 64) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function waitForHumanConfirmation(expiresAt, input = process.stdin, output = process.stderr) {
  const remaining = expiryMillis(expiresAt);
  const timeoutMs = Math.max(1, Math.min(CHECKPOINT_MAX_MS,
    remaining == null ? CHECKPOINT_MAX_MS : remaining - Date.now()));
  output.write('After completing the browser sign-in, type AUTHENTICATION_COMPLETED and press Enter.\n');
  const terminal = readline.createInterface({ input, output });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminal.close();
      reject(new AuthAbError('AUTH_AB_CHECKPOINT_TIMEOUT'));
    }, timeoutMs);
    terminal.once('line', (line) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      terminal.close();
      if (line.trim() !== 'AUTHENTICATION_COMPLETED') reject(new AuthAbError('AUTH_AB_HUMAN_CONFIRMATION_REQUIRED'));
      else resolve();
    });
    terminal.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AuthAbError('AUTH_AB_HUMAN_CONFIRMATION_REQUIRED'));
    });
  });
}

function failureEvidence(stage, failureCode, protocolMethods = [], rpc = null, attemptId = null, diagnostics = {}) {
  return projectSafeStageEvidence({
    stage,
    outcome: 'FAIL',
    failureCode,
    attemptId,
    observedAt: new Date().toISOString(),
    protocolMethods,
    rpc,
    phaseEgress: diagnostics.phaseEgress || [],
    ...(diagnostics.authTransportDiagnostic ? { authTransportDiagnostic: diagnostics.authTransportDiagnostic } : {}),
  }, stage);
}

async function runStage(stage, dependencies = {}) {
  if (!Object.hasOwn(VERSION_BY_STAGE, stage)) fail('AUTH_AB_RUN_FAILED');
  const now = dependencies.now || (() => new Date().toISOString());
  const uuid = dependencies.randomUUID || crypto.randomUUID;
  let state = new AuthAbStageState(stage);
  let rpc = null;
  let stageEvidence = null;
  const phaseEgress = [];
  let authTransportDiagnostic = null;
  const protocolMethods = [];
  const timestamps = {};
  const attemptId = uuid();
  try {
    validateRuntimeContainment();
    const egress = await verifyEgressProxy(dependencies.fetch || fetch);
    if (fs.readdirSync('/probe-home').length !== 0) fail('AUTH_AB_CONTAINMENT_FAILED');
    const identity = CONTRACT[stage];
    const attestations = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-attestations.json'), 'utf8'));
    if (attestations.schema !== 'SKYCOMMAND_CODEX_COMPAT_PROBE_PACKAGE_ATTESTATIONS_V1') fail('AUTH_AB_RUN_FAILED');
    const packageAttestation = attestations[stage];
    const packageEvidence = await inspectStage(stage, identity, packageAttestation, { skipRpcHandshake: true });
    const home = path.join('/probe-home', `${stage}-home`);
    const codexJsPath = path.join(ROOT, 'packages', stage, 'node_modules/@openai/codex/bin/codex.js');
    const schemaDigest = crypto.createHash('sha256')
      .update(JSON.stringify(packageEvidence.schemaFiles.map(({ name, sha256 }) => ({ name, sha256 }))))
      .digest('hex').toUpperCase();

    rpc = (dependencies.createRpcProcess || createRpcProcess)(codexJsPath, home,
      dependencies.spawnImpl, 'AUTH_AB');
    await captureProxyPhase('APP_SERVER_STARTUP', async () => {
      await rpc.start();
      await new Promise((resolve) => setTimeout(resolve, APP_SERVER_STARTUP_SETTLE_MS));
    }, { fetch: dependencies.fetch || fetch, onPhase: (phase) => phaseEgress.push(phase) });
    protocolMethods.push('initialize');
    const initializePhase = await captureProxyPhase('INITIALIZE', async () => {
      const envelope = validateRpcEnvelope(await rpc.request('initialize', {
        clientInfo: { name: 'skycommand-isolated-codex-auth-ab', title: 'SkyCommand Isolated Auth A/B', version: '1' },
        capabilities: {},
      }, RPC_IDS.initialize, 20000, 'INITIALIZE_TIMEOUT'), RPC_IDS.initialize);
      if (!envelope.valid) fail('INITIALIZE_ENVELOPE_INVALID');
      if (envelope.kind === 'ERROR') fail('INITIALIZE_RPC_ERROR');
      validateInitializeResult(envelope.result);
      rpc.notify('initialized', {});
      return envelope;
    }, { fetch: dependencies.fetch || fetch, onPhase: (phase) => phaseEgress.push(phase) });
    const initialized = initializePhase.result;
    state.initialized();
    timestamps.initializedAt = now();
    await captureProxyPhase('POST_INITIALIZE_IDLE', () => new Promise((resolve) => {
      setTimeout(resolve, POST_INITIALIZE_IDLE_MS);
    }), { fetch: dependencies.fetch || fetch, onPhase: (phase) => phaseEgress.push(phase) });

    state.deviceAuthStarted();
    protocolMethods.push('account/login/start');
    timestamps.deviceAuthStartedAt = now();
    const loginPhase = await captureProxyPhase('ACCOUNT_LOGIN_START', () => rpc.request('account/login/start', {
      type: 'chatgptDeviceCode',
    }, RPC_IDS.loginStart, 45000, 'DEVICE_AUTH_START_TIMEOUT'), {
      fetch: dependencies.fetch || fetch,
      onPhase: (phase) => phaseEgress.push(phase),
    });
    phaseEgress.push(aliasDeviceUserCodePhase(loginPhase.phaseEvidence));
    let loginResponse;
    let checkpoint = null;
    const processing = await captureProxyPhase('POST_REQUEST_PROCESSING', () => {
      loginResponse = validateRpcEnvelope(loginPhase.result, RPC_IDS.loginStart);
      if (!loginResponse.valid) fail('DEVICE_AUTH_ENVELOPE_INVALID');
      if (loginResponse.kind === 'ERROR') {
        authTransportDiagnostic = classifyAuthTransportDiagnostic(
          loginResponse.code, loginPhase.result?.error?.message, loginPhase.phaseEvidence,
        );
        return { kind: 'ERROR' };
      }
      checkpoint = validateDeviceCheckpoint(loginResponse.result);
      authTransportDiagnostic = {
        method: 'account/login/start',
        rpcCode: null,
        transportClassification: 'HTTP_RESPONSE_RECEIVED',
        tlsOutcome: 'SUCCEEDED',
        httpResponse: 'RECEIVED',
        httpStatusClass: '2XX',
        responseParse: 'SUCCEEDED',
        rpcMapping: 'NONE',
      };
      return { kind: 'RESULT' };
    }, { fetch: dependencies.fetch || fetch, onPhase: (phase) => phaseEgress.push(phase) });
    if (processing.result.kind === 'ERROR') {
      stageEvidence = failureEvidence(stage, 'DEVICE_AUTH_RPC_ERROR', protocolMethods, {
        method: 'account/login/start', requestId: loginResponse.id,
        outcome: 'JSON_RPC_ERROR', rpcCode: loginResponse.code, observedAt: now(),
      }, attemptId, { phaseEgress, authTransportDiagnostic });
      state.fail();
      return stageEvidence;
    }
    loginResponse.result = null;
    state.checkpointPresented();
    timestamps.checkpointPresentedAt = now();
    process.stderr.write('\nHUMAN DEVICE-CODE CHECKPOINT (transient; do not copy into evidence)\n');
    process.stderr.write(`Verification URL: ${checkpoint.verificationUrl}\nUser code: ${checkpoint.userCode}\n`);
    const checkpointExpiry = checkpoint.expiresAt;
    checkpoint.verificationUrl = '';
    checkpoint.userCode = '';
    checkpoint.loginId = '';
    checkpoint.expiresAt = null;
    await (dependencies.waitForHumanConfirmation || waitForHumanConfirmation)(checkpointExpiry,
      dependencies.input || process.stdin, dependencies.output || process.stderr);
    state.humanConfirmed();
    timestamps.humanConfirmedAt = now();
    protocolMethods.push('account/read');
    let accountResponse;
    try {
      accountResponse = await rpc.request('account/read', { refreshToken: false }, RPC_IDS.accountRead,
        30000, 'ACCOUNT_READ_TIMEOUT');
    } catch (error) {
      const failureCode = error instanceof ProbeError && SAFE_FAILURE_CODES.has(error.code)
        ? error.code : 'ACCOUNT_READ_TIMEOUT';
      const outcome = failureCode === 'ACCOUNT_READ_TIMEOUT' ? 'TIMEOUT' : 'TRANSPORT_ERROR';
      stageEvidence = failureEvidence(stage, failureCode, protocolMethods, {
        method: 'account/read', requestId: RPC_IDS.accountRead, outcome, rpcCode: null, observedAt: now(),
      }, attemptId);
      state.fail();
      return stageEvidence;
    }
    const accountEnvelope = validateRpcEnvelope(accountResponse, RPC_IDS.accountRead);
    if (!accountEnvelope.valid) fail('ACCOUNT_READ_ENVELOPE_INVALID');
    timestamps.accountReadAt = now();
    state.postAuthAccountReadCompleted();
    if (accountEnvelope.kind === 'ERROR') {
      stageEvidence = failureEvidence(stage, 'ACCOUNT_READ_RPC_ERROR', protocolMethods, {
        method: 'account/read', requestId: accountEnvelope.id,
        outcome: 'JSON_RPC_ERROR', rpcCode: accountEnvelope.code, observedAt: timestamps.accountReadAt,
      }, attemptId);
      return stageEvidence;
    }
    const account = accountEnvelope.result;
    const projection = projectAccountRead(account);
    if (!projection.parseable) fail('ACCOUNT_READ_RESULT_INVALID');
    const authenticatedState = projection.accountState === 'ACCOUNT_NULL' || projection.requiresOpenaiAuth
      ? 'UNAUTHENTICATED'
      : (account.account?.type === 'chatgpt' ? 'AUTHENTICATED' : 'UNKNOWN');
    const notification = rpc.notificationEvents.at(-1) || null;
    const result = {
      stage,
      outcome: 'OBSERVED',
      identity: {
        expectedVersion: VERSION_BY_STAGE[stage],
        observedVersion: packageEvidence.observedVersion,
        wrapperIntegrity: identity.wrapperIntegrity,
        platformIntegrity: identity.platformIntegrity,
        packageLockSha256: packageEvidence.packageLockSha256,
        installedArtifactSha256: packageEvidence.installedArtifactSha256,
        schemaTreeSha256: schemaDigest,
      },
      attemptId,
      protocolMethods,
      authenticatedState,
      accountState: projection.accountState,
      accountReadRpc: {
        method: 'account/read', requestId: accountEnvelope.id, outcome: 'RESULT', rpcCode: null,
        observedAt: timestamps.accountReadAt,
      },
      latestRelevantNotification: notification,
      timestamps,
      egressPolicyDigest: egress.policyDigest,
      phaseEgress,
      authTransportDiagnostic,
      observedAt: now(),
    };
    stageEvidence = projectSafeStageEvidence(result, stage);
    return stageEvidence;
  } catch (error) {
    const code = error instanceof AuthAbError || error instanceof ProbeError
      ? error.code : 'AUTH_AB_RUN_FAILED';
    state.fail();
    stageEvidence = failureEvidence(stage, SAFE_FAILURE_CODES.has(code) ? code : 'AUTH_AB_RUN_FAILED',
      protocolMethods, null, attemptId, { phaseEgress, authTransportDiagnostic });
    return stageEvidence;
  } finally {
    if (rpc) await rpc.stop().catch(() => {});
    // Provider response objects, login reference, URL, and user code are intentionally not retained.
  }
}

async function main() {
  const stage = process.argv[2];
  let evidence = await runStage(stage);
  process.stdout.write(`SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify(evidence)}\n`);
  if (evidence.outcome === 'FAIL') process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    const stage = ['baseline', 'candidate'].includes(process.argv[2]) ? process.argv[2] : 'baseline';
    const evidence = failureEvidence(stage, 'AUTH_AB_RUN_FAILED');
    process.stdout.write(`SKYCOMMAND_AUTH_AB_RESULT_V1 ${JSON.stringify(evidence)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_POLICY_HOSTS,
  POLICY_DIGEST,
  RPC_IDS,
  aliasDeviceUserCodePhase,
  captureProxyPhase,
  classifyAuthTransportDiagnostic,
  runStage,
  validateDeviceCheckpoint,
  validateAuthAbSnapshot,
  validateRuntimeContainment,
  waitForHumanConfirmation,
};
