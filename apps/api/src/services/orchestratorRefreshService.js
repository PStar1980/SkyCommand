const { createHash, randomUUID } = require('node:crypto');

const { query } = require('../../../../packages/db/src/connection');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const { getTaskQueueDiagnostics } = require('./temporalService');
const { authorizeRuntimeControl } = require('./supervisorLifecycleGrantService');

const ORCHESTRATOR_REFRESH_CAPABILITY = 'skycommand_temporal_worker_refresh';
const ORCHESTRATOR_REFRESH_PERMISSION = 'WORKFLOW_RUN';
const ORCHESTRATOR_REFRESH_ACTION = 'REBUILD_TEMPORAL_WORKER';
const ORCHESTRATOR_REFRESH_TARGET_SERVICE = 'temporal-worker';
const ORCHESTRATOR_REFRESH_REPOSITORY = 'SkyCommand';
const ORCHESTRATOR_REFRESH_ENVIRONMENT = 'DEV_LOCAL';
const ORCHESTRATOR_REFRESH_REQUEST_DIGEST_ALGORITHM = 'SHA-512';
const ORCHESTRATOR_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const ORCHESTRATOR_REFRESH_FRESHNESS_MS = 60_000;
const ORCHESTRATOR_REFRESH_SUPERVISOR_TIMEOUT_MS = 15_000;
const ORCHESTRATOR_REFRESH_TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED']);

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code: details.code || 'SKYCOMMAND_ORCHESTRATOR_REFRESH_FAILED', ...details };
  return error;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw createHttpError(400, 'idempotencyKey must be a single-line string.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_IDEMPOTENCY_KEY_INVALID',
    });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > ORCHESTRATOR_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw createHttpError(400, 'idempotencyKey must be nonblank and no more than 200 characters.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_IDEMPOTENCY_KEY_INVALID',
      maxLength: ORCHESTRATOR_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
    });
  }
  return normalized;
}

function assertExactRefreshBody(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'Temporal worker refresh request must be a JSON object.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_INVALID_REQUEST',
    });
  }
  const unexpectedFields = Object.keys(body).filter((key) => key !== 'idempotencyKey');
  if (unexpectedFields.length > 0) {
    throw createHttpError(400, 'Temporal worker refresh request contains unsupported fields.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_UNEXPECTED_FIELDS',
      unexpectedFields,
    });
  }
  return { idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey) };
}

function permissionCodeSet(permissions = []) {
  return new Set(
    permissions
      .map((permission) =>
        typeof permission === 'string' ? permission : String(permission?.permissionCode || ''),
      )
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
}

function assertRefreshPermission(permissions = []) {
  if (!permissionCodeSet(permissions).has(ORCHESTRATOR_REFRESH_PERMISSION)) {
    throw createHttpError(
      403,
      'The Assistant principal is not authorized to run the governed temporal-worker refresh.',
      {
        code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_PERMISSION_SCOPE_MISSING',
        missingPermissionCodes: [ORCHESTRATOR_REFRESH_PERMISSION],
      },
    );
  }
}

function buildRequestDigest() {
  return createHash('sha512')
    .update(
      JSON.stringify({
        action: ORCHESTRATOR_REFRESH_ACTION,
        environmentCode: ORCHESTRATOR_REFRESH_ENVIRONMENT,
        repositoryCode: ORCHESTRATOR_REFRESH_REPOSITORY,
        targetService: ORCHESTRATOR_REFRESH_TARGET_SERVICE,
      }),
      'utf8',
    )
    .digest('hex');
}

function getSupervisorBaseUrl(environment = process.env) {
  const explicit = normalizeText(environment.SKYCOMMAND_SUPERVISOR_API_URL);
  if (explicit) return explicit.replace(/\/+$/, '');

  const runtime = normalizeText(environment.SKYCOMMAND_RUNTIME_ENV).toLowerCase();
  const host = runtime === 'docker'
    ? normalizeText(environment.SKYCOMMAND_CONTAINER_HOST_ALIAS, 'host.docker.internal')
    : normalizeText(environment.SKYCOMMAND_SUPERVISOR_HOST, '127.0.0.1');
  const port = normalizeText(environment.SKYCOMMAND_SUPERVISOR_PORT, '17170');
  return `http://${host}:${port}`;
}

function buildSupervisorRefreshUrl(environment = process.env) {
  return `${getSupervisorBaseUrl(environment)}/runtime/rebuild-temporal-worker`;
}

function buildSupervisorStatusUrl(environment = process.env) {
  return `${getSupervisorBaseUrl(environment)}/runtime/status`;
}

function normalizeHeartbeat(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    workerIdentity: row.worker_identity || null,
    namespace: row.namespace || null,
    taskQueue: row.task_queue || null,
    status: row.status || null,
    processId: row.process_id ?? null,
    hostname: row.hostname || null,
    startedAt: row.started_at || null,
    lastSeenAt: row.last_seen_at || null,
    stoppedAt: row.stopped_at || null,
    runtimeEnvironment: metadata.runtimeEnvironment || null,
    configProfile: metadata.configProfile || null,
  };
}

async function loadTemporalHeartbeats({ temporalConfig = getTemporalConfig(), queryExecutor = query } = {}) {
  const result = await queryExecutor(
    `
      SELECT worker_identity, namespace, task_queue, status, process_id, hostname,
             started_at, last_seen_at, stopped_at, metadata
        FROM worker.temporal_worker_heartbeats
       WHERE namespace = $1
         AND task_queue = $2
       ORDER BY last_seen_at DESC
       LIMIT 20
    `,
    [temporalConfig.namespace, temporalConfig.taskQueue],
  );
  return (result.rows || []).map(normalizeHeartbeat);
}

async function loadOperationById(operationId, principalCode, queryExecutor = query) {
  const result = await queryExecutor(
    `
      SELECT operation_id, caller_principal_code, idempotency_key, request_digest,
             repository_code, environment_code, target_service, action, status,
             supervisor_operation_id, before_heartbeat, after_heartbeat, evidence,
             status_reason, requested_at, accepted_at, completed_at,
             last_reconciled_at, created_at, updated_at
        FROM worker.temporal_orchestrator_refresh_operations
       WHERE operation_id = $1
         AND caller_principal_code = $2
       LIMIT 1
    `,
    [operationId, principalCode],
  );
  return result.rows[0] || null;
}

async function loadOperationByKey(principalCode, idempotencyKey, queryExecutor = query) {
  const result = await queryExecutor(
    `
      SELECT operation_id, caller_principal_code, idempotency_key, request_digest,
             repository_code, environment_code, target_service, action, status,
             supervisor_operation_id, before_heartbeat, after_heartbeat, evidence,
             status_reason, requested_at, accepted_at, completed_at,
             last_reconciled_at, created_at, updated_at
        FROM worker.temporal_orchestrator_refresh_operations
       WHERE caller_principal_code = $1
         AND idempotency_key = $2
       LIMIT 1
    `,
    [principalCode, idempotencyKey],
  );
  return result.rows[0] || null;
}

function sanitizeOperation(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    callerPrincipalCode: row.caller_principal_code,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    requestDigestAlgorithm: ORCHESTRATOR_REFRESH_REQUEST_DIGEST_ALGORITHM,
    repositoryCode: row.repository_code,
    environmentCode: row.environment_code,
    targetService: row.target_service,
    action: row.action,
    status: row.status,
    supervisorOperationId: row.supervisor_operation_id || null,
    beforeHeartbeat: row.before_heartbeat || {},
    afterHeartbeat: row.after_heartbeat || {},
    evidence: row.evidence || {},
    statusReason: row.status_reason || null,
    requestedAt: row.requested_at || null,
    acceptedAt: row.accepted_at || null,
    completedAt: row.completed_at || null,
    lastReconciledAt: row.last_reconciled_at || null,
  };
}

async function insertOperation({ callerPrincipalCode, idempotencyKey, requestDigest, beforeHeartbeat }, queryExecutor = query) {
  const operationId = randomUUID();
  const result = await queryExecutor(
    `
      INSERT INTO worker.temporal_orchestrator_refresh_operations (
        operation_id, caller_principal_code, idempotency_key, request_digest,
        repository_code, environment_code, target_service, action,
        before_heartbeat, evidence
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
      ON CONFLICT (caller_principal_code, idempotency_key) DO NOTHING
      RETURNING operation_id, caller_principal_code, idempotency_key, request_digest,
                repository_code, environment_code, target_service, action, status,
                supervisor_operation_id, before_heartbeat, after_heartbeat, evidence,
                status_reason, requested_at, accepted_at, completed_at,
                last_reconciled_at, created_at, updated_at
    `,
    [
      operationId,
      callerPrincipalCode,
      idempotencyKey,
      requestDigest,
      ORCHESTRATOR_REFRESH_REPOSITORY,
      ORCHESTRATOR_REFRESH_ENVIRONMENT,
      ORCHESTRATOR_REFRESH_TARGET_SERVICE,
      ORCHESTRATOR_REFRESH_ACTION,
      JSON.stringify(beforeHeartbeat || {}),
      JSON.stringify({
        targetService: ORCHESTRATOR_REFRESH_TARGET_SERVICE,
        action: ORCHESTRATOR_REFRESH_ACTION,
        transport: 'SUPERVISOR_SIGNED_GRANT',
        lifecycleProfile: 'DEV_LOCAL',
      }),
    ],
  );
  return result.rows[0] || null;
}

async function updateOperation(operationId, fields, queryExecutor = query) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const assignments = entries.map(([field], index) => `${field} = $${index + 2}`).join(', ');
  const values = entries.map(([, value]) => value);
  await queryExecutor(
    `UPDATE worker.temporal_orchestrator_refresh_operations SET ${assignments} WHERE operation_id = $1`,
    [operationId, ...values],
  );
}

async function postSupervisorRefresh({ operationId, grant, fetcher = fetch, environment = process.env }) {
  const response = await fetcher(buildSupervisorRefreshUrl(environment), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-SkyCommand-Supervisor-Grant': grant,
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(ORCHESTRATOR_REFRESH_SUPERVISOR_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw createHttpError(502, 'SkyCommand Supervisor did not accept the temporal-worker refresh.', {
      code: payload?.code || 'SKYCOMMAND_ORCHESTRATOR_REFRESH_SUPERVISOR_REJECTED',
      operationId,
    });
  }
  return payload;
}

async function getSupervisorStatus({ fetcher = fetch, environment = process.env } = {}) {
  try {
    const response = await fetcher(buildSupervisorStatusUrl(environment), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ORCHESTRATOR_REFRESH_SUPERVISOR_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) return null;
    return {
      supervisor: payload.supervisor || null,
      activeOperation: payload.operation
        ? {
            operationId: payload.operation.operationId || null,
            action: payload.operation.action || null,
            requestedAt: payload.operation.requestedAt || null,
          }
        : null,
      lastOperation: payload.lastOperation
        ? {
            operationId: payload.lastOperation.operationId || null,
            action: payload.lastOperation.action || null,
            status: payload.lastOperation.status || null,
            completedAt: payload.lastOperation.completedAt || null,
            runtimeStatus: payload.lastOperation.runtimeStatus || null,
            targetService: payload.lastOperation.targetService || null,
          }
        : null,
      runtimeStatus: payload.runtimeStatus || null,
      engineStatus: payload.engineStatus || null,
    };
  } catch (_error) {
    return null;
  }
}

function isFreshHeartbeat(heartbeat, nowMs = Date.now()) {
  const observedAt = Date.parse(heartbeat?.lastSeenAt || '');
  return (
    heartbeat?.status === 'ONLINE' &&
    Number.isFinite(observedAt) &&
    nowMs - observedAt <= ORCHESTRATOR_REFRESH_FRESHNESS_MS
  );
}

function buildReconciliationEvidence({ beforeHeartbeat, heartbeats, diagnostics, supervisorStatus }) {
  const pollers = Array.isArray(diagnostics?.pollers) ? diagnostics.pollers : [];
  const pollerIdentities = pollers.map((poller) => poller.identity).filter(Boolean);
  const candidate = heartbeats.find((heartbeat) => {
    const isNewIdentity = !beforeHeartbeat?.workerIdentity || heartbeat.workerIdentity !== beforeHeartbeat.workerIdentity;
    return isNewIdentity && isFreshHeartbeat(heartbeat) && pollerIdentities.includes(heartbeat.workerIdentity);
  }) || null;
  const latest = heartbeats[0] || null;
  return {
    namespace: diagnostics?.namespace || latest?.namespace || null,
    taskQueue: diagnostics?.taskQueue || latest?.taskQueue || null,
    beforeWorkerIdentity: beforeHeartbeat?.workerIdentity || null,
    observedWorkerIdentity: candidate?.workerIdentity || latest?.workerIdentity || null,
    observedWorkerStartedAt: candidate?.startedAt || null,
    observedWorkerLastSeenAt: candidate?.lastSeenAt || null,
    observedWorkerStatus: candidate?.status || latest?.status || null,
    heartbeatFresh: Boolean(candidate),
    temporalHealthy: diagnostics?.healthy === true,
    temporalPollerCount: Number(diagnostics?.pollerCount || 0),
    temporalPollerIdentities: pollerIdentities,
    pollerIdentityMatch: Boolean(candidate),
    supervisor: supervisorStatus,
  };
}

async function reconcileOperation(row, { queryExecutor = query, heartbeatLoader = loadTemporalHeartbeats, diagnosticsLoader = getTaskQueueDiagnostics, supervisorStatusLoader = getSupervisorStatus } = {}) {
  if (!row || ORCHESTRATOR_REFRESH_TERMINAL_STATUSES.has(row.status)) return row;
  const temporalConfig = getTemporalConfig();
  const [heartbeats, diagnostics, supervisorStatus] = await Promise.all([
    heartbeatLoader({ temporalConfig, queryExecutor }),
    diagnosticsLoader(temporalConfig.taskQueue).catch(() => null),
    supervisorStatusLoader(),
  ]);
  const evidence = buildReconciliationEvidence({
    beforeHeartbeat: row.before_heartbeat || {},
    heartbeats,
    diagnostics,
    supervisorStatus,
  });
  const supervisorFailure = supervisorStatus?.lastOperation?.operationId === row.operation_id && supervisorStatus.lastOperation.status === 'FAILED';
  const nextStatus = evidence.heartbeatFresh
    ? 'SUCCEEDED'
    : supervisorFailure
      ? 'FAILED'
      : row.status;
  const nextAfterHeartbeat = evidence.heartbeatFresh
    ? heartbeats.find((heartbeat) => heartbeat.workerIdentity === evidence.observedWorkerIdentity) || {}
    : {};
  await updateOperation(
    row.operation_id,
    {
      status: nextStatus,
      after_heartbeat: JSON.stringify(nextAfterHeartbeat),
      evidence: JSON.stringify(evidence),
      status_reason: nextStatus === 'SUCCEEDED'
        ? 'NEW_TEMPORAL_WORKER_GENERATION_POLLING'
        : supervisorFailure
          ? 'SUPERVISOR_REFRESH_FAILED'
          : null,
      completed_at: nextStatus === 'SUCCEEDED' || nextStatus === 'FAILED' ? new Date().toISOString() : undefined,
      last_reconciled_at: new Date().toISOString(),
    },
    queryExecutor,
  );
  return loadOperationById(row.operation_id, row.caller_principal_code, queryExecutor);
}

async function startTemporalWorkerRefresh({ request = {}, permissions = [], principalCode = 'assistant-http', actor = {}, session = {}, requestContext = {}, authorize = authorizeRuntimeControl, supervisorPoster = postSupervisorRefresh, heartbeatLoader = loadTemporalHeartbeats, queryExecutor = query } = {}) {
  assertRefreshPermission(permissions);
  const { idempotencyKey } = assertExactRefreshBody(request);
  const callerPrincipalCode = normalizeText(principalCode, 'assistant-http');
  const requestDigest = buildRequestDigest();
  const existing = await loadOperationByKey(callerPrincipalCode, idempotencyKey, queryExecutor);
  if (existing) {
    if (existing.request_digest !== requestDigest) {
      throw createHttpError(409, 'The idempotency key is already bound to a different refresh request.', {
        code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_IDEMPOTENCY_CONFLICT',
        operationId: existing.operation_id,
      });
    }
    const reconciled = await reconcileOperation(existing, { queryExecutor, heartbeatLoader });
    return { operation: sanitizeOperation(reconciled), reused: true };
  }

  const heartbeats = await heartbeatLoader({ queryExecutor });
  const inserted = await insertOperation(
    {
      callerPrincipalCode,
      idempotencyKey,
      requestDigest,
      beforeHeartbeat: heartbeats[0] || {},
    },
    queryExecutor,
  );
  const operation = inserted || await loadOperationByKey(callerPrincipalCode, idempotencyKey, queryExecutor);
  if (!operation) {
    throw createHttpError(500, 'The temporal-worker refresh operation could not be recorded.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_RECORD_FAILED',
    });
  }
  if (operation.operation_id !== inserted?.operation_id) {
    const reconciled = await reconcileOperation(operation, { queryExecutor, heartbeatLoader });
    return { operation: sanitizeOperation(reconciled), reused: true };
  }

  try {
    const authorized = await authorize({
      action: ORCHESTRATOR_REFRESH_ACTION,
      operationId: operation.operation_id,
      confirmed: true,
      actor,
      session,
      requestContext,
    });
    const accepted = await supervisorPoster({
      operationId: operation.operation_id,
      grant: authorized.authorization.grant,
    });
    await updateOperation(operation.operation_id, {
      status: 'DISPATCHED',
      supervisor_operation_id: accepted.operation?.operationId || operation.operation_id,
      accepted_at: new Date().toISOString(),
      last_reconciled_at: new Date().toISOString(),
      evidence: JSON.stringify({
        ...(operation.evidence || {}),
        supervisorAccepted: true,
        supervisorTransport: 'HOST_SUPERVISOR_HTTP',
        targetService: ORCHESTRATOR_REFRESH_TARGET_SERVICE,
      }),
    }, queryExecutor);
  } catch (error) {
    await updateOperation(operation.operation_id, {
      status: 'FAILED',
      status_reason: error?.details?.code || error?.code || 'SUPERVISOR_DISPATCH_FAILED',
      completed_at: new Date().toISOString(),
      last_reconciled_at: new Date().toISOString(),
    }, queryExecutor).catch(() => {});
    throw error;
  }

  const current = await loadOperationById(operation.operation_id, callerPrincipalCode, queryExecutor);
  return { operation: sanitizeOperation(current), reused: false };
}

async function getTemporalWorkerRefresh({ operationId, principalCode = 'assistant-http', queryExecutor = query } = {}) {
  const normalizedOperationId = normalizeText(operationId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedOperationId)) {
    throw createHttpError(400, 'operationId must be a valid UUID.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_OPERATION_ID_INVALID',
    });
  }
  const row = await loadOperationById(normalizedOperationId, normalizeText(principalCode, 'assistant-http'), queryExecutor);
  if (!row) {
    throw createHttpError(404, 'Temporal worker refresh operation was not found.', {
      code: 'SKYCOMMAND_ORCHESTRATOR_REFRESH_NOT_FOUND',
    });
  }
  const reconciled = await reconcileOperation(row, { queryExecutor });
  return { operation: sanitizeOperation(reconciled) };
}

function getCapabilitySummary(permissionCodes = []) {
  const permissions = permissionCodeSet(permissionCodes);
  const executable = permissions.has(ORCHESTRATOR_REFRESH_PERMISSION);
  return {
    capability: ORCHESTRATOR_REFRESH_CAPABILITY,
    enabled: executable,
    executable,
    requiredPermissionCodes: [ORCHESTRATOR_REFRESH_PERMISSION],
    targetService: ORCHESTRATOR_REFRESH_TARGET_SERVICE,
    action: ORCHESTRATOR_REFRESH_ACTION,
    repositoryCode: ORCHESTRATOR_REFRESH_REPOSITORY,
    environmentCode: ORCHESTRATOR_REFRESH_ENVIRONMENT,
    executionPlane: 'HOST_SUPERVISOR',
    operationIdentityDurable: true,
    idempotencyEnforced: true,
    grantPersisted: false,
    blockedReason: executable ? null : 'SKYCOMMAND_ORCHESTRATOR_REFRESH_PERMISSION_SCOPE_MISSING',
  };
}

module.exports = {
  ORCHESTRATOR_REFRESH_ACTION,
  ORCHESTRATOR_REFRESH_CAPABILITY,
  ORCHESTRATOR_REFRESH_ENVIRONMENT,
  ORCHESTRATOR_REFRESH_MAX_IDEMPOTENCY_KEY_LENGTH,
  ORCHESTRATOR_REFRESH_PERMISSION,
  ORCHESTRATOR_REFRESH_REPOSITORY,
  ORCHESTRATOR_REFRESH_TARGET_SERVICE,
  assertExactRefreshBody,
  buildRequestDigest,
  buildReconciliationEvidence,
  buildSupervisorRefreshUrl,
  getCapabilitySummary,
  getSupervisorBaseUrl,
  getTemporalWorkerRefresh,
  isFreshHeartbeat,
  normalizeHeartbeat,
  normalizeIdempotencyKey,
  postSupervisorRefresh,
  reconcileOperation,
  sanitizeOperation,
  startTemporalWorkerRefresh,
};
