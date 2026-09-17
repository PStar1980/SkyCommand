const crypto = require('node:crypto');
const { pool, query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const {
  BASELINE_ORDINAL,
  canonicalJson,
  executeApprovedDatabaseUpgrade,
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
const EXECUTION_RECEIPT_TABLE = 'core.database_upgrade_apply_execution_receipts';
const EXECUTION_RECEIPT_BOOTSTRAP_MIGRATION_PATH =
  'packages/db_build/src/migrations/00132__database_upgrade_apply_execution_receipt.sql';
const EXECUTION_OUTCOMES = Object.freeze(['STARTED', 'APPLIED', 'FAILED']);
const executionInFlight = new Map();
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

function getExecutionConfig(environment = process.env) {
  const enabled = parseBoolean(
    environment.SKYCOMMAND_ADMIN_DB_UPGRADE_APPLY_EXECUTION_ENABLED,
    false,
  );
  return {
    capability: 'skycommand_admin_database_upgrade_apply_execution',
    enabled,
    humanAdminOnly: true,
    requiredRoleCode: HUMAN_APPROVAL_ROLE_CODE,
    requiredPermissionCode: APPROVE_PERMISSION_CODE,
    applyExecutionExposed: enabled,
    blockedReason: enabled ? null : 'ADMIN_DATABASE_UPGRADE_APPLY_EXECUTION_DISABLED',
  };
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

function assertExactExecutionBody(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_EXECUTION_CONFIRMATION_INVALID',
      'Execution confirmation must be a JSON object.',
    );
  }
  const unexpectedFields = Object.keys(body).filter((key) => key !== 'confirm');
  if (unexpectedFields.length > 0 || body.confirm !== true) {
    throw new DatabaseUpgradeApplyRequestError(
      400,
      'DATABASE_UPGRADE_EXECUTION_CONFIRMATION_REQUIRED',
      'Execution requires explicit confirm: true.',
      { unexpectedFields },
    );
  }
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
    ledgerAppliedCount: Number(output.ledger?.appliedCount || 0),
    ledgerReceipts: Array.isArray(output.ledger?.receipts) ? output.ledger.receipts : [],
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

function mapExecutionReceiptRow(row) {
  if (!row) return null;
  return {
    executionId: row.execution_id,
    requestId: row.request_id,
    requestDigest: String(row.request_digest || '').toUpperCase(),
    planDigest: String(row.plan_digest || '').toUpperCase(),
    databaseName: row.database_name,
    systemIdentifier: row.system_identifier,
    executedByUserId: row.executed_by_user_id,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    outcome: row.outcome,
    appliedCount: Number(row.applied_count || 0),
    resultIdentifiers: row.result_identifiers || [],
    beforeLedgerState: row.before_ledger_state || {},
    afterLedgerState: row.after_ledger_state || {},
    failureCode: row.failure_code || null,
  };
}

function requestSnapshotFromEnvelope(request) {
  const pendingChanges = normalizePendingChanges({ pendingChanges: request.pendingChanges });
  const snapshot = {
    databaseName: request.databaseName,
    systemIdentifier: request.systemIdentifier,
    baselineOrdinal: Number(request.baselineOrdinal),
    sourceRevision: request.sourceRevision,
    planDigest: request.planDigest,
    pendingCount: Number(request.pendingCount),
    pendingChanges,
  };
  if (
    snapshot.pendingCount !== snapshot.pendingChanges.length ||
    snapshot.pendingCount < 1 ||
    !/^[A-F0-9]{64}$/.test(snapshot.planDigest || '') ||
    snapshot.baselineOrdinal !== BASELINE_ORDINAL
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPROVED_REQUEST_ENVELOPE_INVALID',
      'The approved request envelope is incomplete or tampered.',
    );
  }
  return snapshot;
}

function assertApprovedRequestEnvelope(request) {
  if (!request) {
    throw new DatabaseUpgradeApplyRequestError(
      404,
      'DATABASE_UPGRADE_APPLY_REQUEST_NOT_FOUND',
      'Database-upgrade APPLY request was not found.',
    );
  }
  if (request.status !== 'APPROVED') {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPROVED_REQUEST_REQUIRED',
      'Only an APPROVED database-upgrade request may be executed.',
      { status: request.status },
    );
  }
  const decisionIdentityUserId = String(request.humanDecisionIdentity?.userId || '').trim();
  const decisionAt = Date.parse(request.humanDecisionAt || '');
  if (
    !request.humanDecisionUserId ||
    !request.humanDecisionIdentity ||
    decisionIdentityUserId !== String(request.humanDecisionUserId) ||
    !Number.isFinite(decisionAt)
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_HUMAN_DECISION_EVIDENCE_REQUIRED',
      'Approved request is missing durable human decision evidence.',
    );
  }
  const expiresAt = Date.parse(request.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPLY_REQUEST_EXPIRED',
      'Approved database-upgrade APPLY request has expired.',
      { status: 'EXPIRED' },
    );
  }
  if (request.policyContractVersion !== POLICY_CONTRACT_VERSION) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPROVED_REQUEST_POLICY_UNSUPPORTED',
      'The approved request policy contract is not supported.',
    );
  }
  const snapshot = requestSnapshotFromEnvelope(request);
  if (
    !/^[A-F0-9]{64}$/.test(request.requestDigest || '') ||
    buildRequestDigest(snapshot) !== request.requestDigest
  ) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPROVED_REQUEST_DIGEST_MISMATCH',
      'The approved request digest does not match its stored envelope.',
    );
  }
  return snapshot;
}

function isMissingExecutionReceiptTable(error) {
  return (
    error?.code === '42P01' &&
    /relation\s+"?core\.database_upgrade_apply_execution_receipts"?\s+does not exist/i.test(
      String(error?.message || ''),
    )
  );
}

function assertExecutionReceiptBootstrapBoundary(request, snapshot) {
  if (!requestMatchesFreshPlan(request, snapshot)) {
    throw new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
      'The fresh D1 PLAN no longer matches the approved PLAN envelope.',
    );
  }

  const [solePendingChange] = snapshot.pendingChanges;
  const isExactBootstrapPlan =
    snapshot.pendingCount === 1 &&
    solePendingChange?.kind === 'MIGRATION' &&
    solePendingChange?.ordinal === 132 &&
    solePendingChange?.relativePath === EXECUTION_RECEIPT_BOOTSTRAP_MIGRATION_PATH;
  if (!isExactBootstrapPlan) {
    throw new DatabaseUpgradeApplyRequestError(
      503,
      'DATABASE_UPGRADE_EXECUTION_RECEIPT_INFRASTRUCTURE_MISSING',
      'Execution-receipt infrastructure is missing outside the one-time 00132 bootstrap PLAN.',
    );
  }
}

async function loadExecutionReceipt({ requestId, database, client = null } = {}) {
  try {
    const result = await (client || database).query(
      `SELECT execution_id, request_id, request_digest, plan_digest, database_name,
              system_identifier, executed_by_user_id, started_at, completed_at,
              outcome, applied_count, result_identifiers, before_ledger_state,
              after_ledger_state, failure_code
         FROM ${EXECUTION_RECEIPT_TABLE}
        WHERE request_id = $1
        LIMIT 1`,
      [requestId],
    );
    return result.rowCount > 0 ? mapExecutionReceiptRow(result.rows[0]) : null;
  } catch (error) {
    if (isMissingExecutionReceiptTable(error) && !client) return null;
    throw error;
  }
}

async function attachExecutionReceipts(items, database) {
  if (!items.length) return items;
  try {
    const result = await database.query(
      `SELECT execution_id, request_id, request_digest, plan_digest, database_name,
              system_identifier, executed_by_user_id, started_at, completed_at,
              outcome, applied_count, result_identifiers, before_ledger_state,
              after_ledger_state, failure_code
         FROM ${EXECUTION_RECEIPT_TABLE}
        WHERE request_id = ANY($1::uuid[])`,
      [items.map((item) => item.requestId)],
    );
    const receipts = new Map(
      (result.rows || []).map((row) => [row.request_id, mapExecutionReceiptRow(row)]),
    );
    return items.map((item) => ({ ...item, execution: receipts.get(item.requestId) || null }));
  } catch (error) {
    if (isMissingExecutionReceiptTable(error))
      return items.map((item) => ({ ...item, execution: null }));
    throw error;
  }
}

function safeLedgerState(snapshot, output = null) {
  return {
    appliedCount: Number(output?.ledger?.appliedCount ?? snapshot?.ledgerAppliedCount ?? 0),
    pendingCount: Number(snapshot?.pendingCount || 0),
    baselineOrdinal: Number(snapshot?.baselineOrdinal || BASELINE_ORDINAL),
    planDigest: snapshot?.planDigest || null,
  };
}

function safeResultIdentifiers(output, request) {
  const receipts = Array.isArray(output?.ledger?.receipts) ? output.ledger.receipts : [];
  return receipts
    .filter((receipt) => receipt.planDigest === request.planDigest)
    .map((receipt) => ({
      changeId: receipt.changeId || null,
      ordinal: Number(receipt.ordinal),
      kind: receipt.kind || null,
      relativePath: receipt.relativePath || null,
      sha256: receipt.sha256 || null,
      planDigest: receipt.planDigest || null,
    }));
}

async function persistExecutionReceipt({
  executionId,
  request,
  actorId,
  startedAt,
  completedAt,
  outcome,
  appliedCount,
  resultIdentifiers = [],
  beforeLedgerState = {},
  afterLedgerState = {},
  failureCode = null,
  database,
} = {}) {
  if (!EXECUTION_OUTCOMES.includes(outcome)) throw new Error('Invalid execution receipt outcome.');
  try {
    const result = await database.query(
      `INSERT INTO ${EXECUTION_RECEIPT_TABLE} (
         execution_id, request_id, request_digest, plan_digest, database_name,
         system_identifier, executed_by_user_id, started_at, completed_at,
         outcome, applied_count, result_identifiers, before_ledger_state,
         after_ledger_state, failure_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15)
       ON CONFLICT (request_id) DO UPDATE SET
         completed_at = EXCLUDED.completed_at,
         outcome = EXCLUDED.outcome,
         applied_count = EXCLUDED.applied_count,
         result_identifiers = EXCLUDED.result_identifiers,
         before_ledger_state = EXCLUDED.before_ledger_state,
         after_ledger_state = EXCLUDED.after_ledger_state,
         failure_code = EXCLUDED.failure_code
       WHERE ${EXECUTION_RECEIPT_TABLE}.outcome = 'STARTED'
       RETURNING *`,
      [
        executionId,
        request.requestId,
        request.requestDigest,
        request.planDigest,
        request.databaseName,
        request.systemIdentifier,
        actorId,
        startedAt,
        completedAt,
        outcome,
        Number(appliedCount || 0),
        JSON.stringify(resultIdentifiers),
        JSON.stringify(beforeLedgerState),
        JSON.stringify(afterLedgerState),
        failureCode,
      ],
    );
    return result.rowCount > 0
      ? mapExecutionReceiptRow(result.rows[0])
      : loadExecutionReceipt({ requestId: request.requestId, database });
  } catch (error) {
    if (isMissingExecutionReceiptTable(error)) return null;
    throw error;
  }
}

function pendingFingerprint(change) {
  return `${Number(change.ordinal)}|${String(change.kind).toUpperCase()}|${change.relativePath}|${String(change.sha256).toUpperCase()}`;
}

function fingerprintsMatch(left = [], right = []) {
  return (
    canonicalJson(left.map(pendingFingerprint).sort()) ===
    canonicalJson(right.map(pendingFingerprint).sort())
  );
}

function requestMatchesFreshPlan(request, snapshot) {
  return (
    snapshot.databaseName === request.databaseName &&
    snapshot.systemIdentifier === request.systemIdentifier &&
    snapshot.baselineOrdinal === request.baselineOrdinal &&
    snapshot.sourceRevision === request.sourceRevision &&
    snapshot.planDigest === request.planDigest &&
    snapshot.pendingCount === request.pendingCount &&
    snapshot.pendingCount > 0 &&
    fingerprintsMatch(snapshot.pendingChanges, request.pendingChanges)
  );
}

function ledgerReceiptsMatchApprovedPlan(request, snapshot) {
  const receipts = (snapshot.ledgerReceipts || [])
    .filter((receipt) => receipt.planDigest === request.planDigest)
    .map((receipt) => ({
      ordinal: receipt.ordinal,
      kind: receipt.kind,
      relativePath: receipt.relativePath,
      sha256: receipt.sha256,
    }));
  return (
    receipts.length === request.pendingCount && fingerprintsMatch(receipts, request.pendingChanges)
  );
}

function executionAuditMetadata({
  request = null,
  executionId = null,
  actorId = null,
  snapshot = null,
  output = null,
  errorCode = null,
} = {}) {
  return {
    requestId: request?.requestId || null,
    executionId,
    actorId,
    databaseName: snapshot?.databaseName || request?.databaseName || null,
    systemIdentifier: snapshot?.systemIdentifier || request?.systemIdentifier || null,
    planDigest: snapshot?.planDigest || request?.planDigest || null,
    requestDigest: request?.requestDigest || null,
    pendingCount: snapshot?.pendingCount ?? request?.pendingCount ?? null,
    appliedCount: Number(output?.appliedCount ?? 0),
    outcome: output?.outcome || null,
    errorCode,
    humanAdminOnly: true,
    assistantExecutionExposed: false,
  };
}

async function recordExecutionAudit({
  req = null,
  request = null,
  executionId = null,
  actorId = null,
  eventType,
  success,
  outcome,
  snapshot = null,
  output = null,
  errorCode = null,
  auditRecorder = authService.recordAuditEvent,
} = {}) {
  const context = req ? authService.getRequestContext(req) : {};
  await auditRecorder({
    appCode: req?.session?.appCode || 'SKYSERVER_ADMIN',
    userId: actorId,
    eventType,
    resourceType: EXECUTION_RECEIPT_TABLE,
    resourceId: executionId || request?.requestId || null,
    action: String(outcome || eventType).toLowerCase(),
    success: Boolean(success),
    message: `Database-upgrade APPLY execution ${String(outcome || 'refused').toLowerCase()}.`,
    metadata: executionAuditMetadata({
      request,
      executionId,
      actorId,
      snapshot,
      output,
      errorCode,
    }),
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  });
}

async function reconcileApprovedExecution({
  request,
  existingReceipt = null,
  executionId = null,
  actorId,
  database,
  environment,
  upgradeExecutor,
  req = null,
  auditRecorder,
} = {}) {
  let snapshot;
  try {
    snapshot = await recomputeCurrentPlan({ environment, upgradeExecutor });
  } catch (_error) {
    return null;
  }
  if (!ledgerReceiptsMatchApprovedPlan(request, snapshot)) return null;
  const reconciledExecutionId = existingReceipt?.executionId || executionId || crypto.randomUUID();
  const receipt = await persistExecutionReceipt({
    executionId: reconciledExecutionId,
    request,
    actorId,
    startedAt: existingReceipt?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    outcome: 'APPLIED',
    appliedCount: request.pendingCount,
    resultIdentifiers: (snapshot.ledgerReceipts || []).filter(
      (item) => item.planDigest === request.planDigest,
    ),
    beforeLedgerState: {
      appliedCount: Math.max(0, snapshot.ledgerAppliedCount - request.pendingCount),
    },
    afterLedgerState: safeLedgerState(snapshot),
    database,
  });
  if (!receipt) return null;
  await recordExecutionAudit({
    req,
    request,
    executionId: receipt.executionId,
    actorId,
    eventType: 'DATABASE_UPGRADE_EXECUTION_SUCCEEDED',
    success: true,
    outcome: 'RECONCILED',
    snapshot,
    output: { appliedCount: receipt.appliedCount, outcome: 'APPLIED' },
    auditRecorder,
  }).catch(() => {});
  return { request, receipt, idempotent: true, reconciled: true };
}

async function executeApprovedApplyRequest({
  requestId,
  body = {},
  req = null,
  user,
  session,
  permissions = [],
  environment = process.env,
  upgradeExecutor = executeDatabaseUpgrade,
  applyExecutor = executeApprovedDatabaseUpgrade,
  database = { pool, query },
  auditRecorder = authService.recordAuditEvent,
} = {}) {
  const normalizedRequestId = String(requestId || '').trim();
  try {
    assertHumanPrincipal({ user, session, permissions });
    const config = getExecutionConfig(environment);
    if (!config.enabled) {
      throw new DatabaseUpgradeApplyRequestError(
        503,
        config.blockedReason,
        'Human database-upgrade APPLY execution is disabled.',
      );
    }
    assertExactExecutionBody(body);
    if (!normalizedRequestId) {
      throw new DatabaseUpgradeApplyRequestError(
        400,
        'DATABASE_UPGRADE_REQUEST_ID_REQUIRED',
        'requestId is required.',
      );
    }
  } catch (error) {
    await recordExecutionAudit({
      req,
      request: normalizedRequestId ? { requestId: normalizedRequestId } : null,
      actorId: user?.userId || null,
      eventType: 'DATABASE_UPGRADE_EXECUTION_REFUSED',
      success: false,
      outcome: 'REFUSED',
      errorCode: error?.details?.code || error?.code || null,
      auditRecorder,
    }).catch(() => {});
    throw error;
  }
  if (executionInFlight.has(normalizedRequestId)) {
    const error = new DatabaseUpgradeApplyRequestError(
      409,
      'DATABASE_UPGRADE_EXECUTION_IN_PROGRESS',
      'This approved request is already executing.',
    );
    await recordExecutionAudit({
      req,
      request: { requestId: normalizedRequestId },
      actorId: user.userId,
      eventType: 'DATABASE_UPGRADE_EXECUTION_REFUSED',
      success: false,
      outcome: 'REFUSED',
      errorCode: error.details.code,
      auditRecorder,
    }).catch(() => {});
    throw error;
  }

  const operation = (async () => {
    await recordExecutionAudit({
      req,
      request: { requestId: normalizedRequestId },
      actorId: user.userId,
      eventType: 'DATABASE_UPGRADE_EXECUTION_REQUESTED',
      success: true,
      outcome: 'REQUESTED',
      auditRecorder,
    }).catch(() => {});

    let request = null;
    let snapshot = null;
    let executionId = crypto.randomUUID();
    let startedAt = new Date().toISOString();
    let executionStarted = false;
    let client = null;
    try {
      client = await database.pool.connect();
      await client.query('BEGIN');
      const locked = await client.query(`${REQUEST_SELECT} WHERE request_id = $1 FOR UPDATE`, [
        normalizedRequestId,
      ]);
      request = locked.rowCount > 0 ? mapRequestRow(locked.rows[0]) : null;
      assertApprovedRequestEnvelope(request);
      const existingReceipt = await loadExecutionReceipt({
        requestId: normalizedRequestId,
        database,
        client,
      });
      if (existingReceipt?.outcome === 'APPLIED' || existingReceipt?.outcome === 'FAILED') {
        await client.query('COMMIT');
        return { request, receipt: existingReceipt, idempotent: true };
      }
      if (existingReceipt?.outcome === 'STARTED') {
        await client.query('COMMIT');
        const reconciled = await reconcileApprovedExecution({
          request,
          existingReceipt,
          actorId: user.userId,
          database,
          environment,
          upgradeExecutor,
          req,
          auditRecorder,
        });
        if (reconciled) return reconciled;
        throw new DatabaseUpgradeApplyRequestError(
          409,
          'DATABASE_UPGRADE_EXECUTION_IN_PROGRESS',
          'This approved request has an existing execution claim that requires reconciliation.',
        );
      }

      snapshot = await recomputeCurrentPlan({ environment, upgradeExecutor });
      if (!requestMatchesFreshPlan(request, snapshot)) {
        throw new DatabaseUpgradeApplyRequestError(
          409,
          'DATABASE_UPGRADE_APPROVED_PLAN_CHANGED',
          'The fresh D1 PLAN no longer matches the approved PLAN envelope.',
        );
      }
      const started = await client.query(
        `INSERT INTO ${EXECUTION_RECEIPT_TABLE} (
           execution_id, request_id, request_digest, plan_digest, database_name,
           system_identifier, executed_by_user_id, started_at, outcome,
           applied_count, result_identifiers, before_ledger_state, after_ledger_state
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'STARTED', 0, '[]'::jsonb, $9::jsonb, '{}'::jsonb)
         ON CONFLICT (request_id) DO NOTHING
         RETURNING *`,
        [
          executionId,
          request.requestId,
          request.requestDigest,
          request.planDigest,
          request.databaseName,
          request.systemIdentifier,
          user.userId,
          startedAt,
          JSON.stringify(safeLedgerState(snapshot)),
        ],
      );
      if (started.rowCount === 1) {
        const startedReceipt = mapExecutionReceiptRow(started.rows[0]);
        executionId = startedReceipt.executionId;
        startedAt = startedReceipt.startedAt;
        executionStarted = true;
      } else {
        const concurrentReceipt = await loadExecutionReceipt({
          requestId: normalizedRequestId,
          database,
          client,
        });
        await client.query('COMMIT');
        if (concurrentReceipt?.outcome === 'APPLIED' || concurrentReceipt?.outcome === 'FAILED')
          return { request, receipt: concurrentReceipt, idempotent: true };
        throw new DatabaseUpgradeApplyRequestError(
          409,
          'DATABASE_UPGRADE_EXECUTION_IN_PROGRESS',
          'This approved request is already executing.',
        );
      }
      await client.query('COMMIT');
      client = null;
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (isMissingExecutionReceiptTable(error)) {
        if (request && !snapshot)
          snapshot = await recomputeCurrentPlan({ environment, upgradeExecutor });
        if (request && snapshot) assertExecutionReceiptBootstrapBoundary(request, snapshot);
      } else {
        error.executionStarted = executionStarted;
        throw error;
      }
    } finally {
      if (client) client.release();
    }

    try {
      executionStarted = true;
      await recordExecutionAudit({
        req,
        request,
        executionId,
        actorId: user.userId,
        eventType: 'DATABASE_UPGRADE_EXECUTION_STARTED',
        success: true,
        outcome: 'STARTED',
        snapshot,
        output: { appliedCount: 0, outcome: 'STARTED' },
        auditRecorder,
      }).catch(() => {});
      const result = await applyExecutor({ approvedRequest: request, environment });
      const receipt = await persistExecutionReceipt({
        executionId,
        request,
        actorId: user.userId,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: 'APPLIED',
        appliedCount: result.appliedCount,
        resultIdentifiers: safeResultIdentifiers(result, request),
        beforeLedgerState: safeLedgerState(snapshot),
        afterLedgerState: safeLedgerState(result.output || result),
        database,
      });
      if (!receipt) {
        const reconciled = await reconcileApprovedExecution({
          request,
          executionId,
          actorId: user.userId,
          database,
          environment,
          upgradeExecutor,
          req,
          auditRecorder,
        });
        if (reconciled) return reconciled;
        throw new DatabaseUpgradeApplyRequestError(
          500,
          'DATABASE_UPGRADE_EXECUTION_RECEIPT_PERSIST_FAILED',
          'Database-upgrade APPLY succeeded but its execution receipt could not be persisted or reconciled.',
        );
      }
      await recordExecutionAudit({
        req,
        request,
        executionId: receipt.executionId,
        actorId: user.userId,
        eventType: 'DATABASE_UPGRADE_EXECUTION_SUCCEEDED',
        success: true,
        outcome: 'APPLIED',
        snapshot,
        output: result,
        auditRecorder,
      }).catch(() => {});
      return { request, receipt, idempotent: false };
    } catch (error) {
      const reconciled = await reconcileApprovedExecution({
        request,
        existingReceipt: null,
        executionId,
        actorId: user.userId,
        database,
        environment,
        upgradeExecutor,
        req,
        auditRecorder,
      }).catch(() => null);
      if (reconciled) return reconciled;
      const failureReceipt = await persistExecutionReceipt({
        executionId,
        request,
        actorId: user.userId,
        startedAt,
        completedAt: new Date().toISOString(),
        outcome: 'FAILED',
        appliedCount: Number(error?.upgradeResult?.appliedCount || 0),
        resultIdentifiers: safeResultIdentifiers(error?.upgradeResult || {}, request),
        beforeLedgerState: safeLedgerState(snapshot),
        afterLedgerState: safeLedgerState(error?.upgradeResult || {}),
        failureCode: error?.code || 'DATABASE_UPGRADE_EXECUTION_FAILED',
        database,
      }).catch(() => null);
      await recordExecutionAudit({
        req,
        request,
        executionId,
        actorId: user.userId,
        eventType: 'DATABASE_UPGRADE_EXECUTION_FAILED',
        success: false,
        outcome: 'FAILED',
        snapshot,
        output: error?.upgradeResult || null,
        errorCode: error?.code || 'DATABASE_UPGRADE_EXECUTION_FAILED',
        auditRecorder,
      }).catch(() => {});
      error.executionStarted = executionStarted;
      if (failureReceipt) error.details = { ...(error.details || {}), receipt: failureReceipt };
      throw error;
    }
  })();
  executionInFlight.set(normalizedRequestId, operation);
  try {
    return await operation;
  } catch (error) {
    if (!error?.executionStarted) {
      await recordExecutionAudit({
        req,
        request: { requestId: normalizedRequestId },
        actorId: user.userId,
        eventType: 'DATABASE_UPGRADE_EXECUTION_REFUSED',
        success: false,
        outcome: 'REFUSED',
        errorCode: error?.details?.code || error?.code || null,
        auditRecorder,
      }).catch(() => {});
    }
    throw error;
  } finally {
    executionInFlight.delete(normalizedRequestId);
  }
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
  environment = process.env,
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
  const mappedItems = await attachExecutionReceipts(items.rows.map(mapRequestRow), database);
  return {
    items: mappedItems,
    total: Number(total.rows[0]?.count || 0),
    limit: 100,
    offset: 0,
    execution: getExecutionConfig(environment),
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
  assertExactExecutionBody,
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
  executeApprovedApplyRequest,
  getExecutionConfig,
  mapExecutionReceiptRow,
  reconcileApprovedExecution,
};
