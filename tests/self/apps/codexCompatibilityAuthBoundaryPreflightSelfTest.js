'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  CODEX_VERSION,
  INSTALLATION_CODE,
  APPROVED_PREFLIGHT_PROVIDER_HOSTS,
  readOnlyPreflightBlocker,
} = require('../../../docker/codex-compat-probe/auth-boundary-contract');
const {
  ACCOUNT_SQL,
  DEV_DATABASE,
  ENROLLMENT_COUNTS_SQL,
  ENROLLMENT_EVIDENCE_SQL,
  INSTALLATION_SQL,
  MAX_ENROLLMENT_EVIDENCE_ROWS,
  buildSnapshot,
  collectReadOnlyPreflight,
  createDatabaseClient,
  lifecycleHistoryIsValid,
  readDatabaseSnapshot,
  readProviderPolicy,
  readSupervisorSnapshot,
  safeBlockedEnvelope,
  supervisorBaseUrl,
  validatePreflightEnvelope,
  emitPreflightEnvelope,
} = require('../../../docker/codex-compat-probe/auth-boundary-preflight');
const { DEFAULT_RUNTIME_SERVICES } = require('../../../packages/supervisor/src/config');

const ROOT = path.resolve(__dirname, '../../..');
const observedAt = '2026-09-25T14:30:00.000Z';
const installationId = 'd4d4d4d4-4444-4444-8444-d4d4d4d4d4d4';
const accountBindingId = 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5';
const lifecycleId = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';
const enrollmentId = 'f6f6f6f6-6666-4666-8666-f6f6f6f6f6f6';
const fingerprint = 'A'.repeat(64);
const policyBytes = '# pinned source policy\nauth.openai.com\nchatgpt.com\n';
const policyDigest = crypto.createHash('sha256').update(policyBytes).digest('hex').toUpperCase();
const networkDigest = policyDigest;

function lifecycle(overrides = {}) {
  return {
    operationId: lifecycleId,
    state: 'SUCCEEDED',
    attemptCount: 1,
    completedAt: observedAt,
    terminalReconciledAt: observedAt,
    supervisorOperationId: lifecycleId,
    sourceConfigurationFingerprint: fingerprint,
    sourceConfigurationFingerprintStatus: 'BOUND',
    lifecycleSchemaVersion: 2,
    ...overrides,
  };
}

function installationRow(overrides = {}) {
  return {
    installation_id: installationId,
    installation_code: INSTALLATION_CODE,
    runtime_code: 'OPENAI_CODEX_APP_SERVER',
    adapter_version: 'codex-app-server-bootstrap.v1',
    certification_state: 'CERTIFIED',
    enabled: true,
    execution_enabled: false,
    freshness_status: 'CURRENT',
    observed_at: new Date(observedAt),
    protocol_schema_digest: 'D'.repeat(64),
    observed_codex_version: CODEX_VERSION,
    expected_codex_version: CODEX_VERSION,
    runtime_identity_attestation: 'VERIFIED',
    runtime_execution_enabled: 'false',
    runtime_readiness: 'ACCOUNT_UNENROLLED',
    mcp_reachability: 'CURRENT',
    provider_reachability: 'UNKNOWN',
    network_policy_digest: networkDigest,
    expected_network_policy_digest: networkDigest,
    runtime_ok: 'true',
    runtime_observed_at: observedAt,
    containment: {
      nonRoot: true,
      noNewPrivileges: true,
      allLinuxCapabilitiesDropped: true,
      readOnlyRootFilesystem: true,
      managedHomeVolumeOnly: true,
      liveCheckoutMount: false,
      arbitraryHostPathMount: false,
      dockerSocket: false,
      gitAvailable: false,
      browserState: false,
      prohibitedCredentials: true,
    },
    bootstrap_lifecycle: lifecycle(),
    bootstrap_lifecycle_history: [],
    lifecycle_history_present: true,
    // Deliberately present as unexpected driver fields: projection must ignore them.
    user_code: 'DO_NOT_PROJECT_USER_CODE',
    provider_login_reference: 'DO_NOT_PROJECT_LOGIN_REFERENCE',
    access_token: 'DO_NOT_PROJECT_TOKEN',
    ...overrides,
  };
}

function accountRow(overrides = {}) {
  return {
    account_binding_id: accountBindingId,
    account_code: 'phase19-3a0-managed-account',
    account_state: 'UNCONFIGURED',
    execution_enabled: false,
    user_code: 'DO_NOT_PROJECT_ACCOUNT_CODE',
    ...overrides,
  };
}

function enrollmentRow(state = 'COMPLETED', overrides = {}) {
  return {
    enrollment_id: enrollmentId,
    operation_state: state,
    provider_attempt_count: 1,
    created_at: new Date('2026-09-20T10:00:00.000Z'),
    started_at: new Date('2026-09-20T10:01:00.000Z'),
    completed_at: new Date('2026-09-20T10:02:00.000Z'),
    last_observed_at: new Date('2026-09-20T10:02:00.000Z'),
    user_code: 'DO_NOT_PROJECT_ENROLLMENT_CODE',
    verification_url: 'https://auth.openai.com/codex/device?secret=DO_NOT_PROJECT',
    provider_login_reference: 'DO_NOT_PROJECT_PROVIDER_REFERENCE',
    safe_result: { arbitrary: 'DO_NOT_PROJECT_PAYLOAD' },
    ...overrides,
  };
}

function databaseFixture({ enrollmentState = null, lifecycleOverrides = {}, accountOverrides = {}, installOverrides = {} } = {}) {
  const install = installationRow({ bootstrap_lifecycle: lifecycle(lifecycleOverrides), ...installOverrides });
  const account = accountRow(accountOverrides);
  const rows = enrollmentState ? [enrollmentRow(enrollmentState)] : [];
  const activeStates = new Set(['CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED']);
  const knownStates = new Set([
    'CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED',
    'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVOKED',
  ]);
  const activeCount = rows.filter((row) => activeStates.has(row.operation_state)).length;
  const unknownStateCount = rows.filter((row) => !knownStates.has(row.operation_state)).length;
  const unresolvedCount = rows.filter((row) => activeStates.has(row.operation_state)
    || (!activeStates.has(row.operation_state) && row.completed_at === null)).length;
  return {
    installation: install,
    account,
    enrollment: {
      totalCount: rows.length,
      activeCount,
      unresolvedCount,
      unknownStateCount,
      allStatesClassified: unknownStateCount === 0,
      evidenceTruncated: false,
      operations: rows.map((row) => ({
        operationId: row.enrollment_id,
        identityValid: true,
        state: knownStates.has(row.operation_state) ? row.operation_state : 'UNCLASSIFIED',
        providerAttemptCount: row.provider_attempt_count,
        createdAt: row.created_at.toISOString(),
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at?.toISOString() || null,
        lastObservedAt: row.last_observed_at?.toISOString() || null,
      })),
    },
  };
}

function supervisorPayload(overrides = {}) {
  const services = DEFAULT_RUNTIME_SERVICES.map((service) => ({
    service,
    state: 'RUNNING',
    health: ['api', 'codex-agent-runtime-worker', 'codex-control-bridge'].includes(service) ? 'HEALTHY' : 'HEALTHY',
    running: true,
  }));
  return {
    health: { ok: true, service: 'SkyCommand Supervisor', status: 'ONLINE' },
    status: {
      ok: true,
      supervisor: 'ONLINE',
      engineStatus: 'ONLINE',
      runtimeStatus: 'ONLINE',
      operation: null,
      lastOperation: { operationId: lifecycleId, status: 'SUCCEEDED', completedAt: observedAt, error: 'NEVER_PROJECT_RAW_ERROR' },
      runningCount: services.length,
      serviceCount: services.length,
      services,
      rawCredential: 'NEVER_PROJECT_SUPERVISOR_SECRET',
      ...overrides,
    },
  };
}

function fakeClient({ database = databaseFixture(), log = [] } = {}) {
  return {
    async connect() { log.push('CONNECT'); },
    async end() { log.push('END'); },
    async query(sql, params) {
      log.push({ sql: String(sql).trim(), params });
      const statement = String(sql).trim();
      if (statement === 'BEGIN READ ONLY') return { rowCount: null, rows: [] };
      if (statement === 'SHOW transaction_read_only') return { rowCount: 1, rows: [{ transaction_read_only: 'on' }] };
      if (statement === 'SELECT current_database() AS database_name') return { rowCount: 1, rows: [{ database_name: DEV_DATABASE }] };
      if (statement === 'ROLLBACK') return { rowCount: null, rows: [] };
      if (statement === INSTALLATION_SQL.trim()) return { rowCount: 1, rows: [database.installation] };
      if (statement === ACCOUNT_SQL.trim()) return { rowCount: 1, rows: [database.account] };
      if (statement === ENROLLMENT_COUNTS_SQL.trim()) return {
        rowCount: 1,
        rows: [{
          total_count: database.enrollment.totalCount,
          active_count: database.enrollment.activeCount,
          unresolved_count: database.enrollment.unresolvedCount,
          unknown_state_count: database.enrollment.unknownStateCount,
        }],
      };
      if (statement === ENROLLMENT_EVIDENCE_SQL.trim()) return {
        rowCount: database.enrollment.operations.length,
        rows: database.enrollment.operations.map((item) => ({
          enrollment_id: item.operationId,
          operation_state: item.state,
          provider_attempt_count: item.providerAttemptCount,
          created_at: item.createdAt,
          started_at: item.startedAt,
          completed_at: item.completedAt,
          last_observed_at: item.lastObservedAt,
          user_code: 'DO_NOT_RETURNED_BY_SELECT',
        })),
      };
      throw new Error('Unexpected SQL query');
    },
  };
}

function fileSystemForPolicy(text = '# pinned source policy\nauth.openai.com\nchatgpt.com\n') {
  return {
    lstatSync() { return { isSymbolicLink: () => false, isFile: () => true }; },
    readFileSync() { return Buffer.from(text, 'utf8'); },
  };
}

function fetchFixture(payload = supervisorPayload(), calls = []) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    const body = String(url).endsWith('/health') ? payload.health : payload.status;
    return { ok: true, async text() { return JSON.stringify(body); } };
  };
}

function validDependencies(overrides = {}) {
  const db = databaseFixture();
  const supervisor = supervisorPayload();
  return {
    root: ROOT,
    fileSystem: fileSystemForPolicy(),
    databaseClientFactory: () => fakeClient({ database: db }),
    fetcher: fetchFixture(supervisor),
    environment: { SKYCOMMAND_SUPERVISOR_HOST: '127.0.0.1', SKYCOMMAND_SUPERVISOR_PORT: '17170' },
    clock: () => new Date(observedAt),
    ...overrides,
  };
}

async function main() {
  const transactionLog = [];
  const db = databaseFixture();
  await readDatabaseSnapshot(() => fakeClient({ database: db, log: transactionLog }));
  assert.equal(transactionLog[0], 'CONNECT');
  assert.equal(transactionLog[1].sql, 'BEGIN READ ONLY');
  assert.equal(transactionLog[2].sql, 'SHOW transaction_read_only');
  assert.equal(transactionLog[3].sql, 'SELECT current_database() AS database_name');
  assert.ok(transactionLog.some((entry) => entry.sql === 'ROLLBACK'));
  assert.equal(transactionLog.at(-1), 'END');
  assert.equal(transactionLog.some((entry) => entry?.sql === 'COMMIT'), false);
  assert.throws(() => createDatabaseClient({
    PGHOST: 'db.production.example', PGPORT: '5432', PGDATABASE: DEV_DATABASE,
    PGUSER: 'postgres', PGPASSWORD: 'test-only', NODE_ENV: 'development',
  }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);
  assert.throws(() => createDatabaseClient({
    PGHOST: 'localhost', PGPORT: '5432', PGDATABASE: 'production',
    PGUSER: 'postgres', PGPASSWORD: 'test-only', NODE_ENV: 'development',
  }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);
  assert.throws(() => createDatabaseClient({
    PGHOST: 'localhost', PGPORT: '5432', PGDATABASE: DEV_DATABASE,
    PGUSER: 'postgres', PGPASSWORD: 'test-only', NODE_ENV: 'production',
  }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);

  const sql = [INSTALLATION_SQL, ACCOUNT_SQL, ENROLLMENT_COUNTS_SQL, ENROLLMENT_EVIDENCE_SQL].join('\n');
  assert.match(INSTALLATION_SQL.trim(), /^SELECT\b/i);
  assert.match(ACCOUNT_SQL.trim(), /^SELECT\b/i);
  assert.match(ENROLLMENT_COUNTS_SQL.trim(), /^SELECT\b/i);
  assert.match(ENROLLMENT_EVIDENCE_SQL.trim(), /^SELECT\b/i);
  assert.match(ENROLLMENT_COUNTS_SQL, /operation_state IS NULL/i);
  assert.match(ENROLLMENT_COUNTS_SQL, /provider_attempt_count IS NULL/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP)\b/i);
  for (const forbiddenColumn of [
    'verification_url', 'user_code', 'provider_login_reference', 'safe_result', 'access_token', 'refresh_token',
  ]) assert.doesNotMatch(sql, new RegExp(`\\b${forbiddenColumn}\\b`, 'i'));
  assert.equal(MAX_ENROLLMENT_EVIDENCE_ROWS, 64);

  const replacementId = 'a7a7a7a7-7777-4777-8777-a7a7a7a7a7a7';
  const boundFailedHistory = {
    eventType: 'MANAGED_CODEX_LIFECYCLE_SUPERSEDED',
    priorOperationId: lifecycleId,
    attemptCount: 2,
    terminalState: 'FAILED',
    sourceConfigurationFingerprintStatus: 'BOUND',
    sourceConfigurationFingerprint: fingerprint,
    completedAt: observedAt,
    terminalReconciledAt: observedAt,
    supersededAt: observedAt,
    replacementOperationId: replacementId,
    priorLifecycle: {
      operationId: lifecycleId, state: 'FAILED', attemptCount: 2,
      completedAt: observedAt, terminalReconciledAt: observedAt,
      supervisorOperationId: lifecycleId,
      sourceConfigurationFingerprintStatus: 'BOUND',
      sourceConfigurationFingerprint: fingerprint,
      lifecycleSchemaVersion: 2,
    },
  };
  assert.equal(lifecycleHistoryIsValid([boundFailedHistory]), true);
  assert.equal(lifecycleHistoryIsValid([{
    ...boundFailedHistory,
    priorLifecycle: { ...boundFailedHistory.priorLifecycle, supervisorOperationId: replacementId },
  }]), false);
  assert.equal(lifecycleHistoryIsValid([{
    ...boundFailedHistory,
    sourceConfigurationFingerprint: 'B'.repeat(64),
  }]), false);
  const legacyFailedHistory = {
    ...boundFailedHistory,
    sourceConfigurationFingerprintStatus: 'LEGACY_UNBOUND_PRE_FINGERPRINT',
    sourceConfigurationFingerprint: undefined,
    terminalReconciliationBasis: 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY',
    priorLifecycle: {
      operationId: lifecycleId, state: 'FAILED', attemptCount: 2,
      completedAt: observedAt, terminalReconciledAt: observedAt,
      supervisorOperationId: lifecycleId,
      terminalReconciliationBasis: 'LEGACY_PERSISTED_FAILURE_COMPATIBILITY',
    },
  };
  delete legacyFailedHistory.sourceConfigurationFingerprint;
  assert.equal(lifecycleHistoryIsValid([legacyFailedHistory]), true);
  const successfulHistory = {
    eventType: 'MANAGED_CODEX_LIFECYCLE_SUCCESSOR_CREATED',
    priorOperationId: lifecycleId,
    attemptCount: 1,
    terminalState: 'SUCCEEDED',
    sourceConfigurationFingerprintStatus: 'BOUND',
    sourceConfigurationFingerprint: fingerprint,
    completedAt: observedAt,
    terminalReconciledAt: observedAt,
    successorCreatedAt: observedAt,
    successorOperationId: replacementId,
    priorLifecycle: {
      operationId: lifecycleId, state: 'SUCCEEDED', attemptCount: 1,
      completedAt: observedAt, terminalReconciledAt: observedAt,
      supervisorOperationId: lifecycleId,
      sourceConfigurationFingerprintStatus: 'BOUND',
      sourceConfigurationFingerprint: fingerprint,
      lifecycleSchemaVersion: 2,
    },
  };
  assert.equal(lifecycleHistoryIsValid([successfulHistory]), true);

  const calls = [];
  const clean = await collectReadOnlyPreflight(validDependencies({ fetcher: fetchFixture(supervisorPayload(), calls) }));
  validatePreflightEnvelope(clean);
  assert.equal(clean.schema, 'SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1');
  assert.equal(clean.preflightStatus, 'READY');
  assert.equal(clean.installation.installationCode, INSTALLATION_CODE);
  assert.equal(clean.accountBinding.state, 'UNCONFIGURED');
  assert.equal(clean.accountBinding.role, 'OBSERVATION_ONLY');
  assert.equal(clean.accountBinding.executionEnabled, false);
  assert.equal(clean.enrollment.activeCount, 0);
  assert.equal(clean.enrollment.unresolvedCount, 0);
  assert.equal(clean.enrollment.unknownStateCount, 0);
  assert.equal(clean.supervisor.online, true);
  assert.equal(clean.supervisor.activeOperationPresent, false);
  assert.equal(clean.lifecycle.state, 'SUCCEEDED');
  assert.equal(clean.lifecycle.fingerprintStatus, 'BOUND');
  assert.equal(clean.runtime.version.observed, CODEX_VERSION);
  assert.equal(clean.runtime.version.expected, CODEX_VERSION);
  assert.equal(clean.runtime.certificationState, 'CERTIFIED');
  assert.equal(clean.runtime.freshness, 'CURRENT');
  assert.equal(clean.runtime.workerHealth, 'HEALTHY');
  assert.equal(clean.runtime.bridgeHealth, 'HEALTHY');
  assert.equal(clean.runtime.containment, 'CURRENT');
  assert.equal(clean.runtime.mcp, 'CURRENT');
  assert.equal(clean.runtime.executionEnabled, false);
  assert.equal(clean.executionEnabled, false);
  assert.deepEqual(clean.providerPolicy.hosts, APPROVED_PREFLIGHT_PROVIDER_HOSTS);
  assert.equal(clean.providerPolicy.sha256, crypto.createHash('sha256').update(policyBytes).digest('hex').toUpperCase());
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === 'GET' && call.options.redirect === 'error'));
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname).sort(), ['/health', '/runtime/status']);
  assert.throws(() => supervisorBaseUrl({ SKYCOMMAND_SUPERVISOR_HOST: '0.0.0.0' }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);

  let marker = '';
  emitPreflightEnvelope(clean, { write(value) { marker += value; } });
  assert.ok(marker.startsWith('SKYCOMMAND_CODEX_AUTH_BOUNDARY_PREFLIGHT_V1 {'));
  const json = JSON.stringify(clean);
  for (const sentinel of [
    'DO_NOT_PROJECT_USER_CODE', 'DO_NOT_PROJECT_ACCOUNT_CODE', 'DO_NOT_PROJECT_ENROLLMENT_CODE',
    'DO_NOT_PROJECT_LOGIN_REFERENCE', 'DO_NOT_PROJECT_PROVIDER_REFERENCE', 'DO_NOT_PROJECT_TOKEN',
    'DO_NOT_PROJECT_PAYLOAD', 'NEVER_PROJECT_RAW_ERROR', 'NEVER_PROJECT_SUPERVISOR_SECRET',
    'DO_NOT_PROJECT',
  ]) assert.equal(json.includes(sentinel), false, `${sentinel} must not be projected`);
  assert.throws(() => validatePreflightEnvelope({ ...clean, unsafe: 'unexpected' }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);
  assert.throws(() => validatePreflightEnvelope({ ...clean, runtime: { ...clean.runtime, rawPayload: 'not allowed' } }),
    /AUTH_BOUNDARY_PREFLIGHT_INVALID/);

  const activeEnrollmentCases = ['CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED'];
  for (const state of activeEnrollmentCases) {
    const source = databaseFixture({ enrollmentState: state });
    const snapshot = buildSnapshot(source, {
      online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
      lastOperationKnown: true, lastOperation: { operationId: lifecycleId, status: 'SUCCEEDED', completedAt: observedAt },
      workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY', allExpectedServicesRunning: true,
    }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
    assert.equal(readOnlyPreflightBlocker(snapshot), 'AUTH_BOUNDARY_ENROLLMENT_ACTIVE', `${state} vetoes before provider interaction`);
    const blocked = safeBlockedEnvelope(snapshot, readOnlyPreflightBlocker(snapshot), observedAt);
    validatePreflightEnvelope(blocked);
    assert.equal(blocked.blockerClass, 'AUTH_BOUNDARY_ENROLLMENT_ACTIVE');
    assert.equal(blocked.enrollment.operations[0].state, state);
    assert.equal(blocked.enrollment.operations[0].operationId, enrollmentId);
  }

  const unknownDatabase = databaseFixture({ enrollmentState: 'NEW_UNCLASSIFIED_STATE' });
  assert.equal(unknownDatabase.enrollment.unknownStateCount, 1);
  const unknownSnapshot = buildSnapshot(unknownDatabase, {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(unknownSnapshot), 'AUTH_BOUNDARY_ENROLLMENT_UNCLASSIFIED');
  const unknownBlocked = safeBlockedEnvelope(unknownSnapshot, readOnlyPreflightBlocker(unknownSnapshot), observedAt);
  validatePreflightEnvelope(unknownBlocked);
  assert.equal(unknownBlocked.enrollment.operations[0].state, 'UNCLASSIFIED');
  assert.equal(JSON.stringify(unknownBlocked).includes('NEW_UNCLASSIFIED_STATE'), false);

  const unresolvedDatabase = databaseFixture({ enrollmentState: 'FAILED' });
  unresolvedDatabase.enrollment.unresolvedCount = 1;
  unresolvedDatabase.enrollment.operations[0].completedAt = null;
  const unresolvedSnapshot = buildSnapshot(unresolvedDatabase, {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(unresolvedSnapshot), 'AUTH_BOUNDARY_ENROLLMENT_UNRESOLVED');

  const uncertainLifecycle = buildSnapshot(databaseFixture({ lifecycleOverrides: { terminalReconciledAt: null } }), {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(uncertainLifecycle), 'AUTH_BOUNDARY_LIFECYCLE_UNCERTAIN');
  const unknownAccountState = buildSnapshot(databaseFixture({ accountOverrides: { account_state: 'UNRECOGNIZED' } }), {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(unknownAccountState), 'AUTH_BOUNDARY_ACCOUNT_STATE_UNKNOWN');
  const malformedHistory = buildSnapshot(databaseFixture({
    installOverrides: { bootstrap_lifecycle_history: null, lifecycle_history_present: true },
  }), {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(malformedHistory), 'AUTH_BOUNDARY_LIFECYCLE_HISTORY_INVALID');
  const malformedBasis = buildSnapshot(databaseFixture({
    lifecycleOverrides: { terminalReconciliationBasis: 'UNCLASSIFIED_RAW_VALUE' },
  }), {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: false, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(malformedBasis), 'AUTH_BOUNDARY_LIFECYCLE_UNCERTAIN');

  const activeSupervisor = buildSnapshot(databaseFixture(), {
    online: true, runtimeStatus: 'ONLINE', activeOperationPresent: true, activeOperationId: null,
    lastOperationKnown: true, lastOperation: null, workerHealth: 'HEALTHY', bridgeHealth: 'HEALTHY',
    allExpectedServicesRunning: true,
  }, { hosts: [...APPROVED_PREFLIGHT_PROVIDER_HOSTS], sha256: policyDigest }, observedAt);
  assert.equal(readOnlyPreflightBlocker(activeSupervisor), 'AUTH_BOUNDARY_SUPERVISOR_OPERATION_ACTIVE');

  assert.equal(CODEX_VERSION, '0.154.0');
  const preflightSource = fs.readFileSync(path.join(ROOT, 'docker/codex-compat-probe/auth-boundary-preflight.js'), 'utf8');
  assert.doesNotMatch(preflightSource, /getManagedCodex|readHealth|persistRuntimeObservation|reconcileManagedCodex|startManagedCodex/i);
  assert.doesNotMatch(preflightSource, /child_process|docker\s+(?:compose|exec|run)|account\/login\/start|account\/read/);
  assert.equal(DEFAULT_RUNTIME_SERVICES.includes('codex-agent-runtime-worker'), true);

  const sourcePolicy = readProviderPolicy({ root: ROOT, fileSystem: fs });
  assert.deepEqual(sourcePolicy.hosts, APPROVED_PREFLIGHT_PROVIDER_HOSTS);
  const symlinkFileSystem = {
    lstatSync() { return { isSymbolicLink: () => true, isFile: () => false }; },
    readFileSync() { throw new Error('symlink must not be read'); },
  };
  assert.throws(() => readProviderPolicy({ root: ROOT, fileSystem: symlinkFileSystem }), /AUTH_BOUNDARY_PREFLIGHT_INVALID/);
  assert.throws(() => readProviderPolicy({ root: ROOT, fileSystem: fileSystemForPolicy('auth.openai.com\n') }),
    /AUTH_BOUNDARY_PREFLIGHT_INVALID/);
  assert.throws(() => readProviderPolicy({ root: ROOT, fileSystem: fileSystemForPolicy('auth.openai.com\nchatgpt.com\napi.openai.com\n') }),
    /AUTH_BOUNDARY_PREFLIGHT_INVALID/);

  const supervisorCalls = [];
  await readSupervisorSnapshot(fetchFixture(supervisorPayload(), supervisorCalls), {
    SKYCOMMAND_SUPERVISOR_HOST: '127.0.0.1', SKYCOMMAND_SUPERVISOR_PORT: '17170',
  });
  assert.equal(supervisorCalls.every((call) => call.options.method === 'GET'), true);
  await assert.rejects(() => readSupervisorSnapshot(async () => ({
    ok: true,
    async text() { return 'x'.repeat(300 * 1024); },
  }), { SKYCOMMAND_SUPERVISOR_HOST: '127.0.0.1', SKYCOMMAND_SUPERVISOR_PORT: '17170' }),
  (error) => error.code === 'AUTH_BOUNDARY_SUPERVISOR_OFFLINE');

  process.stdout.write('Codex authentication-boundary read-only preflight self-test passed: READ ONLY transaction and rollback, safe SELECT-only columns, local Supervisor GET, blocker classifications, bounded marker projection, policy digest, observational account binding, pinned runtime, and execution-disabled invariants verified. No preflight command, Docker, runtime write, or provider interaction was run.\n');
}

main().catch((error) => {
  process.stderr.write(`Codex authentication-boundary preflight self-test failed: ${error.message}\n`);
  process.exitCode = 1;
});
