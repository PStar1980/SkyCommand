'use strict';

const ORDER = Object.freeze(['baseline', 'candidate']);
const VERSION_BY_STAGE = Object.freeze({ baseline: '0.155.0-alpha.9.2', candidate: '0.156.1' });
const AUTH_AB_METHODS = Object.freeze(['initialize', 'account/read', 'account/login/start']);
const AUTH_AB_SUCCESS_METHOD_ORDER = Object.freeze(['initialize', 'account/login/start', 'account/read']);
const AUTH_AB_PHASES = Object.freeze([
  'APP_SERVER_STARTUP', 'INITIALIZE', 'POST_INITIALIZE_IDLE', 'ACCOUNT_LOGIN_START',
  'DEVICE_CODE_USER_CODE_REQUEST', 'POST_REQUEST_PROCESSING',
]);
const AUTH_AB_TRANSPORT_CLASSIFICATIONS = new Set([
  'DNS_FAILURE', 'CONNECT_FAILURE', 'TLS_FAILURE', 'HTTP_RESPONSE_RECEIVED',
  'RESPONSE_PARSE_FAILURE', 'RPC_MAPPING_FAILURE', 'UNKNOWN',
]);
const SAFE_FAILURE_CODES = new Set([
  'AUTH_AB_CONTAINMENT_FAILED', 'AUTH_AB_EGRESS_POLICY_MISMATCH', 'AUTH_AB_CHECKPOINT_TIMEOUT',
  'AUTH_AB_HUMAN_CONFIRMATION_REQUIRED', 'AUTH_AB_STAGE_OUTPUT_INVALID', 'AUTH_AB_RUN_FAILED',
  'DEVICE_AUTH_START_TIMEOUT',
  'DEVICE_AUTH_ENVELOPE_INVALID', 'DEVICE_AUTH_RPC_ERROR', 'DEVICE_AUTH_RESPONSE_INVALID',
  'INITIALIZE_TIMEOUT', 'INITIALIZE_ENVELOPE_INVALID', 'INITIALIZE_RPC_ERROR', 'INITIALIZE_RESULT_INVALID',
  'ACCOUNT_READ_ENVELOPE_INVALID', 'ACCOUNT_READ_RPC_ERROR', 'ACCOUNT_READ_RESULT_INVALID', 'ACCOUNT_READ_TIMEOUT',
  'APP_SERVER_START_FAILED', 'APP_SERVER_EXITED', 'APP_SERVER_STDIO_INVALID',
  'CLI_VERSION_COMMAND_FAILED', 'CLI_VERSION_MISMATCH', 'PACKAGE_LOCK_UNAVAILABLE',
  'PACKAGE_LOCK_IDENTITY_MISMATCH', 'PACKAGE_MANIFEST_INVALID', 'INSTALLED_ARTIFACT_MISMATCH',
  'SCHEMA_GENERATION_FAILED', 'SCHEMA_BUNDLE_INVALID', 'REQUIRED_SCHEMA_SURFACE_MISSING',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[A-F0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;

class AuthAbError extends Error {
  constructor(code, safeResults = []) {
    super(code);
    this.name = 'AuthAbError';
    this.code = SAFE_FAILURE_CODES.has(code) ? code : 'AUTH_AB_RUN_FAILED';
    this.safeResults = safeResults;
  }
}

class AuthAbStageState {
  constructor(stage) {
    if (!ORDER.includes(stage)) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    this.stage = stage;
    this.state = 'PREPARED';
    this.deviceAuthStarts = 0;
    this.postAuthAccountReads = 0;
  }

  initialized() {
    if (this.state !== 'PREPARED') throw new AuthAbError('AUTH_AB_RUN_FAILED');
    this.state = 'INITIALIZED';
  }

  deviceAuthStarted() {
    if (this.state !== 'INITIALIZED' || this.deviceAuthStarts !== 0) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    this.deviceAuthStarts += 1;
    this.state = 'DEVICE_AUTH_PENDING';
  }

  checkpointPresented() {
    if (this.state !== 'DEVICE_AUTH_PENDING') throw new AuthAbError('AUTH_AB_RUN_FAILED');
    this.state = 'PENDING_USER';
  }

  humanConfirmed() {
    if (this.state !== 'PENDING_USER') throw new AuthAbError('AUTH_AB_HUMAN_CONFIRMATION_REQUIRED');
    this.state = 'HUMAN_CONFIRMED';
  }

  postAuthAccountReadCompleted() {
    if (this.state !== 'HUMAN_CONFIRMED' || this.postAuthAccountReads !== 0) throw new AuthAbError('AUTH_AB_RUN_FAILED');
    this.postAuthAccountReads += 1;
    this.state = 'RECONCILED';
  }

  fail() {
    if (this.state !== 'DISCARDED') this.state = 'FAILED';
  }

  discarded() {
    if (!['PREPARED', 'INITIALIZED', 'DEVICE_AUTH_PENDING', 'PENDING_USER', 'HUMAN_CONFIRMED', 'RECONCILED', 'FAILED'].includes(this.state)) {
      throw new AuthAbError('AUTH_AB_RUN_FAILED');
    }
    this.state = 'DISCARDED';
  }
}

function isTimestamp(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function projectSafePhaseEgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !AUTH_AB_PHASES.includes(value.phase)
    || !['PROXY_PHASE_CURSOR', 'RPC_ENVELOPE_ALIAS'].includes(value.boundarySource)
    || !/^\d{1,40}$/.test(value.startedMonotonicNs || '')
    || !/^\d{1,40}$/.test(value.endedMonotonicNs || '')
    || BigInt(value.endedMonotonicNs) < BigInt(value.startedMonotonicNs)
    || !Number.isSafeInteger(value.beforeCursor) || value.beforeCursor < 0
    || !Number.isSafeInteger(value.afterCursor) || value.afterCursor < value.beforeCursor
    || !Number.isSafeInteger(value.beforeCount) || value.beforeCount < 0 || value.beforeCount > 80
    || !Number.isSafeInteger(value.afterCount) || value.afterCount < 0 || value.afterCount > 80
    || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 80
    || !Array.isArray(value.events) || value.events.length > 80) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  if (value.boundarySource === 'RPC_ENVELOPE_ALIAS'
    && (value.phase !== 'DEVICE_CODE_USER_CODE_REQUEST'
      || value.correlatedPhase !== 'ACCOUNT_LOGIN_START')) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  if (value.boundarySource === 'PROXY_PHASE_CURSOR' && value.correlatedPhase != null) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  const events = value.events.map((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || !Number.isSafeInteger(event.cursor) || event.cursor <= value.beforeCursor || event.cursor > value.afterCursor
      || !['APPROVED_AUTH_HOST', 'OTHER_HOST_REDACTED'].includes(event.destinationClassification)
      || !SHA256.test(event.destinationFingerprint || '')
      || !Number.isSafeInteger(event.port) || event.port < 1 || event.port > 65535
      || !['ALLOW', 'DENY'].includes(event.decision)
      || !['INVALID_AUTHORITY', 'DNS_LOOKUP_FAILED', 'PORT_NOT_ALLOWED', 'HOST_NOT_ALLOWLISTED',
        'NON_PUBLIC_DNS_RESULT', 'UPSTREAM_CONNECT_FAILED', 'PUBLIC_ALLOWLISTED_TLS'].includes(event.reason)
      || !isTimestamp(event.observedAt)
      || !/^\d{1,40}$/.test(event.observedMonotonicNs || '')
      || !Number.isSafeInteger(event.count) || event.count !== 1) {
      throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
    }
    return {
      cursor: event.cursor,
      destinationClassification: event.destinationClassification,
      destinationFingerprint: event.destinationFingerprint,
      port: event.port,
      decision: event.decision,
      reason: event.reason,
      observedAt: event.observedAt,
      observedMonotonicNs: event.observedMonotonicNs,
      count: event.count,
    };
  });
  if (events.reduce((total, event) => total + event.count, 0) !== value.count) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  return {
    phase: value.phase,
    boundarySource: value.boundarySource,
    ...(value.boundarySource === 'RPC_ENVELOPE_ALIAS' ? { correlatedPhase: value.correlatedPhase } : {}),
    startedMonotonicNs: value.startedMonotonicNs,
    endedMonotonicNs: value.endedMonotonicNs,
    beforeCursor: value.beforeCursor,
    afterCursor: value.afterCursor,
    beforeCount: value.beforeCount,
    afterCount: value.afterCount,
    count: value.count,
    events,
  };
}

function projectSafePhaseEgressList(value) {
  if (!Array.isArray(value) || value.length > AUTH_AB_PHASES.length) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  const phases = value.map(projectSafePhaseEgress);
  const indexes = phases.map((phase) => AUTH_AB_PHASES.indexOf(phase.phase));
  if (indexes.some((index, position) => index < 0 || (position > 0 && index <= indexes[position - 1]))) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  if (phases.some((phase) => phase.phase === 'DEVICE_CODE_USER_CODE_REQUEST')
    && !phases.some((phase) => phase.phase === 'ACCOUNT_LOGIN_START')) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  const alias = phases.find((phase) => phase.phase === 'DEVICE_CODE_USER_CODE_REQUEST');
  const account = phases.find((phase) => phase.phase === 'ACCOUNT_LOGIN_START');
  if (alias && account && (alias.beforeCursor !== account.beforeCursor || alias.afterCursor !== account.afterCursor
    || alias.startedMonotonicNs !== account.startedMonotonicNs || alias.endedMonotonicNs !== account.endedMonotonicNs
    || JSON.stringify(alias.events) !== JSON.stringify(account.events))) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  return phases;
}

function projectSafeAuthTransportDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.method !== 'account/login/start'
    || (value.rpcCode !== null && !Number.isSafeInteger(value.rpcCode))
    || !AUTH_AB_TRANSPORT_CLASSIFICATIONS.has(value.transportClassification)
    || !['FAILED', 'SUCCEEDED', 'NOT_REACHED', 'UNKNOWN'].includes(value.tlsOutcome)
    || !['RECEIVED', 'NOT_OBSERVED', 'UNKNOWN'].includes(value.httpResponse)
    || (value.httpStatusClass !== null && !['1XX', '2XX', '3XX', '4XX', '5XX'].includes(value.httpStatusClass))
    || !['SUCCEEDED', 'FAILED', 'NOT_REACHED', 'UNKNOWN'].includes(value.responseParse)
    || !['INTERNAL_ERROR', 'NONE', 'UNKNOWN'].includes(value.rpcMapping)) {
    throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  }
  const consistent = value.transportClassification === 'DNS_FAILURE'
    ? value.httpResponse === 'NOT_OBSERVED' && value.httpStatusClass === null
      && value.responseParse === 'NOT_REACHED' && value.tlsOutcome === 'NOT_REACHED'
    : value.transportClassification === 'CONNECT_FAILURE'
      ? value.httpResponse === 'NOT_OBSERVED' && value.httpStatusClass === null
        && value.responseParse === 'NOT_REACHED' && value.tlsOutcome === 'NOT_REACHED'
      : value.transportClassification === 'TLS_FAILURE'
        ? value.httpResponse === 'NOT_OBSERVED' && value.httpStatusClass === null
          && value.responseParse === 'NOT_REACHED' && value.tlsOutcome === 'FAILED'
        : value.transportClassification === 'HTTP_RESPONSE_RECEIVED'
          ? value.httpResponse === 'RECEIVED' && value.httpStatusClass !== null
            && value.tlsOutcome === 'SUCCEEDED'
          : value.transportClassification === 'RESPONSE_PARSE_FAILURE'
            ? value.httpResponse === 'RECEIVED' && value.httpStatusClass === '2XX'
              && value.responseParse === 'FAILED' && value.tlsOutcome === 'SUCCEEDED'
            : value.transportClassification === 'RPC_MAPPING_FAILURE'
              ? value.rpcCode === -32603 && value.rpcMapping === 'INTERNAL_ERROR'
              : true;
  if (!consistent) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  return {
    method: value.method,
    rpcCode: value.rpcCode,
    transportClassification: value.transportClassification,
    tlsOutcome: value.tlsOutcome,
    httpResponse: value.httpResponse,
    httpStatusClass: value.httpStatusClass,
    responseParse: value.responseParse,
    rpcMapping: value.rpcMapping,
  };
}

function projectSafeStageEvidence(value, expectedStage = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  const stage = value.stage;
  if (!ORDER.includes(stage) || (expectedStage && stage !== expectedStage)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  const failureCode = value.failureCode == null ? null : value.failureCode;
  if (failureCode !== null && !SAFE_FAILURE_CODES.has(failureCode)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
  if (value.outcome === 'FAIL') {
    const failed = {
      schema: 'SKYCOMMAND_CODEX_AUTH_AB_STAGE_RESULT_V1',
      stage,
      outcome: 'FAIL',
      failureCode: failureCode || 'AUTH_AB_RUN_FAILED',
      observedAt: isTimestamp(value.observedAt) ? value.observedAt : new Date(0).toISOString(),
    };
    if (UUID.test(value.attemptId || '')) failed.attemptId = value.attemptId;
    if (Array.isArray(value.protocolMethods)) {
      failed.protocolMethods = [...new Set(value.protocolMethods.filter((method) => AUTH_AB_METHODS.includes(method)))];
    }
    if (value.rpc && AUTH_AB_METHODS.includes(value.rpc.method)
      && Number.isSafeInteger(value.rpc.requestId)
      && ['RESULT', 'JSON_RPC_ERROR', 'TIMEOUT', 'TRANSPORT_ERROR'].includes(value.rpc.outcome)
      && (value.rpc.rpcCode == null || Number.isSafeInteger(value.rpc.rpcCode))
      && isTimestamp(value.rpc.observedAt)) {
      failed.rpc = {
        method: value.rpc.method,
        requestId: value.rpc.requestId,
        outcome: value.rpc.outcome,
        rpcCode: value.rpc.rpcCode ?? null,
        observedAt: value.rpc.observedAt,
      };
    }
    if (Array.isArray(value.phaseEgress)) failed.phaseEgress = projectSafePhaseEgressList(value.phaseEgress);
    if (value.authTransportDiagnostic) {
      failed.authTransportDiagnostic = projectSafeAuthTransportDiagnostic(value.authTransportDiagnostic);
    }
    return failed;
  }
  const identity = value.identity;
  if (value.outcome !== 'OBSERVED' || !identity || identity.expectedVersion !== VERSION_BY_STAGE[stage]
    || identity.observedVersion !== VERSION_BY_STAGE[stage]
    || !SHA256.test(identity.packageLockSha256 || '')
    || !SHA256.test(identity.installedArtifactSha256 || '')
    || !SHA256.test(identity.schemaTreeSha256 || '')
    || !SHA512_SRI.test(identity.wrapperIntegrity || '') || Buffer.from(identity.wrapperIntegrity.slice(7), 'base64').length !== 64
    || !SHA512_SRI.test(identity.platformIntegrity || '') || Buffer.from(identity.platformIntegrity.slice(7), 'base64').length !== 64
    || !UUID.test(value.attemptId || '')
    || !['AUTHENTICATED', 'UNAUTHENTICATED', 'UNKNOWN'].includes(value.authenticatedState)
    || !['ACCOUNT_PRESENT', 'ACCOUNT_NULL', 'UNKNOWN'].includes(value.accountState)
    || !Array.isArray(value.protocolMethods)
    || value.protocolMethods.some((method) => !AUTH_AB_METHODS.includes(method))
    || JSON.stringify(value.protocolMethods) !== JSON.stringify(AUTH_AB_SUCCESS_METHOD_ORDER)
    || !SHA256.test(value.egressPolicyDigest || '')
    || !isTimestamp(value.timestamps?.initializedAt)
    || !isTimestamp(value.timestamps?.deviceAuthStartedAt)
    || !isTimestamp(value.timestamps?.checkpointPresentedAt)
    || !isTimestamp(value.timestamps?.humanConfirmedAt)
    || !isTimestamp(value.timestamps?.accountReadAt)
    || !isTimestamp(value.observedAt)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');

  const rpc = value.accountReadRpc;
  if (!rpc || rpc.method !== 'account/read' || !Number.isSafeInteger(rpc.requestId)
    || !['RESULT', 'JSON_RPC_ERROR'].includes(rpc.outcome)
    || (rpc.rpcCode !== null && !Number.isSafeInteger(rpc.rpcCode))
    || !isTimestamp(rpc.observedAt)) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');

  const notification = value.latestRelevantNotification || null;
  if (notification && (!['account/login/completed', 'account/updated'].includes(notification.type)
    || !isTimestamp(notification.observedAt))) throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');

  return {
    schema: 'SKYCOMMAND_CODEX_AUTH_AB_STAGE_RESULT_V1',
    stage,
    outcome: 'OBSERVED',
    expectedVersion: identity.expectedVersion,
    observedVersion: identity.observedVersion,
    packageIdentity: {
      wrapperIntegrity: identity.wrapperIntegrity,
      platformIntegrity: identity.platformIntegrity,
      packageLockSha256: identity.packageLockSha256,
      installedArtifactSha256: identity.installedArtifactSha256,
      schemaTreeSha256: identity.schemaTreeSha256,
    },
    ...(SHA256.test(value.egressPolicyDigest || '') ? { egressPolicyDigest: value.egressPolicyDigest } : {}),
    attemptId: value.attemptId,
    protocolMethods: [...new Set(value.protocolMethods)],
    resultCategory: value.authenticatedState,
    authenticatedState: value.authenticatedState,
    accountState: value.accountState,
    accountReadRpc: {
      method: rpc.method,
      requestId: rpc.requestId,
      outcome: rpc.outcome,
      rpcCode: rpc.rpcCode,
      observedAt: rpc.observedAt,
    },
    latestRelevantNotification: notification,
    ...(Array.isArray(value.phaseEgress) ? { phaseEgress: projectSafePhaseEgressList(value.phaseEgress) } : {}),
    ...(value.authTransportDiagnostic
      ? { authTransportDiagnostic: projectSafeAuthTransportDiagnostic(value.authTransportDiagnostic) } : {}),
    timestamps: {
      initializedAt: value.timestamps.initializedAt,
      deviceAuthStartedAt: value.timestamps.deviceAuthStartedAt,
      checkpointPresentedAt: value.timestamps.checkpointPresentedAt,
      humanConfirmedAt: value.timestamps.humanConfirmedAt,
      accountReadAt: value.timestamps.accountReadAt,
    },
    observedAt: value.observedAt,
  };
}

function isAcceptedBaselineDeviceAuthFailure(result) {
  const expectedMethods = ['initialize', 'account/login/start'];
  return result?.schema === 'SKYCOMMAND_CODEX_AUTH_AB_STAGE_RESULT_V1'
    && result.stage === 'baseline' && result.outcome === 'FAIL'
    && result.failureCode === 'DEVICE_AUTH_RPC_ERROR'
    && UUID.test(result.attemptId || '')
    && JSON.stringify(result.protocolMethods) === JSON.stringify(expectedMethods)
    && isTimestamp(result.observedAt) && result.observedAt !== new Date(0).toISOString()
    && result.rpc?.method === 'account/login/start'
    && result.rpc.requestId === 302
    && result.rpc.outcome === 'JSON_RPC_ERROR' && result.rpc.rpcCode === -32603
    && isTimestamp(result.rpc.observedAt);
}

class AuthAbSequencer {
  constructor(adapter) {
    this.adapter = adapter;
    this.activeStage = null;
    this.completed = [];
  }

  async execute(priorBaselineResult = null) {
    if (!this.adapter || typeof this.adapter.assertFresh !== 'function') throw new AuthAbError('AUTH_AB_RUN_FAILED');
    await this.adapter.assertFresh();
    let comparativeBaselineFailure = false;
    let stages = ORDER;
    if (priorBaselineResult !== null) {
      if (!priorBaselineResult || priorBaselineResult.schema !== 'SKYCOMMAND_CODEX_AUTH_AB_STAGE_RESULT_V1') {
        throw new AuthAbError('AUTH_AB_STAGE_OUTPUT_INVALID');
      }
      const priorBaseline = projectSafeStageEvidence(priorBaselineResult, 'baseline');
      if (!isAcceptedBaselineDeviceAuthFailure(priorBaseline)) throw new AuthAbError('AUTH_AB_RUN_FAILED', [priorBaseline]);
      priorBaseline.egressDiagnostics = {
        stage: 'baseline',
        availability: 'NOT_CAPTURED_PRIOR_RUN',
        beforeCount: null,
        afterCount: null,
        count: 0,
        events: [],
      };
      this.completed.push(priorBaseline);
      comparativeBaselineFailure = true;
      stages = ['candidate'];
      try {
        // Reconcile the isolated project to down, then prove no prior disposable resources remain.
        await this.adapter.teardown('baseline');
        await this.adapter.verifyDiscarded('baseline');
        if (typeof this.adapter.markDiscarded === 'function') await this.adapter.markDiscarded('baseline');
      } catch (_error) {
        throw new AuthAbError('AUTH_AB_RUN_FAILED', this.completed);
      }
    }
    for (const stage of stages) {
      if (stage === 'candidate' && (!this.completed.some((item) => item.stage === 'baseline')
        || this.activeStage !== null)) throw new AuthAbError('AUTH_AB_RUN_FAILED', this.completed);
      this.activeStage = stage;
      let result;
      let stageError = null;
      let proxyStarted = false;
      let afterDiagnosticsAttempted = false;
      let beforeDiagnostics = null;
      try {
        await this.adapter.startProxy(stage);
        proxyStarted = true;
        beforeDiagnostics = await this.adapter.captureProxyDiagnostics(stage);
        if (!beforeDiagnostics || beforeDiagnostics.stage !== stage || beforeDiagnostics.count !== 0) {
          throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
        }
        result = projectSafeStageEvidence(await this.adapter.runVersion(stage), stage);
        afterDiagnosticsAttempted = true;
        const afterDiagnostics = await this.adapter.captureProxyDiagnostics(stage);
        result.egressDiagnostics = this.adapter.correlateStageEgress
          ? this.adapter.correlateStageEgress(beforeDiagnostics, afterDiagnostics, stage)
          : null;
        if (!result.egressDiagnostics) throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
        if (this.adapter.hasEgressPolicyViolation(result.egressDiagnostics)) {
          stageError = new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH', [...this.completed, result]);
        } else if (result.outcome === 'OBSERVED') {
          this.completed.push(result);
        } else if (stage === 'baseline' && isAcceptedBaselineDeviceAuthFailure(result)) {
          // Preserve the baseline as FAIL; this exact terminal pre-checkpoint error only permits comparison with B.
          this.completed.push(result);
          comparativeBaselineFailure = true;
        } else {
          stageError = new AuthAbError(result.failureCode, [...this.completed, result]);
        }
      } catch (error) {
        const code = error instanceof AuthAbError ? error.code : 'AUTH_AB_RUN_FAILED';
        stageError = new AuthAbError(code, [...this.completed, ...(result ? [result] : [])]);
      } finally {
        if (proxyStarted && !afterDiagnosticsAttempted) {
          afterDiagnosticsAttempted = true;
          try {
            const afterDiagnostics = await this.adapter.captureProxyDiagnostics(stage);
            if (beforeDiagnostics) {
              const evidence = this.adapter.correlateStageEgress
                ? this.adapter.correlateStageEgress(beforeDiagnostics, afterDiagnostics, stage) : null;
              if (!evidence) throw new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH');
              if (result) result.egressDiagnostics = evidence;
              if (this.adapter.hasEgressPolicyViolation(evidence)) {
                stageError = new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH',
                  [...this.completed, ...(result ? [result] : [])]);
              }
            }
          } catch (_error) {
            stageError = new AuthAbError('AUTH_AB_EGRESS_POLICY_MISMATCH',
              [...this.completed, ...(result ? [result] : [])]);
          }
        }
        try {
          await this.adapter.teardown(stage);
          await this.adapter.verifyDiscarded(stage);
          if (typeof this.adapter.markDiscarded === 'function') await this.adapter.markDiscarded(stage);
        } catch (_error) {
          stageError = new AuthAbError('AUTH_AB_RUN_FAILED',
            [...this.completed, ...(result && !this.completed.includes(result) ? [result] : [])]);
        }
        this.activeStage = null;
      }
      if (stageError) throw new AuthAbError(stageError.code, stageError.safeResults?.length ? stageError.safeResults : this.completed);
    }
    return {
      schema: 'SKYCOMMAND_CODEX_AUTH_AB_RESULT_V1',
      outcome: comparativeBaselineFailure ? 'COMPARISON_COMPLETE' : 'PASS',
      stages: this.completed,
    };
  }
}

module.exports = {
  AUTH_AB_METHODS,
  AUTH_AB_SUCCESS_METHOD_ORDER,
  AuthAbError,
  AuthAbSequencer,
  AuthAbStageState,
  AUTH_AB_PHASES,
  AUTH_AB_TRANSPORT_CLASSIFICATIONS,
  isAcceptedBaselineDeviceAuthFailure,
  ORDER,
  SAFE_FAILURE_CODES,
  VERSION_BY_STAGE,
  projectSafeStageEvidence,
  projectSafePhaseEgress,
  projectSafePhaseEgressList,
  projectSafeAuthTransportDiagnostic,
};
