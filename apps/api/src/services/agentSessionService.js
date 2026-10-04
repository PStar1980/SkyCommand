const { pool, query } = require('../../../../packages/db/src/connection');
const { runtimeBusyConditionSql } = require('./agentRuntimeAvailability');

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT']);
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN_ALL']);
const CONTINUATION_KEYS = new Set(['instruction', 'idempotencyKey', 'deadlineMs']);

function failure(statusCode, code, message, details = {}) {
  return Object.assign(new Error(message), { statusCode, code, details: { retriable: false, outcomeCertainty: 'NOT_ACCEPTED', ...details } });
}

function actorFromRequest(req) {
  const internal = req?.session?.authMode === 'INTERNAL_SERVICE_TOKEN';
  const userId = req?.user?.userId || null;
  if (!internal && !userId) throw failure(401, 'AGENT_AUTHENTICATION_REQUIRED', 'Authentication is required.');
  return { internal, userId, adminAll: internal || (req?.user?.roleCodes || []).some((code) => ADMIN_ROLES.has(String(code).toUpperCase())) };
}

function assertUuid(value, label = 'sessionId') {
  const result = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw failure(400, 'AGENT_ID_INVALID', `${label} must be a registered identifier.`);
  return result;
}

// Private Sessions require ownership AND current Project access. A null historical
// internal owner does not make a Session visible to all authenticated users.
const VISIBLE = `($2::boolean = TRUE OR (s.initiating_user_id = $3::uuid AND EXISTS (
  SELECT 1 FROM core.project_members pm
  JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.active = TRUE AND pr.right_code = 'PROJECT_READ'
  WHERE pm.project_id = s.project_id AND pm.user_id = $3::uuid AND pm.membership_state = 'ACTIVE'
)))`;

const PROJECTION = `SELECT s.*, p.project_code, p.project_name, p.active AS project_active,
  p.authority_policy, p.policy_revision AS project_policy_revision,
  u.display_name AS initiating_user_name,
  lr.agent_run_id AS latest_run_id, lr.status AS latest_run_status,
  lr.created_at AS latest_run_created_at, lr.updated_at AS latest_run_updated_at,
  GREATEST(s.updated_at, COALESCE(lr.updated_at, s.updated_at)) AS last_activity_at,
  lr.definition_id, lr.definition_version_id, lr.project_workspace_id,
  lr.installation_id, lr.account_binding_id, lr.capability_profile_id,
  lr.execution_context, lr.requested_authority, lr.fake_runtime_case_id,
  d.agent_code, d.agent_name, d.active AS definition_active, d.lifecycle_state,
  v.revision AS agent_revision, v.content_digest, v.configuration, v.policy_revision AS version_policy_revision,
  v.installation_id AS version_installation_id, v.account_binding_id AS version_account_binding_id,
  v.capability_profile_id AS version_capability_profile_id,
  i.runtime_profile, i.adapter_version, i.enabled AS installation_enabled,
  i.execution_enabled AS installation_execution_enabled, i.execution_enablement_source AS installation_enablement_source,
  i.certification_state, i.freshness_status, i.configuration_digest, i.configuration_revision,
  i.capability_manifest, i.capability_manifest_revision, i.reviewed_source_revision,
  i.process_generation, i.service_generation, i.process_started_at, i.observed_at,
  r.runtime_code, a.account_alias, a.account_state, a.account_policy,
  a.execution_enabled AS account_execution_enabled, a.execution_enablement_source AS account_enablement_source,
  cp.profile_code, cp.policy AS capability_policy,
  cp.execution_enabled AS profile_execution_enabled, cp.execution_enablement_source AS profile_enablement_source,
  pw.workspace_policy, pw.environment_code, pw.workspace_mode, pw.active AS workspace_active,
  au.snapshot AS prior_authority,
  counts.run_count, busy.active_run_id, busy.active_run_status,
  EXISTS (SELECT 1 FROM worker.agent_runs occupied WHERE occupied.installation_id = lr.installation_id
    AND ${runtimeBusyConditionSql('occupied')}) AS runtime_busy,
  EXISTS (SELECT 1 FROM core.project_agent_allow_rules par WHERE par.project_id = s.project_id
    AND par.definition_id = lr.definition_id AND par.allow_state = 'ACTIVE'
    AND (par.definition_version_id IS NULL OR par.definition_version_id = lr.definition_version_id)) AS agent_allowed,
  pt.provider_turn_id, pt.provider_session_reference,
  po.state AS provider_operation_state, po.outcome_certainty,
  accepted.payload->>'threadId' AS provider_conversation_reference,
  EXISTS (SELECT 1 FROM worker.agent_provider_operations uncertain JOIN worker.agent_runs ur USING (agent_run_id)
    WHERE ur.session_id = s.session_id AND uncertain.operation_type = 'SUBMIT_TURN'
      AND (uncertain.outcome_certainty = 'UNKNOWN' OR uncertain.state IN ('UNKNOWN', 'RECOVERY_REQUIRED'))) AS provider_outcome_unknown
FROM worker.agent_sessions s
JOIN core.projects p ON p.project_id = s.project_id
LEFT JOIN auth.users u ON u.user_id = s.initiating_user_id
LEFT JOIN LATERAL (SELECT ar.* FROM worker.agent_runs ar WHERE ar.session_id = s.session_id ORDER BY ar.created_at DESC, ar.agent_run_id DESC LIMIT 1) lr ON TRUE
LEFT JOIN core.agent_definitions d ON d.definition_id = lr.definition_id
LEFT JOIN core.agent_definition_versions v ON v.definition_version_id = lr.definition_version_id
LEFT JOIN core.agent_runtime_installations i ON i.installation_id = lr.installation_id
LEFT JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
LEFT JOIN core.agent_runtime_accounts a ON a.account_binding_id = lr.account_binding_id
LEFT JOIN core.agent_capability_profiles cp ON cp.capability_profile_id = lr.capability_profile_id
LEFT JOIN core.project_workspaces pw ON pw.project_workspace_id = lr.project_workspace_id
LEFT JOIN worker.agent_authority_snapshots au ON au.agent_run_id = lr.agent_run_id
LEFT JOIN LATERAL (SELECT COUNT(*)::int AS run_count FROM worker.agent_runs cr WHERE cr.session_id = s.session_id) counts ON TRUE
LEFT JOIN LATERAL (SELECT br.agent_run_id AS active_run_id, br.status AS active_run_status
  FROM worker.agent_runs br WHERE br.session_id = s.session_id AND (
    br.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT') OR EXISTS (
      SELECT 1 FROM worker.agent_resource_leases bl WHERE bl.agent_run_id = br.agent_run_id AND bl.lease_state IN ('ACTIVE', 'QUARANTINED')))
  ORDER BY br.created_at DESC LIMIT 1) busy ON TRUE
LEFT JOIN LATERAL (SELECT t.* FROM worker.agent_turns t WHERE t.agent_run_id = lr.agent_run_id ORDER BY t.created_at DESC LIMIT 1) pt ON TRUE
LEFT JOIN worker.agent_provider_operations po ON po.agent_turn_id = pt.agent_turn_id AND po.operation_type = 'SUBMIT_TURN'
LEFT JOIN LATERAL (SELECT e.payload FROM worker.agent_events e WHERE e.agent_run_id = lr.agent_run_id
  AND e.event_type = 'PROVIDER_OPERATION_ACCEPTED' AND e.payload->>'providerSessionReference' = pt.provider_session_reference
  AND e.payload->>'providerTurnId' = pt.provider_turn_id AND e.payload->>'operationId' = po.provider_operation_id::text
  ORDER BY e.event_sequence DESC LIMIT 1) accepted ON TRUE`;

function continuationBlockReason(row) {
  if (row.archived_at) return 'SESSION_ARCHIVED';
  if (row.provider_outcome_unknown || row.status === 'RECOVERY_REQUIRED') return 'SESSION_PROVIDER_CONTINUATION_OUTCOME_UNKNOWN';
  if (row.active_run_id) return 'SESSION_ALREADY_ACTIVE';
  if (row.runtime_code === 'OPENAI_CODEX_APP_SERVER' && row.runtime_busy) return 'SESSION_RUNTIME_BUSY';
  if (row.status !== 'ACTIVE' || row.session_model !== 'PERSISTENT') return 'SESSION_INCOMPATIBLE';
  if (!row.latest_run_id || !TERMINAL.has(row.latest_run_status)) return 'SESSION_ALREADY_ACTIVE';
  if (row.latest_run_status !== 'COMPLETED') return 'SESSION_INCOMPATIBLE';
  if (!row.project_active || !row.workspace_active || !row.definition_active || row.lifecycle_state !== 'ACTIVE' || !row.agent_allowed) return 'SESSION_AUTHORITY_REVOKED';
  if (row.installation_enabled !== true || row.installation_execution_enabled !== true || row.certification_state !== 'CERTIFIED' || row.freshness_status !== 'CURRENT') return 'SESSION_RUNTIME_UNAVAILABLE';
  if (row.account_state !== 'CONFIGURED' || row.account_execution_enabled !== true || row.profile_execution_enabled !== true) return 'SESSION_ACCOUNT_UNAVAILABLE';
  if (!['OPENAI_CODEX_APP_SERVER', 'FAKE_PERSISTENT'].includes(row.runtime_code)) return 'SESSION_INCOMPATIBLE';
  const priorRuntime = row.execution_context?.runtime || {};
  const priorConfig = row.prior_authority?.runtimeConfiguration || {};
  if (row.version_installation_id !== row.installation_id || row.version_account_binding_id !== row.account_binding_id || row.version_capability_profile_id !== row.capability_profile_id
    || priorRuntime.adapterVersion !== row.adapter_version || priorRuntime.configurationDigest !== row.configuration_digest
    || priorConfig.runtimeProfile !== row.runtime_profile || row.execution_context?.agent?.contentDigest !== row.content_digest
    || row.execution_context?.project?.policyRevision !== row.project_policy_revision
    || row.execution_context?.workspace?.environmentCode !== row.environment_code || row.execution_context?.workspace?.workspaceMode !== row.workspace_mode) return 'SESSION_INCOMPATIBLE';
  if (row.runtime_code === 'OPENAI_CODEX_APP_SERVER' && (row.runtime_profile !== 'CODEX_READ_ONLY_PILOT' || row.profile_code !== 'CODEX_READ_ONLY_PILOT'
    || row.installation_enablement_source !== 'GOVERNED_CODEX_PILOT' || row.account_enablement_source !== 'GOVERNED_CODEX_PILOT' || row.profile_enablement_source !== 'GOVERNED_CODEX_PILOT')) return 'SESSION_INCOMPATIBLE';
  if (row.runtime_code === 'FAKE_PERSISTENT' && [row.installation_enablement_source, row.account_enablement_source, row.profile_enablement_source].some((source) => source !== 'INTERNAL_FAKE_FIXTURE')) return 'SESSION_INCOMPATIBLE';
  if (!row.provider_session_reference || (row.runtime_code === 'OPENAI_CODEX_APP_SERVER' && !row.provider_conversation_reference)
    || row.provider_operation_state !== 'COMPLETED' || row.outcome_certainty !== 'ACKNOWLEDGED') return 'SESSION_PROVIDER_CONVERSATION_UNAVAILABLE';
  return null;
}

function assertContinuationEligible(row) {
  const code = continuationBlockReason(row);
  if (code) throw failure(code === 'SESSION_RUNTIME_UNAVAILABLE' || code === 'SESSION_ACCOUNT_UNAVAILABLE' ? 503 : 409, code, 'This owned Session cannot currently accept continuation.', { retriable: ['SESSION_ALREADY_ACTIVE', 'SESSION_RUNTIME_UNAVAILABLE', 'SESSION_ACCOUNT_UNAVAILABLE'].includes(code), sessionId: row.session_id });
}

async function loadOwnedSession(client, sessionId, actor, { forUpdate = false } = {}) {
  const id = assertUuid(sessionId);
  // Lock only the durable conversation owner before re-reading latest Run/lease.
  if (forUpdate) {
    const locked = await client.query(`SELECT s.session_id FROM worker.agent_sessions s WHERE s.session_id = $1 AND ${VISIBLE} FOR UPDATE OF s`, [id, actor.adminAll, actor.userId]);
    if (!locked.rowCount) throw failure(404, 'SESSION_NOT_VISIBLE', 'The requested Session is not visible to this user.');
  }
  const result = await client.query(`${PROJECTION} WHERE s.session_id = $1 AND ${VISIBLE}`, [id, actor.adminAll, actor.userId]);
  if (!result.rowCount) throw failure(404, 'SESSION_NOT_VISIBLE', 'The requested Session is not visible to this user.');
  return result.rows[0];
}

function toSession(row) {
  let reason = continuationBlockReason(row);
  if (!reason) {
    try { require('./agentExecutionService').resolveSessionAuthority(row); }
    catch { reason = 'SESSION_AUTHORITY_REVOKED'; }
  }
  return {
    sessionId: row.session_id, projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name,
    agentDefinitionId: row.definition_id, definitionVersionId: row.definition_version_id, agentCode: row.agent_code, agentName: row.agent_name,
    agentRevision: row.agent_revision, revision: row.agent_revision, runtimeKind: row.runtime_code, installationId: row.installation_id,
    runtimeProfile: row.runtime_profile, capabilityProfileId: row.capability_profile_id, accountAlias: row.account_alias,
    initiatingUserId: row.initiating_user_id, initiatingUserName: row.initiating_user_name || (row.initiating_user_id ? null : 'Internal service'),
    sessionModel: row.session_model, status: row.archived_at ? 'ARCHIVED' : row.status, archivedAt: row.archived_at || null,
    createdAt: row.created_at, lastActivityAt: row.last_activity_at || row.latest_run_updated_at || row.updated_at,
    runCount: Number(row.run_count || 0), activeRunId: row.active_run_id || null, activeRunStatus: row.active_run_status || null,
    latestRunId: row.latest_run_id || null, latestRunStatus: row.latest_run_status || null,
    providerConversationAvailability: row.provider_session_reference && (row.provider_conversation_reference || row.runtime_code === 'FAKE_PERSISTENT') ? 'AVAILABLE' : 'UNAVAILABLE',
    continuationEligible: !reason, continuationBlockReason: reason,
    compatibility: { compatible: !reason, reason, freshnessStatus: row.freshness_status || 'UNKNOWN', adapterVersion: row.adapter_version || null, model: row.configuration?.model || null, reasoningEffort: row.configuration?.reasoningEffort || null },
    archiveSupported: true,
  };
}

function boundedInteger(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

async function withRuntimeReadiness(items) {
  if (!items.some((item) => item.runtimeKind === 'OPENAI_CODEX_APP_SERVER')) return items;
  let readiness;
  try { readiness = await require('./managedCodexBootstrapService').getBootstrapReadiness(); }
  catch { readiness = { ok: false, executionEnabled: false, readiness: 'RUNTIME_OFFLINE' }; }
  return items.map((item) => {
    if (item.runtimeKind !== 'OPENAI_CODEX_APP_SERVER') return item;
    const available = readiness.ok === true && readiness.executionEnabled === true;
    const reason = item.continuationBlockReason || (available ? null : 'SESSION_RUNTIME_UNAVAILABLE');
    return { ...item, continuationEligible: !reason, continuationBlockReason: reason,
      compatibility: { ...item.compatibility, compatible: !reason, reason, providerReadiness: readiness.readiness || 'UNKNOWN', runtimeGeneration: readiness.runtimeGeneration || null } };
  });
}

async function listAgentSessions(req, options = {}) {
  const actor = actorFromRequest(req);
  const limit = Math.max(1, boundedInteger(options.limit, 25, 100));
  const offset = boundedInteger(options.offset, 0, 100000);
  const projectId = options.projectId ? assertUuid(options.projectId, 'projectId') : null;
  const definitionId = options.definitionId ? assertUuid(options.definitionId, 'definitionId') : null;
  const initiatingUserId = options.initiatingUserId ? assertUuid(options.initiatingUserId, 'initiatingUserId') : null;
  if (initiatingUserId && !actor.adminAll && initiatingUserId !== actor.userId) throw failure(404, 'SESSION_NOT_VISIBLE', 'The requested Session owner is not visible to this user.');
  for (const key of ['activityFrom', 'activityTo']) if (options[key] && !Number.isFinite(Date.parse(options[key]))) throw failure(400, 'SESSION_FILTER_INVALID', `${key} must be a timestamp.`);
  const activity = 'GREATEST(s.updated_at, COALESCE(lr.updated_at, s.updated_at))';
  const sort = { lastActivityAt: activity, createdAt: 's.created_at', projectName: 'p.project_name' }[options.sort] || activity;
  const direction = String(options.sortDirection || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const filters = `WHERE ($1::uuid IS NULL OR s.project_id = $1) AND ${VISIBLE}
    AND ($4::uuid IS NULL OR lr.definition_id = $4) AND ($5::text IS NULL OR r.runtime_code = $5)
    AND ($6::text IS NULL OR CASE WHEN s.archived_at IS NOT NULL THEN 'ARCHIVED' ELSE s.status END = $6)
    AND ($7::uuid IS NULL OR s.initiating_user_id = $7)
    AND ($8::text = '' OR concat_ws(' ', s.session_id::text, p.project_name, p.project_code, d.agent_name, d.agent_code) ILIKE '%' || $8 || '%')
    AND ($9::timestamptz IS NULL OR ${activity} >= $9)
    AND ($10::timestamptz IS NULL OR ${activity} <= $10)`;
  const values = [projectId, actor.adminAll, actor.userId, definitionId, options.runtimeKind || null, options.status || null, initiatingUserId, String(options.q || '').trim().slice(0, 240), options.activityFrom || null, options.activityTo || null];
  // Bounded SQL pages are stable. Eligibility filtering is performed over a
  // bounded candidate set because it includes current policy interpretation.
  if (options.continuationEligible !== undefined && !['true', 'false', true, false].includes(options.continuationEligible)) throw failure(400, 'SESSION_FILTER_INVALID', 'continuationEligible must be true or false.');
  if (options.continuationEligible !== undefined) {
    const result = await query(`${PROJECTION} ${filters} ORDER BY ${sort} ${direction}, s.session_id LIMIT 1001`, values);
    if (result.rows.length > 1000) throw failure(422, 'SESSION_FILTER_WINDOW_TOO_LARGE', 'Narrow the Project, activity window, or search before filtering continuation eligibility.');
    const desired = String(options.continuationEligible) === 'true';
    const matches = (await withRuntimeReadiness(result.rows.map(toSession))).filter((session) => session.continuationEligible === desired);
    return { items: matches.slice(offset, offset + limit), page: { limit, offset, total: matches.length, hasMore: offset + limit < matches.length }, boundedCandidates: 1000 };
  }
  const result = await query(`${PROJECTION} ${filters} ORDER BY ${sort} ${direction}, s.session_id LIMIT $11 OFFSET $12`, [...values, limit, offset]);
  const count = await query(`SELECT COUNT(*)::int AS total FROM (${PROJECTION} ${filters}) visible_sessions`, values);
  const total = Number(count.rows[0]?.total || 0);
  return { items: await withRuntimeReadiness(result.rows.map(toSession)), page: { limit, offset, total, hasMore: offset + limit < total } };
}

async function getAgentSession(req, sessionId, options = {}) {
  const actor = actorFromRequest(req);
  const row = await loadOwnedSession({ query }, sessionId, actor);
  const limit = Math.max(1, boundedInteger(options.runLimit, 100, 100));
  const offset = boundedInteger(options.runOffset, 0, 100000);
  const timeline = await query(`SELECT ar.agent_run_id AS "runId", ar.session_id AS "sessionId", ar.status,
    ar.created_at AS "createdAt", ar.updated_at AS "updatedAt", ar.terminal_at AS "terminalAt",
    v.configuration->>'model' AS model, v.configuration->>'reasoningEffort' AS "reasoningEffort",
    res.result_status AS "resultStatus",
    (SELECT COUNT(*)::int FROM worker.agent_capability_effects ce WHERE ce.agent_run_id = ar.agent_run_id) AS "capabilityEffectCount",
    (SELECT COUNT(*)::int FROM worker.agent_capability_effects ce JOIN worker.browser_automation_artifacts ba ON ba.browser_automation_run_id = ce.browser_automation_run_id WHERE ce.agent_run_id = ar.agent_run_id) AS "artifactCount"
    FROM worker.agent_runs ar JOIN core.agent_definition_versions v USING (definition_version_id)
    LEFT JOIN worker.agent_results res USING (agent_run_id)
    WHERE ar.session_id = $1 ORDER BY ar.created_at, ar.agent_run_id LIMIT $2 OFFSET $3`, [row.session_id, limit, offset]);
  const [session] = await withRuntimeReadiness([toSession(row)]);
  return { ...session, runs: timeline.rows, runPage: { limit, offset, total: session.runCount, hasMore: offset + limit < session.runCount } };
}

async function continueAgentSession(req, sessionId, body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw failure(400, 'SESSION_INPUT_INVALID', 'A continuation request is required.');
  for (const key of Object.keys(body)) if (!CONTINUATION_KEYS.has(key)) throw failure(400, 'AGENT_INPUT_NOT_ALLOWED', `body.${key} is not an accepted Session continuation input.`);
  try { return await require('./agentExecutionService').admitAgentRun(req, body, { sessionId: assertUuid(sessionId) }); }
  catch (error) {
    const mapped = error.code === 'AGENT_RUNTIME_WORKER_UNAVAILABLE' || error.code === 'AGENT_CODEX_RUNTIME_NOT_READY' ? 'SESSION_RUNTIME_UNAVAILABLE'
      : error.code === 'AGENT_ACCOUNT_NOT_EXECUTION_READY' ? 'SESSION_ACCOUNT_UNAVAILABLE'
        : ['AGENT_SELECTION_NOT_ALLOWED', 'AGENT_PROJECT_NOT_FOUND', 'AGENT_AUTHORITY_DENIED'].includes(error.code) ? 'SESSION_AUTHORITY_REVOKED' : null;
    if (!mapped) throw error;
    throw failure(mapped === 'SESSION_AUTHORITY_REVOKED' ? 409 : 503, mapped, 'Current Session authority or runtime readiness prevents continuation.', { retriable: mapped !== 'SESSION_AUTHORITY_REVOKED' });
  }
}

async function archiveAgentSession(req, sessionId) {
  const actor = actorFromRequest(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await loadOwnedSession(client, sessionId, actor, { forUpdate: true });
    await client.query(`UPDATE worker.agent_sessions SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE session_id = $1`, [row.session_id]);
    const archived = await loadOwnedSession(client, sessionId, actor);
    await client.query('COMMIT');
    return { archived: true, replayed: Boolean(row.archived_at), session: toSession(archived) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { actorFromRequest, assertContinuationEligible, continuationBlockReason, loadOwnedSession, toSession, listAgentSessions, getAgentSession, continueAgentSession, archiveAgentSession };
