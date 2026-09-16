const { pool, query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const {
  BASELINE_ORDINAL,
  canonicalJson,
  executeDatabaseUpgrade,
  normalizeDatabaseName,
  normalizeSystemIdentifier,
  sha256,
} = require('../../../../packages/db_upgrade/src/databaseUpgradeEngine');

const REQUEST_CONTRACT_VERSION = 'database_upgrade_apply_request.v1';
const POLICY_CONTRACT_VERSION = 'database_upgrade_apply_request_policy.v1';
const APPLY_ACTION = 'DATABASE_UPGRADE_APPLY';
const REQUEST_PERMISSION_CODE = 'DB_UPGRADE_APPLY_REQUEST';
const APPROVE_PERMISSION_CODE = 'DB_UPGRADE_APPLY_APPROVE';
const HUMAN_APPROVAL_ROLE_CODE = 'SUPER_ADMIN';
const DEFAULT_REQUEST_TTL_MINUTES = 30;
const MAX_REQUEST_TTL_MINUTES = 24 * 60;
const REQUEST_STATUSES = Object.freeze([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELED',
  'STALE',
]);

class DatabaseUpgradeApplyRequestError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'DatabaseUpgradeApplyRequestError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = { code, ...details };
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseTtlMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_REQUEST_TTL_MINUTES) {
    return DEFAULT_REQUEST_TTL_MINUTES;
  }
  return Math.trunc(parsed);
}

function permissionCodeSet(permissions = []) {
  return new Set(
    (permissions || [])
      .map((permission) =>
        typeof permission === 'string' ? permission : permission?.permissionCode,
      )
      .map((permissionCode) =>
        String(permissionCode || '')
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean),
  );
}

function getApplyRequestConfig(environment = process.env, permissions = []) {
  const configuredDatabaseValue = String(
    environment.SKYCOMMAND_DB_UPGRADE_TARGET_DATABASE || '',
  ).trim();
  const targetSystemIdentifier = normalizeSystemIdentifier(
    environment.SKYCOMMAND_DB_UPGRADE_TARGET_SYSTEM_IDENTIFIER,
  );
  let targetDatabase = null;
  let targetDatabaseValid = false;

  if (configuredDatabaseValue) {
    try {
      targetDatabase = normalizeDatabaseName(configuredDatabaseValue);
      targetDatabaseValid = true;
    } catch (_error) {
      targetDatabase = null;
    }
  }

  const databaseTargetConfigured = Boolean(configuredDatabaseValue);
  const systemIdentifierTargetConfigured = Boolean(targetSystemIdentifier);
  const configured =
    databaseTargetConfigured && targetDatabaseValid && systemIdentifierTargetConfigured;
  const enabled = parseBoolean(
    environment.SKYCOMMAND_ASSISTANT_DB_UPGRADE_APPLY_REQUEST_ENABLED,
    false,
  );
  const missingPermissionCodes = [REQUEST_PERMISSION_CODE].filter(
    (permissionCode) => !permissionCodeSet(permissions).has(permissionCode),
  );

  let blockedReason = null;
  if (!enabled) blockedReason = 'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_DISABLED';
  else if (!databaseTargetConfigured) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_NOT_CONFIGURED';
  } else if (!targetDatabaseValid) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_DATABASE_INVALID';
  } else if (!systemIdentifierTargetConfigured) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_TARGET_SYSTEM_IDENTIFIER_NOT_CONFIGURED';
  } else if (missingPermissionCodes.length > 0) {
    blockedReason = 'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_PERMISSION_SCOPE_MISSING';
  }

  return {
    capability: 'skycommand_database_upgrade_apply_request',
    requestPermissionCode: REQUEST_PERMISSION_CODE,
    missingPermissionCodes,
    applyRequestConfigured: configured,
    applyRequestEnabled: enabled,
    applyRequestExecutable: enabled && configured && missingPermissionCodes.length === 0,
    configured,
    enabled,
    targetDatabase,
    targetSystemIdentifier,
    databaseTargetConfigured,
    systemIdentifierTargetConfigured,
    humanApprovalRequired: true,
    applyExecutionExposed: false,
    applyExecutable: false,
    blockedReason,
    requestTtlMinutes: parseTtlMinutes(environment.SKYCOMMAND_DB_UPGRADE_APPLY_REQUEST_TTL_MINUTES),
  };
}

function assertExactApplyRequestBody({ query: requestQuery = {}, body = {} } = {}) {
  const bodyIsObject = body && typeof body === 'object' && !Array.isArray(body);
  const bodyKeys = bodyIsObject ? Object.keys(body) : [];
  const queryKeys =
    requestQuery && typeof requestQuery === 'object' ? Object.keys(requestQuery) : [];
  const unexpectedFields = bodyKeys.filter((key) => key !== 'expectedPlanDigest');
  if (
    !bodyIsObject ||
    bodyKeys.length !== 1 ||
    unexpectedFields.length > 0 ||
    queryKeys.length > 0
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_INVALID_ARGUMENTS',
      'Database-upgrade APPLY request accepts exactly expectedPlanDigest and no query arguments.',
      { unexpectedFields, queryArguments: queryKeys },
    );
  }

  if (
    typeof body.expectedPlanDigest !== 'string' ||
    !/^[A-Fa-f0-9]{64}$/.test(body.expectedPlanDigest)
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'ASSISTANT_DATABASE_UPGRADE_PLAN_DIGEST_INVALID',
      'expectedPlanDigest must be a 64-character SHA-256 hexadecimal digest.',
    );
  }
  return body.expectedPlanDigest.trim().toUpperCase();
}

function assertExactDecisionBody(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_DECISION_INVALID',
      'Decision must be a JSON object.',
    );
  }
  const unexpectedFields = Object.keys(body).filter(
    (key) => !['decision', 'decisionNote'].includes(key),
  );
  if (unexpectedFields.length > 0) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_DECISION_UNEXPECTED_FIELDS',
      'Decision contains unsupported fields.',
      { unexpectedFields },
    );
  }
  const decision = String(body.decision || '')
    .trim()
    .toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_DECISION_INVALID',
      'Decision must be APPROVED or REJECTED.',
    );
  }
  if (
    body.decisionNote !== undefined &&
    (typeof body.decisionNote !== 'string' || body.decisionNote.length > 4000)
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_DECISION_NOTE_INVALID',
      'decisionNote must be at most 4000 characters.',
    );
  }
  return { decision, decisionNote: String(body.decisionNote || '').trim() || null };
}

function assertAssistantPrincipal(assistantIdentity = {}) {
  if (assistantIdentity.authMode !== 'ASSISTANT_SERVICE_TOKEN' || assistantIdentity.userId) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'DATABASE_UPGRADE_APPLY_REQUEST_ASSISTANT_IDENTITY_REQUIRED',
      'Only the bounded Assistant service identity may create an APPLY request.',
    );
  }
  const agentId = String(assistantIdentity.agentId || '').trim();
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(agentId)) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'DATABASE_UPGRADE_APPLY_REQUEST_AGENT_ID_INVALID',
      'Assistant agent identity is invalid.',
    );
  }
  return agentId;
}

function assertHumanPrincipal({ user, session, permissions = [] } = {}) {
  if (
    !user?.userId ||
    session?.authMode === 'ASSISTANT_SERVICE_TOKEN' ||
    session?.authMode === 'INTERNAL_SERVICE_TOKEN'
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'DATABASE_UPGRADE_APPLY_APPROVAL_HUMAN_REQUIRED',
      'A human SkyCommand web/admin principal is required.',
    );
  }
  if (!permissionCodeSet(permissions).has(APPROVE_PERMISSION_CODE)) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'DATABASE_UPGRADE_APPLY_APPROVAL_PERMISSION_REQUIRED',
      'Human approval permission is required.',
      { missingPermissionCodes: [APPROVE_PERMISSION_CODE] },
    );
  }
  const roles = new Set(
    (user.roleCodes || []).map((role) =>
      String(role || '')
        .trim()
        .toUpperCase(),
    ),
  );
  if (!roles.has(HUMAN_APPROVAL_ROLE_CODE)) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'DATABASE_UPGRADE_APPLY_APPROVAL_ROLE_REQUIRED',
      'SUPER_ADMIN role is required for database-upgrade APPLY decisions.',
      { requiredRoleCode: HUMAN_APPROVAL_ROLE_CODE },
    );
  }
}

function normalizeSourceRevision(value) {
  const sourceRevision = String(value || '').trim();
  if (!sourceRevision) return null;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(sourceRevision) ||
    sourceRevision.includes('..')
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_SOURCE_REVISION_UNSAFE',
      'Server source revision is not safe to persist.',
    );
  }
  return sourceRevision;
}

function normalizePendingChanges(result) {
  const pendingChanges = Array.isArray(result?.pendingChanges) ? result.pendingChanges : [];
  return pendingChanges.map((change) => {
    const relativePath = String(change.relativePath || '').trim();
    const sha = String(change.sha256 || '')
      .trim()
      .toUpperCase();
    if (
      !relativePath ||
      relativePath.startsWith('/') ||
      relativePath.includes('..') ||
      relativePath.includes('\\') ||
      relativePath.includes(':') ||
      !/^[A-F0-9]{64}$/.test(sha)
    ) {
      throw new DatabaseUpgradeApplyRequestError(
        500,
        'DATABASE_UPGRADE_PENDING_METADATA_UNSAFE',
        'D1 returned unsafe pending-change metadata.',
      );
    }
    return {
      ordinal: Number(change.ordinal),
      kind: String(change.kind || '').toUpperCase(),
      relativePath,
      sha256: sha,
    };
  });
}

function snapshotFromPlanResult(result) {
  const output = result?.output || result;
  if (output?.mode !== 'PLAN' || output?.outcome !== 'PLAN_READY') {
    throw new DatabaseUpgradeApplyRequestError(
      500,
      'DATABASE_UPGRADE_PLAN_RESULT_INVALID',
      'D1 did not return a valid PLAN result.',
    );
  }
  const databaseName = String(output.databaseIdentity?.databaseName || '').trim();
  const systemIdentifier = normalizeSystemIdentifier(output.databaseIdentity?.systemIdentifier);
  const planDigest = String(output.planDigest?.digest || '')
    .trim()
    .toUpperCase();
  const pendingChanges = normalizePendingChanges(output);
  const baselineOrdinal = Number(output.baseline?.ordinal);
  if (
    !databaseName ||
    !systemIdentifier ||
    !/^[A-F0-9]{64}$/.test(planDigest) ||
    baselineOrdinal !== BASELINE_ORDINAL
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      500,
      'DATABASE_UPGRADE_PLAN_RESULT_INVALID',
      'D1 PLAN metadata was incomplete.',
    );
  }
  return {
    databaseName,
    systemIdentifier,
    baselineOrdinal,
    sourceRevision: normalizeSourceRevision(output.sourceRevision),
    planDigest,
    pendingCount: pendingChanges.length,
    pendingChanges,
  };
}

function buildRequestDigest(snapshot) {
  return sha256(
    canonicalJson({
      contract: REQUEST_CONTRACT_VERSION,
      action: APPLY_ACTION,
      databaseName: snapshot.databaseName,
      systemIdentifier: snapshot.systemIdentifier,
      baselineOrdinal: snapshot.baselineOrdinal,
      sourceRevision: snapshot.sourceRevision,
      planDigest: snapshot.planDigest,
      pendingCount: snapshot.pendingCount,
      pendingChanges: snapshot.pendingChanges,
      policyContractVersion: POLICY_CONTRACT_VERSION,
    }),
  );
}

async function recomputeCurrentPlan({
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
} = {}) {
  const config = getApplyRequestConfig(environment, [REQUEST_PERMISSION_CODE]);
  if (!config.applyRequestConfigured) {
    throw new DatabaseUpgradeApplyRequestError(
      503,
      config.blockedReason || 'DATABASE_UPGRADE_TARGET_NOT_CONFIGURED',
      'Governed database-upgrade target pins are not configured.',
    );
  }
  const configuredDatabase = String(environment.PGDATABASE || '').trim();
  if (configuredDatabase !== config.targetDatabase) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_TARGET_DATABASE_MISMATCH',
      'Configured database does not match the governed target database.',
    );
  }
  const result = await upgradeExecutor({ mode: 'PLAN', environment });
  const snapshot = snapshotFromPlanResult(result);
  if (snapshot.databaseName !== config.targetDatabase) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_OBSERVED_DATABASE_MISMATCH',
      'Observed database does not match the governed target database.',
    );
  }
  if (snapshot.systemIdentifier !== config.targetSystemIdentifier) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_OBSERVED_SYSTEM_IDENTIFIER_MISMATCH',
      'Observed PostgreSQL system identifier does not match the governed target.',
    );
  }
  return snapshot;
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    status: row.status,
    requestedByAgentId: row.requested_by_agent_id,
    requestedByActorMetadata: row.requested_by_actor_metadata || {},
    triggerSource: row.trigger_source,
    databaseName: row.database_name,
    systemIdentifier: row.system_identifier,
    baselineOrdinal: Number(row.baseline_ordinal),
    sourceRevision: row.source_revision || null,
    planDigest: String(row.plan_digest || '').toUpperCase(),
    pendingCount: Number(row.pending_count),
    pendingChanges: row.pending_changes || [],
    requestDigest: String(row.request_digest || '').toUpperCase(),
    policyContractVersion: row.policy_contract_version,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    humanDecisionUserId: row.human_decision_user_id || null,
    humanDecisionIdentity: row.human_decision_identity || null,
    humanDecisionAt: row.human_decision_at || null,
    humanDecisionNote: row.human_decision_note || null,
    updatedAt: row.updated_at,
  };
}

const REQUEST_SELECT = `
  SELECT request_id, status, requested_by_agent_id, requested_by_actor_metadata,
         trigger_source, database_name, system_identifier, baseline_ordinal,
         source_revision, plan_digest, pending_count, pending_changes,
         request_digest, policy_contract_version, requested_at, expires_at,
         human_decision_user_id, human_decision_identity, human_decision_at,
         human_decision_note, updated_at
  FROM core.database_upgrade_apply_requests
`;

function auditMetadata({
  request = null,
  snapshot = null,
  actorId = null,
  outcome,
  errorCode = null,
} = {}) {
  return {
    requestId: request?.requestId || request?.request_id || null,
    actorId,
    agentId: request?.requestedByAgentId || request?.requested_by_agent_id || null,
    planDigest: snapshot?.planDigest || request?.planDigest || request?.plan_digest || null,
    requestDigest: request?.requestDigest || request?.request_digest || null,
    databaseName: snapshot?.databaseName || request?.databaseName || request?.database_name || null,
    pendingCount: snapshot?.pendingCount ?? request?.pendingCount ?? request?.pending_count ?? null,
    outcome,
    errorCode,
    humanApprovalRequired: true,
    applyExecutionExposed: false,
  };
}

async function recordApplyRequestAudit({
  req = null,
  request = null,
  snapshot = null,
  actorId = null,
  success,
  outcome,
  errorCode = null,
  auditRecorder = authService.recordAuditEvent,
} = {}) {
  const context = req ? authService.getRequestContext(req) : {};
  await auditRecorder({
    appCode: req?.session?.appCode || 'SKYSERVER_ADMIN',
    userId: actorId,
    eventType: `DATABASE_UPGRADE_APPLY_REQUEST_${String(outcome || 'REJECTED').toUpperCase()}`,
    resourceType: 'core.database_upgrade_apply_requests',
    resourceId: request?.requestId || request?.request_id || null,
    action: String(outcome || 'rejected').toLowerCase(),
    success: Boolean(success),
    message: `Database-upgrade APPLY request ${String(outcome || 'rejected').toLowerCase()}.`,
    metadata: auditMetadata({ request, snapshot, actorId, outcome, errorCode }),
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  });
}

async function createApplyRequest({
  expectedPlanDigest,
  permissions = [],
  assistantIdentity = {},
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
  database = { pool, query },
  req = null,
} = {}) {
  const agentId = assertAssistantPrincipal(assistantIdentity);
  const config = getApplyRequestConfig(environment, permissions);
  if (!config.applyRequestEnabled) {
    throw new DatabaseUpgradeApplyRequestError(
      503,
      config.blockedReason,
      'Assistant database-upgrade APPLY request is disabled.',
    );
  }
  if (!config.applyRequestConfigured) {
    throw new DatabaseUpgradeApplyRequestError(
      503,
      config.blockedReason,
      'Assistant database-upgrade target pins are not configured.',
    );
  }
  if (!permissionCodeSet(permissions).has(REQUEST_PERMISSION_CODE)) {
    throw new DatabaseUpgradeApplyRequestError(
      403,
      'ASSISTANT_DATABASE_UPGRADE_APPLY_REQUEST_PERMISSION_SCOPE_MISSING',
      'Assistant database-upgrade APPLY request permission is missing.',
      { missingPermissionCodes: [REQUEST_PERMISSION_CODE] },
    );
  }
  const normalizedDigest = String(expectedPlanDigest || '')
    .trim()
    .toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalizedDigest)) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'ASSISTANT_DATABASE_UPGRADE_PLAN_DIGEST_INVALID',
      'expectedPlanDigest must be a 64-character SHA-256 hexadecimal digest.',
    );
  }
  const snapshot = await recomputeCurrentPlan({ environment, upgradeExecutor });
  if (snapshot.planDigest !== normalizedDigest) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'ASSISTANT_DATABASE_UPGRADE_PLAN_DIGEST_MISMATCH',
      'The supplied PLAN digest does not match a freshly calculated PLAN.',
      { planDigest: snapshot.planDigest },
    );
  }
  if (snapshot.pendingCount < 1) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_NO_PENDING_CHANGES',
      'At least one pending governed change is required.',
    );
  }

  const requestDigest = buildRequestDigest(snapshot);
  const actorMetadata = {
    agentId,
    authMode: 'ASSISTANT_SERVICE_TOKEN',
    triggerSource: 'ASSISTANT',
  };
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const expiredRequests = await client.query(
      `UPDATE core.database_upgrade_apply_requests SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE status = 'PENDING' AND expires_at <= CURRENT_TIMESTAMP RETURNING *`,
    );
    for (const expiredRequest of expiredRequests.rows || []) {
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: null,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: expiredRequest.request_id,
        action: 'expire',
        success: true,
        message: 'Database-upgrade APPLY request expired while creating a request.',
        metadata: auditMetadata({ request: expiredRequest, outcome: 'EXPIRED' }),
      });
    }
    const existing = await client.query(
      `${REQUEST_SELECT} WHERE requested_by_agent_id = $1 AND database_name = $2 AND plan_digest = $3 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`,
      [agentId, snapshot.databaseName, snapshot.planDigest],
    );
    if (existing.rowCount > 0) {
      const request = mapRequestRow(existing.rows[0]);
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: null,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_REUSED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: request.requestId,
        action: 'reuse',
        success: true,
        message: 'Existing current database-upgrade APPLY request was reused.',
        metadata: auditMetadata({ request, snapshot, outcome: 'IDEMPOTENT_REUSE' }),
      });
      await client.query('COMMIT');
      return { accepted: true, reused: true, request };
    }
    const inserted = await client.query(
      `INSERT INTO core.database_upgrade_apply_requests (
        requested_by_agent_id, requested_by_actor_metadata, trigger_source,
        database_name, system_identifier, baseline_ordinal, source_revision,
        plan_digest, pending_count, pending_changes, request_digest,
        policy_contract_version, expires_at
      ) VALUES ($1, $2::jsonb, 'ASSISTANT', $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
        CURRENT_TIMESTAMP + ($12::numeric * INTERVAL '1 minute'))
      ON CONFLICT (requested_by_agent_id, database_name, plan_digest)
        WHERE status = 'PENDING' DO NOTHING
      RETURNING *`,
      [
        agentId,
        JSON.stringify(actorMetadata),
        snapshot.databaseName,
        snapshot.systemIdentifier,
        snapshot.baselineOrdinal,
        snapshot.sourceRevision,
        snapshot.planDigest,
        snapshot.pendingCount,
        JSON.stringify(snapshot.pendingChanges),
        requestDigest,
        POLICY_CONTRACT_VERSION,
        config.requestTtlMinutes,
      ],
    );
    if (inserted.rowCount === 0) {
      const concurrentExisting = await client.query(
        `${REQUEST_SELECT} WHERE requested_by_agent_id = $1 AND database_name = $2 AND plan_digest = $3 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`,
        [agentId, snapshot.databaseName, snapshot.planDigest],
      );
      if (concurrentExisting.rowCount !== 1) {
        throw new DatabaseUpgradeApplyRequestError(
          409,
          'DATABASE_UPGRADE_APPLY_REQUEST_CONFLICT',
          'Concurrent database-upgrade APPLY request could not be reconciled.',
        );
      }
      const request = mapRequestRow(concurrentExisting.rows[0]);
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: null,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_REUSED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: request.requestId,
        action: 'reuse',
        success: true,
        message: 'Concurrent current database-upgrade APPLY request was reused.',
        metadata: auditMetadata({ request, snapshot, outcome: 'IDEMPOTENT_REUSE' }),
      });
      await client.query('COMMIT');
      return { accepted: true, reused: true, request };
    }
    const request = mapRequestRow(inserted.rows[0]);
    await authService.recordAuditEventWithClient(client, {
      appCode: 'SKYSERVER_ADMIN',
      userId: null,
      eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_ACCEPTED',
      resourceType: 'core.database_upgrade_apply_requests',
      resourceId: request.requestId,
      action: 'request',
      success: true,
      message: 'Database-upgrade APPLY authorization request was accepted.',
      metadata: auditMetadata({ request, snapshot, outcome: 'ACCEPTED' }),
    });
    await client.query('COMMIT');
    return { accepted: true, reused: false, request };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function expireRequest(request, { database = { pool, query }, actorId = null } = {}) {
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE core.database_upgrade_apply_requests SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE request_id = $1 AND status = 'PENDING' AND expires_at <= CURRENT_TIMESTAMP RETURNING *`,
      [request.requestId || request.request_id],
    );
    if (result.rowCount > 0) {
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: actorId,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: result.rows[0].request_id,
        action: 'expire',
        success: true,
        message: 'Database-upgrade APPLY request expired.',
        metadata: auditMetadata({ request: result.rows[0], actorId, outcome: 'EXPIRED' }),
      });
    }
    await client.query('COMMIT');
    return result.rowCount > 0 ? mapRequestRow(result.rows[0]) : null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listApplyRequests({
  status = null,
  user,
  session,
  permissions = [],
  database = { pool, query },
} = {}) {
  assertHumanPrincipal({ user, session, permissions });
  const expiryClient = await database.pool.connect();
  try {
    await expiryClient.query('BEGIN');
    const expiredRequests = await expiryClient.query(
      `UPDATE core.database_upgrade_apply_requests SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE status = 'PENDING' AND expires_at <= CURRENT_TIMESTAMP RETURNING *`,
    );
    for (const expiredRequest of expiredRequests.rows || []) {
      await authService.recordAuditEventWithClient(expiryClient, {
        appCode: 'SKYSERVER_ADMIN',
        userId: null,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: expiredRequest.request_id,
        action: 'expire',
        success: true,
        message: 'Database-upgrade APPLY request expired while listing requests.',
        metadata: auditMetadata({ request: expiredRequest, outcome: 'EXPIRED' }),
      });
    }
    await expiryClient.query('COMMIT');
  } catch (error) {
    await expiryClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    expiryClient.release();
  }
  const values = [];
  const clauses = [];
  if (status && REQUEST_STATUSES.includes(String(status).toUpperCase())) {
    values.push(String(status).toUpperCase());
    clauses.push(`status = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [items, total] = await Promise.all([
    database.query(`${REQUEST_SELECT} ${where} ORDER BY requested_at DESC LIMIT 100`, values),
    database.query(
      `SELECT COUNT(*)::int AS count FROM core.database_upgrade_apply_requests ${where}`,
      values,
    ),
  ]);
  return {
    items: items.rows.map(mapRequestRow),
    total: Number(total.rows[0]?.count || 0),
    limit: 100,
    offset: 0,
  };
}

async function decideApplyRequest({
  requestId,
  body = {},
  user,
  session,
  permissions = [],
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
  database = { pool, query },
} = {}) {
  assertHumanPrincipal({ user, session, permissions });
  const { decision, decisionNote } = assertExactDecisionBody(body);
  const initialResult = await database.query(`${REQUEST_SELECT} WHERE request_id = $1 LIMIT 1`, [
    requestId,
  ]);
  if (initialResult.rowCount === 0)
    throw new DatabaseUpgradeApplyRequestError(
      404,
      'DATABASE_UPGRADE_APPLY_REQUEST_NOT_FOUND',
      'Database-upgrade APPLY request was not found.',
    );
  const initialRequest = mapRequestRow(initialResult.rows[0]);
  if (initialRequest.status !== 'PENDING')
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPLY_REQUEST_ALREADY_DECIDED',
      'Database-upgrade APPLY request is no longer pending.',
      { status: initialRequest.status },
    );
  if (new Date(initialRequest.expiresAt).getTime() <= Date.now()) {
    const expired = await expireRequest(initialRequest, { database, actorId: user.userId });
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
      'Database-upgrade APPLY request has expired.',
      { status: expired?.status || 'EXPIRED' },
    );
  }

  let snapshot = null;
  let requestMatchesPlan = true;
  if (decision === 'APPROVED') {
    try {
      snapshot = await recomputeCurrentPlan({ environment, upgradeExecutor });
    } catch (error) {
      if (error.code !== 'DATABASE_UPGRADE_NO_PENDING_CHANGES') throw error;
    }
    requestMatchesPlan =
      snapshot &&
      snapshot.databaseName === initialRequest.databaseName &&
      snapshot.systemIdentifier === initialRequest.systemIdentifier &&
      snapshot.planDigest === initialRequest.planDigest &&
      snapshot.pendingCount === initialRequest.pendingCount &&
      canonicalJson(snapshot.pendingChanges) === canonicalJson(initialRequest.pendingChanges) &&
      snapshot.baselineOrdinal === initialRequest.baselineOrdinal &&
      snapshot.sourceRevision === initialRequest.sourceRevision &&
      initialRequest.policyContractVersion === POLICY_CONTRACT_VERSION &&
      buildRequestDigest(snapshot) === initialRequest.requestDigest;
  }
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN');
    const lockedResult = await client.query(`${REQUEST_SELECT} WHERE request_id = $1 FOR UPDATE`, [
      requestId,
    ]);
    if (lockedResult.rowCount === 0)
      throw new DatabaseUpgradeApplyRequestError(
        404,
        'DATABASE_UPGRADE_APPLY_REQUEST_NOT_FOUND',
        'Database-upgrade APPLY request was not found.',
      );
    const request = mapRequestRow(lockedResult.rows[0]);
    if (request.status !== 'PENDING')
      throw new DatabaseUpgradeApplyRequestError(
        409,
        'DATABASE_UPGRADE_APPLY_REQUEST_ALREADY_DECIDED',
        'Database-upgrade APPLY request is no longer pending.',
        { status: request.status },
      );
    if (new Date(request.expiresAt).getTime() <= Date.now()) {
      const expired = await client.query(
        `UPDATE core.database_upgrade_apply_requests SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE request_id = $1 AND status = 'PENDING' RETURNING *`,
        [requestId],
      );
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: user.userId,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: requestId,
        action: 'expire',
        success: true,
        message: 'Database-upgrade APPLY request expired before decision.',
        metadata: auditMetadata({ request, actorId: user.userId, outcome: 'EXPIRED' }),
      });
      await client.query('COMMIT');
      throw new DatabaseUpgradeApplyRequestError(
        409,
        'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
        'Database-upgrade APPLY request has expired.',
        { status: expired.rows[0]?.status || 'EXPIRED' },
      );
    }
    if (decision === 'APPROVED' && !requestMatchesPlan) {
      const stale = await client.query(
        `UPDATE core.database_upgrade_apply_requests SET status = 'STALE', updated_at = CURRENT_TIMESTAMP WHERE request_id = $1 AND status = 'PENDING' RETURNING *`,
        [requestId],
      );
      await authService.recordAuditEventWithClient(client, {
        appCode: 'SKYSERVER_ADMIN',
        userId: user.userId,
        eventType: 'DATABASE_UPGRADE_APPLY_REQUEST_STALE',
        resourceType: 'core.database_upgrade_apply_requests',
        resourceId: requestId,
        action: 'stale',
        success: false,
        message: 'Database-upgrade APPLY request became stale during revalidation.',
        metadata: auditMetadata({
          request,
          snapshot,
          actorId: user.userId,
          outcome: 'STALE',
          errorCode: 'DATABASE_UPGRADE_PLAN_CHANGED',
        }),
      });
      await client.query('COMMIT');
      throw new DatabaseUpgradeApplyRequestError(
        409,
        'DATABASE_UPGRADE_APPLY_REQUEST_STALE',
        'The governed PLAN changed; request marked STALE.',
        { status: stale.rows[0]?.status || 'STALE' },
      );
    }
    const humanDecisionIdentity = {
      userId: user.userId,
      email: user.email || null,
      displayName: user.displayName || user.email || null,
      roleCodes: (user.roleCodes || [])
        .map((role) => String(role).trim().toUpperCase())
        .filter(Boolean),
    };
    const updated = await client.query(
      `UPDATE core.database_upgrade_apply_requests SET status = $2, human_decision_user_id = $3, human_decision_identity = $4::jsonb, human_decision_at = CURRENT_TIMESTAMP, human_decision_note = $5, updated_at = CURRENT_TIMESTAMP WHERE request_id = $1 AND status = 'PENDING' RETURNING *`,
      [requestId, decision, user.userId, JSON.stringify(humanDecisionIdentity), decisionNote],
    );
    if (updated.rowCount !== 1)
      throw new DatabaseUpgradeApplyRequestError(
        409,
        'DATABASE_UPGRADE_APPLY_REQUEST_CONFLICT',
        'Concurrent database-upgrade APPLY decision rejected.',
      );
    const decidedRequest = mapRequestRow(updated.rows[0]);
    await authService.recordAuditEventWithClient(client, {
      appCode: 'SKYSERVER_ADMIN',
      userId: user.userId,
      eventType: `DATABASE_UPGRADE_APPLY_REQUEST_${decision}`,
      resourceType: 'core.database_upgrade_apply_requests',
      resourceId: requestId,
      action: decision.toLowerCase(),
      success: true,
      message: `Database-upgrade APPLY request ${decision.toLowerCase()}.`,
      metadata: auditMetadata({
        request: decidedRequest,
        snapshot,
        actorId: user.userId,
        outcome: decision,
      }),
    });
    await client.query('COMMIT');
    return { request: decidedRequest, humanApprovalRequired: true, applyExecutionExposed: false };
  } catch (error) {
    if (
      error.code !== 'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED' &&
      error.code !== 'DATABASE_UPGRADE_APPLY_REQUEST_STALE'
    )
      await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  APPLY_ACTION,
  APPROVE_PERMISSION_CODE,
  HUMAN_APPROVAL_ROLE_CODE,
  POLICY_CONTRACT_VERSION,
  REQUEST_CONTRACT_VERSION,
  REQUEST_PERMISSION_CODE,
  REQUEST_STATUSES,
  DatabaseUpgradeApplyRequestError,
  assertAssistantPrincipal,
  assertExactApplyRequestBody,
  assertExactDecisionBody,
  assertHumanPrincipal,
  buildRequestDigest,
  createApplyRequest,
  getApplyRequestConfig,
  listApplyRequests,
  mapRequestRow,
  recordApplyRequestAudit,
  recomputeCurrentPlan,
  snapshotFromPlanResult,
  decideApplyRequest,
};
