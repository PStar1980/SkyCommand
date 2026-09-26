'use strict';

const crypto = require('node:crypto');
const { AUTH_AB_PHASES, projectSafePhaseEgressList } = require('./auth-ab/contract');
const { CONTRACT } = require('./contract');

const CODEX_VERSION = '0.154.0';
const INSTALLATION_CODE = 'phase19-3a0-managed-codex';
const APPROVED_PROVIDER_HOST = 'auth.openai.com';
const APPROVED_PROVIDER_PORT = 443;
const APPROVED_PREFLIGHT_PROVIDER_HOSTS = Object.freeze(['auth.openai.com', 'chatgpt.com']);
const ACCOUNT_STATES = new Set(['UNCONFIGURED', 'CONFIGURED', 'DISABLED', 'REVOKED', 'UNKNOWN']);
const READINESS_BLOCKERS = new Set([
  'ACCOUNT_UNENROLLED', 'PROVIDER_UNREACHABLE', 'PROVIDER_REACHABILITY_UNKNOWN',
]);
const ENROLLMENT_STATES = new Set([
  'CREATED', 'AUTHENTICATING', 'PENDING_USER', 'COMPLETED', 'FAILED', 'EXPIRED',
  'CANCELLED', 'REVOKED', 'RECONCILIATION_REQUIRED', 'UNCLASSIFIED',
]);
const ACTIVE_ENROLLMENT_STATES = new Set([
  'CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED',
]);
const TERMINAL_LIFECYCLE_STATES = new Set(['SUCCEEDED', 'FAILED']);
const SUPERVISOR_TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const LIFECYCLE_SCHEMA_VERSION = 2;
const MAX_LIFECYCLE_HISTORY = 8;
const LEGACY_FAILURE_RECONCILIATION_BASIS = 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY';
const PREFLIGHT_BLOCKER_CODES = new Set([
  'AUTH_BOUNDARY_PREFLIGHT_BLOCKED',
  'AUTH_BOUNDARY_ENROLLMENT_ACTIVE',
  'AUTH_BOUNDARY_ENROLLMENT_UNRESOLVED',
  'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED',
  'AUTH_BOUNDARY_ACCOUNT_STATE_UNKNOWN',
  'AUTH_BOUNDARY_SUPERVISOR_OFFLINE',
  'AUTH_BOUNDARY_SUPERVISOR_OPERATION_ACTIVE',
  'AUTH_BOUNDARY_LIFECYCLE_UNCERTAIN',
  'AUTH_BOUNDARY_LIFECYCLE_UNRECONCILED',
  'AUTH_BOUNDARY_LIFECYCLE_HISTORY_INVALID',
  'AUTH_BOUNDARY_LIFECYCLE_CONTRADICTORY',
  'AUTH_BOUNDARY_RUNTIME_NOT_CURRENT',
  'AUTH_BOUNDARY_EXECUTION_ENABLED',
]);
const OUTCOME_CATEGORIES = new Set([
  'LOGIN_START_FAILURE', 'PROVIDER_LOGIN_FAILURE', 'AUTHENTICATED_ACCOUNT_READ_SUCCESS',
  'AUTHENTICATED_ACCOUNT_READ_FAILURE', 'PROVIDER_OUTCOME_UNCERTAIN',
]);
const SAFE_FAILURE_CODES = new Set([
  'DEVICE_AUTH_RPC_ERROR', 'DEVICE_AUTH_START_TIMEOUT', 'DEVICE_AUTH_ENVELOPE_INVALID',
  'DEVICE_AUTH_RESPONSE_INVALID', 'PROVIDER_LOGIN_FAILED', 'PROVIDER_OUTCOME_UNCERTAIN',
  'ACCOUNT_READ_RPC_ERROR', 'ACCOUNT_READ_TIMEOUT', 'ACCOUNT_READ_RESULT_INVALID',
  'AUTH_BOUNDARY_PREFLIGHT_INVALID', 'AUTH_BOUNDARY_PREFLIGHT_BLOCKED',
  ...PREFLIGHT_BLOCKER_CODES,
  'AUTH_BOUNDARY_ORDER_INVALID', 'AUTH_BOUNDARY_IDENTITY_INVALID',
  'AUTH_BOUNDARY_EVIDENCE_INVALID', 'AUTH_BOUNDARY_CLEANUP_UNVERIFIED',
]);
const ALLOWED_METHODS = Object.freeze(['initialize', 'account/login/start', 'account/read']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[A-F0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

class AuthBoundaryError extends Error {
  constructor(code) {
    super(SAFE_FAILURE_CODES.has(code) ? code : 'AUTH_BOUNDARY_ORDER_INVALID');
    this.name = 'AuthBoundaryError';
    this.code = SAFE_FAILURE_CODES.has(code) ? code : 'AUTH_BOUNDARY_ORDER_INVALID';
  }
}

function isTimestamp(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function requireUuid(value, code = 'AUTH_BOUNDARY_IDENTITY_INVALID') {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new AuthBoundaryError(code);
  return value.toLowerCase();
}

function createFreshExperimentIdentity(randomUUID = crypto.randomUUID) {
  if (typeof randomUUID !== 'function') throw new AuthBoundaryError('AUTH_BOUNDARY_IDENTITY_INVALID');
  for (let index = 0; index < 8; index += 1) {
    const experimentId = requireUuid(randomUUID());
    const providerOperationId = requireUuid(randomUUID());
    if (experimentId !== providerOperationId) return Object.freeze({ experimentId, providerOperationId });
  }
  throw new AuthBoundaryError('AUTH_BOUNDARY_IDENTITY_INVALID');
}

function validateReadOnlyPreflightShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1'
    || value.readOnly !== true
    || value.installationCode !== INSTALLATION_CODE
    || !isTimestamp(value.observedAt)
    || value.sources?.database !== 'READ_ONLY'
    || value.sources?.supervisor !== 'READ_ONLY'
    || value.sources?.runtime !== 'READ_ONLY') {
    throw new AuthBoundaryError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }

  const installation = value.installation;
  const enrollment = value.enrollment;
  const account = value.accountBinding;
  const runtime = value.runtime;
  const supervisor = value.supervisor;
  const lifecycle = value.lifecycle;
  const providerPolicy = value.providerPolicy;
  if (!installation || !enrollment || !account || !runtime || !supervisor || !lifecycle || !providerPolicy
    || installation.installationCode !== INSTALLATION_CODE
    || installation.runtimeCode !== 'OPENAI_CODEX_APP_SERVER'
    || !UUID_V4.test(String(installation.installationId || ''))
    || typeof installation.executionEnabled !== 'boolean'
    || !UUID_V4.test(String(account.bindingId || ''))
    || account.accountCode !== 'phase19-3a0-managed-account'
    || typeof account.executionEnabled !== 'boolean'
    || typeof enrollment.allStatesClassified !== 'boolean'
    || !Number.isSafeInteger(enrollment.activeCount) || enrollment.activeCount < 0
    || !Number.isSafeInteger(enrollment.unresolvedCount) || enrollment.unresolvedCount < 0
    || !Number.isSafeInteger(enrollment.unknownStateCount) || enrollment.unknownStateCount < 0
    || !Array.isArray(enrollment.operations)
    || typeof enrollment.evidenceTruncated !== 'boolean'
    || !Number.isSafeInteger(enrollment.totalCount) || enrollment.totalCount < enrollment.operations.length
    || enrollment.operations.some((item) => !item || typeof item !== 'object'
      || (item.operationId !== null && !UUID_V4.test(String(item.operationId || '')))
      || item.identityValid !== (item.operationId !== null)
      || !ENROLLMENT_STATES.has(item.state)
      || (item.providerAttemptCount !== null
        && (!Number.isInteger(item.providerAttemptCount) || item.providerAttemptCount < 0 || item.providerAttemptCount > 2))
      || ![item.createdAt, item.startedAt, item.completedAt, item.lastObservedAt]
        .every((timestamp) => timestamp === null || isTimestamp(timestamp)))
    || !ACCOUNT_STATES.has(account.state)
    || runtime.codexVersion !== CODEX_VERSION
    || runtime.expectedCodexVersion !== CODEX_VERSION
    || !['CERTIFIED', 'UNVERIFIED', 'REVOKED', 'DISABLED'].includes(runtime.certificationState)
    || !['CURRENT', 'STALE_RECONCILABLE', 'STALE_BLOCKED', 'UNKNOWN'].includes(runtime.freshness)
    || !['HEALTHY', 'UNHEALTHY', 'UNKNOWN'].includes(runtime.workerHealth)
    || !['HEALTHY', 'UNHEALTHY', 'UNKNOWN'].includes(runtime.bridgeHealth)
    || !['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(runtime.containment)
    || !['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(runtime.mcp)
    || typeof runtime.executionEnabled !== 'boolean'
    || !['VERIFIED', 'FAILED', 'UNAVAILABLE'].includes(runtime.identityAttestation)
    || !['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(runtime.readiness)
    || typeof runtime.runtimeObservationCurrent !== 'boolean'
    || typeof runtime.networkPolicyCurrent !== 'boolean'
    || typeof runtime.expectedServicesRunning !== 'boolean'
    || !Array.isArray(runtime.readinessBlockers)
    || !runtime.readinessBlockers.every((item) => READINESS_BLOCKERS.has(item))
    || (runtime.readiness === 'CURRENT' && runtime.readinessBlockers.length !== 0)
    || (runtime.readiness === 'BLOCKED' && runtime.readinessBlockers.length === 0)
    || typeof supervisor.online !== 'boolean'
    || !['ONLINE', 'DEGRADED', 'PARTIAL', 'STARTING', 'STOPPED', 'UNAVAILABLE', 'UNKNOWN'].includes(supervisor.runtimeStatus)
    || typeof supervisor.activeOperationPresent !== 'boolean'
    || typeof supervisor.lastOperationKnown !== 'boolean'
    || (supervisor.activeOperationId !== null && !UUID_V4.test(String(supervisor.activeOperationId || '')))
    || (supervisor.lastOperation != null
      && (!supervisor.lastOperation || typeof supervisor.lastOperation !== 'object'
        || !UUID_V4.test(String(supervisor.lastOperation.operationId || ''))
        || !SUPERVISOR_TERMINAL_STATES.has(supervisor.lastOperation.status)
        || !isTimestamp(supervisor.lastOperation.completedAt)))
    || typeof lifecycle.active !== 'boolean'
    || typeof lifecycle.outcomeKnown !== 'boolean'
    || (lifecycle.operationId !== null && !UUID_V4.test(String(lifecycle.operationId || '')))
    || !['SUCCEEDED', 'FAILED', 'REQUESTED', 'DISPATCHED', 'WAITING_READINESS', 'UNKNOWN'].includes(lifecycle.state)
    || (lifecycle.attemptCount !== null && (!Number.isInteger(lifecycle.attemptCount) || lifecycle.attemptCount < 1 || lifecycle.attemptCount > 2))
    || !['BOUND', 'LEGACY_UNBOUND_PRE_FINGERPRINT', 'INVALID'].includes(lifecycle.fingerprintStatus)
    || (lifecycle.fingerprintStatus === 'BOUND' && !SHA256.test(lifecycle.sourceConfigurationFingerprint || ''))
    || (lifecycle.fingerprintStatus !== 'BOUND' && lifecycle.sourceConfigurationFingerprint !== null)
    || (lifecycle.completedAt !== null && !isTimestamp(lifecycle.completedAt))
    || (lifecycle.terminalReconciledAt !== null && !isTimestamp(lifecycle.terminalReconciledAt))
    || (lifecycle.supervisorOperationId !== null && !UUID_V4.test(String(lifecycle.supervisorOperationId || '')))
    || (lifecycle.lifecycleSchemaVersion !== null && lifecycle.lifecycleSchemaVersion !== LIFECYCLE_SCHEMA_VERSION)
    || ![null, LEGACY_FAILURE_RECONCILIATION_BASIS, 'INVALID'].includes(lifecycle.terminalReconciliationBasis)
    || typeof lifecycle.historyValid !== 'boolean'
    || !Number.isSafeInteger(lifecycle.historyCount) || lifecycle.historyCount < 0 || lifecycle.historyCount > MAX_LIFECYCLE_HISTORY
    || !Array.isArray(providerPolicy.hosts)
    || JSON.stringify(providerPolicy.hosts) !== JSON.stringify(APPROVED_PREFLIGHT_PROVIDER_HOSTS)
    || !SHA256.test(providerPolicy.sha256 || '')) {
    throw new AuthBoundaryError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }

  return { installation, enrollment, account, runtime, supervisor, lifecycle, providerPolicy };
}

function readOnlyPreflightBlocker(value) {
  const { installation, enrollment, runtime, supervisor, lifecycle } = validateReadOnlyPreflightShape(value);
  if (enrollment.activeCount > 0) return 'AUTH_BOUNDARY_ENROLLMENT_ACTIVE';
  if (enrollment.unknownStateCount > 0 || enrollment.allStatesClassified !== true
    || enrollment.operations.some((item) => item.state === 'UNCLASSIFIED' || !item.identityValid
      || item.providerAttemptCount === null)) return 'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED';
  if (enrollment.unresolvedCount > 0) return 'AUTH_BOUNDARY_ENROLLMENT_UNRESOLVED';
  if (value.accountBinding.state === 'UNKNOWN') return 'AUTH_BOUNDARY_ACCOUNT_STATE_UNKNOWN';
  if (!supervisor.online || supervisor.runtimeStatus !== 'ONLINE') return 'AUTH_BOUNDARY_SUPERVISOR_OFFLINE';
  if (supervisor.activeOperationPresent) return 'AUTH_BOUNDARY_SUPERVISOR_OPERATION_ACTIVE';
  if (!supervisor.lastOperationKnown) return 'AUTH_BOUNDARY_SUPERVISOR_OFFLINE';
  if (lifecycle.historyValid !== true) return 'AUTH_BOUNDARY_LIFECYCLE_HISTORY_INVALID';
  if (lifecycle.active || !lifecycle.outcomeKnown || !TERMINAL_LIFECYCLE_STATES.has(lifecycle.state)
    || !lifecycle.operationId || lifecycle.lifecycleSchemaVersion !== LIFECYCLE_SCHEMA_VERSION
    || !lifecycle.completedAt || !lifecycle.terminalReconciledAt
    || lifecycle.supervisorOperationId !== lifecycle.operationId
    || lifecycle.fingerprintStatus !== 'BOUND'
    || lifecycle.terminalReconciliationBasis === 'INVALID'
    || !SHA256.test(lifecycle.sourceConfigurationFingerprint || '')) {
    return 'AUTH_BOUNDARY_LIFECYCLE_UNCERTAIN';
  }
  if (supervisor.lastOperation?.operationId === lifecycle.operationId
    && supervisor.lastOperation.status !== lifecycle.state) return 'AUTH_BOUNDARY_LIFECYCLE_CONTRADICTORY';
  if (runtime.certificationState !== 'CERTIFIED' || runtime.freshness !== 'CURRENT'
    || runtime.workerHealth !== 'HEALTHY' || runtime.bridgeHealth !== 'HEALTHY'
    || runtime.containment !== 'CURRENT' || runtime.mcp !== 'CURRENT'
    || runtime.identityAttestation !== 'VERIFIED' || runtime.runtimeObservationCurrent !== true
    || runtime.networkPolicyCurrent !== true || runtime.expectedServicesRunning !== true
    || !['CURRENT', 'BLOCKED'].includes(runtime.readiness)) return 'AUTH_BOUNDARY_RUNTIME_NOT_CURRENT';
  if (installation.executionEnabled !== false || runtime.executionEnabled !== false
    || value.accountBinding.executionEnabled !== false) return 'AUTH_BOUNDARY_EXECUTION_ENABLED';
  return null;
}

function projectReadOnlyPreflight(value) {
  const { installation, enrollment, account, runtime, supervisor, lifecycle, providerPolicy } =
    validateReadOnlyPreflightShape(value);
  const blocker = readOnlyPreflightBlocker(value);
  if (blocker) throw new AuthBoundaryError(blocker);

  return {
    schema: value.schema,
    preflightStatus: 'READY',
    observedAt: value.observedAt,
    preflightRole: 'VETO_ONLY',
    sources: { database: 'READ_ONLY', supervisor: 'READ_ONLY', runtime: 'READ_ONLY', providerPolicy: 'SOURCE_CONTROLLED' },
    installation: {
      installationId: installation.installationId.toLowerCase(),
      installationCode: INSTALLATION_CODE,
      runtimeCode: 'OPENAI_CODEX_APP_SERVER',
      executionEnabled: false,
    },
    accountBinding: {
      bindingId: account.bindingId.toLowerCase(),
      accountCode: 'phase19-3a0-managed-account',
      state: account.state,
      role: 'OBSERVATION_ONLY',
      executionEnabled: false,
    },
    enrollment: {
      totalCount: enrollment.totalCount,
      activeCount: enrollment.activeCount,
      unresolvedCount: enrollment.unresolvedCount,
      unknownStateCount: enrollment.unknownStateCount,
      allStatesClassified: enrollment.allStatesClassified,
      evidenceTruncated: enrollment.evidenceTruncated,
      operations: enrollment.operations.map((item) => ({
        operationId: item.operationId?.toLowerCase() || null,
        identityValid: item.identityValid,
        state: item.state,
        providerAttemptCount: item.providerAttemptCount,
        createdAt: item.createdAt,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        lastObservedAt: item.lastObservedAt,
      })),
    },
    supervisor: {
      online: supervisor.online,
      runtimeStatus: supervisor.runtimeStatus,
      activeOperationPresent: false,
      activeOperationId: null,
      lastOperationKnown: true,
      lastOperation: supervisor.lastOperation ? {
        operationId: supervisor.lastOperation.operationId.toLowerCase(),
        status: supervisor.lastOperation.status,
        completedAt: supervisor.lastOperation.completedAt,
      } : null,
    },
    lifecycle: {
      operationId: lifecycle.operationId.toLowerCase(),
      state: lifecycle.state,
      attemptCount: lifecycle.attemptCount,
      completedAt: lifecycle.completedAt,
      terminalReconciledAt: lifecycle.terminalReconciledAt,
      supervisorOperationId: lifecycle.supervisorOperationId.toLowerCase(),
      fingerprintStatus: lifecycle.fingerprintStatus,
      sourceConfigurationFingerprint: lifecycle.sourceConfigurationFingerprint.toUpperCase(),
      lifecycleSchemaVersion: lifecycle.lifecycleSchemaVersion,
      terminalReconciliationBasis: lifecycle.terminalReconciliationBasis,
      historyValid: lifecycle.historyValid,
      historyCount: lifecycle.historyCount,
    },
    runtime: {
      version: { observed: runtime.codexVersion, expected: runtime.expectedCodexVersion },
      certificationState: runtime.certificationState,
      freshness: runtime.freshness,
      identityAttestation: runtime.identityAttestation,
      workerHealth: runtime.workerHealth,
      bridgeHealth: runtime.bridgeHealth,
      containment: runtime.containment,
      mcp: runtime.mcp,
      readiness: runtime.readiness,
      readinessBlockers: [...runtime.readinessBlockers],
      observationCurrent: runtime.runtimeObservationCurrent,
      networkPolicyCurrent: runtime.networkPolicyCurrent,
      expectedServicesRunning: runtime.expectedServicesRunning,
      executionEnabled: false,
    },
    providerPolicy: { hosts: [...providerPolicy.hosts], sha256: providerPolicy.sha256.toUpperCase() },
    executionEnabled: false,
  };
}

function projectDisposableRuntimeEvidence(value, experimentId, preflightObservedAt) {
  const id = requireUuid(experimentId);
  const expectedProject = `skycommand-codex-auth-boundary-${id.slice(0, 8)}`;
  const mountTargets = Array.isArray(value?.mounts) ? value.mounts.map((mount) => mount?.target) : [];
  const mountsAreExactTmpfs = Array.isArray(value?.mounts) && value.mounts.length === 2
    && value.mounts.every((mount) => mount && mount.type === 'tmpfs' && mount.readOnly === false)
    && JSON.stringify([...mountTargets].sort()) === JSON.stringify(['/probe-home', '/tmp']);
  const failure = () => { throw new AuthBoundaryError('AUTH_BOUNDARY_PREFLIGHT_BLOCKED'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_RUNTIME_V1'
    || value.projectName !== expectedProject
    || !/^[a-f0-9]{64}$/i.test(String(value.containerId || ''))
    || !/^sha256:[a-f0-9]{64}$/i.test(String(value.imageId || ''))
    || value.codexVersion !== CODEX_VERSION
    || !isTimestamp(value.containerCreatedAt)
    || !isTimestamp(preflightObservedAt)
    || Date.parse(value.containerCreatedAt) < Date.parse(preflightObservedAt)
    || value.projectWasFresh !== true || value.containerWasFresh !== true || value.homeWasFresh !== true
    || value.uid <= 0 || !Number.isInteger(value.uid)
    || value.rootReadOnly !== true || value.capabilitiesDroppedAll !== true || value.noNewPrivileges !== true
    || !mountsAreExactTmpfs
    || value.productionCredentialsPresent !== false || value.productionManagedHomeMounted !== false
    || value.databaseCredentialsPresent !== false || value.supervisorCredentialsPresent !== false
    || value.hostAgentCredentialsPresent !== false || value.providerCredentialsMounted !== false
    || value.secretEnvironmentVariablesPresent !== false
    || value.dockerSocketMounted !== false || value.gitAvailable !== false || value.browserAvailable !== false
    || value.executionEnabled !== false || value.turnStartEnabled !== false
    || value.browserTaskExecutionEnabled !== false || value.mcpTaskExecutionEnabled !== false
    || value.defaultRoutePresent !== false || value.providerProxyOnly !== true
    || !Array.isArray(value.networks) || JSON.stringify(value.networks) !== JSON.stringify(['auth_client'])
    || !Array.isArray(value.allowedProviderHosts)
    || JSON.stringify(value.allowedProviderHosts) !== JSON.stringify([APPROVED_PROVIDER_HOST])
    || !Array.isArray(value.allowedProviderPorts)
    || JSON.stringify(value.allowedProviderPorts) !== JSON.stringify([APPROVED_PROVIDER_PORT])) failure();
  return {
    projectName: expectedProject,
    containerId: String(value.containerId).toLowerCase(),
    imageId: String(value.imageId).toLowerCase(),
    codexVersion: CODEX_VERSION,
    containerCreatedAt: value.containerCreatedAt,
    uid: value.uid,
    rootReadOnly: true,
    capabilitiesDroppedAll: true,
    noNewPrivileges: true,
    mounts: ['/probe-home', '/tmp'].map((target) => ({ target, type: 'tmpfs', readOnly: false })),
    networks: ['auth_client'],
    providerProxyOnly: true,
    executionEnabled: false,
  };
}

function safeRpc(value, expectedMethod) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.method !== expectedMethod
    || !Number.isSafeInteger(value.requestId) || value.requestId < 1
    || (value.rpcCode !== null && !Number.isSafeInteger(value.rpcCode))
    || !['RESULT', 'JSON_RPC_ERROR', 'TIMEOUT', 'TRANSPORT_ERROR'].includes(value.outcome)
    || !isTimestamp(value.observedAt)) throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID');
  return {
    method: expectedMethod,
    requestId: value.requestId,
    rpcCode: value.rpcCode,
    outcome: value.outcome,
    observedAt: value.observedAt,
  };
}

class AuthBoundaryRun {
  #loginId = null;

  constructor({ experimentId, providerOperationId }) {
    this.experimentId = requireUuid(experimentId);
    this.providerOperationId = requireUuid(providerOperationId);
    if (this.experimentId === this.providerOperationId) throw new AuthBoundaryError('AUTH_BOUNDARY_IDENTITY_INVALID');
    this.state = 'CREATED';
    this.outcomeCategory = null;
    this.failureCode = null;
    this.rpc = null;
    this.timestamps = {};
    this.protocolMethods = [];
    this.appServerGeneration = null;
    this.latestNotification = null;
    this.loginStartCount = 0;
    this.accountReadCount = 0;
    this.preflight = null;
    this.runtimeIdentity = null;
    this.teardownVerified = false;
  }

  acceptPreflight(snapshot) {
    if (this.state !== 'CREATED') throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    this.preflight = projectReadOnlyPreflight(snapshot);
    this.state = 'PREFLIGHT_PASSED';
    return this.preflight;
  }

  acceptIsolatedRuntime(evidence) {
    if (this.state !== 'PREFLIGHT_PASSED') throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    this.runtime = projectDisposableRuntimeEvidence(evidence, this.experimentId, this.preflight.observedAt);
    this.state = 'RUNTIME_VERIFIED';
    return this.runtime;
  }

  initialized({ appServerGeneration, observedVersion, executionEnabled, observedAt }) {
    if (this.state !== 'RUNTIME_VERIFIED'
      || typeof appServerGeneration !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(appServerGeneration)
      || observedVersion !== CODEX_VERSION || executionEnabled !== false || !isTimestamp(observedAt)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    this.appServerGeneration = appServerGeneration;
    this.runtimeIdentity = { expectedVersion: CODEX_VERSION, observedVersion };
    this.timestamps.initializedAt = observedAt;
    this.protocolMethods.push('initialize');
    this.state = 'INITIALIZED';
  }

  beginLoginStart(requestId, observedAt) {
    if (this.state !== 'INITIALIZED' || this.loginStartCount !== 0
      || !Number.isSafeInteger(requestId) || requestId < 1 || !isTimestamp(observedAt)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    this.loginStartCount = 1;
    this.protocolMethods.push('account/login/start');
    this.timestamps.loginStartAt = observedAt;
    this.loginRequestId = requestId;
    this.state = 'LOGIN_START_IN_FLIGHT';
  }

  recordLoginStartFailure({ failureCode, rpcCode, requestId, observedAt }) {
    if (this.state !== 'LOGIN_START_IN_FLIGHT'
      || !['DEVICE_AUTH_RPC_ERROR', 'DEVICE_AUTH_START_TIMEOUT', 'DEVICE_AUTH_ENVELOPE_INVALID', 'DEVICE_AUTH_RESPONSE_INVALID'].includes(failureCode)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    const outcome = failureCode === 'DEVICE_AUTH_START_TIMEOUT' ? 'TIMEOUT'
      : failureCode === 'DEVICE_AUTH_RPC_ERROR' ? 'JSON_RPC_ERROR' : 'TRANSPORT_ERROR';
    this.rpc = safeRpc({ method: 'account/login/start', requestId, rpcCode, outcome, observedAt }, 'account/login/start');
    this.finish('LOGIN_START_FAILURE', failureCode, observedAt);
  }

  presentCheckpoint({ verificationUrl, userCode, loginId, expiresAt }, { requestId, observedAt }, presentTransientCheckpoint) {
    if (this.state !== 'LOGIN_START_IN_FLIGHT' || requestId !== this.loginRequestId
      || !isTimestamp(observedAt) || typeof presentTransientCheckpoint !== 'function') {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    let parsedUrl;
    try { parsedUrl = new URL(verificationUrl); } catch (_error) { parsedUrl = null; }
    if (!parsedUrl || parsedUrl.origin !== 'https://auth.openai.com'
      || parsedUrl.pathname !== '/codex/device' || parsedUrl.search || parsedUrl.hash
      || typeof userCode !== 'string' || !/^[A-Za-z0-9-]{3,32}$/.test(userCode)
      || typeof loginId !== 'string' || loginId.length < 1 || loginId.length > 100
      || !(isTimestamp(expiresAt) || (typeof expiresAt === 'number' && Number.isFinite(expiresAt)))) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID');
    }
    this.#loginId = loginId;
    this.rpc = safeRpc({ method: 'account/login/start', requestId, rpcCode: null, outcome: 'RESULT', observedAt }, 'account/login/start');
    this.timestamps.checkpointPresentedAt = observedAt;
    this.state = 'WAITING_FOR_PROVIDER_COMPLETION';
    try {
      presentTransientCheckpoint({ verificationUrl: parsedUrl.toString(), userCode, expiresAt });
    } finally {
      verificationUrl = '';
      userCode = '';
      parsedUrl = null;
    }
    return { state: this.state, checkpointPresentedAt: observedAt };
  }

  observeNotification(notification) {
    if (this.state !== 'WAITING_FOR_PROVIDER_COMPLETION') throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    if (notification?.type === 'account/updated') return { accepted: false, state: this.state };
    if (!notification || notification.type !== 'account/login/completed') {
      return { accepted: false, state: this.state };
    }
    if (notification.experimentId !== this.experimentId
      || notification.providerOperationId !== this.providerOperationId
      || notification.appServerGeneration !== this.appServerGeneration
      || notification.loginId !== this.#loginId
      || typeof notification.success !== 'boolean'
      || !isTimestamp(notification.observedAt)
      || Date.parse(notification.observedAt) < Date.parse(this.timestamps.loginStartAt)) {
      this.#loginId = null;
      this.finish('PROVIDER_OUTCOME_UNCERTAIN', 'PROVIDER_OUTCOME_UNCERTAIN', notification.observedAt);
      return { accepted: false, state: this.state };
    }
    this.latestNotification = { type: 'account/login/completed', observedAt: notification.observedAt };
    this.timestamps.loginCompletedObservedAt = notification.observedAt;
    this.#loginId = null;
    if (notification.success !== true) {
      this.finish('PROVIDER_LOGIN_FAILURE', 'PROVIDER_LOGIN_FAILED', notification.observedAt);
      return { accepted: true, state: this.state };
    }
    this.state = 'LOGIN_COMPLETION_OBSERVED';
    return { accepted: true, state: this.state };
  }

  beginAccountRead(requestId, observedAt) {
    if (this.state !== 'LOGIN_COMPLETION_OBSERVED' || this.accountReadCount !== 0
      || !Number.isSafeInteger(requestId) || requestId < 1 || !isTimestamp(observedAt)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    this.accountReadCount = 1;
    this.protocolMethods.push('account/read');
    this.timestamps.accountReadAt = observedAt;
    this.state = 'ACCOUNT_READ_IN_FLIGHT';
    this.accountReadRequestId = requestId;
  }

  recordAccountReadFailure({ failureCode, rpcCode, requestId, observedAt }) {
    if (this.state !== 'ACCOUNT_READ_IN_FLIGHT'
      || !['ACCOUNT_READ_RPC_ERROR', 'ACCOUNT_READ_TIMEOUT', 'ACCOUNT_READ_RESULT_INVALID'].includes(failureCode)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    const outcome = failureCode === 'ACCOUNT_READ_TIMEOUT' ? 'TIMEOUT'
      : failureCode === 'ACCOUNT_READ_RPC_ERROR' ? 'JSON_RPC_ERROR' : 'TRANSPORT_ERROR';
    this.rpc = safeRpc({
      method: 'account/read', requestId, rpcCode,
      outcome, observedAt,
    }, 'account/read');
    this.finish('AUTHENTICATED_ACCOUNT_READ_FAILURE', failureCode, observedAt);
  }

  recordAccountReadResult({ requestId, observedAt, accountState, authenticated }) {
    if (this.state !== 'ACCOUNT_READ_IN_FLIGHT' || requestId !== this.accountReadRequestId
      || !isTimestamp(observedAt) || !['ACCOUNT_PRESENT', 'ACCOUNT_NULL', 'UNKNOWN'].includes(accountState)
      || typeof authenticated !== 'boolean') throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID');
    this.rpc = safeRpc({ method: 'account/read', requestId, rpcCode: null, outcome: 'RESULT', observedAt }, 'account/read');
    this.accountState = accountState;
    this.authenticated = authenticated;
    this.finish(authenticated && accountState === 'ACCOUNT_PRESENT'
      ? 'AUTHENTICATED_ACCOUNT_READ_SUCCESS' : 'AUTHENTICATED_ACCOUNT_READ_FAILURE',
    authenticated && accountState === 'ACCOUNT_PRESENT' ? null : 'ACCOUNT_READ_RESULT_INVALID', observedAt);
  }

  markProviderOutcomeUncertain(observedAt) {
    if (this.state !== 'WAITING_FOR_PROVIDER_COMPLETION' || !isTimestamp(observedAt)) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_ORDER_INVALID');
    }
    this.#loginId = null;
    this.finish('PROVIDER_OUTCOME_UNCERTAIN', 'PROVIDER_OUTCOME_UNCERTAIN', observedAt);
  }

  markTeardownVerified({ containerRemoved, disposableHomeDiscarded, proxyRemoved }) {
    if (!OUTCOME_CATEGORIES.has(this.outcomeCategory)
      || containerRemoved !== true || disposableHomeDiscarded !== true || proxyRemoved !== true) {
      throw new AuthBoundaryError('AUTH_BOUNDARY_CLEANUP_UNVERIFIED');
    }
    this.teardownVerified = true;
    this.state = 'TERMINAL_DISCARDED';
  }

  safeEvidence({ packageLockSha256, installedArtifactSha256, phaseEgress = [], observedAt }) {
    if (this.state !== 'TERMINAL_DISCARDED' || !this.teardownVerified
      || !SHA256.test(packageLockSha256 || '') || !SHA256.test(installedArtifactSha256 || '')
      || !isTimestamp(observedAt)) throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID');
    let projectedPhases;
    try { projectedPhases = projectSafePhaseEgressList(phaseEgress); }
    catch (_error) { throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID'); }
    return {
      schema: 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_RESULT_V1',
      experimentId: this.experimentId,
      providerOperationId: this.providerOperationId,
      codexVersion: CODEX_VERSION,
      identity: {
        expectedVersion: this.runtimeIdentity?.expectedVersion || CODEX_VERSION,
        observedVersion: this.runtimeIdentity?.observedVersion || null,
        wrapperIntegrity: CONTRACT.baseline.wrapperIntegrity,
        platformIntegrity: CONTRACT.baseline.platformIntegrity,
        packageLockSha256,
        installedArtifactSha256,
      },
      outcomeCategory: this.outcomeCategory,
      failureCode: this.failureCode,
      terminalStage: this.terminalStage,
      preflight: this.preflight,
      isolatedRuntime: this.runtime,
      appServerGeneration: this.appServerGeneration,
      latestRelevantNotification: this.latestNotification,
      protocolMethods: [...this.protocolMethods],
      loginStartCount: this.loginStartCount,
      accountReadCount: this.accountReadCount,
      rpc: this.rpc,
      accountState: this.accountState || 'UNKNOWN',
      authenticatedState: this.authenticated === true ? 'AUTHENTICATED' : (this.authenticated === false ? 'UNAUTHENTICATED' : 'INDETERMINATE'),
      timestamps: { ...this.timestamps, terminalAt: this.terminalAt },
      phaseEgress: projectedPhases,
      executionEnabled: false,
      turnStartCount: 0,
      browserTaskCount: 0,
      observedAt,
      cleanup: 'VERIFIED_DISCARDED',
    };
  }

  finish(category, failureCode, observedAt) {
    if (!OUTCOME_CATEGORIES.has(category) || (failureCode && !SAFE_FAILURE_CODES.has(failureCode))
      || !isTimestamp(observedAt)) throw new AuthBoundaryError('AUTH_BOUNDARY_EVIDENCE_INVALID');
    this.outcomeCategory = category;
    this.failureCode = failureCode;
    this.terminalStage = this.state === 'LOGIN_START_IN_FLIGHT' ? 'ACCOUNT_LOGIN_START'
      : this.state === 'ACCOUNT_READ_IN_FLIGHT' ? 'ACCOUNT_READ' : 'PROVIDER_COMPLETION_WAIT';
    this.terminalAt = observedAt;
    this.state = 'TERMINAL';
  }
}

module.exports = {
  ALLOWED_METHODS,
  AUTH_BOUNDARY_PHASES: AUTH_AB_PHASES,
  APPROVED_PROVIDER_HOST,
  APPROVED_PROVIDER_PORT,
  APPROVED_PREFLIGHT_PROVIDER_HOSTS,
  AuthBoundaryError,
  AuthBoundaryRun,
  CODEX_VERSION,
  INSTALLATION_CODE,
  createFreshExperimentIdentity,
  projectDisposableRuntimeEvidence,
  projectReadOnlyPreflight,
  readOnlyPreflightBlocker,
};
