'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { query, pool } = require('../../../../packages/db/src/connection');
const { CODEX_BOOTSTRAP_REBUILD_SERVICES } = require('../../../../packages/supervisor/src/config');
const authService = require('./authService');
const { authorizeRuntimeControl } = require('./supervisorLifecycleGrantService');
const { getSupervisorBaseUrl } = require('./orchestratorRefreshService');

const RUNTIME_CODE = 'OPENAI_CODEX_APP_SERVER';
const INSTALLATION_CODE = 'phase19-3a0-managed-codex';
const ACCOUNT_CODE = 'phase19-3a0-managed-account';
const PROVIDER_CODE = 'OPENAI_CODEX';
const AUTH_MODE = 'chatgptDeviceCode';
const DEVICE_URL = 'https://auth.openai.com/codex/device';
const PROFILE = 'CODEX_MANAGED_BOOTSTRAP';
const EXPECTED_VERSION = '0.154.0';
const EXPECTED_WRAPPER_INTEGRITY = 'sha512-FV/x1OHXYv/ifjf3mXj9ThTTAWcUZN6cGIRQRhRxkKNOPuImu1WW0c8ev1vUkE9XGH90dEnYG1tBjIkxRikg0w==';
const EXPECTED_LINUX_INTEGRITY = 'sha512-a4FI3A8sGtwGrOqltrPbrS2hajrHQG591EwmRfiRoLMb10VxdBtUGW4gu6IJVYENiYGA7k3P4jlRHEoCZU/s9Q==';
const ACTIVE_STATES = ['CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED'];
const MANAGED_CODEX_ASSISTANT_ID = 'codex-local';
const MANAGED_CODEX_ASSISTANT_PERMISSIONS = new Set(['MANAGED_CODEX_READ', 'MANAGED_CODEX_ENROLL']);
const MANAGED_CODEX_LIFECYCLE_PERMISSION = 'MANAGED_CODEX_LIFECYCLE';
const MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_ENV = 'SKYCOMMAND_MANAGED_CODEX_SOURCE_ROOT';
const CODEX_LIFECYCLE_HEALTH_SERVICES = ['api', 'codex-egress-proxy', 'codex-mcp-gateway', 'codex-agent-runtime-worker', 'codex-control-bridge'];
const PROVIDER_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_CODEX_LIFECYCLE_ATTEMPTS = 2;
const MAX_CODEX_LIFECYCLE_HISTORY = 8;
const MANAGED_CODEX_LIFECYCLE_SCHEMA_VERSION = 2;
const LEGACY_UNBOUND_FINGERPRINT_STATUS = 'LEGACY_UNBOUND_PRE_FINGERPRINT';
const LEGACY_FAILURE_RECONCILIATION_BASIS = 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const SAFE_RPC_METHODS = new Set([
  'account/read', 'account/login/start', 'account/login/cancel', 'account/logout',
  'account/rateLimits/read', 'account/usage/read', 'model/list', 'mcpServerStatus/list',
]);
const RPC_STAGE_BY_METHOD = Object.freeze({
  'account/read': 'ACCOUNT_READ',
  'account/login/start': 'DEVICE_CODE_LOGIN_START',
  'account/login/cancel': 'DEVICE_CODE_LOGIN_CANCEL',
  'account/logout': 'ACCOUNT_LOGOUT',
  'account/rateLimits/read': 'ACCOUNT_RATE_LIMITS_READ',
  'account/usage/read': 'ACCOUNT_USAGE_READ',
  'model/list': 'MODEL_LIST',
  'mcpServerStatus/list': 'MCP_SERVER_STATUS_LIST',
});
const SAFE_RPC_OUTCOMES = new Set(['SUCCEEDED', 'JSON_RPC_ERROR', 'TIMEOUT', 'TRANSPORT_ERROR']);
const ACCOUNT_READ_ERROR_CLASSIFICATIONS = new Set([
  'WORKSPACE_ROUTING_DUPLICATE',
  'WORKSPACE_ROUTING_TIMEOUT',
  'WORKSPACE_ROUTING_UNAUTHORIZED',
  'WORKSPACE_ROUTING_UNAVAILABLE',
  'WORKSPACE_ROUTING_DISCOVERY_ERROR',
  'ACCOUNT_READ_INTERNAL_ERROR',
]);
const ACCOUNT_READ_DATA_KINDS = new Set(['NULL', 'STRING', 'OBJECT', 'ARRAY', 'OTHER']);
const ACCOUNT_READ_LEXICAL_SIGNAL_NAMES = Object.freeze([
  'workspace', 'routing', 'discovery', 'duplicate', 'timeout',
  'unauthorized', 'unavailable', 'account', 'auth',
]);
const SAFE_DIAGNOSTIC_SECRET_MARKERS = new Set([
  'TOKEN', 'SECRET', 'COOKIE', 'CREDENTIAL', 'PASSWORD', 'BEARER', 'AUTHORIZATION',
  'ACCESS', 'REFRESH', 'DEVICE', 'USER', 'VERIFICATION', 'URL', 'LOGIN_ID', 'EMAIL', 'HEADER',
]);
const LOGIN_NOTIFICATION_TYPES = new Set(['account/login/completed', 'account/updated']);
const CODEX_BOOTSTRAP_FINGERPRINT_INPUTS = Object.freeze([
  'compose.yaml',
  'docker/codex-agent-runtime/Dockerfile',
  'docker/codex-agent-runtime/package.json',
  'docker/codex-agent-runtime/package-lock.json',
  'docker/codex-agent-runtime/config.toml',
  'docker/codex-control-bridge.Dockerfile',
  'docker/codex-egress-proxy.Dockerfile',
  'docker/codex-mcp-gateway.Dockerfile',
  'docker/codex-provider-allowlist.txt',
  'apps/codex-agent-runtime-worker/src/appServerClient.js',
  'apps/codex-agent-runtime-worker/src/healthcheck.js',
  'apps/codex-agent-runtime-worker/src/index.js',
  'apps/codex-agent-runtime-worker/src/packageArtifactAttestation.js',
  'apps/codex-agent-runtime-worker/src/runtimeEgressEvidence.js',
  'apps/codex-control-bridge/src/credentialInit.js',
  'apps/codex-control-bridge/src/index.js',
  'apps/codex-egress-proxy/src/authAbDiagnostics.js',
  'apps/codex-egress-proxy/src/index.js',
  'apps/codex-egress-proxy/src/policy.js',
  'apps/codex-mcp-gateway/src/index.js',
  'packages/supervisor/src/config.js',
  'packages/supervisor/src/lifecycleGrant.js',
  'packages/supervisor/src/runtimeLifecycle.js',
  'packages/supervisor/src/server.js',
  'apps/api/src/services/supervisorLifecycleGrantService.js',
  'apps/api/src/services/managedCodexBootstrapService.js',
  'apps/api/src/services/assistantIntegrationService.js',
  'apps/api/src/services/orchestratorRefreshService.js',
  'apps/api/src/services/authService.js',
  'apps/api/src/controllers/assistantIntegrationController.js',
  'apps/api/src/controllers/managedCodexController.js',
  'apps/api/src/routes/assistantIntegration.routes.js',
  'apps/api/src/routes/agentRuntime.routes.js',
  'apps/api/src/middleware/assistantIntegrationMiddleware.js',
  'apps/api/src/middleware/authMiddleware.js',
  'apps/api/src/middleware/permissionMiddleware.js',
  'apps/api/src/server.js',
]);

function safeProviderDestinations(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => PROVIDER_HOST_PATTERN.test(String(item?.host || ''))
      && item?.decision === 'DENY' && item?.reason === 'HOST_NOT_ALLOWLISTED')
    .slice(-20)
    .map((item) => ({
      host: String(item.host).toLowerCase(),
      decision: 'DENY',
      reason: 'HOST_NOT_ALLOWLISTED',
      observedAt: item.observedAt || null,
    }));
}

function safeDiagnosticCode(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,5}$/.test(normalized)) return null;
  if (normalized.split('_').some((part) => SAFE_DIAGNOSTIC_SECRET_MARKERS.has(part))) return null;
  return normalized;
}

function safeTimestamp(value) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function safeLexicalSignals(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(ACCOUNT_READ_LEXICAL_SIGNAL_NAMES.map((name) => [name, value[name] === true]));
}

function safeDiagnosticDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toUpperCase() : null;
}

function safeRpcDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const method = SAFE_RPC_METHODS.has(value.method) ? value.method : null;
  const stage = method ? RPC_STAGE_BY_METHOD[method] : null;
  const outcome = SAFE_RPC_OUTCOMES.has(value.outcome) ? value.outcome : null;
  const observedAt = safeTimestamp(value.observedAt);
  if (!method || !stage || !outcome || !observedAt) return null;
  const rpcCode = Number.isSafeInteger(value.rpcCode) && Math.abs(value.rpcCode) <= 1_000_000_000
    ? value.rpcCode
    : null;
  if (outcome === 'JSON_RPC_ERROR' && rpcCode === null) return null;
  const requestId = Number.isSafeInteger(value.requestId) && value.requestId > 0
    ? value.requestId
    : null;
  if (requestId === null) return null;
  const diagnostic = {
    method,
    requestId,
    rpcCode,
    type: safeDiagnosticCode(value.type),
    reason: safeDiagnosticCode(value.reason),
    stage,
    outcome,
    failureCode: safeDiagnosticCode(value.failureCode),
    observedAt,
  };
  if (method === 'account/read' && outcome === 'JSON_RPC_ERROR') {
    diagnostic.accountReadClassification = ACCOUNT_READ_ERROR_CLASSIFICATIONS.has(value.accountReadClassification)
      ? value.accountReadClassification
      : 'ACCOUNT_READ_INTERNAL_ERROR';
    const messageSignals = safeLexicalSignals(value.messageSignals);
    const dataSignals = value.dataKind === 'STRING' ? safeLexicalSignals(value.dataSignals) : null;
    if (typeof value.messagePresent === 'boolean'
      && ACCOUNT_READ_DATA_KINDS.has(value.dataKind)
      && messageSignals
      && (value.dataKind !== 'STRING' || dataSignals)) {
      diagnostic.messagePresent = value.messagePresent;
      diagnostic.dataKind = value.dataKind;
      diagnostic.messageDigest = safeDiagnosticDigest(value.messageDigest);
      diagnostic.messageSignals = messageSignals;
      diagnostic.dataDigest = value.dataKind === 'STRING' ? safeDiagnosticDigest(value.dataDigest) : null;
      diagnostic.dataSignals = dataSignals;
    }
  }
  return diagnostic;
}

function safeLoginStateDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const operationId = typeof value.enrollmentOperationId === 'string' && UUID_PATTERN.test(value.enrollmentOperationId)
    ? value.enrollmentOperationId
    : null;
  const appServerGeneration = typeof value.appServerGeneration === 'string'
    && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.appServerGeneration)
    ? value.appServerGeneration
    : null;
  const timestamps = value.timestamps && typeof value.timestamps === 'object' ? value.timestamps : {};
  return {
    enrollmentOperationId: operationId,
    appServerGeneration,
    state: ['PENDING_USER', 'COMPLETED', 'FAILED'].includes(value.state) ? value.state : 'UNKNOWN',
    latestNotificationType: LOGIN_NOTIFICATION_TYPES.has(value.latestNotificationType) ? value.latestNotificationType : null,
    latestRpc: safeRpcDiagnostic(value.latestRpc),
    timestamps: {
      loginStartedAt: safeTimestamp(timestamps.loginStartedAt),
      loginCompletedAt: safeTimestamp(timestamps.loginCompletedAt),
      latestNotificationAt: safeTimestamp(timestamps.latestNotificationAt),
      latestRpcAt: safeTimestamp(timestamps.latestRpcAt),
    },
  };
}

function serviceError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code, ...details };
  return error;
}

function actorId(request) {
  return request?.user?.userId || null;
}

function canAdminister(request) {
  const roles = new Set((request?.user?.roleCodes || []).map((item) => String(item).toUpperCase()));
  return roles.has('SUPER_ADMIN') || roles.has('ADMIN_ALL');
}

function assistantPrincipalCode(request) {
  const agentId = request?.assistantIntegration?.agentId;
  const permissions = new Set((request?.permissions || []).map((item) => String(item?.permissionCode || item || '').toUpperCase()));
  if (agentId === MANAGED_CODEX_ASSISTANT_ID && [...MANAGED_CODEX_ASSISTANT_PERMISSIONS].some((code) => permissions.has(code))) {
    return MANAGED_CODEX_ASSISTANT_ID;
  }
  return null;
}

function assertLifecyclePrincipal(request) {
  const codes = new Set((request?.permissions || []).map((item) => String(item?.permissionCode || item || '').toUpperCase()));
  if (request?.assistantIntegration?.agentId !== MANAGED_CODEX_ASSISTANT_ID || !codes.has(MANAGED_CODEX_LIFECYCLE_PERMISSION)) {
    throw serviceError(403, 'MANAGED_CODEX_LIFECYCLE_DENIED', 'Managed Codex lifecycle requires the scoped codex-local lifecycle permission.');
  }
}

function safeLifecycle(value = {}) {
  const hasFingerprint = Object.prototype.hasOwnProperty.call(value, 'sourceConfigurationFingerprint');
  const hasFingerprintStatus = Object.prototype.hasOwnProperty.call(value, 'sourceConfigurationFingerprintStatus');
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(value, 'lifecycleSchemaVersion');
  const lifecycle = {
    operationId: value.operationId || null,
    state: value.state || 'UNKNOWN',
    attemptCount: Number(value.attemptCount || 0),
    requestedAt: value.requestedAt || null,
    acceptedAt: value.acceptedAt || null,
    completedAt: value.completedAt || null,
    terminalReconciledAt: value.terminalReconciledAt || null,
    supervisorOperationId: value.supervisorOperationId || null,
    services: Array.isArray(value.services) ? value.services : [...CODEX_BOOTSTRAP_REBUILD_SERVICES],
    runtimeGeneration: value.runtimeGeneration || null,
    readiness: value.readiness || null,
    readinessReason: value.readinessReason || null,
    runtimeServices: Array.isArray(value.runtimeServices) ? value.runtimeServices : [],
  };
  if (Object.prototype.hasOwnProperty.call(value, 'terminalReconciliationBasis')) {
    lifecycle.terminalReconciliationBasis = value.terminalReconciliationBasis === LEGACY_FAILURE_RECONCILIATION_BASIS
      ? LEGACY_FAILURE_RECONCILIATION_BASIS
      : 'INVALID';
  }
  if (hasFingerprint) {
    lifecycle.sourceConfigurationFingerprint = FINGERPRINT_PATTERN.test(String(value.sourceConfigurationFingerprint || ''))
      ? String(value.sourceConfigurationFingerprint).toUpperCase()
      : null;
  }
  if (hasFingerprint && FINGERPRINT_PATTERN.test(String(value.sourceConfigurationFingerprint || ''))
    && (!hasFingerprintStatus || value.sourceConfigurationFingerprintStatus === 'BOUND')) {
    lifecycle.sourceConfigurationFingerprint = String(value.sourceConfigurationFingerprint).toUpperCase();
    lifecycle.sourceConfigurationFingerprintStatus = 'BOUND';
  } else if (hasFingerprintStatus) {
    lifecycle.sourceConfigurationFingerprintStatus = [
      'BOUND', LEGACY_UNBOUND_FINGERPRINT_STATUS, 'INVALID',
    ].includes(value.sourceConfigurationFingerprintStatus)
      ? value.sourceConfigurationFingerprintStatus
      : 'INVALID';
  } else if (hasFingerprint) {
    lifecycle.sourceConfigurationFingerprintStatus = 'INVALID';
  }
  if (hasSchemaVersion) {
    lifecycle.lifecycleSchemaVersion = Number.isInteger(value.lifecycleSchemaVersion)
      ? value.lifecycleSchemaVersion
      : 'INVALID';
  }
  if (UUID_PATTERN.test(String(value.supersedesOperationId || ''))) {
    lifecycle.supersedesOperationId = String(value.supersedesOperationId);
  }
  if (UUID_PATTERN.test(String(value.successorOfOperationId || ''))) {
    lifecycle.successorOfOperationId = String(value.successorOfOperationId);
  }
  return lifecycle;
}

function safeLifecycleHistory(value = []) {
  return (Array.isArray(value) ? value : []).slice(-MAX_CODEX_LIFECYCLE_HISTORY).flatMap((item) => {
    const priorLifecycle = item?.priorLifecycle || {};
    if (item?.eventType === 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED') {
      const fingerprint = String(item?.sourceConfigurationFingerprint || '');
      if (!UUID_PATTERN.test(String(item?.priorOperationId || ''))
        || !UUID_PATTERN.test(String(item?.successorOperationId || ''))
        || item?.terminalState !== 'SUCCEEDED'
        || !FINGERPRINT_PATTERN.test(fingerprint)
        || item?.sourceConfigurationFingerprintStatus !== 'BOUND'
        || !Number.isInteger(Number(item?.attemptCount))
        || Number(item.attemptCount) < 1
        || Number(item.attemptCount) > MAX_CODEX_LIFECYCLE_ATTEMPTS
        || priorLifecycle.operationId !== item.priorOperationId
        || priorLifecycle.state !== 'SUCCEEDED'
        || Number(priorLifecycle.attemptCount) !== Number(item.attemptCount)
        || !hasBoundSourceConfigurationFingerprint(priorLifecycle)
        || String(priorLifecycle.sourceConfigurationFingerprint).toUpperCase() !== fingerprint.toUpperCase()
        || typeof item.completedAt !== 'string'
        || !item.completedAt
        || typeof item.terminalReconciledAt !== 'string'
        || !item.terminalReconciledAt
        || typeof item.successorCreatedAt !== 'string'
        || !item.successorCreatedAt
        || priorLifecycle.completedAt !== item.completedAt
        || priorLifecycle.terminalReconciledAt !== item.terminalReconciledAt) return [];
      return [{
        eventType: 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED',
        priorOperationId: String(item.priorOperationId),
        attemptCount: Number(item.attemptCount),
        terminalState: 'SUCCEEDED',
        sourceConfigurationFingerprintStatus: 'BOUND',
        sourceConfigurationFingerprint: fingerprint.toUpperCase(),
        completedAt: item.completedAt || null,
        terminalReconciledAt: item.terminalReconciledAt || null,
        successorCreatedAt: item.successorCreatedAt || null,
        successorOperationId: String(item.successorOperationId),
        priorLifecycle: safeLifecycle(priorLifecycle),
      }];
    }
    const legacyUnbound = item?.sourceConfigurationFingerprintStatus === LEGACY_UNBOUND_FINGERPRINT_STATUS
      && !Object.prototype.hasOwnProperty.call(item, 'sourceConfigurationFingerprint')
      && !Object.prototype.hasOwnProperty.call(item?.priorLifecycle || {}, 'lifecycleSchemaVersion')
      && !Object.prototype.hasOwnProperty.call(item?.priorLifecycle || {}, 'sourceConfigurationFingerprint')
      && !Object.prototype.hasOwnProperty.call(item?.priorLifecycle || {}, 'sourceConfigurationFingerprintStatus');
    const boundFingerprint = FINGERPRINT_PATTERN.test(String(item?.sourceConfigurationFingerprint || ''))
      && [undefined, 'BOUND'].includes(item?.sourceConfigurationFingerprintStatus);
    const attemptCount = Number(item?.attemptCount);
    const supersessionAttemptCountValid = Number.isInteger(attemptCount)
      && attemptCount >= 1
      && attemptCount <= MAX_CODEX_LIFECYCLE_ATTEMPTS
      && (!legacyUnbound || attemptCount === MAX_CODEX_LIFECYCLE_ATTEMPTS);
    const hasReconciliationBasis = Object.prototype.hasOwnProperty.call(item || {}, 'terminalReconciliationBasis');
    if (!UUID_PATTERN.test(String(item?.priorOperationId || ''))
      || !UUID_PATTERN.test(String(item?.replacementOperationId || ''))
      || item?.terminalState !== 'FAILED'
      || (!legacyUnbound && !boundFingerprint)
      || !supersessionAttemptCountValid
      || priorLifecycle.operationId !== item.priorOperationId
      || priorLifecycle.state !== 'FAILED'
      || Number(priorLifecycle.attemptCount) !== Number(item.attemptCount)) return [];
    if (hasReconciliationBasis
      && (item.terminalReconciliationBasis !== LEGACY_FAILURE_RECONCILIATION_BASIS
        || priorLifecycle.terminalReconciliationBasis !== LEGACY_FAILURE_RECONCILIATION_BASIS)) return [];
    const historyEntry = {
      eventType: 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED',
      priorOperationId: String(item.priorOperationId),
      attemptCount: Number(item.attemptCount),
      terminalState: 'FAILED',
      sourceConfigurationFingerprintStatus: legacyUnbound ? LEGACY_UNBOUND_FINGERPRINT_STATUS : 'BOUND',
      completedAt: item.completedAt || null,
      terminalReconciledAt: item.terminalReconciledAt || null,
      supersededAt: item.supersededAt || null,
      replacementOperationId: String(item.replacementOperationId),
      priorLifecycle: safeLifecycle(item.priorLifecycle || {}),
    };
    if (hasReconciliationBasis) historyEntry.terminalReconciliationBasis = LEGACY_FAILURE_RECONCILIATION_BASIS;
    if (!legacyUnbound) historyEntry.sourceConfigurationFingerprint = String(item.sourceConfigurationFingerprint).toUpperCase();
    return [historyEntry];
  });
}

function isLegacyPreFingerprintLifecycle(value = {}) {
  return !Object.prototype.hasOwnProperty.call(value, 'lifecycleSchemaVersion')
    && !Object.prototype.hasOwnProperty.call(value, 'sourceConfigurationFingerprint')
    && !Object.prototype.hasOwnProperty.call(value, 'sourceConfigurationFingerprintStatus');
}

function hasBoundSourceConfigurationFingerprint(value = {}) {
  const hasStatus = Object.prototype.hasOwnProperty.call(value, 'sourceConfigurationFingerprintStatus');
  return FINGERPRINT_PATTERN.test(String(value.sourceConfigurationFingerprint || ''))
    && (!hasStatus || value.sourceConfigurationFingerprintStatus === 'BOUND');
}

function hasSupersessionEvidence(lifecycle = {}, history = []) {
  return history.some((item) => item.priorOperationId === lifecycle.operationId)
    || Object.prototype.hasOwnProperty.call(lifecycle, 'supersededAt')
    || Object.prototype.hasOwnProperty.call(lifecycle, 'supersededByOperationId');
}

function isValidLifecycleTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const canonical = `${match[1]}.${String(match[2] || '').padEnd(3, '0')}Z`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === canonical;
}

function hasValidTerminalReconciliationBasis(lifecycle = {}) {
  return !Object.prototype.hasOwnProperty.call(lifecycle, 'terminalReconciliationBasis')
    || lifecycle.terminalReconciliationBasis === LEGACY_FAILURE_RECONCILIATION_BASIS;
}

function hasValidHistoricalFingerprintEvidence(lifecycle = {}) {
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(lifecycle, 'lifecycleSchemaVersion');
  const hasFingerprintEvidence = Object.prototype.hasOwnProperty.call(lifecycle, 'sourceConfigurationFingerprint')
    || Object.prototype.hasOwnProperty.call(lifecycle, 'sourceConfigurationFingerprintStatus');
  if (hasSchemaVersion && lifecycle.lifecycleSchemaVersion !== MANAGED_CODEX_LIFECYCLE_SCHEMA_VERSION) return false;
  if (hasSchemaVersion && !hasBoundSourceConfigurationFingerprint(lifecycle)) return false;
  return !hasFingerprintEvidence || hasBoundSourceConfigurationFingerprint(lifecycle);
}

function canReconcileLegacyPersistedFailure({ lifecycle, supervisor, lifecycleHistory, lifecycleHistoryIsValid }) {
  if (!lifecycle || lifecycle.state !== 'FAILED'
    || !Number.isInteger(lifecycle.attemptCount)
    || lifecycle.attemptCount !== MAX_CODEX_LIFECYCLE_ATTEMPTS
    || !UUID_PATTERN.test(String(lifecycle.operationId || ''))
    || !UUID_PATTERN.test(String(lifecycle.supervisorOperationId || ''))
    || lifecycle.supervisorOperationId !== lifecycle.operationId
    || !isValidLifecycleTimestamp(lifecycle.completedAt)
    || !hasValidHistoricalFingerprintEvidence(lifecycle)
    || hasSupersessionEvidence(lifecycle, lifecycleHistory)
    || lifecycleHistoryIsValid !== true
    || !supervisor
    || !Object.prototype.hasOwnProperty.call(supervisor, 'operation')
    || supervisor.operation !== null
    || Object.prototype.hasOwnProperty.call(lifecycle, 'terminalReconciliationBasis')) return false;

  const markerMissing = !Object.prototype.hasOwnProperty.call(lifecycle, 'terminalReconciledAt')
    || lifecycle.terminalReconciledAt === null
    || lifecycle.terminalReconciledAt === undefined;
  if (!markerMissing) return false;

  const last = supervisor.lastOperation;
  if (last && !UUID_PATTERN.test(String(last.operationId || ''))) return false;
  return !(last?.operationId === lifecycle.operationId && last.status !== 'FAILED');
}

async function readLifecycleRecord(queryExecutor = query) {
  const result = await queryExecutor(
    `SELECT installation_id, metadata
       FROM core.agent_runtime_installations
      WHERE installation_code = $1
      LIMIT 1`,
    [INSTALLATION_CODE],
  );
  if (result.rowCount !== 1) throw serviceError(503, 'MANAGED_CODEX_BINDING_UNAVAILABLE', 'The managed Codex installation is not registered.');
  const rawHistory = result.rows[0].metadata?.bootstrapLifecycleHistory;
  return {
    installationId: result.rows[0].installation_id,
    lifecycle: result.rows[0].metadata?.bootstrapLifecycle || null,
    lifecycleHistory: safeLifecycleHistory(rawHistory || []),
    rawLifecycleHistory: Array.isArray(rawHistory) ? rawHistory : [],
    lifecycleHistoryIsArray: rawHistory === undefined || Array.isArray(rawHistory),
  };
}

async function persistLifecycleRecord(installationId, lifecycle, queryExecutor = query) {
  await queryExecutor(
    `UPDATE core.agent_runtime_installations
        SET metadata = metadata || jsonb_build_object('bootstrapLifecycle', $2::jsonb),
            updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1`,
    [installationId, JSON.stringify(safeLifecycle(lifecycle))],
  );
}

async function claimLifecycleRecord(installationId, lifecycle, lifecycleHistory, expectedLifecycle, queryExecutor = query) {
  const result = await queryExecutor(
    `UPDATE core.agent_runtime_installations
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'bootstrapLifecycle', $2::jsonb,
              'bootstrapLifecycleHistory', $3::jsonb
            ),
            updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1
        AND COALESCE(metadata->'bootstrapLifecycle', 'null'::jsonb) IS NOT DISTINCT FROM $4::jsonb
      RETURNING installation_id`,
    [installationId, JSON.stringify(safeLifecycle(lifecycle)), JSON.stringify(lifecycleHistory), JSON.stringify(expectedLifecycle || null)],
  );
  if (result.rowCount !== 1) {
    throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_CHANGED', 'The managed Codex lifecycle changed concurrently; reconcile the current operation before retrying.');
  }
}

function sameCanonicalFilesystemPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return path.sep === '\\'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function validateManagedCodexCandidateSourceRoot(candidateRoot, fileSystem = fs) {
  const invalidRoot = () => serviceError(
    503,
    'MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_INVALID',
    'The trusted managed Codex candidate source root is unavailable or non-canonical.',
  );
  if (typeof candidateRoot !== 'string'
    || !candidateRoot
    || candidateRoot !== candidateRoot.trim()
    || !path.isAbsolute(candidateRoot)
    || path.normalize(candidateRoot) !== candidateRoot) {
    throw invalidRoot();
  }

  const resolvedRoot = path.resolve(candidateRoot);
  const volumeRoot = path.parse(resolvedRoot).root;
  if (!volumeRoot || sameCanonicalFilesystemPath(resolvedRoot, volumeRoot)) throw invalidRoot();

  try {
    const stat = fileSystem.lstatSync(resolvedRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidRoot();
    const realPath = fileSystem.realpathSync(resolvedRoot);
    if (!sameCanonicalFilesystemPath(resolvedRoot, realPath)) throw invalidRoot();
  } catch (_error) {
    throw invalidRoot();
  }
  return resolvedRoot;
}

function resolveManagedCodexCandidateSourceRoot(environment = process.env, fileSystem = fs) {
  return validateManagedCodexCandidateSourceRoot(
    environment?.[MANAGED_CODEX_CANDIDATE_SOURCE_ROOT_ENV],
    fileSystem,
  );
}

// Self-hosting invariant: the source identity used to authorize a rebuild must
// describe the source the Supervisor will build, not merely the source bytes of
// the API currently authorizing it. Runtime certification remains rooted at
// repositoryRoot(); only lifecycle admission uses this trusted candidate root.
function bootstrapSourceConfigurationFingerprint(fileSystem = fs) {
  const candidateRoot = resolveManagedCodexCandidateSourceRoot(process.env, fileSystem);
  const hash = crypto.createHash('sha256');
  hash.update('SKYCOMMAND_MANAGED_CODEX_BOOTSTRAP_FINGERPRINT_V1\0');
  try {
    for (const relativePath of CODEX_BOOTSTRAP_FINGERPRINT_INPUTS) {
      const absolutePath = path.join(candidateRoot, relativePath);
      const stat = fileSystem.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid fingerprint input');
      const bytes = fileSystem.readFileSync(absolutePath);
      hash.update(relativePath).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
    }
  } catch (_error) {
    throw serviceError(503, 'MANAGED_CODEX_FINGERPRINT_UNAVAILABLE', 'The source-controlled managed Codex bootstrap fingerprint could not be computed safely.');
  }
  return hash.digest('hex').toUpperCase();
}

async function readSupervisorRuntimeStatus(fetcher = fetch) {
  try {
    const response = await fetcher(`${getSupervisorBaseUrl()}/runtime/status`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload.ok === true ? payload : null;
  } catch (_error) {
    return null;
  }
}

async function reconcileManagedCodexLifecycle(operationId, request, dependencies = {}) {
  assertLifecyclePrincipal(request);
  if (!UUID_PATTERN.test(String(operationId || ''))) {
    throw serviceError(400, 'MANAGED_CODEX_LIFECYCLE_ID_INVALID', 'operationId must be a UUID.');
  }
  const queryExecutor = dependencies.queryExecutor || query;
  const {
    installationId,
    lifecycle,
    lifecycleHistory,
    rawLifecycleHistory,
    lifecycleHistoryIsArray,
  } = await readLifecycleRecord(queryExecutor);
  if (!lifecycle || lifecycle.operationId !== operationId) throw serviceError(404, 'MANAGED_CODEX_LIFECYCLE_NOT_FOUND', 'The managed Codex lifecycle operation was not found.');
  const supervisor = await readSupervisorRuntimeStatus(dependencies.fetcher || fetch);
  let next = { ...lifecycle };
  let legacyFailureCompatibilityReconciled = false;
  const active = supervisor?.operation;
  const last = supervisor?.lastOperation;
  const serviceRows = Array.isArray(supervisor?.services) ? supervisor.services : [];
  const relevantServices = serviceRows
    .filter((item) => CODEX_LIFECYCLE_HEALTH_SERVICES.includes(item.service))
    .map((item) => ({ service: item.service, state: item.state, health: item.health || null }));
  if (active?.operationId === operationId) {
    next = { ...next, state: 'DISPATCHED', runtimeServices: relevantServices };
  } else if (last?.operationId === operationId && last.status === 'FAILED') {
    next = {
      ...next,
      state: 'FAILED',
      completedAt: last.completedAt || lifecycle.completedAt || new Date().toISOString(),
      terminalReconciledAt: lifecycle.terminalReconciledAt || new Date().toISOString(),
      runtimeServices: relevantServices,
    };
  } else if (last?.operationId === operationId && last.status === 'SUCCEEDED') {
    const servicesHealthy = CODEX_LIFECYCLE_HEALTH_SERVICES.every((service) => {
      const item = serviceRows.find((candidate) => candidate.service === service);
      return item?.running === true && item?.health === 'HEALTHY';
    });
    if (!servicesHealthy) {
      next = { ...next, state: 'WAITING_READINESS', runtimeServices: relevantServices };
    } else {
      const { health } = await readHealth({ ...dependencies, queryExecutor });
      const ready = health?.ok === true && health.mcpReachability === 'CURRENT';
      next = {
        ...next,
        state: ready ? 'SUCCEEDED' : 'WAITING_READINESS',
        completedAt: ready ? (last.completedAt || new Date().toISOString()) : null,
        terminalReconciledAt: ready ? (lifecycle.terminalReconciledAt || new Date().toISOString()) : null,
        runtimeGeneration: health?.runtimeGeneration || null,
        readiness: health?.readiness || null,
        readinessReason: health?.mcpFailureReason || null,
        runtimeServices: relevantServices,
      };
    }
  } else if (canReconcileLegacyPersistedFailure({
    lifecycle,
    supervisor,
    lifecycleHistory,
    lifecycleHistoryIsValid: lifecycleHistoryIsArray && rawLifecycleHistory.length === lifecycleHistory.length,
  })) {
    next = {
      ...lifecycle,
      terminalReconciledAt: new Date().toISOString(),
      terminalReconciliationBasis: LEGACY_FAILURE_RECONCILIATION_BASIS,
    };
    legacyFailureCompatibilityReconciled = true;
  }
  const lifecycleChanged = JSON.stringify(next) !== JSON.stringify(lifecycle);
  if (lifecycleChanged) await persistLifecycleRecord(installationId, next, queryExecutor);
  const noActiveSupervisorOperation = Boolean(supervisor && Object.prototype.hasOwnProperty.call(supervisor, 'operation') && supervisor.operation === null);
  const sameOperationIsContradictory = last?.operationId === operationId && last.status !== 'FAILED';
  const terminalFailureConfirmed = noActiveSupervisorOperation
    && next.state === 'FAILED'
    && !sameOperationIsContradictory
    && hasValidTerminalReconciliationBasis(next)
    && (last?.operationId === operationId
      ? last.status === 'FAILED'
      : (lifecycle.state === 'FAILED' && isValidLifecycleTimestamp(lifecycle.terminalReconciledAt))
        || legacyFailureCompatibilityReconciled);
  const liveTerminalSuccessConfirmed = noActiveSupervisorOperation
    && next.state === 'SUCCEEDED'
    && Boolean(next.completedAt)
    && Boolean(next.terminalReconciledAt)
    && last?.operationId === operationId
    && last.status === 'SUCCEEDED';
  const sameOperationHasContradictoryOutcome = last?.operationId === operationId && last.status !== 'SUCCEEDED';
  // A reconciled success remains historical authority after Supervisor.lastOperation advances,
  // but never when current evidence contradicts this exact lifecycle operation.
  const durablePreviouslyReconciledSuccess = noActiveSupervisorOperation
    && lifecycle.state === 'SUCCEEDED'
    && Boolean(lifecycle.completedAt)
    && Boolean(lifecycle.terminalReconciledAt)
    && lifecycle.lifecycleSchemaVersion === MANAGED_CODEX_LIFECYCLE_SCHEMA_VERSION
    && hasBoundSourceConfigurationFingerprint(lifecycle)
    && next.state === 'SUCCEEDED'
    && !sameOperationHasContradictoryOutcome;
  return {
    installationId,
    currentLifecycle: lifecycleChanged ? safeLifecycle(next) : next,
    lifecycle: safeLifecycle(next),
    lifecycleHistory,
    supervisor,
    terminalFailureConfirmed,
    legacyFailureCompatibilityReconciled,
    liveTerminalSuccessConfirmed,
    durablePreviouslyReconciledSuccess,
    result: { ok: ['SUCCEEDED', 'WAITING_READINESS'].includes(next.state), lifecycle: safeLifecycle(next), lifecycleHistory, executionEnabled: false },
  };
}

async function getManagedCodexLifecycle(operationId, request, dependencies = {}) {
  const reconciled = await reconcileManagedCodexLifecycle(operationId, request, dependencies);
  return reconciled.result;
}

async function startManagedCodexLifecycle(operationId, request, dependencies = {}) {
  assertLifecyclePrincipal(request);
  if (!UUID_PATTERN.test(String(operationId || ''))) {
    throw serviceError(400, 'MANAGED_CODEX_LIFECYCLE_ID_INVALID', 'operationId must be a UUID.');
  }
  const queryExecutor = dependencies.queryExecutor || query;
  const { installationId, lifecycle: prior, lifecycleHistory: storedHistory, rawLifecycleHistory, lifecycleHistoryIsArray } = await readLifecycleRecord(queryExecutor);
  if (!lifecycleHistoryIsArray || rawLifecycleHistory.length !== storedHistory.length) {
    throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_HISTORY_INVALID', 'Existing lifecycle history could not be safely preserved; no replacement was started.');
  }
  if (operationId !== prior?.operationId
    && storedHistory.some((entry) => entry.priorOperationId === operationId
      || entry.replacementOperationId === operationId
      || entry.successorOperationId === operationId)) {
    throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_ID_REUSED', 'A prior managed Codex lifecycle UUID cannot be reused for a new operation.');
  }
  if (prior && !UUID_PATTERN.test(String(prior.operationId || ''))) {
    throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_RECORD_INVALID', 'The persisted lifecycle operation identity is invalid; no replacement was started.');
  }
  if (prior && (!Number.isInteger(Number(prior.attemptCount))
    || Number(prior.attemptCount) < 1
    || Number(prior.attemptCount) > MAX_CODEX_LIFECYCLE_ATTEMPTS)) {
    throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_RECORD_INVALID', 'The persisted lifecycle attempt count is invalid; no new attempt was started.');
  }
  const fingerprint = (dependencies.getBootstrapSourceConfigurationFingerprint
    || bootstrapSourceConfigurationFingerprint)();
  if (!FINGERPRINT_PATTERN.test(String(fingerprint || ''))) {
    throw serviceError(503, 'MANAGED_CODEX_FINGERPRINT_UNAVAILABLE', 'The source-controlled managed Codex bootstrap fingerprint is invalid.');
  }
  const currentFingerprint = String(fingerprint).toUpperCase();
  let priorForCas = prior;
  let lifecycleHistory = storedHistory;
  let supersedesOperationId = null;
  let successorOfOperationId = null;
  let attemptCount = 1;
  if (prior) {
    if (hasSupersessionEvidence(prior, storedHistory)) {
      throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_ALREADY_SUPERSEDED', 'The prior lifecycle is already represented as superseded; it cannot be superseded again.');
    }
    const observed = await reconcileManagedCodexLifecycle(prior.operationId, request, dependencies);
    priorForCas = observed.currentLifecycle;
    lifecycleHistory = observed.lifecycleHistory;
    const hasSchemaVersion = Object.prototype.hasOwnProperty.call(observed.lifecycle, 'lifecycleSchemaVersion');
    if (hasSchemaVersion && observed.lifecycle.lifecycleSchemaVersion !== MANAGED_CODEX_LIFECYCLE_SCHEMA_VERSION) {
      throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_SCHEMA_UNSUPPORTED', 'The persisted lifecycle schema version is unsupported; no new operation was started.');
    }
    if (prior.operationId === operationId) {
      if (['SUCCEEDED', 'DISPATCHED', 'WAITING_READINESS'].includes(observed.lifecycle.state)) {
        if (!hasBoundSourceConfigurationFingerprint(observed.lifecycle)) {
          throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE', 'The existing lifecycle is not bound to an authoritative source/configuration fingerprint.');
        }
        if (String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase() !== currentFingerprint) {
          throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_CHANGED', 'The existing operation identity is bound to a different source/configuration fingerprint.');
        }
        if (observed.lifecycle.state === 'SUCCEEDED'
          && !observed.liveTerminalSuccessConfirmed
          && !observed.durablePreviouslyReconciledSuccess) {
          throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_RECONCILIATION_REQUIRED', 'The successful lifecycle is not durably reconciled or currently confirmed by the Supervisor.');
        }
        return { ...observed.result, reused: true };
      }
      if (!observed.terminalFailureConfirmed || observed.lifecycle.state !== 'FAILED') {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_RECONCILIATION_REQUIRED', 'The existing lifecycle outcome is not authoritatively terminal; reconcile the same operationId before recovery.', { operationId });
      }
      if (Number(observed.lifecycle.attemptCount || 0) >= MAX_CODEX_LIFECYCLE_ATTEMPTS) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_EXHAUSTED', 'The managed Codex lifecycle has exhausted its two-attempt budget.', { operationId });
      }
      if (!hasBoundSourceConfigurationFingerprint(observed.lifecycle)) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE', 'The existing lifecycle is not bound to an authoritative source/configuration fingerprint.');
      }
      if (String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase() !== currentFingerprint) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_CHANGED', 'A changed bootstrap fingerprint requires a new lifecycle operation identity.');
      }
      attemptCount = Number(observed.lifecycle.attemptCount || 0) + 1;
    } else if ((observed.liveTerminalSuccessConfirmed || observed.durablePreviouslyReconciledSuccess)
      && observed.lifecycle.state === 'SUCCEEDED') {
      if (!hasBoundSourceConfigurationFingerprint(observed.lifecycle)) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE', 'The successful lifecycle is not bound to an authoritative source/configuration fingerprint.');
      }
      if (String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase() === currentFingerprint) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNCHANGED', 'A successful lifecycle already covers the current source/configuration fingerprint.');
      }
      if (lifecycleHistory.length >= MAX_CODEX_LIFECYCLE_HISTORY) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_HISTORY_LIMIT', 'The bounded lifecycle history is full; no prior evidence was discarded.');
      }
      const successorCreatedAt = new Date().toISOString();
      lifecycleHistory = [...lifecycleHistory, {
        eventType: 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED',
        priorOperationId: observed.lifecycle.operationId,
        attemptCount: Number(observed.lifecycle.attemptCount),
        terminalState: 'SUCCEEDED',
        sourceConfigurationFingerprintStatus: 'BOUND',
        sourceConfigurationFingerprint: String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase(),
        completedAt: observed.lifecycle.completedAt,
        terminalReconciledAt: observed.lifecycle.terminalReconciledAt,
        successorCreatedAt,
        successorOperationId: operationId,
        priorLifecycle: safeLifecycle(observed.lifecycle),
      }];
      successorOfOperationId = observed.lifecycle.operationId;
    } else {
      if (!observed.terminalFailureConfirmed || observed.lifecycle.state !== 'FAILED') {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_SUPERSESSION_NOT_TERMINAL', 'A lifecycle successor requires an authoritatively reconciled terminal FAILED or SUCCEEDED outcome and no active Supervisor operation.');
      }
      const legacyPreFingerprint = isLegacyPreFingerprintLifecycle(observed.lifecycle);
      const priorFingerprintIsBound = hasBoundSourceConfigurationFingerprint(observed.lifecycle);
      if (!legacyPreFingerprint && !priorFingerprintIsBound) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNAVAILABLE', 'The failed lifecycle is versioned or fingerprint-aware but has no valid authoritative fingerprint.');
      }
      const priorAttemptCount = Number(observed.lifecycle.attemptCount);
      if (legacyPreFingerprint && priorAttemptCount !== MAX_CODEX_LIFECYCLE_ATTEMPTS) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_REMAIN', 'The legacy failed lifecycle operation has not exhausted its authorized attempt budget.');
      }
      if (priorFingerprintIsBound
        && String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase() === currentFingerprint) {
        if (priorAttemptCount !== MAX_CODEX_LIFECYCLE_ATTEMPTS) {
          throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_ATTEMPTS_REMAIN', 'The failed lifecycle operation still has an authorized retry for the unchanged source/configuration fingerprint.');
        }
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_FINGERPRINT_UNCHANGED', 'A new lifecycle operation requires a changed source/configuration fingerprint.');
      }
      if (lifecycleHistory.length >= MAX_CODEX_LIFECYCLE_HISTORY) {
        throw serviceError(409, 'MANAGED_CODEX_LIFECYCLE_HISTORY_LIMIT', 'The bounded lifecycle supersession history is full; no prior evidence was discarded.');
      }
      const supersededAt = new Date().toISOString();
      lifecycleHistory = [...lifecycleHistory, {
        eventType: 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED',
        priorOperationId: observed.lifecycle.operationId,
        attemptCount: Number(observed.lifecycle.attemptCount),
        terminalState: 'FAILED',
        sourceConfigurationFingerprintStatus: legacyPreFingerprint
          ? LEGACY_UNBOUND_FINGERPRINT_STATUS
          : 'BOUND',
        completedAt: observed.lifecycle.completedAt,
        terminalReconciledAt: observed.lifecycle.terminalReconciledAt,
        ...(observed.lifecycle.terminalReconciliationBasis
          ? { terminalReconciliationBasis: observed.lifecycle.terminalReconciliationBasis }
          : {}),
        supersededAt,
        replacementOperationId: operationId,
        priorLifecycle: safeLifecycle(observed.lifecycle),
      }];
      if (priorFingerprintIsBound) {
        lifecycleHistory[lifecycleHistory.length - 1].sourceConfigurationFingerprint = String(observed.lifecycle.sourceConfigurationFingerprint).toUpperCase();
      }
      supersedesOperationId = observed.lifecycle.operationId;
    }
  }
  const lifecycle = {
    operationId,
    state: 'REQUESTED',
    attemptCount,
    requestedAt: supersedesOperationId || successorOfOperationId ? new Date().toISOString() : (priorForCas?.requestedAt || new Date().toISOString()),
    acceptedAt: null,
    completedAt: null,
    supervisorOperationId: operationId,
    services: [...CODEX_BOOTSTRAP_REBUILD_SERVICES],
    runtimeGeneration: null,
    readiness: null,
    readinessReason: null,
    runtimeServices: [],
    sourceConfigurationFingerprint: currentFingerprint,
    sourceConfigurationFingerprintStatus: 'BOUND',
    lifecycleSchemaVersion: MANAGED_CODEX_LIFECYCLE_SCHEMA_VERSION,
    ...(supersedesOperationId ? { supersedesOperationId } : {}),
    ...(successorOfOperationId ? { successorOfOperationId } : {}),
  };
  await claimLifecycleRecord(installationId, lifecycle, lifecycleHistory, priorForCas, queryExecutor);
  try {
    const authorized = await (dependencies.authorize || authorizeRuntimeControl)({
      action: 'REBUILD_CODEX_BOOTSTRAP',
      operationId,
      confirmed: true,
      actor: request.user || {},
      session: request.session || {},
      requestContext: authService.getRequestContext(request),
    });
    const response = await (dependencies.fetcher || fetch)(`${getSupervisorBaseUrl()}/runtime/rebuild-codex-bootstrap`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'X-SkyCommand-Supervisor-Grant': authorized.authorization.grant },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || payload.operation?.operationId !== operationId) {
      throw serviceError(502, payload.code || 'MANAGED_CODEX_SUPERVISOR_REJECTED', 'The Supervisor did not accept the fixed managed Codex rebuild operation.');
    }
    lifecycle.state = 'DISPATCHED';
    lifecycle.acceptedAt = new Date().toISOString();
    await persistLifecycleRecord(installationId, lifecycle, queryExecutor);
    return { ok: true, reused: false, lifecycle: safeLifecycle(lifecycle), lifecycleHistory: safeLifecycleHistory(lifecycleHistory), executionEnabled: false };
  } catch (error) {
    lifecycle.state = 'UNKNOWN';
    lifecycle.readinessReason = 'SUPERVISOR_OUTCOME_REQUIRES_RECONCILIATION';
    await persistLifecycleRecord(installationId, lifecycle, queryExecutor);
    throw serviceError(503, 'MANAGED_CODEX_LIFECYCLE_RECONCILIATION_REQUIRED', 'The fixed Supervisor rebuild outcome is uncertain; reconcile the same operationId before recovery.', {
      operationId,
      causeCode: String(error?.code || 'SUPERVISOR_DISPATCH_ERROR').slice(0, 100),
    });
  }
}

function assertOwner(account, request) {
  const userId = actorId(request);
  const assistantPrincipal = assistantPrincipalCode(request);
  const ownerPrincipal = account.metadata?.ownerPrincipalCode || account.account_metadata?.ownerPrincipalCode || null;
  if (assistantPrincipal && !account.owner_user_id && (!ownerPrincipal || ownerPrincipal === assistantPrincipal)) return;
  if (!userId || (account.owner_user_id && account.owner_user_id !== userId && !canAdminister(request))) {
    throw serviceError(404, 'MANAGED_CODEX_BINDING_NOT_FOUND', 'The managed Codex pilot binding is not available to this principal.');
  }
}

function safeOperation(row, exposeVerification = false) {
  if (!row) return null;
  const pending = row.operation_state === 'PENDING_USER'
    && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
  return {
    enrollmentId: row.enrollment_id,
    state: row.operation_state,
    authMode: row.auth_mode,
    loginReference: row.provider_login_reference || null,
    verificationUrl: exposeVerification && pending ? row.verification_url : null,
    userCode: exposeVerification && pending ? row.user_code : null,
    expiresAt: row.expires_at || null,
    startedAt: row.started_at || row.created_at || null,
    completedAt: row.completed_at || null,
    lastObservedAt: row.last_observed_at || null,
    failureCode: row.failure_code || null,
    safeResult: row.safe_result || {},
  };
}

function cleanAccountMetadata(value = {}) {
  const result = {};
  for (const key of ['accountType', 'authMode', 'planType']) {
    if (typeof value[key] === 'string' && value[key]) result[key] = value[key].slice(0, 40);
  }
  if (value.authenticated === true) result.authenticated = true;
  if (value.rateLimits && typeof value.rateLimits === 'object') result.rateLimits = value.rateLimits;
  if (value.usage && typeof value.usage === 'object') result.usage = value.usage;
  if (typeof value.observedAt === 'string') result.observedAt = value.observedAt;
  if (typeof value.source === 'string') result.source = value.source;
  return result;
}

function assessRuntimeIdentity(health, certification = {}) {
  const expected = {
    codexVersion: certification.packageVersion || EXPECTED_VERSION,
    wrapperPackageIntegrity: certification.wrapperPackageIntegrity || EXPECTED_WRAPPER_INTEGRITY,
    packageIntegrity: certification.packageIntegrity || EXPECTED_LINUX_INTEGRITY,
    packageLockSha256: certification.packageLockSha256 || null,
    protocolSchemaDigest: certification.protocolSchemaDigest || null,
    protocolSchemaV2Digest: certification.protocolSchemaV2Digest || null,
    installedArtifactSha256: typeof certification.installedArtifactSha256 === 'string'
      && /^[0-9A-F]{64}$/i.test(certification.installedArtifactSha256)
      ? certification.installedArtifactSha256.toUpperCase()
      : null,
    configurationDigest: certification.configurationDigest || null,
    networkPolicyDigest: certification.networkPolicyDigest || null,
  };
  const observed = {
    codexVersion: typeof health?.observedCodexVersion === 'string'
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(health.observedCodexVersion.trim())
      ? health.observedCodexVersion.trim()
      : null,
    packageIntegrity: typeof health?.observedPackageIntegrity === 'string'
      && /^sha512-[A-Za-z0-9+/]{86}==$/.test(health.observedPackageIntegrity.trim())
      ? health.observedPackageIntegrity.trim()
      : null,
    wrapperPackageIntegrity: typeof health?.observedWrapperPackageIntegrity === 'string'
      && /^sha512-[A-Za-z0-9+/]{86}==$/.test(health.observedWrapperPackageIntegrity.trim())
      ? health.observedWrapperPackageIntegrity.trim()
      : null,
    platformPackageVersion: typeof health?.observedPlatformPackageVersion === 'string'
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(health.observedPlatformPackageVersion)
      ? health.observedPlatformPackageVersion
      : null,
    packageLockSha256: typeof health?.observedPackageLockSha256 === 'string'
      && /^[0-9A-F]{64}$/i.test(health.observedPackageLockSha256)
      ? health.observedPackageLockSha256
      : null,
    protocolSchemaDigest: typeof health?.observedProtocolSchemaDigest === 'string'
      && /^[0-9A-F]{64}$/i.test(health.observedProtocolSchemaDigest.trim())
      ? health.observedProtocolSchemaDigest.trim().toUpperCase()
      : null,
    protocolSchemaV2Digest: typeof health?.protocolSchemaV2Digest === 'string'
      && /^[0-9A-F]{64}$/i.test(health.protocolSchemaV2Digest)
      ? health.protocolSchemaV2Digest.toUpperCase()
      : null,
    configurationDigest: typeof health?.configurationDigest === 'string' ? health.configurationDigest : null,
    networkPolicyDigest: typeof health?.networkPolicyDigest === 'string' ? health.networkPolicyDigest : null,
    installedArtifactSha256: typeof health?.observedInstalledArtifactSha256 === 'string'
      && /^[0-9A-F]{64}$/i.test(health.observedInstalledArtifactSha256)
      ? health.observedInstalledArtifactSha256.toUpperCase()
      : null,
  };
  const mismatchFields = [];
  const mismatchCodes = [];
  const addMismatch = (field, code) => {
    if (!mismatchFields.includes(field)) mismatchFields.push(field);
    if (!mismatchCodes.includes(code)) mismatchCodes.push(code);
  };

  if (!observed.codexVersion) addMismatch('observedCodexVersion', 'CODEX_OBSERVED_VERSION_UNAVAILABLE');
  else if (observed.codexVersion !== expected.codexVersion) addMismatch('observedCodexVersion', 'CODEX_VERSION_MISMATCH');
  if (!observed.wrapperPackageIntegrity) addMismatch('observedWrapperPackageIntegrity', 'CODEX_OBSERVED_WRAPPER_PACKAGE_INTEGRITY_UNAVAILABLE');
  else if (observed.wrapperPackageIntegrity !== expected.wrapperPackageIntegrity) addMismatch('observedWrapperPackageIntegrity', 'CODEX_WRAPPER_PACKAGE_INTEGRITY_MISMATCH');
  if (!observed.packageIntegrity) addMismatch('observedPackageIntegrity', 'CODEX_OBSERVED_PACKAGE_INTEGRITY_UNAVAILABLE');
  else if (observed.packageIntegrity !== expected.packageIntegrity) addMismatch('observedPackageIntegrity', 'CODEX_PACKAGE_INTEGRITY_MISMATCH');
  if (!expected.protocolSchemaDigest) addMismatch('expectedProtocolSchemaDigest', 'CODEX_PROTOCOL_SCHEMA_DIGEST_EXPECTED_MISSING');
  else if (!observed.protocolSchemaDigest) addMismatch('observedProtocolSchemaDigest', 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISSING');
  else if (observed.protocolSchemaDigest !== expected.protocolSchemaDigest.toUpperCase()) {
    addMismatch('observedProtocolSchemaDigest', 'CODEX_PROTOCOL_SCHEMA_DIGEST_MISMATCH');
  }
  if (!observed.installedArtifactSha256) {
    addMismatch('observedInstalledArtifactSha256', 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE');
  } else if (expected.installedArtifactSha256 && observed.installedArtifactSha256 !== expected.installedArtifactSha256) {
    addMismatch('observedInstalledArtifactSha256', 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED');
  }
  if (!expected.installedArtifactSha256) {
    addMismatch('expectedInstalledArtifactSha256', 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE');
  }

  const workerExpectedVersion = typeof health?.expectedCodexVersion === 'string' ? health.expectedCodexVersion : null;
  const workerExpectedIntegrity = typeof health?.expectedPackageIntegrity === 'string' ? health.expectedPackageIntegrity : null;
  const workerExpectedWrapperIntegrity = typeof health?.expectedWrapperPackageIntegrity === 'string'
    ? health.expectedWrapperPackageIntegrity
    : null;
  const workerExpectedPackageLockSha256 = typeof health?.expectedPackageLockSha256 === 'string'
    && /^[0-9A-F]{64}$/i.test(health.expectedPackageLockSha256)
    ? health.expectedPackageLockSha256.toUpperCase()
    : null;
  const workerExpectedProtocolDigest = typeof health?.expectedProtocolSchemaDigest === 'string'
    ? health.expectedProtocolSchemaDigest.toUpperCase()
    : null;
  const workerExpectedProtocolV2Digest = typeof health?.expectedProtocolSchemaV2Digest === 'string'
    ? health.expectedProtocolSchemaV2Digest.toUpperCase()
    : null;
  const workerExpectedArtifactDigest = typeof health?.expectedInstalledArtifactSha256 === 'string'
    && /^[0-9A-F]{64}$/i.test(health.expectedInstalledArtifactSha256)
    ? health.expectedInstalledArtifactSha256.toUpperCase()
    : null;
  if (
    workerExpectedVersion !== expected.codexVersion
    || workerExpectedWrapperIntegrity !== expected.wrapperPackageIntegrity
    || workerExpectedIntegrity !== expected.packageIntegrity
    || workerExpectedPackageLockSha256 !== expected.packageLockSha256
    || workerExpectedProtocolDigest !== expected.protocolSchemaDigest
    || workerExpectedProtocolV2Digest !== expected.protocolSchemaV2Digest
    || workerExpectedArtifactDigest !== expected.installedArtifactSha256
  ) addMismatch('workerExpectedIdentity', 'CODEX_API_WORKER_IDENTITY_MISMATCH');

  if (health?.identityAttestation !== 'VERIFIED') {
    addMismatch('identityAttestation', health?.identityAttestation === 'FAILED'
      ? 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED'
      : 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE');
  }
  for (const field of Array.isArray(health?.identityMismatchFields) ? health.identityMismatchFields : []) {
    if ([
      'observedCodexVersion',
      'observedWrapperPackageIntegrity',
      'observedPackageIntegrity',
      'observedInstalledArtifactSha256',
      'installedPackageManifest',
      'installedPackageLock',
      'artifactAttestation',
    ].includes(field)) {
      addMismatch(field, field === 'observedCodexVersion'
        ? (observed.codexVersion ? 'CODEX_VERSION_MISMATCH' : 'CODEX_OBSERVED_VERSION_UNAVAILABLE')
        : field === 'observedWrapperPackageIntegrity'
          ? (observed.wrapperPackageIntegrity ? 'CODEX_WRAPPER_PACKAGE_INTEGRITY_MISMATCH' : 'CODEX_OBSERVED_WRAPPER_PACKAGE_INTEGRITY_UNAVAILABLE')
        : field === 'observedPackageIntegrity'
          ? (observed.packageIntegrity ? 'CODEX_PACKAGE_INTEGRITY_MISMATCH' : 'CODEX_OBSERVED_PACKAGE_INTEGRITY_UNAVAILABLE')
          : field === 'observedInstalledArtifactSha256'
            ? (observed.installedArtifactSha256 ? 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED' : 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_UNAVAILABLE')
          : 'CODEX_INSTALLED_ARTIFACT_ATTESTATION_FAILED');
    }
  }

  return {
    observed,
    expected,
    attestation: health?.identityAttestation === 'VERIFIED'
      ? 'VERIFIED'
      : health?.identityAttestation === 'FAILED' ? 'FAILED' : 'UNAVAILABLE',
    mismatchFields,
    mismatchCodes,
    readinessCode: mismatchCodes[0] || null,
    readinessReason: mismatchCodes.length
      ? `Managed Codex identity check failed: ${mismatchCodes[0]}.`
      : null,
  };
}

function readinessFor({ health, accountState, activeOperation, certification }) {
  const identity = assessRuntimeIdentity(health, certification);
  if (!certification.installed) return { readiness: 'UNINSTALLED', reason: 'Managed Codex runtime registration is absent.' };
  if (!health) return { readiness: 'RUNTIME_OFFLINE', reason: 'The managed Codex runtime health endpoint is unavailable.' };
  if (identity.mismatchFields.length) {
    return {
      readiness: 'PROTOCOL_INCOMPATIBLE',
      reason: identity.readinessReason,
      readinessCode: identity.readinessCode,
      mismatchFields: identity.mismatchFields,
    };
  }
  if (health.ok !== true) return { readiness: 'INSTALLATION_UNCERTIFIED', reason: 'The managed Codex runtime has not passed its own startup and containment checks.' };
  if (health.configurationDigest !== certification.configurationDigest || health.networkPolicyDigest !== certification.networkPolicyDigest) {
    return { readiness: 'CONFIG_DRIFT', reason: 'Managed Codex configuration or provider egress policy differs from its source-controlled identity.' };
  }
  if (health.containment?.nonRoot !== true || health.containment?.noNewPrivileges !== true || health.containment?.allLinuxCapabilitiesDropped !== true || health.containment?.readOnlyRootFilesystem !== true || health.containment?.managedHomeVolumeOnly !== true || health.containment?.liveCheckoutMount !== false || health.containment?.arbitraryHostPathMount !== false || health.containment?.dockerSocket !== false || health.containment?.gitAvailable !== false || health.containment?.browserState !== false || health.containment?.prohibitedCredentials !== true) {
    return { readiness: 'INSTALLATION_UNCERTIFIED', reason: 'The runtime containment profile did not pass all observed checks.' };
  }
  if (health.mcpReachability !== 'CURRENT') return { readiness: 'MCP_UNREACHABLE', reason: 'The required managed SkyCommand MCP facade is not healthy.' };
  if (activeOperation && ['CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED'].includes(activeOperation.operation_state)) {
    return { readiness: 'ACCOUNT_AUTHENTICATING', reason: 'The managed account enrollment operation has not reconciled to an authenticated account.' };
  }
  if (accountState !== 'CONFIGURED') return { readiness: 'ACCOUNT_UNENROLLED', reason: 'The managed Codex pilot account is not enrolled.' };
  if (health.providerReachability !== 'CURRENT') return { readiness: 'PROVIDER_UNREACHABLE', reason: 'A current provider/authentication reachability check has not succeeded.' };
  return { readiness: 'CURRENT', reason: 'Runtime, containment, provider, MCP, and managed account prerequisites are current for the registered managed Codex profile.' };
}

function enrollmentRuntimeReadiness({ installation, health, certification } = {}) {
  const decision = readinessFor({
    health,
    accountState: 'UNCONFIGURED',
    activeOperation: null,
    certification: { ...(certification || {}), installed: Boolean(installation) },
  });
  if (decision.readiness === 'ACCOUNT_UNENROLLED') {
    return { ready: true, readiness: 'RUNTIME_READY', reason: 'The pinned runtime, containment, egress policy, and managed MCP checks passed; account enrollment may begin.' };
  }
  return { ready: false, readiness: decision.readiness, reason: decision.reason };
}

function repositoryRoot() {
  return path.resolve(__dirname, '../../../..');
}

function expectedCertification(root = repositoryRoot()) {
  const packagePath = path.join(root, 'docker/codex-agent-runtime/package.json');
  const lockPath = path.join(root, 'docker/codex-agent-runtime/package-lock.json');
  const configPath = path.join(root, 'docker/codex-agent-runtime/config.toml');
  const networkPath = path.join(root, 'docker/codex-provider-allowlist.txt');
  const packageStat = fs.lstatSync(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
    throw serviceError(503, 'CODEX_PACKAGE_IDENTITY_INVALID', 'The source-controlled Codex package identity is invalid.');
  }
  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lockBytes = fs.readFileSync(lockPath);
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const protocolCertification = packageMetadata.skycommandRuntimeCertification;
  const validDigest = (value) => typeof value === 'string' && /^[0-9A-F]{64}$/i.test(value);
  const protocolCertificationValid = protocolCertification?.schema === 'SKYCOMMAND_CODEX_RUNTIME_CERTIFICATION_V1'
    && protocolCertification.packageVersion === EXPECTED_VERSION
    && protocolCertification.wrapperPackageIntegrity === EXPECTED_WRAPPER_INTEGRITY
    && protocolCertification.linuxX64PackageIntegrity === EXPECTED_LINUX_INTEGRITY
    && validDigest(protocolCertification.installedArtifactSha256)
    && validDigest(protocolCertification.primaryProtocolSchemaDigest)
    && validDigest(protocolCertification.versionedProtocolSchemaDigests?.v2);
  const wrapperNode = lock.packages?.['node_modules/@openai/codex'];
  const packageNode = lock.packages?.['node_modules/@openai/codex-linux-x64'];
  if (wrapperNode?.version !== EXPECTED_VERSION
    || wrapperNode?.integrity !== EXPECTED_WRAPPER_INTEGRITY
    || packageNode?.version !== `${EXPECTED_VERSION}-linux-x64`
    || packageNode?.integrity !== EXPECTED_LINUX_INTEGRITY
    || packageMetadata.dependencies?.['@openai/codex'] !== EXPECTED_VERSION) {
    throw serviceError(503, 'CODEX_PACKAGE_LOCK_INVALID', 'The source-controlled Codex package identity is invalid.');
  }
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  return {
    packageVersion: EXPECTED_VERSION,
    wrapperPackageIntegrity: wrapperNode.integrity,
    packageIntegrity: packageNode.integrity,
    packageLockSha256: sha(lockBytes),
    installedArtifactSha256: protocolCertificationValid ? protocolCertification.installedArtifactSha256 : null,
    protocolSchemaDigest: protocolCertificationValid ? protocolCertification.primaryProtocolSchemaDigest : null,
    protocolSchemaV2Digest: protocolCertificationValid ? protocolCertification.versionedProtocolSchemaDigests.v2 : null,
    configurationDigest: sha(fs.readFileSync(configPath)),
    networkPolicyDigest: sha(fs.readFileSync(networkPath)),
  };
}

function readBridgeToken(filePath = process.env.CODEX_CONTROL_BRIDGE_TOKEN_FILE || '/run/codex-api-bridge/api-bridge-token') {
  const token = fs.readFileSync(filePath, 'utf8').trim();
  if (token.length < 40) throw serviceError(503, 'CODEX_CONTROL_BRIDGE_CREDENTIAL_INVALID', 'Managed Codex control bridge authentication is unavailable.');
  return token;
}

async function callBridge(pathname, method = 'POST', body = {}, options = {}) {
  const base = String(options.baseUrl || process.env.CODEX_CONTROL_BRIDGE_URL || 'http://codex-control-bridge-api-control:4220').replace(/\/+$/, '');
  let response;
  try {
    response = await (options.fetcher || fetch)(`${base}${pathname}`, {
      method,
      headers: { accept: 'application/json', authorization: `Bearer ${options.token || readBridgeToken()}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs || 65000),
    });
  } catch (_error) {
    throw serviceError(503, 'CODEX_RUNTIME_UNAVAILABLE', 'The managed Codex runtime control path is unavailable.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    const candidateCode = payload.code;
    const code = typeof candidateCode === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(candidateCode)
      ? candidateCode
      : 'CODEX_RUNTIME_OPERATION_FAILED';
    const observedProviderDestinations = code === 'CODEX_PROVIDER_EGRESS_BLOCKED'
      ? safeProviderDestinations(payload.details?.observedProviderDestinations)
      : [];
    const rpcDiagnostic = safeRpcDiagnostic(payload.details?.rpcDiagnostic);
    throw serviceError(response.status >= 500 ? 503 : 409, code, 'The managed Codex runtime operation did not complete.', {
      status: response.status,
      ...(observedProviderDestinations.length ? { observedProviderDestinations } : {}),
      ...(rpcDiagnostic ? { rpcDiagnostic } : {}),
    });
  }
  return payload;
}

async function loadPilot(queryExecutor = query, request) {
  const installationResult = await queryExecutor(
    `SELECT i.*, r.runtime_code, r.runtime_name
       FROM core.agent_runtime_installations i
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
      WHERE r.runtime_code = $1 AND i.installation_code = $2 AND r.active = TRUE
      LIMIT 1`,
    [RUNTIME_CODE, INSTALLATION_CODE],
  );
  const installation = installationResult.rows[0] || null;
  if (!installation) return { installation: null, account: null, activeOperation: null };
  const accountResult = await queryExecutor(
    `SELECT * FROM core.agent_runtime_accounts WHERE installation_id = $1 AND account_code = $2 LIMIT 1`,
    [installation.installation_id, ACCOUNT_CODE],
  );
  const account = accountResult.rows[0] || null;
  if (account && request) assertOwner(account, request);
  let activeOperation = null;
  if (account) {
    const operationResult = await queryExecutor(
      `SELECT * FROM core.agent_runtime_enrollment_operations
        WHERE account_binding_id = $1 AND operation_state = ANY($2::text[])
        ORDER BY created_at DESC LIMIT 1`,
      [account.account_binding_id, ACTIVE_STATES],
    );
    activeOperation = operationResult.rows[0] || null;
  }
  return { installation, account, activeOperation };
}

async function persistRuntimeObservation(installation, health, certification, queryExecutor = query) {
  const admission = readinessFor({ health, accountState: 'UNCONFIGURED', certification: { ...certification, installed: true } });
  const identity = assessRuntimeIdentity(health, certification);
  const safeObservation = health ? {
    runtimeKind: health.runtimeKind || null,
    runtimeIdentity: identity,
    codexVersion: identity.observed.codexVersion,
    packageIntegrity: identity.observed.packageIntegrity,
    packageLockSha256: identity.observed.packageLockSha256,
    protocolSchemaDigest: identity.observed.protocolSchemaDigest,
    protocolSchemaV2Digest: identity.observed.protocolSchemaV2Digest,
    configurationDigest: identity.observed.configurationDigest,
    networkPolicyDigest: identity.observed.networkPolicyDigest,
    runtimeGeneration: health.runtimeGeneration || null,
    processId: Number.isInteger(health.processId) ? health.processId : null,
    processStartedAt: health.processStartedAt || null,
    imageBuildId: health.imageBuildId || null,
    mcpReachability: health.mcpReachability || 'UNKNOWN',
    mcpFailureReason: health.mcpFailureReason || null,
    providerReachability: health.providerReachability || 'UNKNOWN',
    providerLastVerifiedAt: health.providerLastVerifiedAt || null,
    observedProviderDestinations: safeProviderDestinations(health.observedProviderDestinations),
    containment: health.containment || {},
    observedAt: health.observedAt || new Date().toISOString(),
    ok: health.ok === true,
    readiness: admission.readiness,
    readinessReason: admission.reason,
  } : {
    runtimeIdentity: identity,
    ok: false,
    readiness: 'RUNTIME_OFFLINE',
    readinessReason: 'The managed Codex runtime health endpoint is unavailable.',
    observedAt: new Date().toISOString(),
  };
  const certified = Boolean(health?.ok && admission.readiness !== 'CONFIG_DRIFT' && admission.readiness !== 'PROTOCOL_INCOMPATIBLE' && admission.readiness !== 'INSTALLATION_UNCERTIFIED' && admission.readiness !== 'MCP_UNREACHABLE');
  const freshness = certified ? 'CURRENT' : (health ? 'STALE_BLOCKED' : 'UNKNOWN');
  await queryExecutor(
    `UPDATE core.agent_runtime_installations
        SET certification_state = $2,
            enabled = $3,
            protocol_schema_digest = $4,
            configuration_revision = $5,
            configuration_digest = $6,
            process_generation = $7,
            process_started_at = $8,
            service_generation = $9,
            observed_at = $10,
            freshness_status = $11,
            metadata = metadata || $12::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE installation_id = $1`,
    [
      installation.installation_id,
      certified ? 'CERTIFIED' : 'UNVERIFIED',
      certified,
      identity.observed.protocolSchemaDigest,
      'phase19.3a0.bootstrap.v1',
      identity.observed.configurationDigest,
      health?.runtimeGeneration || null,
      health?.processStartedAt || null,
      health?.imageBuildId || null,
      health?.observedAt || new Date().toISOString(),
      freshness,
      JSON.stringify({
        ...safeObservation,
        runtimeIdentity: identity,
        expectedPackageVersion: certification.packageVersion,
        expectedWrapperPackageIntegrity: certification.wrapperPackageIntegrity,
        expectedPackageIntegrity: certification.packageIntegrity,
        expectedPackageLockSha256: certification.packageLockSha256,
        expectedProtocolSchemaDigest: certification.protocolSchemaDigest || null,
        expectedProtocolSchemaV2Digest: certification.protocolSchemaV2Digest || null,
        expectedInstalledArtifactSha256: identity.expected.installedArtifactSha256,
        expectedConfigurationDigest: certification.configurationDigest,
        expectedNetworkPolicyDigest: certification.networkPolicyDigest,
        managedHomeReference: 'docker-volume:skycommand_codex_managed_home',
        executionEnabled: false,
      }),
    ],
  );
  return { observation: safeObservation, certification: certified ? 'CERTIFIED' : 'UNVERIFIED', freshness };
}

async function readHealth({ queryExecutor = query, bridge = callBridge, persistObservation = true } = {}) {
  const { installation } = await loadPilot(queryExecutor);
  if (!installation) return { installation: null, health: null, certification: expectedCertification() };
  const certification = expectedCertification();
  let health = null;
  try { health = (await bridge('/v1/runtime/health', 'GET')).health || null; }
  catch (_error) { health = null; }
  if (persistObservation) await persistRuntimeObservation(installation, health, certification, queryExecutor);
  return { installation, health, certification };
}

function safeManagedStatus({ installation, account, activeOperation, health, certification }) {
  const identity = assessRuntimeIdentity(health, certification);
  const decision = readinessFor({
    health,
    accountState: account?.account_state || 'UNCONFIGURED',
    activeOperation,
    certification: { ...certification, installed: Boolean(installation) },
  });
  const metadata = account?.metadata && typeof account.metadata === 'object' ? account.metadata : {};
  return {
    profile: PROFILE,
    runtime: {
      runtimeCode: RUNTIME_CODE,
      runtimeName: 'Managed OpenAI Codex App Server',
      installationCode: INSTALLATION_CODE,
      certificationState: installation?.certification_state || 'UNVERIFIED',
      freshnessStatus: installation?.freshness_status || 'UNKNOWN',
      enabled: installation?.enabled === true,
      executionEnabled: installation?.execution_enabled === true,
      readiness: decision.readiness,
      readinessReason: decision.reason,
      readinessCode: decision.readinessCode || null,
      identityMismatchFields: identity.mismatchFields,
      identityMismatchCodes: identity.mismatchCodes,
      identityAttestation: identity.attestation,
      observedIdentity: identity.observed,
      expectedIdentity: identity.expected,
      version: identity.observed.codexVersion,
      package: '@openai/codex-linux-x64',
      wrapperPackageIntegrity: identity.observed.wrapperPackageIntegrity,
      expectedWrapperPackageIntegrity: identity.expected.wrapperPackageIntegrity,
      packageIntegrity: identity.observed.packageIntegrity,
      expectedPackageVersion: identity.expected.codexVersion,
      expectedPackageIntegrity: identity.expected.packageIntegrity,
      packageLockSha256: identity.observed.packageLockSha256,
      expectedPackageLockSha256: identity.expected.packageLockSha256,
      installedArtifactSha256: identity.observed.installedArtifactSha256,
      expectedInstalledArtifactSha256: identity.expected.installedArtifactSha256,
      protocolSchemaDigest: identity.observed.protocolSchemaDigest,
      expectedProtocolSchemaDigest: identity.expected.protocolSchemaDigest,
      protocolSchemaV2Digest: identity.observed.protocolSchemaV2Digest,
      expectedProtocolSchemaV2Digest: identity.expected.protocolSchemaV2Digest,
      configurationDigest: identity.observed.configurationDigest,
      networkPolicyDigest: identity.observed.networkPolicyDigest,
      runtimeGeneration: health?.runtimeGeneration || null,
      imageBuildId: health?.imageBuildId || null,
      mcpReachability: health?.mcpReachability || 'UNREACHABLE',
      egressDiagnosticCaptureReady: health?.egressDiagnosticCaptureReady === true,
      providerReachability: health?.providerReachability || 'UNKNOWN',
      managedHomeReference: 'docker-volume:skycommand_codex_managed_home',
      containment: health?.containment || null,
      observedAt: health?.observedAt || null,
      observedProviderDestinations: safeProviderDestinations(health?.observedProviderDestinations),
      loginStateDiagnostic: safeLoginStateDiagnostic(health?.loginStateDiagnostic),
    },
    account: account ? {
      accountBindingId: account.account_binding_id,
      accountCode: account.account_code,
      accountAlias: account.account_alias,
      accountState: account.account_state,
      executionEnabled: account?.execution_enabled === true,
      authMode: metadata.authMode || AUTH_MODE,
      accountType: metadata.accountType || null,
      planType: metadata.planType || null,
      lastVerifiedAt: metadata.lastVerifiedAt || null,
      rateLimits: metadata.rateLimits || null,
      usage: metadata.usage || null,
    } : null,
    enrollment: safeOperation(activeOperation, true),
    humanActionRequired: Boolean(activeOperation && activeOperation.operation_state === 'PENDING_USER'),
  };
}

async function getManagedCodex(request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { installation, account, activeOperation } = await loadPilot(queryExecutor, request);
  if (!installation) return safeManagedStatus({ installation: null, account: null, activeOperation: null, health: null, certification: expectedCertification() });
  const { health, certification } = await readHealth({ ...dependencies, persistObservation: false });
  return safeManagedStatus({ installation, account, activeOperation, health, certification });
}

async function getCompatibilityDiagnostics(request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { installation, account } = await loadPilot(queryExecutor, request);
  if (!installation || !account) throw serviceError(503, 'MANAGED_CODEX_BINDING_UNAVAILABLE', 'The managed Codex pilot binding is not registered.');
  assertOwner(account, request);
  const definition = await queryExecutor(
    `SELECT v.configuration
       FROM core.agent_definitions d
       JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
      WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
        AND d.active = TRUE
      ORDER BY v.revision DESC
      LIMIT 1`,
  );
  const configuration = definition.rows[0]?.configuration && typeof definition.rows[0].configuration === 'object'
    ? definition.rows[0].configuration
    : {};
  const requestedModel = typeof configuration.model === 'string' ? configuration.model : null;
  const requestedReasoningEffort = typeof configuration.reasoningEffort === 'string' ? configuration.reasoningEffort : null;
  const payload = await (dependencies.bridge || callBridge)('/v1/diagnostics/compatibility', 'POST', {
    requestedModel,
    requestedReasoningEffort,
  }, { timeoutMs: 30000 });
  return {
    profile: PROFILE,
    requestedModel,
    requestedReasoningEffort,
    diagnostics: payload.diagnostics || null,
    observedAt: new Date().toISOString(),
  };
}

async function getBootstrapReadiness(dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { installation, account, activeOperation } = await loadPilot(queryExecutor);
  if (!installation) return { ok: false, readiness: 'UNINSTALLED', executionEnabled: false };
  const { health, certification } = await readHealth({ ...dependencies, persistObservation: false });
  const decision = readinessFor({
    health,
    accountState: account?.account_state || 'UNCONFIGURED',
    activeOperation,
    certification: { ...certification, installed: true },
  });
  return {
    ok: decision.readiness === 'CURRENT',
    readiness: decision.readiness,
    readinessReason: decision.reason,
    executionEnabled: installation.execution_enabled === true && account?.execution_enabled === true,
    runtimeGeneration: health?.runtimeGeneration || null,
    observedAt: health?.observedAt || new Date().toISOString(),
  };
}

function validateDeviceResponse(enrollment = {}) {
  let url;
  try { url = new URL(String(enrollment.verificationUrl || '')); } catch (_error) { url = null; }
  if (!url || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.pathname !== '/codex/device') {
    throw serviceError(502, 'CODEX_DEVICE_LOGIN_RESPONSE_INVALID', 'The pinned Codex app-server returned an unexpected device verification address.');
  }
  const loginId = String(enrollment.loginId || '').trim();
  const userCode = String(enrollment.userCode || '').trim();
  if (!loginId || loginId.length > 100 || !/^[A-Za-z0-9-]{3,32}$/.test(userCode)) {
    throw serviceError(502, 'CODEX_DEVICE_LOGIN_RESPONSE_INVALID', 'The pinned Codex app-server returned an invalid device-code response.');
  }
  return { verificationUrl: url.toString(), userCode, loginReference: loginId, expiresAt: enrollment.expiresAt || null };
}

async function startEnrollment(request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { installation, account, activeOperation } = await loadPilot(queryExecutor, request);
  if (!installation || !account) throw serviceError(503, 'MANAGED_CODEX_BINDING_UNAVAILABLE', 'The managed Codex pilot binding is not registered.');
  assertOwner(account, request);
  if (account.account_state === 'REVOKED') throw serviceError(409, 'MANAGED_CODEX_ACCOUNT_REVOKED', 'The managed Codex account binding is revoked.');
  if (account.account_state === 'CONFIGURED') throw serviceError(409, 'MANAGED_CODEX_ACCOUNT_ALREADY_ENROLLED', 'The managed Codex account is already enrolled.');
  if (activeOperation) {
    if (activeOperation.operation_state === 'PENDING_USER') return { ok: true, reused: true, enrollment: safeOperation(activeOperation, true) };
    return reconcileEnrollment(activeOperation.enrollment_id, request, dependencies);
  }

  const runtime = await readHealth({ ...dependencies, queryExecutor });
  const runtimeGate = enrollmentRuntimeReadiness(runtime);
  if (!runtimeGate.ready) {
    throw serviceError(503, 'CODEX_RUNTIME_NOT_READY', 'Managed device-code enrollment is unavailable until runtime certification, containment, egress policy, and MCP readiness pass.', {
      readiness: runtimeGate.readiness,
    });
  }

  const actor = actorId(request);
  const principalCode = assistantPrincipalCode(request);
  if (!actor && !principalCode) throw serviceError(401, 'MANAGED_CODEX_OWNER_REQUIRED', 'An authenticated owner or scoped Assistant principal is required for managed account enrollment.');
  const enrollmentId = randomUUID();
  const poolRef = dependencies.poolRef || pool;
  const client = await poolRef.connect();
  let row;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT a.* FROM core.agent_runtime_accounts a WHERE a.account_binding_id = $1 FOR UPDATE`,
      [account.account_binding_id],
    );
    if (locked.rowCount !== 1) throw serviceError(404, 'MANAGED_CODEX_BINDING_NOT_FOUND', 'The managed Codex account binding is unavailable.');
    const current = locked.rows[0];
    assertOwner(current, request);
    if (current.account_state !== 'UNCONFIGURED') throw serviceError(409, 'MANAGED_CODEX_ACCOUNT_NOT_UNCONFIGURED', 'The managed Codex account is not available for enrollment.');
    const existing = await client.query(
      `SELECT * FROM core.agent_runtime_enrollment_operations
        WHERE account_binding_id = $1 AND operation_state = ANY($2::text[])
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [current.account_binding_id, ACTIVE_STATES],
    );
    if (existing.rowCount) {
      await client.query('COMMIT');
      return existing.rows[0].operation_state === 'PENDING_USER'
        ? { ok: true, reused: true, enrollment: safeOperation(existing.rows[0], true) }
        : reconcileEnrollment(existing.rows[0].enrollment_id, request, dependencies);
    }
    await client.query(
      `UPDATE core.agent_runtime_accounts
          SET owner_user_id = COALESCE(owner_user_id, $2),
              metadata = CASE WHEN $3::text IS NULL THEN metadata ELSE metadata || jsonb_build_object('ownerPrincipalCode', $3) END,
              updated_by = $2, updated_at = CURRENT_TIMESTAMP
        WHERE account_binding_id = $1`,
      [current.account_binding_id, actor, principalCode],
    );
    const inserted = await client.query(
      `INSERT INTO core.agent_runtime_enrollment_operations (
         enrollment_id, installation_id, account_binding_id, provider_code, auth_mode,
         operation_state, started_at, provider_attempt_count, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, 'AUTHENTICATING', CURRENT_TIMESTAMP, 1, $6, $6)
       RETURNING *`,
      [enrollmentId, installation.installation_id, current.account_binding_id, PROVIDER_CODE, AUTH_MODE, actor],
    );
    row = inserted.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    const result = await (dependencies.bridge || callBridge)('/v1/enrollment/start', 'POST', { operationId: enrollmentId });
    const details = validateDeviceResponse(result.enrollment || {});
    const updated = await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'PENDING_USER', provider_login_reference = $2,
              verification_url = $3, user_code = $4, expires_at = $5,
              last_observed_at = CURRENT_TIMESTAMP, failure_code = NULL,
              updated_by = $6
        WHERE enrollment_id = $1 RETURNING *`,
      [enrollmentId, details.loginReference, details.verificationUrl, details.userCode, details.expiresAt, actor],
    );
    await authService.recordAuditEvent({
      appCode: request.session?.appCode,
      userId: actor,
      eventType: 'AGENT_RUNTIME_ENROLLMENT',
      resourceType: 'core.agent_runtime_accounts',
      resourceId: account.account_binding_id,
      action: 'start_managed_codex_device_login',
      success: true,
      message: 'Managed Codex device-code enrollment started.',
      metadata: { providerCode: PROVIDER_CODE, authMode: AUTH_MODE, enrollmentId, operationState: 'PENDING_USER', executionEnabled: false },
      ...authService.getRequestContext(request),
    });
    return { ok: true, reused: false, enrollment: safeOperation(updated.rows[0], true) };
  } catch (error) {
    const code = String(error.code || 'CODEX_RUNTIME_OPERATION_FAILED').slice(0, 100);
    await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'RECONCILIATION_REQUIRED', verification_url = NULL,
              user_code = NULL, failure_code = $2, safe_result = $3::jsonb,
              last_observed_at = CURRENT_TIMESTAMP, updated_by = $4
        WHERE enrollment_id = $1 AND operation_state = 'AUTHENTICATING'`,
      [enrollmentId, code, JSON.stringify({ observedProviderDestinations: safeProviderDestinations(error.details?.observedProviderDestinations), executionEnabled: false }), actor],
    );
    throw serviceError(503, 'MANAGED_CODEX_ENROLLMENT_RECONCILIATION_REQUIRED', 'The original managed Codex enrollment operation has an uncertain provider outcome. Reconcile this operation before any replacement login.', { enrollmentId, causeCode: code });
  }
}

async function getEnrollmentRow(enrollmentId, request, queryExecutor = query) {
  const result = await queryExecutor(
    `SELECT e.*, a.owner_user_id, a.account_state, a.metadata AS account_metadata
       FROM core.agent_runtime_enrollment_operations e
       JOIN core.agent_runtime_accounts a ON a.account_binding_id = e.account_binding_id
      WHERE e.enrollment_id = $1 AND e.installation_id = (
        SELECT installation_id FROM core.agent_runtime_installations WHERE installation_code = $2
      ) LIMIT 1`,
    [enrollmentId, INSTALLATION_CODE],
  );
  if (result.rowCount !== 1) throw serviceError(404, 'MANAGED_CODEX_ENROLLMENT_NOT_FOUND', 'The managed Codex enrollment operation was not found.');
  assertOwner(result.rows[0], request);
  return result.rows[0];
}

async function storeAccountMetadata(accountBindingId, metadata, request, queryExecutor = query) {
  const clean = cleanAccountMetadata(metadata);
  const lastVerifiedAt = metadata.observedAt || new Date().toISOString();
  await queryExecutor(
    `UPDATE core.agent_runtime_accounts
        SET account_state = $2,
            metadata = (metadata - 'rateLimits' - 'usage' - 'planType' - 'accountType' - 'lastVerifiedAt') || $3::jsonb,
            updated_by = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE account_binding_id = $1`,
    [accountBindingId, metadata.authenticated === true ? 'CONFIGURED' : 'UNCONFIGURED', JSON.stringify({ ...clean, lastVerifiedAt, authMode: AUTH_MODE, providerCode: PROVIDER_CODE, executionEnabled: false }), actorId(request)],
  );
  return clean;
}

async function retrySameEnrollment(row, request, dependencies, queryExecutor) {
  const recoveryReason = row.failure_code;
  const runtime = await readHealth({ ...dependencies, queryExecutor });
  const { health, certification } = runtime;
  if (!health || health.networkPolicyDigest !== certification.networkPolicyDigest) {
    throw serviceError(409, 'CODEX_PROVIDER_EGRESS_POLICY_NOT_CURRENT', 'The source-controlled provider allowlist is not active in the managed runtime; reconcile the same enrollment after the fixed runtime refresh.', { enrollmentId: row.enrollment_id });
  }
  const runtimeGate = enrollmentRuntimeReadiness(runtime);
  if (!runtimeGate.ready) {
    throw serviceError(503, 'CODEX_RUNTIME_NOT_READY', 'The existing managed enrollment cannot be retried until runtime certification, containment, egress policy, and MCP readiness pass.', {
      enrollmentId: row.enrollment_id,
      readiness: runtimeGate.readiness,
    });
  }

  const bridge = dependencies.bridge || callBridge;
  const accountResponse = await bridge('/v1/account/read', 'POST', {});
  const account = accountResponse.account || {};
  if (account.authenticated === true) {
    const metadata = cleanAccountMetadata({ ...account, observedAt: new Date().toISOString() });
    await storeAccountMetadata(row.account_binding_id, { ...metadata, authenticated: true }, request, queryExecutor);
    const completed = await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'COMPLETED', verification_url = NULL, user_code = NULL,
              completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), last_observed_at = CURRENT_TIMESTAMP,
              failure_code = NULL, safe_result = $2::jsonb, updated_by = $3
        WHERE enrollment_id = $1 RETURNING *`,
      [row.enrollment_id, JSON.stringify({ account: metadata, providerState: 'COMPLETED', executionEnabled: false }), actorId(request)],
    );
    return { ok: true, reused: true, enrollment: safeOperation(completed.rows[0], false), accountState: 'CONFIGURED', account: metadata };
  }

  const claimed = await queryExecutor(
    `UPDATE core.agent_runtime_enrollment_operations
        SET operation_state = 'AUTHENTICATING', provider_attempt_count = provider_attempt_count + 1,
            failure_code = NULL, last_observed_at = CURRENT_TIMESTAMP, updated_by = $2
      WHERE enrollment_id = $1 AND operation_state = 'RECONCILIATION_REQUIRED'
        AND failure_code = $3 AND provider_attempt_count = 1
      RETURNING *`,
    [row.enrollment_id, actorId(request), recoveryReason],
  );
  if (claimed.rowCount !== 1) throw serviceError(409, 'MANAGED_CODEX_ENROLLMENT_RECONCILIATION_REQUIRED', 'The same enrollment was already retried or changed; reconcile its current state without creating another operation.', { enrollmentId: row.enrollment_id });

  try {
    const result = await bridge('/v1/enrollment/start', 'POST', { operationId: row.enrollment_id });
    const details = validateDeviceResponse(result.enrollment || {});
    const updated = await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'PENDING_USER', provider_login_reference = $2,
              verification_url = $3, user_code = $4, expires_at = $5,
              last_observed_at = CURRENT_TIMESTAMP, failure_code = NULL,
              safe_result = jsonb_build_object('providerAttemptCount', provider_attempt_count, 'executionEnabled', FALSE),
              updated_by = $6
        WHERE enrollment_id = $1 AND operation_state = 'AUTHENTICATING' RETURNING *`,
      [row.enrollment_id, details.loginReference, details.verificationUrl, details.userCode, details.expiresAt, actorId(request)],
    );
    await authService.recordAuditEvent({
      appCode: request.session?.appCode,
      userId: actorId(request),
      eventType: 'AGENT_RUNTIME_ENROLLMENT',
      resourceType: 'core.agent_runtime_accounts',
      resourceId: row.account_binding_id,
      action: 'retry_managed_codex_device_login_same_operation',
      success: true,
      message: recoveryReason === 'CODEX_PROVIDER_EGRESS_BLOCKED'
        ? 'The same managed Codex device-code enrollment resumed after its observed provider egress was allowlisted.'
        : 'The same managed Codex device-code enrollment resumed after account-read reconciliation confirmed its app-server login state was lost.',
      metadata: { providerCode: PROVIDER_CODE, authMode: AUTH_MODE, enrollmentId: row.enrollment_id, recoveryReason, providerAttemptCount: 2, operationState: 'PENDING_USER', executionEnabled: false },
      ...authService.getRequestContext(request),
    });
    return { ok: true, reused: true, enrollment: safeOperation(updated.rows[0], true), accountState: row.account_state };
  } catch (error) {
    const code = String(error.code || 'CODEX_RUNTIME_OPERATION_FAILED').slice(0, 100);
    await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'RECONCILIATION_REQUIRED', verification_url = NULL, user_code = NULL,
              failure_code = $2, safe_result = $3::jsonb, last_observed_at = CURRENT_TIMESTAMP,
              updated_by = $4
        WHERE enrollment_id = $1 AND operation_state = 'AUTHENTICATING'`,
      [row.enrollment_id, code, JSON.stringify({ providerAttemptCount: 2, observedProviderDestinations: safeProviderDestinations(error.details?.observedProviderDestinations), executionEnabled: false }), actorId(request)],
    );
    throw serviceError(503, 'MANAGED_CODEX_ENROLLMENT_RECONCILIATION_REQUIRED', 'The same enrollment retry has an uncertain provider outcome; reconcile it without creating a replacement.', { enrollmentId: row.enrollment_id, causeCode: code });
  }
}

async function reconcileEnrollment(enrollmentId, request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const row = await getEnrollmentRow(enrollmentId, request, queryExecutor);
  if (['COMPLETED', 'CANCELLED', 'EXPIRED', 'REVOKED', 'FAILED'].includes(row.operation_state)) {
    return { ok: true, reused: true, enrollment: safeOperation(row, false), accountState: row.account_state };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    const expired = await queryExecutor(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'EXPIRED', verification_url = NULL, user_code = NULL,
              last_observed_at = CURRENT_TIMESTAMP, updated_by = $2
        WHERE enrollment_id = $1 RETURNING *`,
      [enrollmentId, actorId(request)],
    );
    return { ok: true, enrollment: safeOperation(expired.rows[0], false), accountState: row.account_state };
  }
  if (row.operation_state === 'RECONCILIATION_REQUIRED'
    && ['CODEX_PROVIDER_EGRESS_BLOCKED', 'CODEX_LOGIN_STATE_LOST'].includes(row.failure_code)
    && Number(row.provider_attempt_count || 0) === 1) {
    return retrySameEnrollment(row, request, dependencies, queryExecutor);
  }
  let result;
  try {
    result = await (dependencies.bridge || callBridge)('/v1/enrollment/reconcile', 'POST', { operationId: enrollmentId });
  } catch (error) {
    throw error;
  }
  const providerResult = result.enrollment || {};
  const account = providerResult.account || {};
  const eventList = Array.isArray(providerResult.events)
    ? providerResult.events.filter((event) => ['login-completed', 'account-updated'].includes(event.type)).slice(-20)
    : [];
  let accountMetadata = cleanAccountMetadata(account);
  if (account.authenticated === true) {
    try {
      const metadata = await (dependencies.bridge || callBridge)('/v1/account/metadata', 'POST', {});
      accountMetadata = cleanAccountMetadata({ ...(metadata.account || account), rateLimits: metadata.rateLimits, usage: metadata.usage, source: metadata.source, observedAt: metadata.observedAt });
    } catch (_error) {
      accountMetadata = cleanAccountMetadata({ ...account, observedAt: new Date().toISOString() });
    }
    await storeAccountMetadata(row.account_binding_id, { ...accountMetadata, authenticated: true }, request, queryExecutor);
  }
  const providerState = String(providerResult.state || '').toUpperCase();
  const completed = account.authenticated === true;
  const failed = providerState === 'FAILED' || providerState === 'CANCELLED';
  const nextState = completed ? 'COMPLETED' : failed ? (providerState === 'CANCELLED' ? 'CANCELLED' : 'FAILED') : (providerState === 'RECONCILIATION_REQUIRED' || providerState === 'COMPLETED' ? 'RECONCILIATION_REQUIRED' : 'PENDING_USER');
  const code = completed || failed || nextState !== 'PENDING_USER' ? null : row.user_code;
  const url = code ? row.verification_url : null;
  const updated = await queryExecutor(
    `UPDATE core.agent_runtime_enrollment_operations
        SET operation_state = $2,
            verification_url = $3,
            user_code = $4,
            completed_at = CASE WHEN $2 IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
            last_observed_at = CURRENT_TIMESTAMP,
            failure_code = $5,
            safe_result = $6::jsonb,
            updated_by = $7
      WHERE enrollment_id = $1 RETURNING *`,
    [enrollmentId, nextState, url, code, completed ? null : (failed ? 'PROVIDER_LOGIN_FAILED' : (providerState === 'RECONCILIATION_REQUIRED' ? (row.failure_code || 'CODEX_LOGIN_STATE_LOST') : null)), JSON.stringify({ events: eventList, account: accountMetadata, providerState, providerAttemptCount: Number(row.provider_attempt_count || 0), executionEnabled: false }), actorId(request)],
  );
  if (completed || failed) {
    await authService.recordAuditEvent({
      appCode: request.session?.appCode,
      userId: actorId(request),
      eventType: 'AGENT_RUNTIME_ENROLLMENT',
      resourceType: 'core.agent_runtime_accounts',
      resourceId: row.account_binding_id,
      action: completed ? 'complete_managed_codex_device_login' : 'managed_codex_device_login_failed',
      success: completed,
      message: completed ? 'Managed Codex device-code enrollment completed.' : 'Managed Codex device-code enrollment did not complete.',
      metadata: { providerCode: PROVIDER_CODE, authMode: AUTH_MODE, enrollmentId, operationState: nextState, eventTypes: eventList.map((event) => event.type), accountAuthenticated: completed, executionEnabled: false },
      ...authService.getRequestContext(request),
    });
  }
  return { ok: true, reused: true, enrollment: safeOperation(updated.rows[0], true), accountState: completed ? 'CONFIGURED' : row.account_state, account: accountMetadata };
}

async function refreshManagedAccount(request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { account } = await loadPilot(queryExecutor, request);
  if (!account) throw serviceError(503, 'MANAGED_CODEX_BINDING_UNAVAILABLE', 'The managed Codex pilot account binding is not registered.');
  assertOwner(account, request);
  if (account.account_state === 'REVOKED') throw serviceError(409, 'MANAGED_CODEX_ACCOUNT_REVOKED', 'The managed Codex account binding is revoked.');
  let result;
  try { result = await (dependencies.bridge || callBridge)('/v1/account/metadata', 'POST', {}); }
  catch (error) {
    if (error.code === 'ACCOUNT_UNENROLLED') {
      await storeAccountMetadata(account.account_binding_id, { authenticated: false, observedAt: new Date().toISOString() }, request, queryExecutor);
      return { ok: true, accountState: 'UNCONFIGURED', providerReachability: 'CURRENT', metadata: null };
    }
    throw error;
  }
  const metadata = cleanAccountMetadata({ ...(result.account || {}), rateLimits: result.rateLimits, usage: result.usage, source: result.source, observedAt: result.observedAt });
  const state = result.account?.authenticated === true ? 'CONFIGURED' : 'UNCONFIGURED';
  await storeAccountMetadata(account.account_binding_id, { ...metadata, authenticated: state === 'CONFIGURED' }, request, queryExecutor);
  return { ok: true, accountState: state, providerReachability: 'CURRENT', metadata };
}

async function logoutManagedAccount(request, dependencies = {}) {
  const queryExecutor = dependencies.queryExecutor || query;
  const { account } = await loadPilot(queryExecutor, request);
  if (!account) throw serviceError(503, 'MANAGED_CODEX_BINDING_UNAVAILABLE', 'The managed Codex pilot account binding is not registered.');
  assertOwner(account, request);
  await (dependencies.bridge || callBridge)('/v1/account/logout', 'POST', {});
  const client = await (dependencies.poolRef || pool).connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE core.agent_runtime_accounts
          SET account_state = 'REVOKED',
              metadata = jsonb_build_object('providerCode', $2, 'authMode', $3, 'executionEnabled', FALSE, 'revokedAt', CURRENT_TIMESTAMP),
              updated_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE account_binding_id = $1`,
      [account.account_binding_id, PROVIDER_CODE, AUTH_MODE, actorId(request)],
    );
    await client.query(
      `UPDATE core.agent_runtime_enrollment_operations
          SET operation_state = 'REVOKED', verification_url = NULL, user_code = NULL,
              completed_at = CURRENT_TIMESTAMP, last_observed_at = CURRENT_TIMESTAMP,
              updated_by = $2
        WHERE account_binding_id = $1 AND operation_state = ANY($3::text[])`,
      [account.account_binding_id, actorId(request), ACTIVE_STATES],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  await authService.recordAuditEvent({
    appCode: request.session?.appCode,
    userId: actorId(request),
    eventType: 'AGENT_RUNTIME_ENROLLMENT',
    resourceType: 'core.agent_runtime_accounts',
    resourceId: account.account_binding_id,
    action: 'revoke_managed_codex_enrollment',
    success: true,
    message: 'Managed Codex account enrollment was logged out and revoked.',
    metadata: { providerCode: PROVIDER_CODE, enrollmentState: 'REVOKED', executionEnabled: false },
    ...authService.getRequestContext(request),
  });
  return { ok: true, accountState: 'REVOKED', executionEnabled: false };
}

module.exports = {
  ACCOUNT_CODE,
  ACTIVE_STATES,
  AUTH_MODE,
  DEVICE_URL,
  enrollmentRuntimeReadiness,
  INSTALLATION_CODE,
  PROFILE,
  PROVIDER_CODE,
  RUNTIME_CODE,
  callBridge,
  bootstrapSourceConfigurationFingerprint,
  assessRuntimeIdentity,
  cleanAccountMetadata,
  expectedCertification,
  getManagedCodexLifecycle,
  getManagedCodex,
  getCompatibilityDiagnostics,
  getBootstrapReadiness,
  readinessFor,
  readHealth,
  persistRuntimeObservation,
  safeManagedStatus,
  safeOperation,
  safeProviderDestinations,
  safeLoginStateDiagnostic,
  safeRpcDiagnostic,
  startManagedCodexLifecycle,
  startEnrollment,
  reconcileEnrollment,
  refreshManagedAccount,
  logoutManagedAccount,
  validateDeviceResponse,
};
