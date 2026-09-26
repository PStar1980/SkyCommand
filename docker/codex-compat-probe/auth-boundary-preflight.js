'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { DEFAULT_RUNTIME_SERVICES } = require('../../packages/supervisor/src/config');
const {
  APPROVED_PREFLIGHT_PROVIDER_HOSTS,
  AuthBoundaryError,
  CODEX_VERSION,
  INSTALLATION_CODE,
  projectReadOnlyPreflight,
  readOnlyPreflightBlocker,
} = require('./auth-boundary-contract');

const ROOT = path.resolve(__dirname, '../..');
const ACCOUNT_CODE = 'phase19-3a0-managed-account';
const RUNTIME_CODE = 'OPENAI_CODEX_APP_SERVER';
const DEV_DATABASE = 'skyserver_dev';
const ACCOUNT_STATES = new Set(['UNCONFIGURED', 'CONFIGURED', 'DISABLED', 'REVOKED']);
const SUPERVISOR_TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const SAFE_PREFLIGHT_BLOCKERS = new Set([
  'AUTH_BOUNDARY_PREFLIGHT_INVALID', 'AUTH_BOUNDARY_ENROLLMENT_ACTIVE',
  'AUTH_BOUNDARY_ENROLLMENT_UNRESOLVED', 'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED',
  'AUTH_BOUNDARY_ACCOUNT_STATE_UNKNOWN',
  'AUTH_BOUNDARY_SUPERVISOR_OFFLINE', 'AUTH_BOUNDARY_SUPERVISOR_OPERATION_ACTIVE',
  'AUTH_BOUNDARY_LIFECYCLE_UNCERTAIN', 'AUTH_BOUNDARY_LIFECYCLE_UNRECONCILED',
  'AUTH_BOUNDARY_LIFECYCLE_HISTORY_INVALID', 'AUTH_BOUNDARY_LIFECYCLE_CONTRADICTORY',
  'AUTH_BOUNDARY_RUNTIME_NOT_CURRENT', 'AUTH_BOUNDARY_EXECUTION_ENABLED',
]);
const ENROLLMENT_ACTIVE_STATES = Object.freeze([
  'CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED',
]);
const ENROLLMENT_KNOWN_STATES = Object.freeze([
  ...ENROLLMENT_ACTIVE_STATES, 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVOKED',
]);
const MAX_ENROLLMENT_EVIDENCE_ROWS = 64;
const MAX_SUPERVISOR_RESPONSE_BYTES = 256 * 1024;
const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[A-F0-9]{64}$/i;

const INSTALLATION_SQL = `
  SELECT i.installation_id, i.installation_code, r.runtime_code,
         i.adapter_version, i.certification_state, i.enabled, i.execution_enabled,
         i.freshness_status, i.observed_at, i.protocol_schema_digest,
         i.metadata->>'codexVersion' AS observed_codex_version,
         i.metadata->>'expectedPackageVersion' AS expected_codex_version,
         i.metadata->'runtimeIdentity'->>'attestation' AS runtime_identity_attestation,
         i.metadata->>'executionEnabled' AS runtime_execution_enabled,
         i.metadata->>'readiness' AS runtime_readiness,
         i.metadata->>'mcpReachability' AS mcp_reachability,
         i.metadata->>'providerReachability' AS provider_reachability,
         i.metadata->>'networkPolicyDigest' AS network_policy_digest,
         i.metadata->>'expectedNetworkPolicyDigest' AS expected_network_policy_digest,
         i.metadata->>'ok' AS runtime_ok,
         i.metadata->>'observedAt' AS runtime_observed_at,
         i.metadata->'containment' AS containment,
         i.metadata->'bootstrapLifecycle' AS bootstrap_lifecycle,
         i.metadata->'bootstrapLifecycleHistory' AS bootstrap_lifecycle_history,
         i.metadata ? 'bootstrapLifecycleHistory' AS lifecycle_history_present
    FROM core.agent_runtime_installations AS i
    JOIN core.agent_runtimes AS r ON r.agent_runtime_id = i.agent_runtime_id
   WHERE i.installation_code = $1
     AND r.runtime_code = $2
     AND r.active = TRUE
`;

const ACCOUNT_SQL = `
  SELECT account_binding_id, account_code, account_state, execution_enabled
    FROM core.agent_runtime_accounts
   WHERE installation_id = $1 AND account_code = $2
`;

const ENROLLMENT_COUNTS_SQL = `
  SELECT count(*)::bigint AS total_count,
         count(*) FILTER (WHERE operation_state = ANY($3::text[]))::bigint AS active_count,
         count(*) FILTER (
         WHERE operation_state = ANY($3::text[])
              OR operation_state IS NULL
              OR (operation_state = ANY($4::text[]) AND completed_at IS NULL)
              OR provider_attempt_count IS NULL
              OR provider_attempt_count NOT BETWEEN 0 AND 2
         )::bigint AS unresolved_count,
         count(*) FILTER (
           WHERE operation_state IS NULL OR operation_state <> ALL($5::text[])
         )::bigint AS unknown_state_count
    FROM core.agent_runtime_enrollment_operations
   WHERE installation_id = $1 AND account_binding_id = $2
`;

const ENROLLMENT_EVIDENCE_SQL = `
  SELECT enrollment_id, operation_state, provider_attempt_count,
         created_at, started_at, completed_at, last_observed_at
    FROM core.agent_runtime_enrollment_operations
   WHERE installation_id = $1 AND account_binding_id = $2
   ORDER BY created_at DESC, enrollment_id DESC
   LIMIT $3
`;

class PreflightCollectionError extends Error {
  constructor(code = 'AUTH_BOUNDARY_PREFLIGHT_INVALID') {
    super(code);
    this.name = 'PreflightCollectionError';
    this.code = code;
  }
}

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeState(value, knownStates) {
  return typeof value === 'string' && knownStates.includes(value) ? value : 'UNCLASSIFIED';
}

function lifecycleHistoryIsValid(history, historyPresent = true) {
  if ((history === null || history === undefined) && historyPresent !== true) history = [];
  if (!Array.isArray(history) || history.length > 8) return false;
  const seen = new Set();
  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !['MANAGED_CODEX_LIFECYCLE_SUPERSEDED', 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED'].includes(entry.eventType)
      || !VALID_UUID.test(String(entry.priorOperationId || ''))
      || !entry.priorLifecycle || typeof entry.priorLifecycle !== 'object' || Array.isArray(entry.priorLifecycle)
      || entry.priorLifecycle.operationId !== entry.priorOperationId
      || !['FAILED', 'SUCCEEDED'].includes(entry.priorLifecycle.state)
      || !VALID_UUID.test(String(entry.priorLifecycle.supervisorOperationId || ''))
      || entry.priorLifecycle.supervisorOperationId !== entry.priorOperationId
      || !Number.isInteger(Number(entry.attemptCount))
      || Number(entry.attemptCount) < 1 || Number(entry.attemptCount) > 2
      || Number(entry.priorLifecycle.attemptCount) !== Number(entry.attemptCount)
      || !iso(entry.completedAt) || !iso(entry.terminalReconciledAt)) return false;
    if (seen.has(entry.priorOperationId)) return false;
    seen.add(entry.priorOperationId);
    if (entry.priorLifecycle.completedAt !== entry.completedAt
      || entry.priorLifecycle.terminalReconciledAt !== entry.terminalReconciledAt
      || (Object.prototype.hasOwnProperty.call(entry.priorLifecycle, 'terminalReconciliationBasis')
        && entry.priorLifecycle.terminalReconciliationBasis !== 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY')
      || (Object.prototype.hasOwnProperty.call(entry, 'terminalReconciliationBasis')
        !== Object.prototype.hasOwnProperty.call(entry.priorLifecycle, 'terminalReconciliationBasis'))
      || (Object.prototype.hasOwnProperty.call(entry, 'terminalReconciliationBasis')
        && entry.terminalReconciliationBasis !== entry.priorLifecycle.terminalReconciliationBasis)) return false;
    if (entry.eventType === 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED') {
      const legacyUnbound = entry.sourceConfigurationFingerprintStatus === 'LEGACY_UNBOUND_PRE_FINGERPRINT'
        && !Object.prototype.hasOwnProperty.call(entry, 'sourceConfigurationFingerprint')
        && !Object.prototype.hasOwnProperty.call(entry.priorLifecycle, 'lifecycleSchemaVersion')
        && !Object.prototype.hasOwnProperty.call(entry.priorLifecycle, 'sourceConfigurationFingerprint')
        && !Object.prototype.hasOwnProperty.call(entry.priorLifecycle, 'sourceConfigurationFingerprintStatus');
      const fingerprint = String(entry.sourceConfigurationFingerprint || '');
      const bound = entry.sourceConfigurationFingerprintStatus === 'BOUND'
        && SHA256.test(fingerprint)
        && entry.priorLifecycle.sourceConfigurationFingerprintStatus === 'BOUND'
        && SHA256.test(String(entry.priorLifecycle.sourceConfigurationFingerprint || ''))
        && String(entry.priorLifecycle.sourceConfigurationFingerprint).toUpperCase() === fingerprint.toUpperCase();
      if (entry.terminalState !== 'FAILED' || Number(entry.attemptCount) !== 2
        || !VALID_UUID.test(String(entry.replacementOperationId || ''))
        || entry.replacementOperationId === entry.priorOperationId
        || !iso(entry.supersededAt)
        || (!legacyUnbound && !bound)) return false;
    } else {
      const fingerprint = String(entry.sourceConfigurationFingerprint || '');
      if (entry.terminalState !== 'SUCCEEDED'
        || !VALID_UUID.test(String(entry.successorOperationId || ''))
        || entry.successorOperationId === entry.priorOperationId
        || !iso(entry.successorCreatedAt)
        || entry.sourceConfigurationFingerprintStatus !== 'BOUND'
        || !SHA256.test(fingerprint)
        || entry.priorLifecycle.sourceConfigurationFingerprintStatus !== 'BOUND'
        || !SHA256.test(String(entry.priorLifecycle.sourceConfigurationFingerprint || ''))
        || String(entry.priorLifecycle.sourceConfigurationFingerprint).toUpperCase() !== fingerprint.toUpperCase()
        || entry.priorLifecycle.lifecycleSchemaVersion !== 2) return false;
    }
  }
  return true;
}

function projectLifecycle(raw, history, historyPresent = true) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      active: true, outcomeKnown: false, operationId: null, state: 'UNKNOWN', attemptCount: null,
      completedAt: null, terminalReconciledAt: null, supervisorOperationId: null,
      fingerprintStatus: 'INVALID', sourceConfigurationFingerprint: null,
      lifecycleSchemaVersion: null, terminalReconciliationBasis: null,
      historyValid: lifecycleHistoryIsValid(history, historyPresent), historyCount: Array.isArray(history) ? history.length : 0,
    };
  }
  const operationId = VALID_UUID.test(String(raw.operationId || '')) ? String(raw.operationId).toLowerCase() : null;
  const state = ['SUCCEEDED', 'FAILED', 'REQUESTED', 'DISPATCHED', 'WAITING_READINESS'].includes(raw.state)
    ? raw.state : 'UNKNOWN';
  const fingerprint = typeof raw.sourceConfigurationFingerprint === 'string'
    && SHA256.test(raw.sourceConfigurationFingerprint) ? raw.sourceConfigurationFingerprint.toUpperCase() : null;
  const fingerprintStatus = fingerprint && raw.sourceConfigurationFingerprintStatus === 'BOUND'
    ? 'BOUND'
    : raw.sourceConfigurationFingerprintStatus === 'LEGACY_UNBOUND_PRE_FINGERPRINT'
      ? 'LEGACY_UNBOUND_PRE_FINGERPRINT' : 'INVALID';
  const attemptCount = Number.isInteger(Number(raw.attemptCount)) ? Number(raw.attemptCount) : null;
  const completedAt = iso(raw.completedAt);
  const terminalReconciledAt = iso(raw.terminalReconciledAt);
  const supervisorOperationId = VALID_UUID.test(String(raw.supervisorOperationId || ''))
    ? String(raw.supervisorOperationId).toLowerCase() : null;
  const schemaVersion = raw.lifecycleSchemaVersion === 2 ? 2 : null;
  const hasReconciliationBasis = Object.prototype.hasOwnProperty.call(raw, 'terminalReconciliationBasis');
  const terminalReconciliationBasis = raw.terminalReconciliationBasis === 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY'
    ? raw.terminalReconciliationBasis : hasReconciliationBasis ? 'INVALID' : null;
  const terminal = ['SUCCEEDED', 'FAILED'].includes(state);
  const historyValid = lifecycleHistoryIsValid(history, historyPresent);
  const outcomeKnown = Boolean(operationId && terminal && completedAt && terminalReconciledAt
    && schemaVersion === 2 && fingerprintStatus === 'BOUND' && historyValid
    && attemptCount >= 1 && attemptCount <= 2 && supervisorOperationId === operationId);
  return {
    active: !terminal,
    outcomeKnown,
    operationId,
    state,
    attemptCount,
    completedAt,
    terminalReconciledAt,
    supervisorOperationId,
    fingerprintStatus,
    sourceConfigurationFingerprint: fingerprintStatus === 'BOUND' ? fingerprint : null,
    lifecycleSchemaVersion: schemaVersion,
    terminalReconciliationBasis,
    historyValid,
    historyCount: Array.isArray(history) ? history.length : 0,
  };
}

function readProviderPolicy({ root = ROOT, fileSystem = fs } = {}) {
  const policyPath = path.join(root, 'docker', 'codex-provider-allowlist.txt');
  let stat;
  let bytes;
  try {
    stat = fileSystem.lstatSync(policyPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('invalid policy file');
    bytes = fileSystem.readFileSync(policyPath);
  } catch (_error) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }
  const text = bytes.toString('utf8');
  const hosts = text.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim().toLowerCase())
    .filter(Boolean);
  if (JSON.stringify(hosts) !== JSON.stringify(APPROVED_PREFLIGHT_PROVIDER_HOSTS)) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }
  return { hosts, sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase() };
}

function createDatabaseClient(environment = process.env) {
  const port = Number(environment.PGPORT || 5432);
  const host = String(environment.PGHOST || '').trim().toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)
    || environment.PGDATABASE !== DEV_DATABASE
    || environment.NODE_ENV === 'production'
    || !environment.PGUSER || environment.PGPASSWORD === undefined
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }
  return new Client({
    host,
    port,
    database: environment.PGDATABASE,
    user: environment.PGUSER,
    password: environment.PGPASSWORD,
    connectionTimeoutMillis: 5000,
    application_name: 'skycommand-codex-auth-boundary-read-only-preflight',
  });
}

async function readDatabaseSnapshot(clientFactory = createDatabaseClient) {
  const client = clientFactory();
  let transactionStarted = false;
  let output;
  let failure = null;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    const readOnly = await client.query('SHOW transaction_read_only');
    if (String(readOnly.rows?.[0]?.transaction_read_only).toLowerCase() !== 'on') {
      throw new PreflightCollectionError();
    }
    const databaseIdentity = await client.query('SELECT current_database() AS database_name');
    if (databaseIdentity.rowCount !== 1 || databaseIdentity.rows[0]?.database_name !== DEV_DATABASE) {
      throw new PreflightCollectionError();
    }

    const installationResult = await client.query(INSTALLATION_SQL, [INSTALLATION_CODE, RUNTIME_CODE]);
    if (installationResult.rowCount !== 1 || installationResult.rows.length !== 1) {
      throw new PreflightCollectionError();
    }
    const installation = installationResult.rows[0];
    const accountResult = await client.query(ACCOUNT_SQL, [installation.installation_id, ACCOUNT_CODE]);
    if (accountResult.rowCount !== 1 || accountResult.rows.length !== 1) {
      throw new PreflightCollectionError();
    }
    const account = accountResult.rows[0];
    const [countResult, evidenceResult] = await Promise.all([
      client.query(ENROLLMENT_COUNTS_SQL, [
        installation.installation_id,
        account.account_binding_id,
        ENROLLMENT_ACTIVE_STATES,
        ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVOKED'],
        ENROLLMENT_KNOWN_STATES,
      ]),
      client.query(ENROLLMENT_EVIDENCE_SQL, [
        installation.installation_id,
        account.account_binding_id,
        MAX_ENROLLMENT_EVIDENCE_ROWS,
      ]),
    ]);
    if (countResult.rowCount !== 1 || countResult.rows.length !== 1) throw new PreflightCollectionError();
    const counts = countResult.rows[0];
    const totalCount = safeCount(counts.total_count);
    const activeCount = safeCount(counts.active_count);
    const unresolvedCount = safeCount(counts.unresolved_count);
    const unknownStateCount = safeCount(counts.unknown_state_count);
    if ([totalCount, activeCount, unresolvedCount, unknownStateCount].some((value) => value === null)) {
      throw new PreflightCollectionError();
    }
    const operations = evidenceResult.rows.map((row) => {
      const state = normalizeState(row.operation_state, ENROLLMENT_KNOWN_STATES);
      const attemptCount = safeCount(row.provider_attempt_count);
      const operationId = VALID_UUID.test(String(row.enrollment_id || '')) ? String(row.enrollment_id).toLowerCase() : null;
      return {
        operationId,
        identityValid: operationId !== null,
        state,
        providerAttemptCount: attemptCount !== null && attemptCount <= 2 ? attemptCount : null,
        createdAt: iso(row.created_at),
        startedAt: iso(row.started_at),
        completedAt: iso(row.completed_at),
        lastObservedAt: iso(row.last_observed_at),
      };
    });
    output = {
      installation,
      account,
      enrollment: {
        totalCount,
        activeCount,
        unresolvedCount,
        unknownStateCount,
        allStatesClassified: unknownStateCount === 0,
        evidenceTruncated: totalCount > operations.length,
        operations,
      },
    };
  } catch (_error) {
    failure = new PreflightCollectionError();
  } finally {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch (_error) { failure = new PreflightCollectionError(); }
    }
    try { await client.end(); } catch (_error) { failure = new PreflightCollectionError(); }
  }
  if (failure || !output) throw failure || new PreflightCollectionError();
  return output;
}

function supervisorBaseUrl(environment = process.env) {
  const host = String(environment.SKYCOMMAND_SUPERVISOR_HOST || '127.0.0.1').trim().toLowerCase();
  const port = Number(environment.SKYCOMMAND_SUPERVISOR_PORT || 17170);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)
    || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_PREFLIGHT_INVALID');
  }
  return `http://${host === '::1' ? '[::1]' : host}:${port}`;
}

async function readJsonResponse(fetcher, url) {
  let response;
  try {
    response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('read failed');
    const declaredBytes = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SUPERVISOR_RESPONSE_BYTES) throw new Error('response too large');
    let text;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_SUPERVISOR_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('response too large');
        }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks, totalBytes).toString('utf8');
    } else {
      text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_SUPERVISOR_RESPONSE_BYTES) throw new Error('response too large');
    }
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid response');
    return body;
  } catch (_error) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_SUPERVISOR_OFFLINE');
  }
}

async function readSupervisorSnapshot(fetcher = fetch, environment = process.env) {
  const baseUrl = supervisorBaseUrl(environment);
  const [health, status] = await Promise.all([
    readJsonResponse(fetcher, `${baseUrl}/health`),
    readJsonResponse(fetcher, `${baseUrl}/runtime/status`),
  ]);
  if (health.status !== 'ONLINE' || health.service !== 'SkyCommand Supervisor'
    || !Object.prototype.hasOwnProperty.call(status, 'operation')
    || !Object.prototype.hasOwnProperty.call(status, 'lastOperation')) {
    throw new PreflightCollectionError('AUTH_BOUNDARY_SUPERVISOR_OFFLINE');
  }
  const operationPresent = status.operation !== null;
  const activeOperationId = operationPresent && VALID_UUID.test(String(status.operation?.operationId || ''))
    ? String(status.operation.operationId).toLowerCase() : null;
  let lastOperation = null;
  let lastOperationKnown = status.lastOperation === null;
  if (status.lastOperation && typeof status.lastOperation === 'object' && !Array.isArray(status.lastOperation)) {
    const id = VALID_UUID.test(String(status.lastOperation.operationId || ''))
      ? String(status.lastOperation.operationId).toLowerCase() : null;
    const completedAt = iso(status.lastOperation.completedAt);
    const state = SUPERVISOR_TERMINAL_STATES.has(status.lastOperation.status) ? status.lastOperation.status : null;
    lastOperationKnown = Boolean(id && completedAt && state);
    if (lastOperationKnown) lastOperation = { operationId: id, status: state, completedAt };
  }
  const serviceMap = new Map((Array.isArray(status.services) ? status.services : [])
    .filter((row) => row && typeof row.service === 'string')
    .map((row) => [row.service, row]));
  const requiredInventoryPresent = DEFAULT_RUNTIME_SERVICES.length === status.serviceCount
    && serviceMap.size === DEFAULT_RUNTIME_SERVICES.length
    && DEFAULT_RUNTIME_SERVICES.every((service) => serviceMap.has(service));
  const allRunning = requiredInventoryPresent && DEFAULT_RUNTIME_SERVICES.every((service) =>
    serviceMap.get(service)?.running === true && serviceMap.get(service)?.state === 'RUNNING');
  return {
    online: status.supervisor === 'ONLINE' && status.engineStatus === 'ONLINE',
    runtimeStatus: ['ONLINE', 'DEGRADED', 'PARTIAL', 'STARTING', 'STOPPED', 'UNAVAILABLE'].includes(status.runtimeStatus)
      ? status.runtimeStatus : 'UNKNOWN',
    activeOperationPresent: operationPresent,
    activeOperationId,
    lastOperationKnown,
    lastOperation,
    workerHealth: serviceMap.get('codex-agent-runtime-worker')?.health === 'HEALTHY' ? 'HEALTHY' : 'UNHEALTHY',
    bridgeHealth: serviceMap.get('codex-control-bridge')?.health === 'HEALTHY' ? 'HEALTHY' : 'UNHEALTHY',
    allExpectedServicesRunning: allRunning,
  };
}

function mapReadiness(installation, account, runtimeOk, mcpReachability) {
  const knownNotReadyStates = new Set([
    'CURRENT', 'ACCOUNT_UNENROLLED', 'PROVIDER_UNREACHABLE', 'PROVIDER_REACHABILITY_UNKNOWN',
  ]);
  if (!runtimeOk || mcpReachability !== 'CURRENT' || !knownNotReadyStates.has(installation.runtime_readiness)) {
    return { readiness: 'UNKNOWN', readinessBlockers: [] };
  }
  const blockers = [];
  if (account.account_state !== 'CONFIGURED') blockers.push('ACCOUNT_UNENROLLED');
  if (installation.runtime_readiness === 'PROVIDER_UNREACHABLE') blockers.push('PROVIDER_UNREACHABLE');
  if (installation.runtime_readiness === 'PROVIDER_REACHABILITY_UNKNOWN'
    || (installation.provider_reachability !== 'CURRENT' && !blockers.includes('PROVIDER_UNREACHABLE'))) {
    blockers.push('PROVIDER_REACHABILITY_UNKNOWN');
  }
  if (blockers.length) return { readiness: 'BLOCKED', readinessBlockers: [...new Set(blockers)] };
  return { readiness: 'CURRENT', readinessBlockers: [] };
}

function containmentCurrent(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.nonRoot === true && value.noNewPrivileges === true
    && value.allLinuxCapabilitiesDropped === true && value.readOnlyRootFilesystem === true
    && value.managedHomeVolumeOnly === true && value.liveCheckoutMount === false
    && value.arbitraryHostPathMount === false && value.dockerSocket === false
    && value.gitAvailable === false && value.browserState === false
    && value.prohibitedCredentials === true;
}

function buildSnapshot(database, supervisor, providerPolicy, observedAt = new Date().toISOString()) {
  const installation = database.installation;
  const account = database.account;
  const metadataTimestamp = iso(installation.runtime_observed_at);
  const columnTimestamp = iso(installation.observed_at);
  const runtimeObservationCurrent = Boolean(metadataTimestamp && columnTimestamp && metadataTimestamp === columnTimestamp);
  const runtimeOk = installation.runtime_ok === 'true' && runtimeObservationCurrent;
  const mcp = installation.mcp_reachability === 'CURRENT' ? 'CURRENT' : 'BLOCKED';
  const networkPolicyDigest = String(installation.network_policy_digest || '');
  const expectedNetworkPolicyDigest = String(installation.expected_network_policy_digest || '');
  const identityAttestation = installation.runtime_identity_attestation === 'VERIFIED'
    ? 'VERIFIED'
    : installation.runtime_identity_attestation === 'FAILED' ? 'FAILED' : 'UNAVAILABLE';
  const readiness = mapReadiness(installation, account, runtimeOk, mcp);
  const lifecycle = projectLifecycle(
    installation.bootstrap_lifecycle,
    installation.bootstrap_lifecycle_history,
    installation.lifecycle_history_present === true,
  );
  const activeId = supervisor.activeOperationPresent ? supervisor.activeOperationId : null;
  return {
    schema: 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1',
    readOnly: true,
    observedAt,
    installationCode: INSTALLATION_CODE,
    sources: { database: 'READ_ONLY', supervisor: 'READ_ONLY', runtime: 'READ_ONLY' },
    installation: {
      installationId: String(installation.installation_id || ''),
      installationCode: installation.installation_code,
      runtimeCode: installation.runtime_code,
      executionEnabled: installation.execution_enabled,
    },
    accountBinding: {
      bindingId: String(account.account_binding_id || ''),
      accountCode: account.account_code,
      state: ACCOUNT_STATES.has(account.account_state) ? account.account_state : 'UNKNOWN',
      executionEnabled: account.execution_enabled,
    },
    enrollment: {
      ...database.enrollment,
      allStatesClassified: database.enrollment.unknownStateCount === 0,
    },
    runtime: {
      codexVersion: installation.observed_codex_version || 'UNKNOWN',
      expectedCodexVersion: installation.expected_codex_version || 'UNKNOWN',
      certificationState: runtimeOk ? installation.certification_state : 'UNVERIFIED',
      freshness: runtimeObservationCurrent ? installation.freshness_status : 'UNKNOWN',
      workerHealth: supervisor.workerHealth,
      bridgeHealth: supervisor.bridgeHealth,
      containment: runtimeObservationCurrent && containmentCurrent(installation.containment) ? 'CURRENT' : 'BLOCKED',
      mcp,
      identityAttestation,
      executionEnabled: installation.execution_enabled === true
        || account.execution_enabled === true || installation.runtime_execution_enabled !== 'false',
      readiness: readiness.readiness,
      readinessBlockers: readiness.readinessBlockers,
      runtimeObservationCurrent,
      networkPolicyCurrent: SHA256.test(networkPolicyDigest) && SHA256.test(expectedNetworkPolicyDigest)
        && SHA256.test(providerPolicy.sha256 || '')
        && networkPolicyDigest.toUpperCase() === expectedNetworkPolicyDigest.toUpperCase()
        && networkPolicyDigest.toUpperCase() === providerPolicy.sha256.toUpperCase(),
      expectedServicesRunning: supervisor.allExpectedServicesRunning,
    },
    supervisor: {
      online: supervisor.online,
      runtimeStatus: supervisor.runtimeStatus,
      activeOperationPresent: supervisor.activeOperationPresent,
      activeOperationId: activeId,
      lastOperationKnown: supervisor.lastOperationKnown,
      lastOperation: supervisor.lastOperation,
    },
    lifecycle: {
      ...lifecycle,
    },
    providerPolicy,
  };
}

function safeBlockedEnvelope(snapshot, code, observedAt = new Date().toISOString()) {
  const allowedBlocker = SAFE_PREFLIGHT_BLOCKERS.has(code) ? code : 'AUTH_BOUNDARY_PREFLIGHT_INVALID';
  const operations = Array.isArray(snapshot?.enrollment?.operations)
    ? snapshot.enrollment.operations.slice(0, MAX_ENROLLMENT_EVIDENCE_ROWS).map((item) => ({
      operationId: VALID_UUID.test(String(item.operationId || '')) ? String(item.operationId).toLowerCase() : null,
      state: ENROLLMENT_KNOWN_STATES.includes(item.state) ? item.state : 'UNCLASSIFIED',
      providerAttemptCount: Number.isInteger(item.providerAttemptCount) ? item.providerAttemptCount : null,
      createdAt: iso(item.createdAt), startedAt: iso(item.startedAt),
      completedAt: iso(item.completedAt), lastObservedAt: iso(item.lastObservedAt),
    })) : [];
  return {
    schema: 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1',
    preflightStatus: 'BLOCKED',
    blockerClass: allowedBlocker,
    observedAt,
    readOnly: true,
    sources: { database: 'READ_ONLY', supervisor: 'READ_ONLY', runtime: 'READ_ONLY', providerPolicy: 'SOURCE_CONTROLLED' },
    installation: {
      installationId: VALID_UUID.test(String(snapshot?.installation?.installationId || ''))
        ? String(snapshot.installation.installationId).toLowerCase() : null,
      installationCode: INSTALLATION_CODE,
      runtimeCode: RUNTIME_CODE,
      executionEnabled: typeof snapshot?.installation?.executionEnabled === 'boolean'
        ? snapshot.installation.executionEnabled : null,
    },
    enrollment: {
      totalCount: safeCount(snapshot?.enrollment?.totalCount) ?? 0,
      activeCount: safeCount(snapshot?.enrollment?.activeCount) ?? 0,
      unresolvedCount: safeCount(snapshot?.enrollment?.unresolvedCount) ?? 0,
      unknownStateCount: safeCount(snapshot?.enrollment?.unknownStateCount) ?? 0,
      allStatesClassified: snapshot?.enrollment?.allStatesClassified === true,
      operations,
      evidenceTruncated: snapshot?.enrollment?.evidenceTruncated === true,
    },
    accountBinding: {
      bindingId: VALID_UUID.test(String(snapshot?.accountBinding?.bindingId || ''))
        ? String(snapshot.accountBinding.bindingId).toLowerCase() : null,
      state: ACCOUNT_STATES.has(snapshot?.accountBinding?.state) ? snapshot.accountBinding.state : 'UNKNOWN',
      role: 'OBSERVATION_ONLY',
      executionEnabled: typeof snapshot?.accountBinding?.executionEnabled === 'boolean'
        ? snapshot.accountBinding.executionEnabled : null,
    },
    supervisor: {
      online: snapshot?.supervisor?.online === true,
      runtimeStatus: ['ONLINE', 'DEGRADED', 'PARTIAL', 'STARTING', 'STOPPED', 'UNAVAILABLE'].includes(snapshot?.supervisor?.runtimeStatus)
        ? snapshot.supervisor.runtimeStatus : 'UNKNOWN',
      activeOperationPresent: snapshot?.supervisor?.activeOperationPresent === true,
      activeOperationId: VALID_UUID.test(String(snapshot?.supervisor?.activeOperationId || ''))
        ? String(snapshot.supervisor.activeOperationId).toLowerCase() : null,
      lastOperation: snapshot?.supervisor?.lastOperation && VALID_UUID.test(String(snapshot.supervisor.lastOperation.operationId || ''))
        ? {
          operationId: String(snapshot.supervisor.lastOperation.operationId).toLowerCase(),
          status: SUPERVISOR_TERMINAL_STATES.has(snapshot.supervisor.lastOperation.status)
            ? snapshot.supervisor.lastOperation.status : 'UNKNOWN',
          completedAt: iso(snapshot.supervisor.lastOperation.completedAt),
        } : null,
    },
    lifecycle: {
      operationId: VALID_UUID.test(String(snapshot?.lifecycle?.operationId || ''))
        ? String(snapshot.lifecycle.operationId).toLowerCase() : null,
      state: ['SUCCEEDED', 'FAILED', 'REQUESTED', 'DISPATCHED', 'WAITING_READINESS'].includes(snapshot?.lifecycle?.state)
        ? snapshot.lifecycle.state : 'UNKNOWN',
      attemptCount: Number.isInteger(snapshot?.lifecycle?.attemptCount) ? snapshot.lifecycle.attemptCount : null,
      completedAt: iso(snapshot?.lifecycle?.completedAt),
      terminalReconciledAt: iso(snapshot?.lifecycle?.terminalReconciledAt),
      fingerprintStatus: ['BOUND', 'LEGACY_UNBOUND_PRE_FINGERPRINT', 'INVALID'].includes(snapshot?.lifecycle?.fingerprintStatus)
        ? snapshot.lifecycle.fingerprintStatus : 'INVALID',
      sourceConfigurationFingerprint: SHA256.test(String(snapshot?.lifecycle?.sourceConfigurationFingerprint || ''))
        ? snapshot.lifecycle.sourceConfigurationFingerprint.toUpperCase() : null,
      lifecycleSchemaVersion: snapshot?.lifecycle?.lifecycleSchemaVersion === 2 ? 2 : null,
      terminalReconciliationBasis: ['LEGACY_PERSISTED_FAILURE_COMPATIBILITY', 'INVALID'].includes(snapshot?.lifecycle?.terminalReconciliationBasis)
        ? snapshot.lifecycle.terminalReconciliationBasis : null,
      historyValid: snapshot?.lifecycle?.historyValid === true,
      historyCount: safeCount(snapshot?.lifecycle?.historyCount) ?? 0,
    },
    runtime: {
      codexVersion: snapshot?.runtime?.codexVersion === CODEX_VERSION ? CODEX_VERSION : 'UNKNOWN',
      expectedCodexVersion: snapshot?.runtime?.expectedCodexVersion === CODEX_VERSION ? CODEX_VERSION : 'UNKNOWN',
      certificationState: ['CERTIFIED', 'UNVERIFIED', 'REVOKED', 'DISABLED'].includes(snapshot?.runtime?.certificationState)
        ? snapshot.runtime.certificationState : 'UNKNOWN',
      freshness: ['CURRENT', 'STALE_RECONCILABLE', 'STALE_BLOCKED', 'UNKNOWN'].includes(snapshot?.runtime?.freshness)
        ? snapshot.runtime.freshness : 'UNKNOWN',
      workerHealth: ['HEALTHY', 'UNHEALTHY', 'UNKNOWN'].includes(snapshot?.runtime?.workerHealth)
        ? snapshot.runtime.workerHealth : 'UNKNOWN',
      bridgeHealth: ['HEALTHY', 'UNHEALTHY', 'UNKNOWN'].includes(snapshot?.runtime?.bridgeHealth)
        ? snapshot.runtime.bridgeHealth : 'UNKNOWN',
      containment: ['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(snapshot?.runtime?.containment)
        ? snapshot.runtime.containment : 'UNKNOWN',
      mcp: ['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(snapshot?.runtime?.mcp) ? snapshot.runtime.mcp : 'UNKNOWN',
      readiness: ['CURRENT', 'BLOCKED', 'UNKNOWN'].includes(snapshot?.runtime?.readiness)
        ? snapshot.runtime.readiness : 'UNKNOWN',
      executionEnabled: typeof snapshot?.runtime?.executionEnabled === 'boolean' ? snapshot.runtime.executionEnabled : null,
    },
    providerPolicy: {
      hosts: Array.isArray(snapshot?.providerPolicy?.hosts)
        && JSON.stringify(snapshot.providerPolicy.hosts) === JSON.stringify(APPROVED_PREFLIGHT_PROVIDER_HOSTS)
        ? [...APPROVED_PREFLIGHT_PROVIDER_HOSTS] : [],
      sha256: SHA256.test(String(snapshot?.providerPolicy?.sha256 || ''))
        ? snapshot.providerPolicy.sha256.toUpperCase() : null,
    },
    executionEnabled: typeof snapshot?.installation?.executionEnabled === 'boolean'
      && typeof snapshot?.accountBinding?.executionEnabled === 'boolean'
      && typeof snapshot?.runtime?.executionEnabled === 'boolean'
      ? snapshot.installation.executionEnabled || snapshot.accountBinding.executionEnabled || snapshot.runtime.executionEnabled : null,
  };
}

function exactKeys(value, expected) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()));
}

function validatePreflightEnvelope(value) {
  const fail = () => { throw new PreflightCollectionError('AUTH_BOUNDARY_PREFLIGHT_INVALID'); };
  const readyKeys = [
    'schema', 'preflightStatus', 'observedAt', 'preflightRole', 'sources', 'installation',
    'accountBinding', 'enrollment', 'supervisor', 'lifecycle', 'runtime', 'providerPolicy', 'executionEnabled',
  ];
  const blockedKeys = [
    'schema', 'preflightStatus', 'blockerClass', 'observedAt', 'readOnly', 'sources', 'installation',
    'enrollment', 'accountBinding', 'supervisor', 'lifecycle', 'runtime', 'providerPolicy', 'executionEnabled',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1'
    || !iso(value.observedAt)) fail();
  if (value.preflightStatus === 'READY') {
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(readyKeys.sort())
      || value.executionEnabled !== false || value.preflightRole !== 'VETO_ONLY'
      || !exactKeys(value.sources, ['database', 'supervisor', 'runtime', 'providerPolicy'])
      || value.sources.database !== 'READ_ONLY' || value.sources.supervisor !== 'READ_ONLY'
      || value.sources.runtime !== 'READ_ONLY' || value.sources.providerPolicy !== 'SOURCE_CONTROLLED'
      || !exactKeys(value.installation, ['installationId', 'installationCode', 'runtimeCode', 'executionEnabled'])
      || value.installation.installationCode !== INSTALLATION_CODE
      || value.installation.runtimeCode !== RUNTIME_CODE || value.installation.executionEnabled !== false
      || !exactKeys(value.accountBinding, ['bindingId', 'accountCode', 'state', 'role', 'executionEnabled'])
      || value.accountBinding.accountCode !== ACCOUNT_CODE
      || value.accountBinding.role !== 'OBSERVATION_ONLY' || value.accountBinding.executionEnabled !== false
      || !exactKeys(value.enrollment, [
        'totalCount', 'activeCount', 'unresolvedCount', 'unknownStateCount',
        'allStatesClassified', 'evidenceTruncated', 'operations',
      ])
      || value.enrollment?.activeCount !== 0 || value.enrollment?.unresolvedCount !== 0
      || value.enrollment?.unknownStateCount !== 0
      || !Array.isArray(value.enrollment.operations)
      || value.enrollment.operations.some((item) => !exactKeys(item, [
        'operationId', 'identityValid', 'state', 'providerAttemptCount', 'createdAt', 'startedAt', 'completedAt', 'lastObservedAt',
      ]))
      || !exactKeys(value.supervisor, [
        'online', 'runtimeStatus', 'activeOperationPresent', 'activeOperationId', 'lastOperationKnown', 'lastOperation',
      ])
      || value.supervisor?.online !== true || value.supervisor?.activeOperationPresent !== false
      || (value.supervisor.lastOperation !== null && !exactKeys(value.supervisor.lastOperation, ['operationId', 'status', 'completedAt']))
      || !exactKeys(value.lifecycle, [
        'operationId', 'state', 'attemptCount', 'completedAt', 'terminalReconciledAt', 'supervisorOperationId',
        'fingerprintStatus', 'sourceConfigurationFingerprint', 'lifecycleSchemaVersion',
        'terminalReconciliationBasis', 'historyValid', 'historyCount',
      ])
      || value.lifecycle?.state !== 'SUCCEEDED' && value.lifecycle?.state !== 'FAILED'
      || value.lifecycle?.fingerprintStatus !== 'BOUND'
      || !exactKeys(value.runtime, [
        'version', 'certificationState', 'freshness', 'identityAttestation', 'workerHealth', 'bridgeHealth',
        'containment', 'mcp', 'readiness', 'readinessBlockers', 'observationCurrent',
        'networkPolicyCurrent', 'expectedServicesRunning', 'executionEnabled',
      ])
      || !exactKeys(value.runtime.version, ['observed', 'expected'])
      || value.runtime?.certificationState !== 'CERTIFIED' || value.runtime?.freshness !== 'CURRENT'
      || value.runtime?.identityAttestation !== 'VERIFIED' || value.runtime?.executionEnabled !== false
      || !exactKeys(value.providerPolicy, ['hosts', 'sha256'])
      || JSON.stringify(value.providerPolicy?.hosts) !== JSON.stringify(APPROVED_PREFLIGHT_PROVIDER_HOSTS)
      || !SHA256.test(String(value.providerPolicy?.sha256 || ''))) fail();
    return value;
  }
  if (value.preflightStatus !== 'BLOCKED'
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(blockedKeys.sort())
    || !SAFE_PREFLIGHT_BLOCKERS.has(value.blockerClass)
    || value.readOnly !== true
    || !exactKeys(value.sources, ['database', 'supervisor', 'runtime', 'providerPolicy'])
    || !exactKeys(value.installation, ['installationId', 'installationCode', 'runtimeCode', 'executionEnabled'])
    || !exactKeys(value.accountBinding, ['bindingId', 'state', 'role', 'executionEnabled'])
    || !exactKeys(value.enrollment, [
      'totalCount', 'activeCount', 'unresolvedCount', 'unknownStateCount', 'allStatesClassified', 'operations', 'evidenceTruncated',
    ])
    || !exactKeys(value.supervisor, ['online', 'runtimeStatus', 'activeOperationPresent', 'activeOperationId', 'lastOperation'])
    || !exactKeys(value.lifecycle, [
      'operationId', 'state', 'attemptCount', 'completedAt', 'terminalReconciledAt', 'fingerprintStatus',
      'sourceConfigurationFingerprint', 'lifecycleSchemaVersion', 'terminalReconciliationBasis', 'historyValid', 'historyCount',
    ])
    || !exactKeys(value.runtime, [
      'codexVersion', 'expectedCodexVersion', 'certificationState', 'freshness', 'workerHealth', 'bridgeHealth',
      'containment', 'mcp', 'readiness', 'executionEnabled',
    ])
    || !exactKeys(value.providerPolicy, ['hosts', 'sha256'])
    || value.accountBinding?.role !== 'OBSERVATION_ONLY'
    || !Array.isArray(value.enrollment?.operations)
    || value.enrollment.operations.length > MAX_ENROLLMENT_EVIDENCE_ROWS
    || (value.executionEnabled !== null && typeof value.executionEnabled !== 'boolean')) fail();
  return value;
}

async function collectReadOnlyPreflight(dependencies = {}) {
  const providerPolicy = readProviderPolicy({ root: ROOT, fileSystem: dependencies.fileSystem || fs });
  const database = await readDatabaseSnapshot(dependencies.databaseClientFactory);
  const supervisor = await readSupervisorSnapshot(dependencies.fetcher || fetch, dependencies.environment || process.env);
  const snapshot = buildSnapshot(database, supervisor, providerPolicy,
    (dependencies.clock || (() => new Date()))().toISOString());
  const blocker = readOnlyPreflightBlocker(snapshot);
  if (blocker) return safeBlockedEnvelope(snapshot, blocker, snapshot.observedAt);
  return projectReadOnlyPreflight(snapshot);
}

function emitPreflightEnvelope(envelope, output = process.stdout) {
  validatePreflightEnvelope(envelope);
  output.write(`SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1 ${JSON.stringify(envelope)}\n`);
}

async function main() {
  let envelope;
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
    envelope = await collectReadOnlyPreflight();
  } catch (error) {
    const code = error instanceof AuthBoundaryError || error instanceof PreflightCollectionError
      ? error.code : 'AUTH_BOUNDARY_PREFLIGHT_INVALID';
    envelope = safeBlockedEnvelope(null, code);
  }
  emitPreflightEnvelope(envelope);
  if (envelope.preflightStatus !== 'READY') process.exitCode = 2;
}

if (require.main === module) main();

module.exports = {
  ACCOUNT_SQL,
  DEV_DATABASE,
  ENROLLMENT_COUNTS_SQL,
  ENROLLMENT_EVIDENCE_SQL,
  INSTALLATION_SQL,
  MAX_ENROLLMENT_EVIDENCE_ROWS,
  PreflightCollectionError,
  buildSnapshot,
  collectReadOnlyPreflight,
  createDatabaseClient,
  emitPreflightEnvelope,
  lifecycleHistoryIsValid,
  readDatabaseSnapshot,
  readProviderPolicy,
  readSupervisorSnapshot,
  safeBlockedEnvelope,
  supervisorBaseUrl,
  validatePreflightEnvelope,
};
