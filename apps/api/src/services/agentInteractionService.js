
const { randomUUID } = require('node:crypto');

const { pool, query } = require('../../../../packages/db/src/connection');
const { sha256Digest } = require('../../../../packages/agents/src/canonical');
const { validateJsonSchema } = require('../../../../packages/tools/src/jsonSchemaValidator');
const agentCapabilityAuthorizationService = require('./agentCapabilityAuthorizationService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED']);
const OPEN_REQUEST_STATUSES = new Set(['PENDING', 'SAVED', 'DELIVERED']);
const ADMIN_ROLE_CODES = new Set(['SUPER_ADMIN', 'ADMIN_ALL']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_APPROVAL_TTL_MS = 90 * 1000;
const DEFAULT_INPUT_TTL_MS = 5 * 60 * 1000;
const FORBIDDEN_PAYLOAD_KEYS = /(?:credential|secret|token|password|grant|authorization|principal|actor|permission|provider|temporal|workflow|filesystem|path|environment)/i;

class AgentInteractionServiceError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'AgentInteractionServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function assertUuid(value, fieldName) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new AgentInteractionServiceError(400, 'AGENT_INTERACTION_ID_INVALID', fieldName + ' must be a valid identifier.');
  }
  return normalized;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fieldName, maxLength = 30000) {
  if (!isPlainObject(value)) {
    throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_PAYLOAD_INVALID', fieldName + ' must be an object.');
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > maxLength) {
    throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_PAYLOAD_TOO_LARGE', fieldName + ' exceeds the supported size.');
  }
  return JSON.parse(serialized);
}

function scanSafePayload(value, path = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSafePayload(entry, path + '[' + index + ']'));
    return;
  }
  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_PAYLOAD_KEYS.test(key)) {
      throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_SECRET_FIELD', path + '.' + key + ' is not permitted in an interaction payload.');
    }
    scanSafePayload(nested, path + '.' + key);
  });
}

function actorFromRequest(req) {
  const internal = req?.session?.authMode === 'INTERNAL_SERVICE_TOKEN';
  const userId = req?.user?.userId || null;
  if (!userId && !internal) {
    throw new AgentInteractionServiceError(401, 'AGENT_INTERACTION_AUTHENTICATION_REQUIRED', 'An authenticated user or authorized internal principal is required.');
  }
  const roleCodes = new Set((req?.user?.roleCodes || []).map((role) => String(role).toUpperCase()));
  return {
    internal,
    userId,
    displayName: req?.user?.displayName || req?.user?.username || (internal ? 'SkyCommand Internal Service' : null),
    adminAll: internal || [...roleCodes].some((role) => ADMIN_ROLE_CODES.has(role)),
  };
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertProjectAccess(client, projectId, actor) {
  const project = await client.query(
    'SELECT project_id, project_code, project_name FROM core.projects WHERE project_id = $1 AND active = TRUE',
    [projectId],
  );
  if (project.rowCount === 0) {
    throw new AgentInteractionServiceError(404, 'AGENT_INTERACTION_NOT_FOUND', 'The requested interaction is not visible to this user.');
  }
  if (actor.adminAll) return project.rows[0];
  const membership = await client.query(
    'SELECT 1 FROM core.project_members pm JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.right_code = $3 AND pr.active = TRUE WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.membership_state = $4 LIMIT 1',
    [projectId, actor.userId, 'PROJECT_READ', 'ACTIVE'],
  );
  if (membership.rowCount === 0) {
    throw new AgentInteractionServiceError(404, 'AGENT_INTERACTION_NOT_FOUND', 'The requested interaction is not visible to this user.');
  }
  return project.rows[0];
}

function responderEligible(row, actor) {
  if (actor.adminAll || actor.internal) return true;
  const scope = row.eligible_responder_scope && typeof row.eligible_responder_scope === 'object'
    ? row.eligible_responder_scope
    : {};
  return scope.mode !== 'INITIATING_USER' || actor.userId === row.initiating_user_id;
}

function safeDecision(row, includePayload = false) {
  if (!row || !row.agent_interaction_decision_id) return null;
  const value = {
    decisionId: row.agent_interaction_decision_id,
    requestId: row.agent_interaction_request_id,
    responderUserId: row.responder_user_id || null,
    responderActor: row.responder_actor_snapshot || { kind: row.responder_actor_kind, id: row.responder_actor_id },
    decisionType: row.decision_type,
    decisionValue: row.decision_value,
    payloadDigest: row.decision_digest || null,
    deliveryState: row.delivery_state,
    applicationStatus: row.application_status,
    applicationReason: row.application_reason || null,
    applicationResult: row.application_result || {},
    createdAt: row.created_at,
    deliveredAt: row.delivered_at || null,
    acknowledgedAt: row.acknowledged_at || null,
    appliedAt: row.applied_at || null,
  };
  if (includePayload) value.safePayload = row.safe_payload || {};
  return value;
}

function safeInteraction(row, includePayload = false) {
  if (!row) return null;
  return {
    interactionId: row.agent_interaction_request_id,
    rootExecutionId: row.execution_scope_id,
    runId: row.agent_run_id,
    sessionId: row.session_id,
    projectId: row.project_id,
    projectCode: row.project_code || null,
    projectName: row.project_name || null,
    agentCode: row.agent_code || null,
    interactionType: row.interaction_type,
    operationKind: row.operation_kind,
    operationId: row.operation_id || null,
    capabilityEffectId: row.capability_effect_id || null,
    operationKey: row.operation_key,
    inputDigest: row.input_digest,
    prompt: row.safe_prompt,
    validationSchema: row.validation_schema || {},
    policyRevision: row.policy_revision,
    eligibleResponderScope: row.eligible_responder_scope || {},
    authorityEpoch: row.authority_epoch,
    expiresAt: row.expires_at,
    status: row.status,
    statusReason: row.status_reason || null,
    version: row.version,
    createdAt: row.created_at,
    savedAt: row.saved_at || null,
    deliveredAt: row.delivered_at || null,
    appliedAt: row.applied_at || null,
    blockedAt: row.blocked_at || null,
    expiredAt: row.expired_at || null,
    canceledAt: row.canceled_at || null,
    decision: safeDecision(row.decision, includePayload),
  };
}

async function loadInteractionRow(client, interactionId, { forUpdate = false } = {}) {
  const lock = forUpdate ? 'FOR UPDATE OF r, ar, es' : '';
  const result = await client.query(
    `SELECT r.*,
            ar.status AS run_status,
            ar.revocation_epoch AS run_revocation_epoch,
            es.status AS scope_status,
            es.revocation_epoch AS scope_revocation_epoch,
            p.project_code, p.project_name, def.agent_code,
            CASE WHEN dec.agent_interaction_decision_id IS NULL THEN NULL ELSE jsonb_build_object(
              'agent_interaction_decision_id', dec.agent_interaction_decision_id,
              'agent_interaction_request_id', dec.agent_interaction_request_id,
              'responder_user_id', dec.responder_user_id,
              'responder_actor_kind', dec.responder_actor_kind,
              'responder_actor_id', dec.responder_actor_id,
              'responder_actor_snapshot', dec.responder_actor_snapshot,
              'decision_type', dec.decision_type,
              'decision_value', dec.decision_value,
              'safe_payload', dec.safe_payload,
              'decision_digest', dec.decision_digest,
              'delivery_state', dec.delivery_state,
              'application_status', dec.application_status,
              'application_reason', dec.application_reason,
              'application_result', dec.application_result,
              'created_at', dec.created_at,
              'delivered_at', dec.delivered_at,
              'acknowledged_at', dec.acknowledged_at,
              'applied_at', dec.applied_at
            ) END AS decision
       FROM worker.agent_interaction_requests r
       JOIN core.projects p ON p.project_id = r.project_id
       JOIN worker.agent_runs ar ON ar.agent_run_id = r.agent_run_id
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       JOIN core.agent_definitions def ON def.definition_id = ar.definition_id
       LEFT JOIN worker.agent_interaction_decisions dec ON dec.agent_interaction_request_id = r.agent_interaction_request_id
      WHERE r.agent_interaction_request_id = $1 ` + lock,
    [interactionId],
  );
  return result.rows[0] || null;
}

async function appendEvent(client, row, eventType, sourceCursor, payload = {}, availability = 'REPORTED') {
  const next = await client.query(
    'SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM worker.agent_events WHERE agent_run_id = $1',
    [row.agent_run_id],
  );
  await client.query(
    'INSERT INTO worker.agent_events (agent_run_id, session_id, execution_scope_id, event_sequence, event_type, event_scope, source_kind, source_instance, source_cursor, availability, freshness, observed_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP,$12::jsonb) ON CONFLICT (agent_run_id, source_kind, source_instance, source_cursor) DO NOTHING',
    [row.agent_run_id, row.session_id, row.execution_scope_id, Number(next.rows[0].next_sequence), eventType, 'RUN', 'SKYCOMMAND_AGENT_INTERACTION', 'control-plane', sourceCursor, availability, 'CURRENT', JSON.stringify(payload)],
  );
}

async function markEffectBlocked(client, row, reason) {
  if (!row.capability_effect_id) return;
  await client.query(
    'UPDATE worker.agent_capability_effects SET authority_decision = $2, dispatch_state = $3, outcome_certainty = $4, denial_reason = $5::text, reconciliation_metadata = COALESCE(reconciliation_metadata, $6::jsonb) || jsonb_build_object($7::text, $5::text) WHERE agent_capability_effect_id = $1 AND dispatch_state NOT IN ($8, $9)',
    [row.capability_effect_id, 'DENY', 'DENIED', 'REJECTED', reason, '{}', 'interactionBlockedReason', 'COMPLETED', 'FAILED'],
  );
}

async function expireLockedInteraction(client, row, reason = 'INTERACTION_EXPIRED') {
  if (!OPEN_REQUEST_STATUSES.has(row.status)) return row;
  await client.query(
    'UPDATE worker.agent_interaction_requests SET status = $2, status_reason = $3, expired_at = COALESCE(expired_at, CURRENT_TIMESTAMP), version = version + 1 WHERE agent_interaction_request_id = $1',
    [row.agent_interaction_request_id, 'EXPIRED', reason],
  );
  if (row.decision?.agent_interaction_decision_id) {
    await client.query(
      'UPDATE worker.agent_interaction_decisions SET application_status = CASE WHEN application_status = $2 THEN $3 ELSE application_status END, application_reason = COALESCE(application_reason, $4), version = version + 1 WHERE agent_interaction_decision_id = $1',
      [row.decision.agent_interaction_decision_id, 'PENDING', 'EXPIRED', reason],
    );
  }
  await markEffectBlocked(client, row, reason);
  await appendEvent(client, row, 'AGENT_INTERACTION_EXPIRED', 'interaction:' + row.agent_interaction_request_id + ':expired', { interactionId: row.agent_interaction_request_id, reason }, 'ERROR');
  return { ...row, status: 'EXPIRED', status_reason: reason };
}

function interactionValidationSchema(interactionType) {
  if (interactionType === 'USER_INPUT') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['answer'],
      properties: { answer: { type: 'string', minLength: 1, maxLength: 2000 } },
    };
  }
  return {};
}

async function createAgentInteraction({
  runId,
  interactionType,
  operationKind,
  operationId = null,
  capabilityEffectId = null,
  operationKey,
  inputDigest,
  safePrompt,
  validationSchema = null,
  policyRevision = 'agent-policy.v1',
  eligibleResponderScope = { mode: 'INITIATING_USER_OR_PROJECT_READER' },
  authorityEpoch = 0,
  ttlMs = null,
} = {}) {
  const id = assertUuid(runId, 'runId');
  if (!['APPROVAL', 'USER_INPUT'].includes(interactionType)) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_TYPE_INVALID', 'interactionType is not supported.');
  const prompt = text(safePrompt);
  if (!prompt) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_PROMPT_INVALID', 'A safe interaction prompt is required.');
  const schema = cloneJson(validationSchema || interactionValidationSchema(interactionType), 'validationSchema');
  const digest = text(inputDigest);
  if (!/^[A-F0-9]{64}$/.test(digest)) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_DIGEST_INVALID', 'inputDigest must be a canonical SHA-256 digest.');
  const key = text(operationKey, operationId || id + ':' + interactionType);
  const duration = Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : interactionType === 'APPROVAL' ? DEFAULT_APPROVAL_TTL_MS : DEFAULT_INPUT_TTL_MS;
  return withTransaction(async (client) => {
    const runResult = await client.query(
      'SELECT ar.*, es.status AS scope_status, es.revocation_epoch AS scope_revocation_epoch FROM worker.agent_runs ar JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id WHERE ar.agent_run_id = $1 FOR UPDATE',
      [id],
    );
    if (runResult.rowCount === 0) throw new AgentInteractionServiceError(404, 'AGENT_RUN_NOT_FOUND', 'Agent Run not found while creating an interaction.');
    const run = runResult.rows[0];
    const existingResult = await client.query(
      'SELECT agent_interaction_request_id FROM worker.agent_interaction_requests WHERE agent_run_id = $1 AND operation_key = $2 AND interaction_type = $3 FOR UPDATE',
      [id, key, interactionType],
    );
    if (existingResult.rowCount > 0) {
      const existing = await loadInteractionRow(client, existingResult.rows[0].agent_interaction_request_id);
      return { created: false, interaction: safeInteraction(existing, false) };
    }
    const canceled = run.scope_status !== 'ACTIVE' || TERMINAL_RUN_STATUSES.has(run.status) || ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(run.status);
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + duration).toISOString();
    const inserted = await client.query(
      'INSERT INTO worker.agent_interaction_requests (agent_interaction_request_id, execution_scope_id, agent_run_id, session_id, project_id, initiating_user_id, interaction_type, operation_kind, operation_id, capability_effect_id, operation_key, input_digest, safe_prompt, validation_schema, policy_revision, eligible_responder_scope, authority_epoch, expires_at, status, status_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17,$18,$19,$20) RETURNING *',
      [requestId, run.execution_scope_id, id, run.session_id, run.project_id, run.initiating_user_id, interactionType, text(operationKind, interactionType), operationId, capabilityEffectId, key, digest, prompt, JSON.stringify(schema), text(policyRevision, 'agent-policy.v1'), JSON.stringify(eligibleResponderScope || {}), Math.max(Number(authorityEpoch), Number(run.revocation_epoch), Number(run.scope_revocation_epoch)), expiresAt, canceled ? 'CANCELED' : 'PENDING', canceled ? 'RUN_OR_ROOT_REVOKED_BEFORE_INTERACTION' : null],
    );
    const row = inserted.rows[0];
    if (!canceled && run.status === 'RUNNING') {
      await client.query('UPDATE worker.agent_runs SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE agent_run_id = $1', [id, interactionType === 'APPROVAL' ? 'WAITING_FOR_APPROVAL' : 'WAITING_FOR_USER_INPUT']);
    }
    await appendEvent(client, row, 'AGENT_INTERACTION_REQUESTED', 'interaction:' + requestId + ':requested', { interactionId: requestId, interactionType, operationKind: text(operationKind, interactionType), operationId, capabilityEffectId, inputDigest: digest, authorityEpoch: row.authority_epoch, expiresAt, status: row.status }, canceled ? 'ERROR' : 'REPORTED');
    return { created: true, interaction: safeInteraction({ ...row, decision: null }, false) };
  });
}

async function loadAgentInteractionActivity({ interactionId } = {}) {
  return withTransaction(async (client) => {
    let row = await loadInteractionRow(client, assertUuid(interactionId, 'interactionId'), { forUpdate: true });
    if (!row) return null;
    if (OPEN_REQUEST_STATUSES.has(row.status) && new Date(row.expires_at).getTime() <= Date.now()) row = await expireLockedInteraction(client, row);
    return safeInteraction(row, true);
  });
}

async function acknowledgeAgentInteractionDelivery({ interactionId, decisionId } = {}) {
  return withTransaction(async (client) => {
    const row = await loadInteractionRow(client, assertUuid(interactionId, 'interactionId'), { forUpdate: true });
    if (!row || !row.decision || row.decision.agent_interaction_decision_id !== decisionId) return { acknowledged: false, reason: 'DECISION_NOT_CURRENT' };
    if (row.decision.delivery_state !== 'ACKNOWLEDGED') {
      await client.query('UPDATE worker.agent_interaction_decisions SET delivery_state = $2, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP), acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP), version = version + 1 WHERE agent_interaction_decision_id = $1', [decisionId, 'ACKNOWLEDGED']);
      if (OPEN_REQUEST_STATUSES.has(row.status)) await client.query('UPDATE worker.agent_interaction_requests SET status = $2, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP), version = version + 1 WHERE agent_interaction_request_id = $1', [interactionId, 'DELIVERED']);
      await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_DELIVERED', 'interaction:' + interactionId + ':decision:' + decisionId + ':delivered', { interactionId, decisionId });
    }
    return { acknowledged: true, interactionId, decisionId };
  });
}

async function applyAgentInteractionDecision({ interactionId, decisionId } = {}) {
  const id = assertUuid(interactionId, 'interactionId');
  const prepared = await withTransaction(async (client) => {
    const row = await loadInteractionRow(client, id, { forUpdate: true });
    if (!row || !row.decision || row.decision.agent_interaction_decision_id !== decisionId) return { kind: 'MISSING', interaction: row };
    if (['APPLIED', 'BLOCKED', 'REJECTED', 'EXPIRED', 'CANCELED'].includes(row.decision.application_status)) return { kind: 'REPLAY', interaction: safeInteraction(row, true), applicationStatus: row.decision.application_status, applicationResult: row.decision.application_result || {} };
    if (!OPEN_REQUEST_STATUSES.has(row.status) || new Date(row.expires_at).getTime() <= Date.now()) {
      await expireLockedInteraction(client, row);
      return { kind: 'BLOCKED', interaction: safeInteraction({ ...row, status: 'EXPIRED' }, true), applicationStatus: 'EXPIRED', reason: 'INTERACTION_EXPIRED' };
    }
    if (
      TERMINAL_RUN_STATUSES.has(row.run_status) ||
      row.scope_status !== 'ACTIVE' ||
      Math.max(Number(row.run_revocation_epoch || 0), Number(row.scope_revocation_epoch || 0)) !== Number(row.authority_epoch || 0)
    ) {
      const reason = 'INTERACTION_AUTHORITY_STALE';
      await client.query('UPDATE worker.agent_interaction_decisions SET application_status = $2, application_reason = $3, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_decision_id = $1', [decisionId, 'BLOCKED', reason]);
      await client.query('UPDATE worker.agent_interaction_requests SET status = $2, status_reason = $3, blocked_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1', [id, 'BLOCKED', reason]);
      await markEffectBlocked(client, row, reason);
      await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_BLOCKED', 'interaction:' + id + ':decision:' + decisionId + ':authority-stale', { interactionId: id, decisionId, reason }, 'ERROR');
      return { kind: 'BLOCKED', interaction: safeInteraction({ ...row, status: 'BLOCKED' }, false), applicationStatus: 'BLOCKED', reason };
    }
    if (row.decision.decision_type === 'REJECT') {
      await client.query('UPDATE worker.agent_interaction_decisions SET application_status = $2, application_reason = $3, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_decision_id = $1', [decisionId, 'REJECTED', 'RESPONDER_REJECTED']);
      await client.query('UPDATE worker.agent_interaction_requests SET status = $2, status_reason = $3, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1', [id, 'REJECTED', 'RESPONDER_REJECTED']);
      await markEffectBlocked(client, row, 'INTERACTION_REJECTED');
      await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_APPLIED', 'interaction:' + id + ':decision:' + decisionId + ':rejected', { interactionId: id, decisionId, applicationStatus: 'REJECTED', reason: 'RESPONDER_REJECTED' }, 'ERROR');
      return { kind: 'APPLIED', interaction: safeInteraction({ ...row, status: 'REJECTED' }, true), applicationStatus: 'REJECTED', reason: 'RESPONDER_REJECTED', input: null, capabilityRequest: null };
    }
    return { kind: 'READY', row, payload: row.decision.safe_payload || {} };
  });
  if (prepared.kind !== 'READY') {
    return { interaction: prepared.interaction || null, applicationStatus: prepared.applicationStatus || 'BLOCKED', reason: prepared.reason || null, input: prepared.applicationStatus === 'APPLIED' ? prepared.applicationResult?.input || null : null, capabilityRequest: null, replayed: prepared.kind === 'REPLAY' };
  }
  let capabilityRequest = null;
  let effect = null;
  let blockedReason = null;
  if (prepared.row.interaction_type === 'APPROVAL' && prepared.row.capability_effect_id) {
    try {
      const approved = await agentCapabilityAuthorizationService.approveManagedCapabilityEffect({ effectId: prepared.row.capability_effect_id });
      capabilityRequest = approved.capabilityRequest || null;
      effect = approved.effect || null;
      blockedReason = approved.allowed ? null : approved.reason || 'CURRENT_AUTHORITY_REJECTED';
    } catch (error) {
      blockedReason = error.code || 'INTERACTION_APPROVAL_REVALIDATION_FAILED';
    }
  }
  return withTransaction(async (client) => {
    const row = await loadInteractionRow(client, id, { forUpdate: true });
    if (!row || !row.decision || row.decision.agent_interaction_decision_id !== decisionId) return { interaction: null, applicationStatus: 'BLOCKED', reason: 'DECISION_NOT_CURRENT', input: null, capabilityRequest: null };
    if (row.decision.application_status !== 'PENDING') return { interaction: safeInteraction(row, true), applicationStatus: row.decision.application_status, reason: row.decision.application_reason || null, input: null, capabilityRequest: null, replayed: true };
    if (
      TERMINAL_RUN_STATUSES.has(row.run_status) ||
      row.scope_status !== 'ACTIVE' ||
      Math.max(Number(row.run_revocation_epoch || 0), Number(row.scope_revocation_epoch || 0)) !== Number(row.authority_epoch || 0)
    ) {
      blockedReason = blockedReason || 'INTERACTION_AUTHORITY_STALE';
    }
    if (blockedReason) {
      await client.query('UPDATE worker.agent_interaction_decisions SET application_status = $2, application_reason = $3, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_decision_id = $1', [decisionId, 'BLOCKED', blockedReason]);
      await client.query('UPDATE worker.agent_interaction_requests SET status = $2, status_reason = $3, blocked_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1', [id, 'BLOCKED', blockedReason]);
      await markEffectBlocked(client, row, blockedReason);
      await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_BLOCKED', 'interaction:' + id + ':decision:' + decisionId + ':blocked', { interactionId: id, decisionId, reason: blockedReason }, 'ERROR');
      return { interaction: safeInteraction({ ...row, status: 'BLOCKED' }, false), applicationStatus: 'BLOCKED', reason: blockedReason, input: null, capabilityRequest: null };
    }
    const result = prepared.row.interaction_type === 'USER_INPUT' ? { input: prepared.payload.input || {} } : { approved: true, effectId: prepared.row.capability_effect_id || null };
    await client.query('UPDATE worker.agent_interaction_decisions SET application_status = $2, application_reason = NULL, application_result = $3::jsonb, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_decision_id = $1', [decisionId, 'APPLIED', JSON.stringify(result)]);
    await client.query('UPDATE worker.agent_interaction_requests SET status = $2, status_reason = NULL, applied_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1', [id, 'APPLIED']);
    await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_APPLIED', 'interaction:' + id + ':decision:' + decisionId + ':applied', { interactionId: id, decisionId, applicationStatus: 'APPLIED', capabilityEffectId: prepared.row.capability_effect_id || null, inputDigest: prepared.row.interaction_type === 'USER_INPUT' ? sha256Digest(prepared.payload.input || {}) : null });
    return { interaction: safeInteraction({ ...row, status: 'APPLIED' }, false), applicationStatus: 'APPLIED', reason: null, input: result.input || null, capabilityRequest, effect, replayed: false };
  });
}

async function cancelAgentInteractionsForRun({ runId, reason = 'RUN_OR_ROOT_STOP_REQUESTED' } = {}) {
  const id = assertUuid(runId, 'runId');
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM worker.agent_interaction_requests WHERE agent_run_id = $1 AND status IN ($2,$3,$4) FOR UPDATE', [id, 'PENDING', 'SAVED', 'DELIVERED']);
    for (const row of result.rows) {
      await client.query('UPDATE worker.agent_interaction_requests SET status = $2, status_reason = $3, canceled_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1', [row.agent_interaction_request_id, 'CANCELED', reason]);
      if (row.decision_id) await client.query('UPDATE worker.agent_interaction_decisions SET application_status = $2, application_reason = $3, version = version + 1 WHERE agent_interaction_decision_id = $1 AND application_status = $4', [row.decision_id, 'CANCELED', reason, 'PENDING']);
      await markEffectBlocked(client, row, reason);
      await appendEvent(client, row, 'AGENT_INTERACTION_CANCELED', 'interaction:' + row.agent_interaction_request_id + ':canceled', { interactionId: row.agent_interaction_request_id, reason }, 'ERROR');
    }
    return { canceled: result.rows.length, runId: id };
  });
}

async function expireInteractionActivity({ interactionId } = {}) {
  const id = assertUuid(interactionId, 'interactionId');
  return withTransaction(async (client) => {
    const row = await loadInteractionRow(client, id, { forUpdate: true });
    if (!row) return { expired: false, reason: 'NOT_FOUND' };
    await expireLockedInteraction(client, row);
    return { expired: true, interactionId: id };
  });
}

async function reconcileQuarantinedRuntimeActivity({ runId, evidence = {} } = {}) {
  const safeEvidence = cloneJson(evidence, 'evidence', 10000);
  scanSafePayload(safeEvidence, 'evidence');
  if (safeEvidence.confirmed !== true || !text(safeEvidence.workerGeneration) || !text(safeEvidence.sourceCursor)) {
    throw new AgentInteractionServiceError(422, 'AGENT_QUARANTINE_CONFIRMATION_INVALID', 'Quarantine clearance requires confirmed-stop evidence, workerGeneration, and sourceCursor.');
  }
  const id = assertUuid(runId, 'runId');
  return withTransaction(async (client) => {
    const result = await client.query('SELECT ar.*, rc.quarantine_state FROM worker.agent_runs ar LEFT JOIN worker.agent_runtime_cells rc ON rc.agent_run_id = ar.agent_run_id WHERE ar.agent_run_id = $1 FOR UPDATE OF ar', [id]);
    if (result.rowCount === 0) throw new AgentInteractionServiceError(404, 'AGENT_RUN_NOT_FOUND', 'Agent Run not found while reconciling quarantine.');
    const run = result.rows[0];
    if (run.quarantine_state !== 'QUARANTINED') return { runId: id, cleared: false, reason: 'NOT_QUARANTINED' };
    await client.query('UPDATE worker.agent_runtime_cells SET quarantine_state = $2, quarantine_cleared_at = CURRENT_TIMESTAMP, quarantine_evidence = quarantine_evidence || $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE agent_run_id = $1', [id, 'CLEARED', JSON.stringify({ clearance: safeEvidence })]);
    await client.query('UPDATE worker.agent_resource_leases SET lease_state = $2, released_at = CURRENT_TIMESTAMP, quarantine_evidence = quarantine_evidence || $3::jsonb WHERE agent_run_id = $1 AND lease_state = $4', [id, 'RELEASED', JSON.stringify({ clearance: safeEvidence }), 'QUARANTINED']);
    await client.query('UPDATE worker.agent_runs SET stop_evidence = stop_evidence || $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE agent_run_id = $1', [id, JSON.stringify({ quarantineClearedAt: new Date().toISOString(), clearance: safeEvidence })]);
    await appendEvent(client, run, 'AGENT_RUNTIME_QUARANTINE_CLEARED', 'runtime:' + id + ':quarantine:cleared:' + safeEvidence.sourceCursor, { runId: id, workerGeneration: safeEvidence.workerGeneration, sourceCursor: safeEvidence.sourceCursor });
    return { runId: id, cleared: true, workerGeneration: safeEvidence.workerGeneration, sourceCursor: safeEvidence.sourceCursor };
  });
}

async function getInteractionForRequest(req, interactionId, includePayload = false) {
  const actor = actorFromRequest(req);
  const id = assertUuid(interactionId, 'interactionId');
  const values = [id, actor.adminAll, actor.userId];
  let result = await query(
    `SELECT r.*, p.project_code, p.project_name, def.agent_code,
            CASE WHEN dec.agent_interaction_decision_id IS NULL THEN NULL ELSE jsonb_build_object(
              'agent_interaction_decision_id', dec.agent_interaction_decision_id,
              'agent_interaction_request_id', dec.agent_interaction_request_id,
              'responder_user_id', dec.responder_user_id,
              'responder_actor_kind', dec.responder_actor_kind,
              'responder_actor_id', dec.responder_actor_id,
              'responder_actor_snapshot', dec.responder_actor_snapshot,
              'decision_type', dec.decision_type,
              'decision_value', dec.decision_value,
              'safe_payload', dec.safe_payload,
              'decision_digest', dec.decision_digest,
              'delivery_state', dec.delivery_state,
              'application_status', dec.application_status,
              'application_reason', dec.application_reason,
              'application_result', dec.application_result,
              'created_at', dec.created_at,
              'delivered_at', dec.delivered_at,
              'acknowledged_at', dec.acknowledged_at,
              'applied_at', dec.applied_at
            ) END AS decision
       FROM worker.agent_interaction_requests r
       JOIN core.projects p ON p.project_id = r.project_id
       JOIN worker.agent_runs ar ON ar.agent_run_id = r.agent_run_id
       JOIN core.agent_definitions def ON def.definition_id = ar.definition_id
       LEFT JOIN worker.agent_interaction_decisions dec ON dec.agent_interaction_request_id = r.agent_interaction_request_id
      WHERE r.agent_interaction_request_id = $1
        AND ($2::boolean = TRUE OR $3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM core.project_members pm
          JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.right_code = 'PROJECT_READ' AND pr.active = TRUE
          WHERE pm.project_id = r.project_id AND pm.user_id = $3 AND pm.membership_state = 'ACTIVE'
        ))`,
    values,
  );
  if (result.rowCount === 0) throw new AgentInteractionServiceError(404, 'AGENT_INTERACTION_NOT_FOUND', 'The requested interaction is not visible to this user.');
  let row = result.rows[0];
  if (OPEN_REQUEST_STATUSES.has(row.status) && new Date(row.expires_at).getTime() <= Date.now()) {
    await expireInteractionActivity({ interactionId: id });
    return getInteractionForRequest(req, id, includePayload);
  }
  return safeInteraction(row, includePayload);
}

async function listAgentInteractions(req, options = {}) {
  const actor = actorFromRequest(req);
  const limitValue = Number.parseInt(options.limit, 10);
  const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, MAX_LIMIT) : DEFAULT_LIMIT;
  const values = [actor.adminAll, actor.userId];
  const clauses = [
    "($1::boolean = TRUE OR $2::uuid IS NULL OR EXISTS (SELECT 1 FROM core.project_members pm JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.right_code = 'PROJECT_READ' AND pr.active = TRUE WHERE pm.project_id = r.project_id AND pm.user_id = $2 AND pm.membership_state = 'ACTIVE'))",
  ];
  if (options.status) {
    values.push(text(options.status).toUpperCase());
    clauses.push('r.status = $' + values.length);
  }
  if (options.interactionType) {
    values.push(text(options.interactionType).toUpperCase());
    clauses.push('r.interaction_type = $' + values.length);
  }
  if (options.projectId) {
    values.push(assertUuid(options.projectId, 'projectId'));
    clauses.push('r.project_id = $' + values.length);
  }
  const base = 'FROM worker.agent_interaction_requests r JOIN core.projects p ON p.project_id = r.project_id JOIN worker.agent_runs ar ON ar.agent_run_id = r.agent_run_id JOIN core.agent_definitions def ON def.definition_id = ar.definition_id LEFT JOIN worker.agent_interaction_decisions dec ON dec.agent_interaction_request_id = r.agent_interaction_request_id WHERE ' + clauses.join(' AND ');
  const count = await query('SELECT COUNT(*)::int AS total ' + base, values);
  const rows = await query(
    'SELECT r.*, p.project_code, p.project_name, def.agent_code, CASE WHEN dec.agent_interaction_decision_id IS NULL THEN NULL ELSE jsonb_build_object(' +
      "'agent_interaction_decision_id', dec.agent_interaction_decision_id, 'agent_interaction_request_id', dec.agent_interaction_request_id, 'responder_user_id', dec.responder_user_id, 'responder_actor_kind', dec.responder_actor_kind, 'responder_actor_id', dec.responder_actor_id, 'responder_actor_snapshot', dec.responder_actor_snapshot, 'decision_type', dec.decision_type, 'decision_value', dec.decision_value, 'safe_payload', '{}'::jsonb, 'decision_digest', dec.decision_digest, 'delivery_state', dec.delivery_state, 'application_status', dec.application_status, 'application_reason', dec.application_reason, 'application_result', dec.application_result, 'created_at', dec.created_at, 'delivered_at', dec.delivered_at, 'acknowledged_at', dec.acknowledged_at, 'applied_at', dec.applied_at) END AS decision " +
      base + ' ORDER BY r.created_at DESC, r.agent_interaction_request_id LIMIT $' + (values.length + 1),
    [...values, limit],
  );
  return { items: rows.rows.map((row) => safeInteraction(row, false)), total: Number(count.rows[0]?.total || 0), limit };
}

async function submitAgentInteractionDecision(req, interactionId, body = {}) {
  const actor = actorFromRequest(req);
  const id = assertUuid(interactionId, 'interactionId');
  if (!isPlainObject(body)) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_DECISION_INVALID', 'Decision body must be an object.');
  for (const key of Object.keys(body)) if (!new Set(['decision', 'input']).has(key)) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_INPUT_NOT_ALLOWED', 'body.' + key + ' is not an accepted interaction decision field.');
  const decisionValue = text(body.decision).toUpperCase();
  const result = await withTransaction(async (client) => {
    let row = await loadInteractionRow(client, id, { forUpdate: true });
    if (!row) throw new AgentInteractionServiceError(404, 'AGENT_INTERACTION_NOT_FOUND', 'The requested interaction is not visible to this user.');
    await assertProjectAccess(client, row.project_id, actor);
    if (!responderEligible(row, actor)) throw new AgentInteractionServiceError(403, 'AGENT_INTERACTION_RESPONDER_NOT_ELIGIBLE', 'The authenticated responder is outside the eligible interaction scope.');
    if (OPEN_REQUEST_STATUSES.has(row.status) && new Date(row.expires_at).getTime() <= Date.now()) {
      await expireLockedInteraction(client, row);
      return { expired: true, interactionId: id };
    }
    let decisionType;
    let safePayload = {};
    if (row.interaction_type === 'APPROVAL') {
      if (!['APPROVE', 'REJECT'].includes(decisionValue)) throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_DECISION_INVALID', 'Approval decisions must be APPROVE or REJECT.');
      decisionType = decisionValue;
    } else {
      if (decisionValue !== 'SUBMIT') throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_DECISION_INVALID', 'User-input decisions must use SUBMIT.');
      const input = cloneJson(body.input, 'input');
      scanSafePayload(input, 'input');
      try {
        validateJsonSchema(input, row.validation_schema || {}, { schemaName: 'Agent interaction input' });
      } catch (error) {
        throw new AgentInteractionServiceError(422, 'AGENT_INTERACTION_INPUT_SCHEMA_INVALID', error.message);
      }
      safePayload = { input };
      decisionType = 'SUBMIT_INPUT';
    }
    const digest = sha256Digest({ requestId: id, decisionType, decisionValue, safePayload });
    if (row.decision?.agent_interaction_decision_id) {
      if (row.decision.decision_digest === digest) return { saved: true, replayed: true, interaction: safeInteraction(row, false), decision: safeDecision(row.decision, false) };
      throw new AgentInteractionServiceError(409, 'AGENT_INTERACTION_CONFLICT', 'A different decision is already saved for this interaction.', { interactionId: id, decisionId: row.decision.agent_interaction_decision_id });
    }
    if (!OPEN_REQUEST_STATUSES.has(row.status)) {
      throw new AgentInteractionServiceError(409, 'AGENT_INTERACTION_NOT_OPEN', 'The interaction is no longer accepting a decision.', { interactionId: id, status: row.status });
    }
    if (
      TERMINAL_RUN_STATUSES.has(row.run_status) ||
      row.scope_status !== 'ACTIVE' ||
      Math.max(Number(row.run_revocation_epoch || 0), Number(row.scope_revocation_epoch || 0)) !== Number(row.authority_epoch || 0)
    ) {
      throw new AgentInteractionServiceError(409, 'AGENT_INTERACTION_AUTHORITY_STALE', 'The interaction authority is no longer current.', { interactionId: id, status: row.status });
    }
    const decisionId = randomUUID();
    const actorId = actor.userId || 'internal:agent-interaction';
    await client.query(
      'INSERT INTO worker.agent_interaction_decisions (agent_interaction_decision_id, agent_interaction_request_id, responder_user_id, responder_actor_kind, responder_actor_id, responder_actor_snapshot, decision_type, decision_value, safe_payload, decision_digest) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10)',
      [decisionId, id, actor.userId, actor.internal ? 'INTERNAL_SERVICE' : 'USER', actorId, JSON.stringify({ kind: actor.internal ? 'INTERNAL_SERVICE' : 'USER', id: actorId, displayNameSnapshot: actor.displayName }), decisionType, decisionValue, JSON.stringify(safePayload), digest],
    );
    await client.query("UPDATE worker.agent_interaction_requests SET decision_id = $2, status = 'SAVED', saved_at = CURRENT_TIMESTAMP, version = version + 1 WHERE agent_interaction_request_id = $1", [id, decisionId]);
    await client.query(
      "INSERT INTO worker.execution_outbox (aggregate_type, aggregate_id, event_type, stable_workflow_id, payload, dispatch_state, interaction_request_id, interaction_decision_id) SELECT 'AGENT_INTERACTION', r.agent_interaction_request_id, 'AGENT_INTERACTION_DECISION', NULL, jsonb_build_object('runId', r.agent_run_id, 'workflowId', ar.stable_temporal_workflow_id, 'interactionRequestId', r.agent_interaction_request_id, 'decisionId', $2::uuid), 'PENDING', r.agent_interaction_request_id, $2::uuid FROM worker.agent_interaction_requests r JOIN worker.agent_runs ar ON ar.agent_run_id = r.agent_run_id WHERE r.agent_interaction_request_id = $1",
      [id, decisionId],
    );
    await appendEvent(client, row, 'AGENT_INTERACTION_DECISION_SAVED', 'interaction:' + id + ':decision:' + decisionId + ':saved', { interactionId: id, decisionId, decisionType, decisionValue, decisionDigest: digest, responder: { kind: actor.internal ? 'INTERNAL_SERVICE' : 'USER', id: actorId } });
    row = await loadInteractionRow(client, id);
    return { saved: true, replayed: false, interaction: safeInteraction(row, false), decision: safeDecision(row.decision, false) };
  });
  if (result?.expired) {
    throw new AgentInteractionServiceError(409, 'AGENT_INTERACTION_EXPIRED', 'The interaction expired before a decision was saved.', { interactionId: id });
  }
  if (!result.replayed) {
    try {
      const { dispatchAgentInteractionDecision } = require('./agentRunDispatcher');
      dispatchAgentInteractionDecision(result.interaction.interactionId).catch(() => {});
    } catch (_error) {}
  }
  return result;
}

async function listAgentInteractionsForRun(runId) {
  const id = assertUuid(runId, 'runId');
  const result = await query(
    `SELECT r.*, p.project_code, p.project_name, def.agent_code,
            CASE WHEN dec.agent_interaction_decision_id IS NULL THEN NULL ELSE jsonb_build_object(
              'agent_interaction_decision_id', dec.agent_interaction_decision_id,
              'agent_interaction_request_id', dec.agent_interaction_request_id,
              'responder_user_id', dec.responder_user_id,
              'responder_actor_kind', dec.responder_actor_kind,
              'responder_actor_id', dec.responder_actor_id,
              'responder_actor_snapshot', dec.responder_actor_snapshot,
              'decision_type', dec.decision_type,
              'decision_value', dec.decision_value,
              'safe_payload', '{}'::jsonb,
              'decision_digest', dec.decision_digest,
              'delivery_state', dec.delivery_state,
              'application_status', dec.application_status,
              'application_reason', dec.application_reason,
              'application_result', dec.application_result,
              'created_at', dec.created_at,
              'delivered_at', dec.delivered_at,
              'acknowledged_at', dec.acknowledged_at,
              'applied_at', dec.applied_at
            ) END AS decision
       FROM worker.agent_interaction_requests r
       JOIN core.projects p ON p.project_id = r.project_id
       JOIN worker.agent_runs ar ON ar.agent_run_id = r.agent_run_id
       JOIN core.agent_definitions def ON def.definition_id = ar.definition_id
       LEFT JOIN worker.agent_interaction_decisions dec ON dec.agent_interaction_request_id = r.agent_interaction_request_id
      WHERE r.agent_run_id = $1
      ORDER BY r.created_at, r.agent_interaction_request_id`,
    [id],
  );
  return result.rows.map((row) => safeInteraction(row, false));
}

module.exports = {
  AgentInteractionServiceError,
  createAgentInteraction,
  loadAgentInteractionActivity,
  acknowledgeAgentInteractionDelivery,
  applyAgentInteractionDecision,
  cancelAgentInteractionsForRun,
  expireInteractionActivity,
  reconcileQuarantinedRuntimeActivity,
  listAgentInteractions,
  listAgentInteractionsForRun,
  getInteractionForRequest,
  submitAgentInteractionDecision,
};
