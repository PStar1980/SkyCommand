const { createHash, randomUUID } = require('node:crypto');

const { query } = require('../../../../packages/db/src/connection');
const { getTaskQueueDiagnostics } = require('./temporalService');
const {
  buildReconciliationEvidence: buildTemporalReconciliationEvidence,
  getSupervisorBaseUrl,
  loadTemporalHeartbeats,
  normalizeHeartbeat,
} = require('./orchestratorRefreshService');
const { authorizeRuntimeControl } = require('./supervisorLifecycleGrantService');
const {
  DEV_RUNTIME_REFRESH_AGENT_ID,
  DEV_RUNTIME_REFRESH_CAPABILITY,
  DEV_RUNTIME_REFRESH_ENVIRONMENT,
  DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
  DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
  DEV_RUNTIME_REFRESH_PERMISSION,
  DEV_RUNTIME_REFRESH_REPOSITORY,
  getDevRuntimeRefreshProfile,
  listDevRuntimeRefreshProfiles,
  normalizeProfileCode,
} = require('./devRuntimeRefreshProfileRegistry');

const SUPERVISOR_TIMEOUT_MS = 15_000;
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE_PATTERN = /^[A-Z0-9_]{1,96}$/;
const SAFE_RUNTIME_STATUSES = new Set([
  'ONLINE',
  'STARTING',
  'PARTIAL',
  'DEGRADED',
  'STOPPED',
  'UNAVAILABLE',
  'UNKNOWN',
]);
const SAFE_ENGINE_STATUSES = new Set(['ONLINE', 'OFFLINE', 'UNKNOWN']);
const SAFE_SERVICE_STATES = new Set([
  'RUNNING',
  'EXITED',
  'CREATED',
  'RESTARTING',
  'UNKNOWN',
  'NOT_CREATED',
  'COMPLETED_BY_GOVERNED_ACTION',
]);
const SAFE_HEALTH_STATES = new Set(['HEALTHY', 'UNHEALTHY', 'STARTING', 'NONE', 'UNKNOWN']);
const SAFE_SUPERVISOR_ACTIONS = new Set([
  'START',
  'STOP',
  'RESTART',
  'REBUILD_WEB',
  'REBUILD_BACKEND',
  'REBUILD_TEMPORAL_WORKER',
  'REBUILD_CODEX_BOOTSTRAP',
  'REBUILD_AGENT_SESSION_RUNTIME',
]);

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code: details.code || 'SKYCOMMAND_DEV_RUNTIME_REFRESH_FAILED', ...details };
  return error;
}

function safeCode(value, fallback = 'RUNTIME_REFRESH_OUTCOME_UNAVAILABLE') {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return SAFE_CODE_PATTERN.test(code) ? code : fallback;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw createHttpError(400, 'idempotencyKey must be a single-line string.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_IDEMPOTENCY_KEY_INVALID',
    });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw createHttpError(400, 'idempotencyKey must be nonblank and no more than 200 characters.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_IDEMPOTENCY_KEY_INVALID',
      maxLength: DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
    });
  }
  return normalized;
}

function assertExactRuntimeRefreshBody(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Runtime refresh request must be a JSON object.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_INVALID_REQUEST',
    });
  }
  const unexpectedFields = Object.keys(body).filter(
    (key) => !['profileCode', 'idempotencyKey'].includes(key),
  );
  if (unexpectedFields.length) {
    throw createHttpError(400, 'Runtime refresh request contains unsupported fields.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_UNEXPECTED_FIELDS',
      rejectedFieldCount: unexpectedFields.length,
    });
  }
  const profileCode = normalizeProfileCode(body.profileCode);
  if (!profileCode || !getDevRuntimeRefreshProfile(profileCode)) {
    throw createHttpError(403, 'The requested runtime refresh profile is not allowlisted.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PROFILE_NOT_ALLOWED',
    });
  }
  return { profileCode, idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey) };
}

function permissionCodeSet(permissions = []) {
  const values = Array.isArray(permissions) ? permissions : [];
  return new Set(
    values
      .map((permission) =>
        typeof permission === 'string' ? permission : String(permission?.permissionCode || ''),
      )
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
}

function assertRuntimeRefreshAuthority({ permissions = [], agentId = '' } = {}) {
  if (String(agentId || '').trim() !== DEV_RUNTIME_REFRESH_AGENT_ID) {
    throw createHttpError(
      403,
      'The Assistant principal is not authorized for DEV runtime refresh.',
      {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED',
      },
    );
  }
  if (!permissionCodeSet(permissions).has(DEV_RUNTIME_REFRESH_PERMISSION)) {
    throw createHttpError(
      403,
      'The Assistant principal lacks the DEV runtime lifecycle permission.',
      {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PERMISSION_SCOPE_MISSING',
        missingPermissionCodes: [DEV_RUNTIME_REFRESH_PERMISSION],
      },
    );
  }
}

function buildRequestDigest(profileOrCode) {
  const profile =
    typeof profileOrCode === 'string' ? getDevRuntimeRefreshProfile(profileOrCode) : profileOrCode;
  if (!profile) {
    throw createHttpError(403, 'The requested runtime refresh profile is not allowlisted.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PROFILE_NOT_ALLOWED',
    });
  }
  return createHash('sha512')
    .update(
      JSON.stringify({
        profileCode: profile.profileCode,
        repositoryCode: profile.repositoryCode,
        environmentCode: profile.environmentCode,
        lifecycleProfileCode: profile.lifecycleProfileCode,
        action: profile.action,
        supervisorPath: profile.supervisorPath,
        targetService: profile.targetService,
        affectedServices: profile.affectedServices,
        oneShotServices: profile.oneShotServices,
      healthOptionalServices: profile.healthOptionalServices,
        reconciliationEvidence: profile.reconciliationEvidence,
      }),
      'utf8',
    )
    .digest('hex');
}

function buildSupervisorActionUrl(profileCode, environment = process.env) {
  const profile = getDevRuntimeRefreshProfile(profileCode);
  if (!profile) {
    throw createHttpError(403, 'The requested runtime refresh profile is not allowlisted.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PROFILE_NOT_ALLOWED',
    });
  }
  return `${getSupervisorBaseUrl(environment)}${profile.supervisorPath}`;
}

function buildSupervisorStatusUrl(environment = process.env) {
  return `${getSupervisorBaseUrl(environment)}/runtime/status`;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function safeEnum(value, allowed, fallback = 'UNKNOWN') {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return allowed.has(normalized) ? normalized : fallback;
}

function sanitizeSupervisorOperation(raw, expectedProfile = null) {
  if (!raw || typeof raw !== 'object') return null;
  const operationId = safeUuid(raw.operationId);
  const action = typeof raw.action === 'string' ? raw.action.trim().toUpperCase() : '';
  if (!SAFE_SUPERVISOR_ACTIONS.has(action)) return null;
  if (!operationId || (expectedProfile && action !== expectedProfile.action)) return null;
  const status = ['SUCCEEDED', 'FAILED', 'REQUESTED', 'DISPATCHED', 'UNKNOWN'].includes(
    String(raw.status || '').toUpperCase(),
  )
    ? String(raw.status).toUpperCase()
    : null;
  return {
    operationId,
    action,
    status,
    requestedAt: safeTimestamp(raw.requestedAt),
    completedAt: safeTimestamp(raw.completedAt),
    runtimeStatus: safeEnum(raw.runtimeStatus, SAFE_RUNTIME_STATUSES),
    failureCode: raw.code ? safeCode(raw.code) : null,
  };
}

function sanitizeActiveOperation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const operationId = safeUuid(raw.operationId);
  if (!operationId) return null;
  return {
    operationId,
    action:
      typeof raw.action === 'string' && SAFE_SUPERVISOR_ACTIONS.has(raw.action.trim().toUpperCase())
        ? raw.action.trim().toUpperCase()
        : null,
    requestedAt: safeTimestamp(raw.requestedAt),
  };
}

function projectSupervisorStatus(payload, profile) {
  if (!payload || typeof payload !== 'object' || payload.ok !== true) return null;
  const sourceServices = Array.isArray(payload.services) ? payload.services : [];
  const servicesByName = new Map(
    sourceServices
      .filter((item) => item && typeof item === 'object')
      .map((item) => [String(item.service || '').trim(), item]),
  );
  const services = profile.affectedServices.map((service) => {
    const item = servicesByName.get(service) || {};
    const state = safeEnum(item.state, SAFE_SERVICE_STATES);
    const health = safeEnum(item.health || 'NONE', SAFE_HEALTH_STATES, 'UNKNOWN');
    return { service, state, health, running: item.running === true && state === 'RUNNING' };
  });
  const activeOperationPresent = payload.operation !== null && payload.operation !== undefined;
  const activeOperation = sanitizeActiveOperation(payload.operation);
  const rawLastOperation =
    payload.lastOperation && typeof payload.lastOperation === 'object'
      ? payload.lastOperation
      : null;
  const lastOperation = rawLastOperation ? sanitizeSupervisorOperation(rawLastOperation) : null;
  return {
    supervisorStatus: payload.supervisor === 'ONLINE' ? 'ONLINE' : 'UNKNOWN',
    engineStatus: safeEnum(payload.engineStatus, SAFE_ENGINE_STATUSES),
    runtimeStatus: safeEnum(payload.runtimeStatus, SAFE_RUNTIME_STATUSES),
    runningCount: services.filter((item) => item.running).length,
    serviceCount: profile.affectedServices.length,
    services,
    activeOperationPresent,
    activeOperation,
    lastOperation,
  };
}

function buildRuntimeEvidence(supervisorStatus, profile, observedAt = new Date().toISOString()) {
  if (!supervisorStatus) return null;
  const lastOperation = supervisorStatus.lastOperation;
  const matchingActionSucceeded = Boolean(
    lastOperation &&
      lastOperation.status === 'SUCCEEDED' &&
      lastOperation.action === profile.action,
  );
  const services = supervisorStatus.services.map((service) =>
    profile.oneShotServices.includes(service.service) && matchingActionSucceeded
      ? { ...service, state: 'COMPLETED_BY_GOVERNED_ACTION', health: 'NONE', running: false }
      : service,
  );
  const generationIsCurrent = Boolean(
    matchingActionSucceeded &&
      supervisorStatus.runtimeStatus === 'ONLINE' &&
      services.length === profile.affectedServices.length &&
      services.every((service) =>
        profile.oneShotServices.includes(service.service)
          ? service.state === 'COMPLETED_BY_GOVERNED_ACTION'
          : service.running && (
              service.health === 'HEALTHY' ||
              (profile.healthOptionalServices.includes(service.service) && service.health === 'NONE')
            ),
      ),
  );
  return {
    observedAt: safeTimestamp(observedAt),
    supervisorStatus: supervisorStatus.supervisorStatus,
    engineStatus: supervisorStatus.engineStatus,
    runtimeStatus: supervisorStatus.runtimeStatus,
    runningCount: supervisorStatus.runningCount,
    serviceCount: supervisorStatus.serviceCount,
    services,
    activeOperationPresent:
      supervisorStatus.activeOperationPresent === true || Boolean(supervisorStatus.activeOperation),
    activeOperation: supervisorStatus.activeOperation,
    lastOperation,
    generationOperationId: generationIsCurrent ? lastOperation.operationId : null,
    freshness: generationIsCurrent ? 'CURRENT' : 'UNKNOWN',
  };
}

async function getSupervisorRuntimeStatus({
  profile,
  fetcher = fetch,
  environment = process.env,
} = {}) {
  try {
    const response = await fetcher(buildSupervisorStatusUrl(environment), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(SUPERVISOR_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    return projectSupervisorStatus(payload, profile);
  } catch (_error) {
    return null;
  }
}

const SELECT_OPERATION = `
  SELECT operation_id, caller_principal_code, caller_agent_id, idempotency_key, request_digest,
         profile_code, repository_code, environment_code, lifecycle_profile_code,
         target_service, affected_services, action, status, supervisor_operation_id,
         before_heartbeat, after_heartbeat, before_runtime_evidence,
         after_runtime_evidence, evidence, status_reason, requested_at, accepted_at,
         completed_at, last_reconciled_at, created_at, updated_at
    FROM worker.dev_runtime_refresh_operations
`;

async function loadOperationById(operationId, principalCode, queryExecutor = query) {
  const result = await queryExecutor(
    `${SELECT_OPERATION} WHERE operation_id = $1 AND caller_principal_code = $2 LIMIT 1`,
    [operationId, principalCode],
  );
  return result.rows[0] || null;
}

async function loadOperationByKey(principalCode, idempotencyKey, queryExecutor = query) {
  const result = await queryExecutor(
    `${SELECT_OPERATION} WHERE caller_principal_code = $1 AND idempotency_key = $2 LIMIT 1`,
    [principalCode, idempotencyKey],
  );
  return result.rows[0] || null;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function sanitizeHeartbeat(value) {
  const heartbeat = parseObject(value);
  return {
    workerIdentity:
      typeof heartbeat.workerIdentity === 'string' ? heartbeat.workerIdentity.slice(0, 200) : null,
    namespace: typeof heartbeat.namespace === 'string' ? heartbeat.namespace.slice(0, 128) : null,
    taskQueue: typeof heartbeat.taskQueue === 'string' ? heartbeat.taskQueue.slice(0, 128) : null,
    status: typeof heartbeat.status === 'string' ? heartbeat.status.slice(0, 32) : null,
    processId: Number.isSafeInteger(heartbeat.processId) ? heartbeat.processId : null,
    hostname: typeof heartbeat.hostname === 'string' ? heartbeat.hostname.slice(0, 128) : null,
    startedAt: safeTimestamp(heartbeat.startedAt),
    lastSeenAt: safeTimestamp(heartbeat.lastSeenAt),
    stoppedAt: safeTimestamp(heartbeat.stoppedAt),
    runtimeEnvironment:
      typeof heartbeat.runtimeEnvironment === 'string'
        ? heartbeat.runtimeEnvironment.slice(0, 64)
        : null,
    configProfile:
      typeof heartbeat.configProfile === 'string' ? heartbeat.configProfile.slice(0, 64) : null,
  };
}

function sanitizeRuntimeEvidence(value, profile) {
  const evidence = parseObject(value);
  const sourceServices = Array.isArray(evidence.services) ? evidence.services : [];
  const sourceByName = new Map(sourceServices.map((item) => [String(item?.service || ''), item]));
  const services = profile.affectedServices.map((service) => {
    const item = sourceByName.get(service) || {};
    const state = safeEnum(item.state, SAFE_SERVICE_STATES);
    return {
      service,
      state,
      health: safeEnum(item.health, SAFE_HEALTH_STATES),
      running: item.running === true && state === 'RUNNING',
    };
  });
  const lastOperation = sanitizeSupervisorOperation(evidence.lastOperation);
  return {
    observedAt: safeTimestamp(evidence.observedAt),
    supervisorStatus: evidence.supervisorStatus === 'ONLINE' ? 'ONLINE' : 'UNKNOWN',
    engineStatus: safeEnum(evidence.engineStatus, SAFE_ENGINE_STATUSES),
    runtimeStatus: safeEnum(evidence.runtimeStatus, SAFE_RUNTIME_STATUSES),
    runningCount: services.filter((item) => item.running).length,
    serviceCount: profile.affectedServices.length,
    services,
    activeOperationPresent: evidence.activeOperationPresent === true,
    activeOperation: sanitizeActiveOperation(evidence.activeOperation),
    lastOperation,
    generationOperationId: safeUuid(evidence.generationOperationId),
    freshness: evidence.freshness === 'CURRENT' ? 'CURRENT' : 'UNKNOWN',
  };
}

function sanitizeTemporalEvidence(value) {
  const evidence = parseObject(value);
  const temporal = parseObject(evidence.temporal);
  if (!Object.keys(temporal).length) return null;
  return {
    namespace: typeof temporal.namespace === 'string' ? temporal.namespace.slice(0, 128) : null,
    taskQueue: typeof temporal.taskQueue === 'string' ? temporal.taskQueue.slice(0, 128) : null,
    beforeWorkerIdentity:
      typeof temporal.beforeWorkerIdentity === 'string'
        ? temporal.beforeWorkerIdentity.slice(0, 200)
        : null,
    observedWorkerIdentity:
      typeof temporal.observedWorkerIdentity === 'string'
        ? temporal.observedWorkerIdentity.slice(0, 200)
        : null,
    observedWorkerStartedAt: safeTimestamp(temporal.observedWorkerStartedAt),
    observedWorkerLastSeenAt: safeTimestamp(temporal.observedWorkerLastSeenAt),
    observedWorkerStatus:
      typeof temporal.observedWorkerStatus === 'string'
        ? temporal.observedWorkerStatus.slice(0, 32)
        : null,
    heartbeatFresh: temporal.heartbeatFresh === true,
    temporalHealthy: temporal.temporalHealthy === true,
    temporalPollerCount: Number.isSafeInteger(temporal.temporalPollerCount)
      ? temporal.temporalPollerCount
      : 0,
    pollerIdentityMatch: temporal.pollerIdentityMatch === true,
  };
}

function sanitizeOperation(row) {
  if (!row) return null;
  const profile = getDevRuntimeRefreshProfile(row.profile_code);
  if (!profile) return null;
  const evidence = parseObject(row.evidence);
  const supervisorEvidence = sanitizeSupervisorOperation(evidence.supervisorOperation, profile);
  const beforeHeartbeat =
    profile.profileCode === 'TEMPORAL_WORKER' ? sanitizeHeartbeat(row.before_heartbeat) : {};
  const afterHeartbeat =
    profile.profileCode === 'TEMPORAL_WORKER' ? sanitizeHeartbeat(row.after_heartbeat) : {};
  const statusReason = row.status_reason ? safeCode(row.status_reason) : null;
  return {
    operationId: safeUuid(row.operation_id),
    profileCode: profile.profileCode,
    repositoryCode: profile.repositoryCode,
    environmentCode: profile.environmentCode,
    lifecycleProfileCode: profile.lifecycleProfileCode,
    targetService: profile.targetService,
    affectedServices: [...profile.affectedServices],
    action: profile.action,
    status: ['PENDING', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(
      String(row.status || '').toUpperCase(),
    )
      ? String(row.status).toUpperCase()
      : 'UNKNOWN',
    supervisorOperationId: safeUuid(row.supervisor_operation_id),
    supervisorOperation: supervisorEvidence,
    beforeHeartbeat,
    afterHeartbeat,
    runtimeEvidence: {
      before: sanitizeRuntimeEvidence(row.before_runtime_evidence, profile),
      after: sanitizeRuntimeEvidence(row.after_runtime_evidence, profile),
    },
    temporalEvidence: sanitizeTemporalEvidence(evidence),
    statusReason,
    requestedAt: safeTimestamp(row.requested_at),
    acceptedAt: safeTimestamp(row.accepted_at),
    completedAt: safeTimestamp(row.completed_at),
    lastReconciledAt: safeTimestamp(row.last_reconciled_at),
  };
}

async function insertOperation(
  {
    callerPrincipalCode,
    callerAgentId,
    idempotencyKey,
    requestDigest,
    profile,
    beforeRuntimeEvidence,
    beforeHeartbeat,
  },
  queryExecutor = query,
) {
  const operationId = randomUUID();
  const result = await queryExecutor(
    `
      INSERT INTO worker.dev_runtime_refresh_operations (
        operation_id, caller_principal_code, caller_agent_id, idempotency_key, request_digest,
        profile_code, repository_code, environment_code, lifecycle_profile_code,
        target_service, action, affected_services, before_heartbeat,
        before_runtime_evidence, evidence
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
        $13::jsonb, $14::jsonb, $15::jsonb
      )
      ON CONFLICT (caller_principal_code, idempotency_key) DO NOTHING
      RETURNING operation_id, caller_principal_code, caller_agent_id, idempotency_key, request_digest,
                profile_code, repository_code, environment_code, lifecycle_profile_code,
                target_service, affected_services, action, status, supervisor_operation_id,
                before_heartbeat, after_heartbeat, before_runtime_evidence,
                after_runtime_evidence, evidence, status_reason, requested_at, accepted_at,
                completed_at, last_reconciled_at, created_at, updated_at
    `,
    [
      operationId,
      callerPrincipalCode,
      callerAgentId,
      idempotencyKey,
      requestDigest,
      profile.profileCode,
      profile.repositoryCode,
      profile.environmentCode,
      profile.lifecycleProfileCode,
      profile.targetService,
      profile.action,
      JSON.stringify(profile.affectedServices),
      JSON.stringify(beforeHeartbeat || {}),
      JSON.stringify(beforeRuntimeEvidence || {}),
      JSON.stringify({
        transport: 'HOST_SUPERVISOR_SIGNED_GRANT',
        reconciliationEvidence: profile.reconciliationEvidence,
      }),
    ],
  );
  return result.rows[0] || null;
}

const MUTABLE_FIELDS = new Set([
  'status',
  'supervisor_operation_id',
  'after_heartbeat',
  'after_runtime_evidence',
  'evidence',
  'status_reason',
  'accepted_at',
  'completed_at',
  'last_reconciled_at',
]);

async function updateOperation(operationId, fields, queryExecutor = query) {
  const entries = Object.entries(fields).filter(
    ([field, value]) => MUTABLE_FIELDS.has(field) && value !== undefined,
  );
  if (!entries.length) return;
  const assignments = entries.map(([field], index) => `${field} = $${index + 2}`).join(', ');
  const values = entries.map(([, value]) => value);
  await queryExecutor(
    `UPDATE worker.dev_runtime_refresh_operations SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE operation_id = $1 AND status NOT IN ('SUCCEEDED', 'FAILED')`,
    [operationId, ...values],
  );
}

async function postSupervisorRefresh({
  operationId,
  profile,
  grant,
  fetcher = fetch,
  environment = process.env,
}) {
  let response;
  try {
    response = await fetcher(buildSupervisorActionUrl(profile.profileCode, environment), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-SkyCommand-Supervisor-Grant': grant,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(SUPERVISOR_TIMEOUT_MS),
    });
  } catch (_error) {
    throw createHttpError(
      502,
      'Supervisor dispatch outcome is uncertain; reconcile the same operation.',
      {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_DISPATCH_OUTCOME_UNKNOWN',
        outcomeUnknown: true,
        operationId,
      },
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const outcomeUnknown = Number(response.status) >= 500 || !Number.isInteger(response.status);
    throw createHttpError(
      502,
      'SkyCommand Supervisor did not accept the registered runtime refresh.',
      {
        code: safeCode(payload?.code, 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_REJECTED'),
        operationId,
        outcomeUnknown,
      },
    );
  }
  if (payload?.ok !== true || payload?.accepted !== true) {
    throw createHttpError(502, 'Supervisor returned an unclassifiable runtime refresh response.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_RESPONSE_INVALID',
      operationId,
      outcomeUnknown: true,
    });
  }
  const acceptedOperation = sanitizeSupervisorOperation(payload.operation, profile);
  if (!acceptedOperation || acceptedOperation.operationId !== operationId) {
    throw createHttpError(
      502,
      'Supervisor acceptance did not match the durable operation identity.',
      {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_OPERATION_ID_MISMATCH',
        operationId,
        outcomeUnknown: true,
      },
    );
  }
  return acceptedOperation;
}

function supervisorStatusFailureCode(status, profile, operation) {
  const active = status?.activeOperation;
  const last = status?.lastOperation;
  if (status?.activeOperationPresent && !active) return 'SUPERVISOR_OPERATION_UNCORRELATED';
  if (
    active?.operationId === operation.supervisor_operation_id ||
    active?.operationId === operation.operation_id
  ) {
    return active.action === profile.action ? null : 'SUPERVISOR_ACTION_MISMATCH';
  }
  if (active) return 'SUPERVISOR_OPERATION_UNCORRELATED';
  const expectedOperationId =
    safeUuid(operation.supervisor_operation_id) || safeUuid(operation.operation_id);
  if (last?.operationId !== expectedOperationId) return 'SUPERVISOR_OUTCOME_UNCONFIRMED';
  if (last.action !== profile.action) return 'SUPERVISOR_ACTION_MISMATCH';
  if (last.status === 'SUCCEEDED' || last.status === 'FAILED') return null;
  return 'SUPERVISOR_TERMINAL_OUTCOME_UNAVAILABLE';
}

async function buildTemporalEvidence(
  operation,
  supervisorStatus,
  {
    queryExecutor = query,
    heartbeatLoader = loadTemporalHeartbeats,
    diagnosticsLoader = getTaskQueueDiagnostics,
  } = {},
) {
  const temporalConfig = require('../../../../packages/temporal/src/config').getTemporalConfig();
  const [heartbeats, diagnostics] = await Promise.all([
    heartbeatLoader({ temporalConfig, queryExecutor }).catch(() => []),
    diagnosticsLoader(temporalConfig.taskQueue).catch(() => null),
  ]);
  const normalized = (heartbeats || []).map((heartbeat) =>
    heartbeat.worker_identity ? normalizeHeartbeat(heartbeat) : heartbeat,
  );
  const evidence = buildTemporalReconciliationEvidence({
    beforeHeartbeat: operation.before_heartbeat || {},
    heartbeats: normalized,
    diagnostics,
    supervisorStatus,
  });
  return {
    namespace: typeof evidence.namespace === 'string' ? evidence.namespace.slice(0, 128) : null,
    taskQueue: typeof evidence.taskQueue === 'string' ? evidence.taskQueue.slice(0, 128) : null,
    beforeWorkerIdentity:
      typeof evidence.beforeWorkerIdentity === 'string'
        ? evidence.beforeWorkerIdentity.slice(0, 200)
        : null,
    observedWorkerIdentity:
      typeof evidence.observedWorkerIdentity === 'string'
        ? evidence.observedWorkerIdentity.slice(0, 200)
        : null,
    observedWorkerStartedAt: safeTimestamp(evidence.observedWorkerStartedAt),
    observedWorkerLastSeenAt: safeTimestamp(evidence.observedWorkerLastSeenAt),
    observedWorkerStatus:
      typeof evidence.observedWorkerStatus === 'string'
        ? evidence.observedWorkerStatus.slice(0, 32)
        : null,
    heartbeatFresh: evidence.heartbeatFresh === true,
    temporalHealthy: evidence.temporalHealthy === true,
    temporalPollerCount: Number.isSafeInteger(evidence.temporalPollerCount)
      ? evidence.temporalPollerCount
      : 0,
    pollerIdentityMatch: evidence.pollerIdentityMatch === true,
  };
}

async function reconcileOperation(
  row,
  {
    queryExecutor = query,
    supervisorStatusLoader = getSupervisorRuntimeStatus,
    heartbeatLoader = loadTemporalHeartbeats,
    diagnosticsLoader = getTaskQueueDiagnostics,
    now = () => new Date(),
  } = {},
) {
  if (!row || TERMINAL_STATUSES.has(String(row.status || '').toUpperCase())) return row;
  const profile = getDevRuntimeRefreshProfile(row.profile_code);
  if (!profile) {
    await updateOperation(
      row.operation_id,
      {
        status: 'UNKNOWN',
        status_reason: 'RUNTIME_REFRESH_PROFILE_INVALID',
        last_reconciled_at: now().toISOString(),
      },
      queryExecutor,
    );
    return loadOperationById(row.operation_id, row.caller_principal_code, queryExecutor);
  }

  const observedAt = now().toISOString();
  const supervisorStatus = await supervisorStatusLoader({ profile });
  if (!supervisorStatus) {
    await updateOperation(
      row.operation_id,
      {
        status: 'UNKNOWN',
        status_reason: 'SUPERVISOR_STATUS_UNAVAILABLE',
        last_reconciled_at: observedAt,
      },
      queryExecutor,
    );
    return loadOperationById(row.operation_id, row.caller_principal_code, queryExecutor);
  }

  const runtimeEvidence = buildRuntimeEvidence(supervisorStatus, profile, observedAt);
  const expectedOperationId = safeUuid(row.supervisor_operation_id) || safeUuid(row.operation_id);
  const activeOperationId = supervisorStatus.activeOperation?.operationId || null;
  const activeMatches = Boolean(activeOperationId && activeOperationId === expectedOperationId);
  const failureCode = supervisorStatusFailureCode(supervisorStatus, profile, row);
  let nextStatus = 'UNKNOWN';
  let nextReason = failureCode || 'SUPERVISOR_OUTCOME_UNCONFIRMED';
  let completedAt;
  let afterHeartbeat = row.after_heartbeat || {};
  let temporalEvidence = null;

  if (activeMatches) {
    nextStatus = 'DISPATCHED';
    nextReason = null;
  } else if (!failureCode) {
    const last = supervisorStatus.lastOperation;
    nextStatus = last.status;
    nextReason =
      nextStatus === 'FAILED' ? safeCode(last.failureCode, 'SUPERVISOR_REFRESH_FAILED') : null;
    completedAt = safeTimestamp(last.completedAt) || observedAt;
  }

  if (profile.profileCode === 'TEMPORAL_WORKER') {
    temporalEvidence = await buildTemporalEvidence(row, supervisorStatus, {
      queryExecutor,
      heartbeatLoader,
      diagnosticsLoader,
    });
    const supervisorFailed = !failureCode && supervisorStatus.lastOperation?.status === 'FAILED';
    if (temporalEvidence.heartbeatFresh && temporalEvidence.pollerIdentityMatch) {
      nextStatus = 'SUCCEEDED';
      nextReason = null;
      completedAt = completedAt || observedAt;
      const heartbeats = await heartbeatLoader({
        temporalConfig: require('../../../../packages/temporal/src/config').getTemporalConfig(),
        queryExecutor,
      }).catch(() => []);
      const match = heartbeats.find(
        (heartbeat) =>
          (heartbeat.worker_identity || heartbeat.workerIdentity) ===
          temporalEvidence.observedWorkerIdentity,
      );
      afterHeartbeat = match ? normalizeHeartbeat(match) : {};
    } else if (supervisorFailed) {
      nextStatus = 'FAILED';
      nextReason = nextReason || 'SUPERVISOR_REFRESH_FAILED';
      completedAt = completedAt || observedAt;
    } else if (
      nextStatus === 'SUCCEEDED' &&
      (!temporalEvidence.heartbeatFresh || !temporalEvidence.pollerIdentityMatch)
    ) {
      nextStatus = 'UNKNOWN';
      nextReason = 'TEMPORAL_WORKER_GENERATION_UNCONFIRMED';
      completedAt = undefined;
    }
  }

  const priorEvidence = parseObject(row.evidence);
  const nextEvidence = {
    transport: 'HOST_SUPERVISOR_SIGNED_GRANT',
    reconciliationCode: nextReason,
    supervisorOperation: sanitizeSupervisorOperation(
      activeMatches ? supervisorStatus.activeOperation : supervisorStatus.lastOperation,
      profile,
    ),
    temporal: temporalEvidence,
  };
  await updateOperation(
    row.operation_id,
    {
      status: nextStatus,
      after_heartbeat: JSON.stringify(afterHeartbeat || {}),
      after_runtime_evidence: JSON.stringify(runtimeEvidence || {}),
      evidence: JSON.stringify({
        supervisorAccepted: priorEvidence.supervisorAccepted === true,
        ...nextEvidence,
      }),
      status_reason: nextReason,
      completed_at: completedAt,
      last_reconciled_at: observedAt,
    },
    queryExecutor,
  );
  return loadOperationById(row.operation_id, row.caller_principal_code, queryExecutor);
}

async function startDevRuntimeRefresh({
  request = {},
  permissions = [],
  principalCode = 'assistant-http',
  agentId = '',
  actor = {},
  session = {},
  requestContext = {},
  authorize = authorizeRuntimeControl,
  supervisorStatusLoader = getSupervisorRuntimeStatus,
  supervisorPoster = postSupervisorRefresh,
  heartbeatLoader = loadTemporalHeartbeats,
  queryExecutor = query,
  now = () => new Date(),
} = {}) {
  assertRuntimeRefreshAuthority({ permissions, agentId });
  const { profileCode, idempotencyKey } = assertExactRuntimeRefreshBody(request);
  const profile = getDevRuntimeRefreshProfile(profileCode);
  const callerPrincipalCode = normalizeText(principalCode, 'assistant-http');
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(callerPrincipalCode)) {
    throw createHttpError(403, 'The Assistant principal identity is invalid for runtime refresh.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED',
    });
  }
  const requestDigest = buildRequestDigest(profile);

  const continueOperation = async (operation, reused) => {
    if (operation.request_digest !== requestDigest || operation.caller_agent_id !== agentId) {
      throw createHttpError(
        409,
        'The idempotency key is already bound to a different runtime refresh request.',
        {
          code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_IDEMPOTENCY_CONFLICT',
          operationId: operation.operation_id,
        },
      );
    }
    const reconciled = await reconcileOperation(operation, {
      queryExecutor,
      supervisorStatusLoader,
      heartbeatLoader,
      now,
    });
    return { operation: sanitizeOperation(reconciled), reused };
  };

  return (async () => {
    const existing = await loadOperationByKey(callerPrincipalCode, idempotencyKey, queryExecutor);
    if (existing) return continueOperation(existing, true);

    const supervisorBefore = await supervisorStatusLoader({ profile });
    if (
      !supervisorBefore ||
      supervisorBefore.supervisorStatus !== 'ONLINE' ||
      supervisorBefore.engineStatus !== 'ONLINE'
    ) {
      throw createHttpError(
        503,
        'The Host Supervisor and runtime engine must be online before refresh admission.',
        {
          code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_UNAVAILABLE',
        },
      );
    }
    if (supervisorBefore.activeOperationPresent || supervisorBefore.activeOperation) {
      throw createHttpError(
        409,
        'Another Supervisor operation is active; runtime refresh was not dispatched.',
        {
          code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_BUSY',
        },
      );
    }

    const beforeRuntimeEvidence = buildRuntimeEvidence(
      supervisorBefore,
      profile,
      now().toISOString(),
    );
    let beforeHeartbeat = {};
    if (profile.profileCode === 'TEMPORAL_WORKER') {
      const heartbeats = await heartbeatLoader({ queryExecutor }).catch(() => []);
      beforeHeartbeat = heartbeats[0]
        ? heartbeats[0].worker_identity
          ? normalizeHeartbeat(heartbeats[0])
          : heartbeats[0]
        : {};
    }
    const inserted = await insertOperation(
      {
        callerPrincipalCode,
        callerAgentId: agentId,
        idempotencyKey,
        requestDigest,
        profile,
        beforeRuntimeEvidence,
        beforeHeartbeat,
      },
      queryExecutor,
    );
    const operation =
      inserted || (await loadOperationByKey(callerPrincipalCode, idempotencyKey, queryExecutor));
    if (!operation) {
      throw createHttpError(500, 'The DEV runtime refresh operation could not be recorded.', {
        code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_RECORD_FAILED',
      });
    }
    if (!inserted || operation.operation_id !== inserted.operation_id) {
      return continueOperation(operation, true);
    }

    try {
      const authorization = await authorize({
        action: profile.action,
        operationId: operation.operation_id,
        permissionCode: DEV_RUNTIME_REFRESH_PERMISSION,
        confirmed: true,
        actor,
        session,
        requestContext,
      });
      const accepted = await supervisorPoster({
        operationId: operation.operation_id,
        profile,
        grant: authorization.authorization.grant,
      });
      if (accepted.operationId !== operation.operation_id) {
        throw createHttpError(
          502,
          'Supervisor acceptance did not match the durable operation identity.',
          {
            code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_SUPERVISOR_OPERATION_ID_MISMATCH',
            operationId: operation.operation_id,
            outcomeUnknown: true,
          },
        );
      }
      await updateOperation(
        operation.operation_id,
        {
          status: 'DISPATCHED',
          supervisor_operation_id: accepted.operationId,
          accepted_at: now().toISOString(),
          last_reconciled_at: now().toISOString(),
          evidence: JSON.stringify({
            supervisorAccepted: true,
            transport: 'HOST_SUPERVISOR_SIGNED_GRANT',
            supervisorOperation: accepted,
            reconciliationCode: null,
            temporal: null,
          }),
        },
        queryExecutor,
      );
    } catch (error) {
      const outcomeUnknown = error?.details?.outcomeUnknown === true;
      const reason = safeCode(
        error?.details?.code || error?.code,
        outcomeUnknown ? 'SUPERVISOR_DISPATCH_OUTCOME_UNKNOWN' : 'SUPERVISOR_DISPATCH_REJECTED',
      );
      await updateOperation(
        operation.operation_id,
        {
          status: outcomeUnknown ? 'UNKNOWN' : 'FAILED',
          status_reason: reason,
          completed_at: outcomeUnknown ? undefined : now().toISOString(),
          last_reconciled_at: now().toISOString(),
          evidence: JSON.stringify({
            supervisorAccepted: false,
            transport: 'HOST_SUPERVISOR_SIGNED_GRANT',
            reconciliationCode: reason,
            supervisorOperation: null,
            temporal: null,
          }),
        },
        queryExecutor,
      ).catch(() => {});
      if (outcomeUnknown) {
        const current = await loadOperationById(
          operation.operation_id,
          callerPrincipalCode,
          queryExecutor,
        );
        return { operation: sanitizeOperation(current), reused: false };
      }
      throw createHttpError(
        error?.statusCode || 502,
        'The registered Supervisor runtime refresh was rejected.',
        {
          code: reason,
          operationId: operation.operation_id,
        },
      );
    }

    const current = await loadOperationById(
      operation.operation_id,
      callerPrincipalCode,
      queryExecutor,
    );
    return { operation: sanitizeOperation(current), reused: false };
  })();
}

async function getDevRuntimeRefresh({
  operationId,
  principalCode = 'assistant-http',
  permissions = [],
  agentId = '',
  queryExecutor = query,
  supervisorStatusLoader = getSupervisorRuntimeStatus,
  heartbeatLoader = loadTemporalHeartbeats,
  diagnosticsLoader = getTaskQueueDiagnostics,
  now = () => new Date(),
} = {}) {
  assertRuntimeRefreshAuthority({ permissions, agentId });
  const normalizedOperationId = normalizeText(operationId);
  if (!UUID_PATTERN.test(normalizedOperationId)) {
    throw createHttpError(400, 'operationId must be a valid UUID.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_OPERATION_ID_INVALID',
    });
  }
  const callerPrincipalCode = normalizeText(principalCode, 'assistant-http');
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(callerPrincipalCode)) {
    throw createHttpError(403, 'The Assistant principal identity is invalid for runtime refresh.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED',
    });
  }
  const row = await loadOperationById(normalizedOperationId, callerPrincipalCode, queryExecutor);
  if (!row) {
    throw createHttpError(404, 'DEV runtime refresh operation was not found for this principal.', {
      code: 'SKYCOMMAND_DEV_RUNTIME_REFRESH_NOT_FOUND',
    });
  }
  const reconciled = await reconcileOperation(row, {
    queryExecutor,
    supervisorStatusLoader,
    heartbeatLoader,
    diagnosticsLoader,
    now,
  });
  return { operation: sanitizeOperation(reconciled) };
}

function getDevRuntimeRefreshCapabilitySummary(permissionCodes = [], agentId = '') {
  const executable =
    String(agentId || '').trim() === DEV_RUNTIME_REFRESH_AGENT_ID &&
    permissionCodeSet(permissionCodes).has(DEV_RUNTIME_REFRESH_PERMISSION);
  return {
    capability: DEV_RUNTIME_REFRESH_CAPABILITY,
    enabled: executable,
    executable,
    principalAgentId: DEV_RUNTIME_REFRESH_AGENT_ID,
    requiredPermissionCodes: [DEV_RUNTIME_REFRESH_PERMISSION],
    profiles: listDevRuntimeRefreshProfiles().map((profile) => ({
      profileCode: profile.profileCode,
      action: profile.action,
      affectedServices: profile.affectedServices,
      oneShotServices: profile.oneShotServices,
      healthOptionalServices: profile.healthOptionalServices,
      reconciliationEvidence: profile.reconciliationEvidence,
      repositoryCode: profile.repositoryCode,
      environmentCode: profile.environmentCode,
      lifecycleProfileCode: profile.lifecycleProfileCode,
    })),
    startEndpoint: '/api/assistant/runtime-refresh/runs',
    statusEndpoint: '/api/assistant/runtime-refresh/runs/{operationId}',
    requestFields: ['profileCode', 'idempotencyKey'],
    operationIdentityDurable: true,
    idempotencyEnforced: true,
    grantOperationBound: true,
    grantPersisted: false,
    directDockerReachable: false,
    blockedReason: executable
      ? null
      : agentId !== DEV_RUNTIME_REFRESH_AGENT_ID
        ? 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PRINCIPAL_NOT_ALLOWED'
        : 'SKYCOMMAND_DEV_RUNTIME_REFRESH_PERMISSION_SCOPE_MISSING',
  };
}

module.exports = {
  DEV_RUNTIME_REFRESH_AGENT_ID,
  DEV_RUNTIME_REFRESH_CAPABILITY,
  DEV_RUNTIME_REFRESH_ENVIRONMENT,
  DEV_RUNTIME_REFRESH_LIFECYCLE_PROFILE,
  DEV_RUNTIME_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
  DEV_RUNTIME_REFRESH_PERMISSION,
  DEV_RUNTIME_REFRESH_REPOSITORY,
  assertExactRuntimeRefreshBody,
  assertRuntimeRefreshAuthority,
  buildRequestDigest,
  buildRuntimeEvidence,
  buildSupervisorActionUrl,
  buildSupervisorStatusUrl,
  getDevRuntimeRefreshCapabilitySummary,
  getDevRuntimeRefreshProfile,
  getDevRuntimeRefresh,
  getSupervisorRuntimeStatus,
  insertOperation,
  listDevRuntimeRefreshProfiles,
  loadOperationById,
  loadOperationByKey,
  normalizeIdempotencyKey,
  postSupervisorRefresh,
  projectSupervisorStatus,
  reconcileOperation,
  sanitizeOperation,
  startDevRuntimeRefresh,
  updateOperation,
};
