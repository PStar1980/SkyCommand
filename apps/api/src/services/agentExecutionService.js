const { randomUUID } = require('node:crypto');
const { Connection, Client } = require('@temporalio/client');

const { pool, query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const agentRegistryService = require('./agentRegistryService');
const {
  evaluateAuthority,
  intersectConstraints,
  intersectExecutionSurfacePolicies,
  intersectScopes,
  normalizeConstraints,
  normalizeScope,
} = require('../../../../packages/agents/src/authority');
const { normalizeRuntimeConfigurationIdentity } = require('../../../../packages/agents/src/runtimeConfiguration');
const { buildExecutionContext } = require('../../../../packages/agents/src/executionContext');
const { sha256Digest } = require('../../../../packages/agents/src/canonical');
const { resolveFakeRuntimeCase } = require('../../../../packages/agents/src/fakeRuntime');
const { getAgentRuntimeTaskQueue } = require('../../../../packages/agents/src/runtimeWorker');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const { dispatchAgentRun } = require('./agentRunDispatcher');
const { normalizeRuntimeIdentity, projectRuntimeIdentity } = require('./agentRuntimeProjection');

const MAX_INSTRUCTION_LENGTH = 20000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MIN_DEADLINE_MS = 1000;
const MAX_DEADLINE_MS = 15 * 60 * 1000;
const ADMIN_ROLE_CODES = new Set(['SUPER_ADMIN', 'ADMIN_ALL']);
const ALLOWED_PUBLIC_KEYS = new Set([
  'projectId',
  'definitionId',
  'definitionVersionId',
  'projectWorkspaceId',
  'instruction',
  'requestedScope',
  'requestedExecutionSurfaces',
  'constraints',
  'deadlineMs',
  'idempotencyKey',
  'fakeRuntimeCaseId',
]);
const FORBIDDEN_INPUT_KEYS = /(?:user|principal|actor|permission|grant|credential|secret|token|password|root|parent|delegat|provider|temporal|workflow|filesystem|path|environmentAuthority)/i;

class AgentExecutionServiceError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = 'AgentExecutionServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertUuid(value, fieldName) {
  const normalized = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AgentExecutionServiceError(400, 'AGENT_ID_INVALID', `${fieldName} must be a valid registered identifier.`);
  }
  return normalized;
}

function assertPlainObject(value, fieldName) {
  if (!isPlainObject(value)) throw new AgentExecutionServiceError(400, 'AGENT_OBJECT_INVALID', `${fieldName} must be an object.`);
  return value;
}

function scanForbiddenKeys(value, path = 'body') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_INPUT_KEYS.test(key)) {
      throw new AgentExecutionServiceError(400, 'AGENT_INPUT_NOT_ALLOWED', `${path}.${key} is not an accepted Agent Run input.`);
    }
    scanForbiddenKeys(nested, `${path}.${key}`);
  });
}

function sanitizeJson(value, fieldName, maxLength = 30000) {
  assertPlainObject(value, fieldName);
  const serialized = JSON.stringify(value);
  if (serialized.length > maxLength) throw new AgentExecutionServiceError(400, 'AGENT_JSON_TOO_LARGE', `${fieldName} exceeds the supported size.`);
  return JSON.parse(serialized);
}

function normalizeDeadline(value) {
  if (value === undefined || value === null || value === '') return 5 * 60 * 1000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_DEADLINE_MS || parsed > MAX_DEADLINE_MS) {
    throw new AgentExecutionServiceError(422, 'AGENT_DEADLINE_INVALID', `deadlineMs must be between ${MIN_DEADLINE_MS} and ${MAX_DEADLINE_MS}.`);
  }
  return parsed;
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function actorFromRequest(req) {
  const internal = req?.session?.authMode === 'INTERNAL_SERVICE_TOKEN';
  const userId = req?.user?.userId || null;
  if (!userId && !internal) throw new AgentExecutionServiceError(401, 'AGENT_AUTHENTICATION_REQUIRED', 'An authenticated user or authorized internal principal is required.');
  const roleCodes = new Set((req?.user?.roleCodes || []).map((role) => String(role).toUpperCase()));
  return {
    internal,
    userId,
    displayName: req?.user?.displayName || req?.user?.username || (internal ? 'SkyCommand Internal Service' : null),
    adminAll: internal || [...roleCodes].some((role) => ADMIN_ROLE_CODES.has(role)),
  };
}

function requestContext(req) {
  return {
    requestId: text(req?.id || req?.headers?.['x-request-id'], `agent-run-request-${randomUUID()}`),
    traceId: text(req?.headers?.['x-trace-id'], `agent-run-trace-${randomUUID()}`),
  };
}

function normalizePublicRequest(req, body = {}) {
  assertPlainObject(body, 'body');
  scanForbiddenKeys(body);
  for (const key of Object.keys(body)) {
    if (!ALLOWED_PUBLIC_KEYS.has(key)) throw new AgentExecutionServiceError(400, 'AGENT_INPUT_NOT_ALLOWED', `body.${key} is not an accepted Agent Run input.`);
  }
  const projectId = assertUuid(body.projectId, 'projectId');
  const definitionId = assertUuid(body.definitionId, 'definitionId');
  const definitionVersionId = body.definitionVersionId ? assertUuid(body.definitionVersionId, 'definitionVersionId') : null;
  const projectWorkspaceId = body.projectWorkspaceId ? assertUuid(body.projectWorkspaceId, 'projectWorkspaceId') : null;
  const instruction = text(body.instruction);
  if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) throw new AgentExecutionServiceError(400, 'AGENT_INSTRUCTION_INVALID', `instruction is required and must be no longer than ${MAX_INSTRUCTION_LENGTH} characters.`);
  const idempotencyKey = text(req?.headers?.['idempotency-key'] || body.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 200) throw new AgentExecutionServiceError(400, 'AGENT_IDEMPOTENCY_KEY_REQUIRED', 'A bounded Idempotency-Key is required for Agent Run admission.');
  return {
    projectId,
    definitionId,
    definitionVersionId,
    projectWorkspaceId,
    instruction,
    requestedScope: sanitizeJson(body.requestedScope || {}, 'requestedScope'),
    requestedExecutionSurfaces: sanitizeJson(body.requestedExecutionSurfaces || { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW', reason: 'Bounded internal fake runtime admission.' }] }, 'requestedExecutionSurfaces'),
    constraints: sanitizeJson(body.constraints || {}, 'constraints'),
    deadlineMs: normalizeDeadline(body.deadlineMs),
    fakeRuntimeCaseId: body.fakeRuntimeCaseId ? text(body.fakeRuntimeCaseId) : null,
    idempotencyKey,
  };
}

function policyFrom(value) {
  const policy = isPlainObject(value) ? value : {};
  return {
    scope: normalizeScope(policy.scope || {}),
    executionSurfaces: policy.executionSurfaces || policy.surfaces || {},
    constraints: normalizeConstraints(policy.constraints || {}),
  };
}

function permissionCodes(req) {
  return new Set((req?.permissions || []).map((permission) => permission.permissionCode));
}

async function hasPermission(req, permissionCode) {
  if (permissionCodes(req).has(permissionCode)) return true;
  const actor = actorFromRequest(req);
  if (!actor.userId) return false;
  return authService.hasPermission(actor.userId, permissionCode, req.session?.appCode);
}

async function ensurePrincipal(client, actor) {
  if (actor.userId) {
    const existing = await client.query(`SELECT execution_principal_id, principal_code FROM auth.execution_principals WHERE user_id = $1 AND principal_type = 'USER' AND status = 'ACTIVE' LIMIT 1`, [actor.userId]);
    if (existing.rowCount > 0) return existing.rows[0];
    const principalCode = `user:${actor.userId}`;
    await client.query(
      `INSERT INTO auth.execution_principals (principal_type, user_id, principal_code, created_by, updated_by)
       VALUES ('USER', $1, $2, $1, $1)
       ON CONFLICT (principal_code) DO UPDATE SET status = 'ACTIVE', user_id = EXCLUDED.user_id, updated_by = EXCLUDED.updated_by`,
      [actor.userId, principalCode],
    );
    return (await client.query(`SELECT execution_principal_id, principal_code FROM auth.execution_principals WHERE principal_code = $1`, [principalCode])).rows[0];
  }
  await client.query(
    `INSERT INTO auth.execution_principals (principal_type, principal_code, metadata)
     VALUES ('SERVICE', 'internal:agent-run', $1::jsonb)
     ON CONFLICT (principal_code) DO UPDATE SET status = 'ACTIVE', metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify({ internalTestSurface: true, phase: '19.2A' })],
  );
  return (await client.query(`SELECT execution_principal_id, principal_code FROM auth.execution_principals WHERE principal_code = 'internal:agent-run'`)).rows[0];
}

async function assertProjectAccess(client, projectId, actor, rightCode = 'PROJECT_READ') {
  const projectResult = await client.query(`SELECT * FROM core.projects WHERE project_id = $1 AND active = TRUE`, [projectId]);
  if (projectResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_PROJECT_NOT_FOUND', 'The requested Agent Project is not visible to this user.');
  if (actor.adminAll) return projectResult.rows[0];
  const access = await client.query(
    `SELECT 1
       FROM core.project_members pm
       JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.active = TRUE AND pr.right_code = $3
      WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.membership_state = 'ACTIVE'
      LIMIT 1`,
    [projectId, actor.userId, rightCode],
  );
  if (access.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_PROJECT_NOT_FOUND', 'The requested Agent Project is not visible to this user.');
  return projectResult.rows[0];
}

async function resolveWorkspace(client, request, project) {
  const workspaces = await client.query(
    `SELECT pw.*, rp.profile_id, cp.profile_code
       FROM core.project_workspaces pw
       JOIN core.repository_paths rp ON rp.repo_path_id = pw.repo_path_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
      WHERE pw.project_id = $1 AND pw.active = TRUE AND rp.active = TRUE AND cp.active = TRUE
      ORDER BY pw.created_at, pw.project_workspace_id`,
    [project.project_id],
  );
  const selected = request.projectWorkspaceId
    ? workspaces.rows.find((row) => row.project_workspace_id === request.projectWorkspaceId)
    : workspaces.rows.length === 1 ? workspaces.rows[0] : null;
  if (!selected) {
    throw new AgentExecutionServiceError(request.projectWorkspaceId ? 404 : 422, request.projectWorkspaceId ? 'AGENT_WORKSPACE_NOT_FOUND' : 'AGENT_WORKSPACE_REQUIRED', request.projectWorkspaceId ? 'The registered workspace is not visible to this Project.' : 'A Project with multiple registered workspaces requires an explicit projectWorkspaceId.');
  }
  if (['PRODUCTION', 'PROD'].includes(String(selected.environment_code || '').toUpperCase())) throw new AgentExecutionServiceError(422, 'AGENT_PRODUCTION_ENVIRONMENT_DENIED', 'Agent Run admission is limited to non-production environments.');
  return selected;
}

async function resolveAgentSelection(client, request, project, workspace) {
  const result = await client.query(
    `SELECT d.*, v.definition_version_id, v.revision, v.content_digest,
            v.installation_id, v.account_binding_id, v.capability_profile_id,
            v.configuration, v.policy_revision AS version_policy_revision,
            i.installation_code, i.adapter_version, i.runtime_profile,
            i.certification_state, i.enabled AS installation_enabled,
            i.execution_enabled AS installation_execution_enabled,
            i.execution_enablement_source AS installation_enablement_source,
            i.reviewed_source_revision, i.configuration_revision,
            i.configuration_digest, i.process_generation, i.service_generation,
            i.process_started_at, i.observed_at, i.freshness_status,
            i.capability_manifest,
            r.runtime_code, r.runtime_name,
            a.account_code, a.account_state, a.account_policy,
            a.execution_enabled AS account_execution_enabled,
            a.execution_enablement_source AS account_enablement_source,
            cp.profile_code, cp.policy AS capability_policy,
            cp.execution_enabled AS profile_execution_enabled,
            cp.execution_enablement_source AS profile_enablement_source,
            par.allow_state
       FROM core.agent_definitions d
       JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
       JOIN core.agent_runtime_installations i ON i.installation_id = v.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN core.agent_runtime_accounts a ON a.account_binding_id = v.account_binding_id
       JOIN core.agent_capability_profiles cp ON cp.capability_profile_id = v.capability_profile_id
       JOIN core.project_agent_allow_rules par
         ON par.project_id = $1
        AND par.definition_id = d.definition_id
        AND par.allow_state = 'ACTIVE'
        AND (par.definition_version_id IS NULL OR par.definition_version_id = v.definition_version_id)
      WHERE d.definition_id = $2
        AND d.active = TRUE
        AND d.lifecycle_state = 'ACTIVE'
        AND ($3::uuid IS NULL OR v.definition_version_id = $3::uuid)
      ORDER BY v.revision DESC
      LIMIT 1`,
    [project.project_id, request.definitionId, request.definitionVersionId],
  );
  if (result.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_SELECTION_NOT_ALLOWED', 'The selected immutable Agent version is not allowed for this Project.');
  const selected = result.rows[0];
  if (selected.project_id && selected.project_id !== project.project_id) throw new AgentExecutionServiceError(404, 'AGENT_SELECTION_NOT_ALLOWED', 'The selected Agent is not allowed for this Project.');
  return selected;
}

function assertFakeRuntimeEligibility(selected) {
  if (!['FAKE_PERSISTENT', 'FAKE_EPHEMERAL'].includes(selected.runtime_code)) throw new AgentExecutionServiceError(422, 'AGENT_REAL_RUNTIME_DISABLED', 'Only source-controlled internal fake runtimes are executable in Phase 19.2A.');
  if (selected.installation_enabled !== true || selected.certification_state !== 'CERTIFIED' || selected.installation_execution_enabled !== true || selected.installation_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_NOT_EXECUTION_READY', 'The fake runtime installation is not certified, enabled, fresh, and source-controlled for execution.');
  if (selected.freshness_status !== 'CURRENT') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_STALE', 'The fake runtime installation freshness is not CURRENT.');
  if (selected.account_state !== 'CONFIGURED' || selected.account_execution_enabled !== true || selected.account_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_ACCOUNT_NOT_EXECUTION_READY', 'The fake runtime account is not configured and execution-enabled by the internal fixture.');
  if (selected.profile_execution_enabled !== true || selected.profile_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_PROFILE_NOT_EXECUTION_READY', 'The fake runtime capability profile is not enabled by the internal fixture.');
}

function buildAuthority({ request, project, workspace, selected, runtimeConfiguration }) {
  const projectPolicy = policyFrom(project.authority_policy);
  const workspacePolicy = policyFrom(workspace.workspace_policy);
  const definitionPolicy = policyFrom(selected.configuration);
  const capabilityPolicy = policyFrom(selected.capability_policy);
  const runtimePolicy = policyFrom(selected.capability_manifest);
  const accountPolicy = policyFrom(selected.account_policy);
  const configuredScope = intersectScopes([projectPolicy.scope, workspacePolicy.scope, definitionPolicy.scope]);
  const grantedScope = intersectScopes([capabilityPolicy.scope, runtimePolicy.scope, accountPolicy.scope]);
  const configuredSurfaces = intersectExecutionSurfacePolicies({
    requested: projectPolicy.executionSurfaces,
    configured: workspacePolicy.executionSurfaces,
    granted: definitionPolicy.executionSurfaces,
    policyRevision: project.policy_revision,
  }).granted;
  const grantedSurfaces = intersectExecutionSurfacePolicies({
    requested: capabilityPolicy.executionSurfaces,
    configured: runtimePolicy.executionSurfaces,
    granted: accountPolicy.executionSurfaces,
    policyRevision: project.policy_revision,
  }).granted;
  const authority = evaluateAuthority({
    snapshotId: `authority-${randomUUID()}`,
    authorityKind: 'RUNTIME_COMPATIBLE',
    policyRevision: project.policy_revision || 'agent-policy.v1',
    sourcePolicyRevision: selected.version_policy_revision || null,
    requested: request.requestedScope,
    configured: configuredScope,
    granted: grantedScope,
    requestedSurfaces: request.requestedExecutionSurfaces,
    configuredSurfaces,
    grantedSurfaces,
    requestedConstraints: request.constraints,
    configuredConstraints: intersectConstraints([projectPolicy.constraints, workspacePolicy.constraints, definitionPolicy.constraints]),
    grantedConstraints: intersectConstraints([capabilityPolicy.constraints, runtimePolicy.constraints, accountPolicy.constraints]),
    obligations: ['REGISTERED_WORKSPACE_ONLY', 'INTERNAL_FAKE_RUNTIME_ONLY', 'NO_AGENT_CAPABILITY_EFFECTS', 'NO_PROVIDER_CREDENTIALS'],
    runtimeConfiguration,
  });
  const requestedSurfaceModes = new Map(authority.executionSurfaces.requested.surfaces.map((entry) => [entry.surface, entry.mode]));
  const deniedRequestedSurface = authority.executionSurfaces.granted.surfaces.find((entry) => entry.mode === 'DENY' && requestedSurfaceModes.get(entry.surface) !== 'DENY');
  const relevantDenials = authority.denials.filter((denial) => denial.dimension !== 'executionSurface' || requestedSurfaceModes.get(denial.value) !== 'DENY');
  if (deniedRequestedSurface || relevantDenials.length > 0) throw new AgentExecutionServiceError(422, 'AGENT_AUTHORITY_DENIED', 'The requested fake Agent Run is denied by the pinned Project, workspace, Agent, runtime, or account authority.', { denials: relevantDenials, deniedSurface: deniedRequestedSurface?.surface || null });
  return authority;
}

async function getRuntimeWorkerReadiness() {
  const config = getTemporalConfig();
  let connection;
  try {
    connection = await Connection.connect({ address: config.address });
    const response = await connection.workflowService.describeTaskQueue({
      namespace: config.namespace,
      taskQueue: { name: getAgentRuntimeTaskQueue(), kind: 1 },
      taskQueueType: 2,
      includeTaskQueueStatus: true,
    });
    const pollers = Array.isArray(response?.pollers) ? response.pollers : [];
    if (pollers.length === 0) throw new AgentExecutionServiceError(503, 'AGENT_RUNTIME_WORKER_UNAVAILABLE', 'The dedicated Agent Runtime Worker is not polling its task queue.');
    return {
      ready: true,
      taskQueue: getAgentRuntimeTaskQueue(),
      namespace: config.namespace,
      workerIdentity: pollers[0]?.identity || pollers[0]?.workerIdentity || null,
      pollerCount: pollers.length,
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof AgentExecutionServiceError) throw error;
    throw new AgentExecutionServiceError(503, 'AGENT_RUNTIME_WORKER_UNAVAILABLE', 'The dedicated Agent Runtime Worker readiness could not be verified.', { reason: error?.code || error?.message || 'TEMPORAL_UNAVAILABLE' });
  } finally {
    await connection?.close?.();
  }
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendEvent(client, { runId, sessionId, executionScopeId, eventType, payload = {}, sourceCursor }) {
  const next = await client.query('SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM worker.agent_events WHERE agent_run_id = $1', [runId]);
  return client.query(
    `INSERT INTO worker.agent_events (
       agent_run_id, session_id, execution_scope_id, event_sequence,
       event_type, event_scope, source_kind, source_instance, source_cursor,
       availability, freshness, observed_at, payload
     ) VALUES ($1, $2, $3, $4, $5, 'RUN', 'SKYCOMMAND_AGENT_EXECUTION_SERVICE', 'api', $6, 'REPORTED', 'CURRENT', CURRENT_TIMESTAMP, $7::jsonb)
     ON CONFLICT (agent_run_id, source_kind, source_instance, source_cursor) DO NOTHING`,
    [runId, sessionId, executionScopeId, Number(next.rows[0].next_sequence), eventType, sourceCursor, JSON.stringify(payload)],
  );
}

async function findExistingAdmission({ callerScopeKey, idempotencyKey, submittedIntentDigest }) {
  const result = await query(
    `SELECT admission_request_id, agent_run_id, submitted_intent_digest, resolved_spec_digest, created_at
       FROM worker.agent_admission_requests
      WHERE caller_scope_key = $1 AND idempotency_key = $2`,
    [callerScopeKey, idempotencyKey],
  );
  if (result.rowCount === 0) return null;
  const existing = result.rows[0];
  if (existing.submitted_intent_digest !== submittedIntentDigest) throw new AgentExecutionServiceError(409, 'AGENT_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different submitted content.', { agentRunId: existing.agent_run_id, admissionRequestId: existing.admission_request_id });
  return existing;
}

function toRunSummary(row) {
  return {
    runId: row.agent_run_id,
    rootExecutionId: row.execution_scope_id,
    sessionId: row.session_id,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    agentDefinitionId: row.definition_id,
    agentCode: row.agent_code,
    agentRevision: row.agent_revision,
    definitionVersionId: row.definition_version_id,
    workspaceBindingId: row.project_workspace_id,
    environmentCode: row.environment_code,
    runtimeKind: projectRuntimeIdentity(row),
    installationId: row.installation_id,
    accountBindingId: row.account_binding_id,
    capabilityProfileId: row.capability_profile_id,
    fakeRuntimeCaseId: row.fake_runtime_case_id,
    initiatingUserId: row.initiating_user_id,
    initiatingActor: row.initiating_actor_snapshot,
    requestingActor: { kind: row.requesting_actor_kind, id: row.requesting_actor_id },
    triggerSource: row.trigger_source,
    status: row.status,
    outcome: row.outcome,
    stopState: row.stop_state,
    revocationEpoch: row.revocation_epoch,
    stableTemporalWorkflowId: row.stable_temporal_workflow_id,
    authoritySnapshot: row.authority_snapshot || null,
    runtimeCell: row.runtime_cell || null,
    resultStatus: row.result_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at,
  };
}

async function getRunRow(runId, actor, { includeEvidence = false } = {}) {
  const result = await query(
    `SELECT ar.*, r.runtime_code,
            p.project_code, p.project_name,
            d.agent_code, v.revision AS agent_revision,
            pw.environment_code,
            jsonb_build_object('authoritySnapshotId', a.authority_snapshot_id, 'digest', a.digest, 'snapshot', a.snapshot) AS authority_snapshot,
            CASE WHEN rc.runtime_cell_id IS NULL THEN NULL ELSE jsonb_build_object('runtimeCellId', rc.runtime_cell_id, 'runtimeKind', rc.runtime_kind, 'adapterVersion', rc.adapter_version, 'taskQueue', rc.task_queue, 'workerIdentity', rc.worker_identity, 'workerGeneration', rc.worker_generation, 'readinessStatus', rc.readiness_status, 'observedAt', rc.observed_at, 'heartbeatAt', rc.heartbeat_at, 'containmentProfile', rc.containment_profile) END AS runtime_cell,
            res.result_status,
            res.result AS terminal_result
       FROM worker.agent_runs ar
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN core.projects p ON p.project_id = ar.project_id
       JOIN core.agent_definitions d ON d.definition_id = ar.definition_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
       JOIN core.project_workspaces pw ON pw.project_workspace_id = ar.project_workspace_id
       LEFT JOIN worker.agent_authority_snapshots a ON a.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_runtime_cells rc ON rc.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_results res ON res.agent_run_id = ar.agent_run_id
      WHERE ar.agent_run_id = $1
        AND ($2::boolean = TRUE OR $3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM core.project_members pm
          JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.active = TRUE AND pr.right_code = 'PROJECT_READ'
          WHERE pm.project_id = ar.project_id AND pm.user_id = $3 AND pm.membership_state = 'ACTIVE'
        ))`,
    [runId, actor.adminAll, actor.userId],
  );
  if (result.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_RUN_NOT_FOUND', 'The requested Agent Run is not visible to this user.');
  const row = result.rows[0];
  const summary = toRunSummary(row);
  if (!includeEvidence) return summary;
  const [events, operations, resultRow] = await Promise.all([
    query(`SELECT agent_event_id AS "eventId", event_sequence AS "sequence", event_type AS "eventType", event_scope AS "scope", source_kind AS "sourceKind", source_instance AS "sourceInstance", source_cursor AS "sourceCursor", availability, freshness, observed_at AS "observedAt", payload FROM worker.agent_events WHERE agent_run_id = $1 ORDER BY event_sequence`, [runId]),
    query(`SELECT provider_operation_id AS "operationId", operation_key AS "operationKey", operation_type AS "operationType", provider_operation_reference AS "providerOperationReference", input_digest AS "inputDigest", fence_epoch AS "fenceEpoch", state, outcome_certainty AS "outcomeCertainty", outcome, created_at AS "createdAt", updated_at AS "updatedAt" FROM worker.agent_provider_operations WHERE agent_run_id = $1 ORDER BY created_at`, [runId]),
    query(`SELECT agent_result_id AS "resultId", result_status AS "resultStatus", result_digest AS "resultDigest", result, published_at AS "publishedAt" FROM worker.agent_results WHERE agent_run_id = $1`, [runId]),
  ]);
  return { ...summary, executionContext: row.execution_context, authoritySnapshot: row.authority_snapshot, events: events.rows, providerOperations: operations.rows, result: resultRow.rows[0] || null };
}

async function admitAgentRun(req, body = {}) {
  const actor = actorFromRequest(req);
  const request = normalizePublicRequest(req, body);
  const submittedIntent = {
    projectId: request.projectId,
    definitionId: request.definitionId,
    definitionVersionId: request.definitionVersionId,
    projectWorkspaceId: request.projectWorkspaceId,
    instruction: request.instruction,
    requestedScope: request.requestedScope,
    requestedExecutionSurfaces: request.requestedExecutionSurfaces,
    constraints: request.constraints,
    deadlineMs: request.deadlineMs,
    fakeRuntimeCaseId: request.fakeRuntimeCaseId,
  };
  const submittedIntentDigest = sha256Digest(submittedIntent);
  const callerScopeKey = `${actor.internal ? 'internal' : actor.userId}:AGENT_RUN`;

  const existing = await findExistingAdmission({ callerScopeKey, idempotencyKey: request.idempotencyKey, submittedIntentDigest });
  if (existing) {
    return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: existing.admission_request_id, run: await getRunRow(existing.agent_run_id, actor), dispatch: { durable: true, replay: true } };
  }

  const runtimeReadiness = await getRuntimeWorkerReadiness();
  const requestId = requestContext(req);
  const admissionRequestId = randomUUID();
  const rootExecutionId = randomUUID();
  const sessionId = randomUUID();
  const agentRunId = randomUUID();
  const stableWorkflowId = `agent-run/${agentRunId}`;
  const deadlineAt = new Date(Date.now() + request.deadlineMs).toISOString();

  let accepted;
  try {
    accepted = await withTransaction(async (client) => {
      const duplicate = await client.query(`SELECT admission_request_id, agent_run_id, submitted_intent_digest, resolved_spec_digest FROM worker.agent_admission_requests WHERE caller_scope_key = $1 AND idempotency_key = $2 FOR UPDATE`, [callerScopeKey, request.idempotencyKey]);
      if (duplicate.rowCount > 0) {
        if (duplicate.rows[0].submitted_intent_digest !== submittedIntentDigest) throw new AgentExecutionServiceError(409, 'AGENT_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different submitted content.', { agentRunId: duplicate.rows[0].agent_run_id });
        return { replayed: true, admissionRequestId: duplicate.rows[0].admission_request_id, agentRunId: duplicate.rows[0].agent_run_id };
      }

      const principal = await ensurePrincipal(client, actor);
      const project = await assertProjectAccess(client, request.projectId, actor, 'PROJECT_READ');
      const workspace = await resolveWorkspace(client, request, project);
      const selected = await resolveAgentSelection(client, request, project, workspace);
      assertFakeRuntimeEligibility(selected);
      const runtimeCaseId = request.fakeRuntimeCaseId || selected.configuration?.runtimeCaseId || (selected.runtime_code === 'FAKE_PERSISTENT' ? 'persistent-delayed-usage' : 'ephemeral-absent-usage');
      const fakeCase = resolveFakeRuntimeCase(runtimeCaseId, selected.runtime_code);
      const runtimeConfiguration = normalizeRuntimeConfigurationIdentity({
        runtimeInstallationId: selected.installation_id,
        reviewedSourceRevision: selected.reviewed_source_revision,
        configurationRevision: selected.configuration_revision,
        configurationDigest: selected.configuration_digest,
        capabilityManifestRevision: 'phase19.2a',
        capabilityManifestDigest: sha256Digest(selected.capability_manifest || {}),
        runtimeProfile: selected.runtime_profile,
        processGeneration: runtimeReadiness.workerIdentity,
        serviceGeneration: runtimeReadiness.workerIdentity,
        processStartedAt: selected.process_started_at,
        observedAt: runtimeReadiness.observedAt,
        freshnessStatus: selected.freshness_status,
        evidence: { taskQueue: runtimeReadiness.taskQueue, pollerCount: runtimeReadiness.pollerCount, sourceControlledFixture: true },
      });
      const authority = buildAuthority({ request, project, workspace, selected, runtimeConfiguration });
      const resolvedSpec = {
        projectId: project.project_id,
        definitionId: selected.definition_id,
        definitionVersionId: selected.definition_version_id,
        definitionRevision: selected.revision,
        projectWorkspaceId: workspace.project_workspace_id,
        environmentCode: workspace.environment_code,
        runtimeKind: selected.runtime_code,
        installationId: selected.installation_id,
        accountBindingId: selected.account_binding_id,
        capabilityProfileId: selected.capability_profile_id,
        fakeRuntimeCaseId: fakeCase.caseId,
        deadlineAt,
        authorityDigest: authority.digest,
        runtimeConfiguration,
        workflowId: stableWorkflowId,
      };
      const resolvedSpecDigest = sha256Digest(resolvedSpec);
      const initiatingActor = { kind: actor.internal ? 'INTERNAL_SERVICE' : 'USER', id: principal.principal_code, displayNameSnapshot: actor.displayName };
      const executionContext = buildExecutionContext({
        contextId: `execution-context-${agentRunId}`,
        request: requestId,
        initiatingUser: { userId: actor.userId, principalId: principal.execution_principal_id, displayNameSnapshot: actor.displayName },
        initiatingActor,
        requestingActor: initiatingActor,
        project: { projectId: project.project_id, projectCode: project.project_code, policyRevision: project.policy_revision },
        agent: { definitionId: selected.definition_id, versionId: selected.definition_version_id, revision: selected.revision, contentDigest: selected.content_digest },
        workspace: { projectWorkspaceId: workspace.project_workspace_id, environmentCode: workspace.environment_code, workspaceMode: workspace.workspace_mode },
        rootExecutionId,
        sessionId,
        runId: agentRunId,
        triggerSource: 'MANUAL',
        authoritySnapshot: { snapshotId: authority.snapshotId, digest: authority.digest },
        executionSurfacePolicy: authority.executionSurfaces,
        runtime: { runtimeKind: selected.runtime_code, installationId: selected.installation_id, accountBindingId: selected.account_binding_id, capabilityProfileId: selected.capability_profile_id, configurationRevision: runtimeConfiguration.configurationRevision, configurationDigest: runtimeConfiguration.configurationDigest, workerTaskQueue: runtimeReadiness.taskQueue, workerGeneration: runtimeReadiness.workerIdentity },
        environmentProfile: { environmentCode: workspace.environment_code, profileCode: workspace.profile_code },
        admission: { admissionRequestId, submittedIntentDigest, resolvedSpecDigest },
      });

      await client.query(
        `INSERT INTO worker.execution_scopes (execution_scope_id, project_id, initiating_user_id, initiating_principal_id, initiating_actor_kind, initiating_actor_id, initiating_actor_snapshot, requesting_actor_kind, requesting_actor_id, requesting_actor_snapshot, trigger_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $5, $6, $7::jsonb, 'MANUAL')`,
        [rootExecutionId, project.project_id, actor.userId, principal.execution_principal_id, initiatingActor.kind, initiatingActor.id, JSON.stringify(initiatingActor)],
      );
      await client.query(
        `INSERT INTO worker.agent_sessions (session_id, execution_scope_id, project_id, initiating_user_id, session_model, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [sessionId, rootExecutionId, project.project_id, actor.userId, fakeCase.sessionModel],
      );
      await client.query(
        `INSERT INTO worker.agent_runs (
           agent_run_id, execution_scope_id, session_id, project_id, definition_id,
           definition_version_id, project_workspace_id, installation_id,
           account_binding_id, capability_profile_id, initiating_user_id,
           initiating_principal_id, initiating_actor_kind, initiating_actor_id,
           initiating_actor_snapshot, requesting_actor_kind, requesting_actor_id,
           trigger_source, instruction, fake_runtime_case_id, requested_authority,
           execution_context, submitted_intent_digest, resolved_spec_digest,
           stable_temporal_workflow_id, status, revocation_epoch
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $13, $14, 'MANUAL', $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22, 'ADMITTED', 0)`,
        [agentRunId, rootExecutionId, sessionId, project.project_id, selected.definition_id, selected.definition_version_id, workspace.project_workspace_id, selected.installation_id, selected.account_binding_id, selected.capability_profile_id, actor.userId, principal.execution_principal_id, initiatingActor.kind, initiatingActor.id, JSON.stringify(initiatingActor), request.instruction, fakeCase.caseId, JSON.stringify({ requested: request.requestedScope, surfaces: request.requestedExecutionSurfaces, constraints: request.constraints }), JSON.stringify(executionContext), submittedIntentDigest, resolvedSpecDigest, stableWorkflowId],
      );
      const authoritySnapshotResult = await client.query(
        `INSERT INTO worker.agent_authority_snapshots (agent_run_id, execution_scope_id, digest, snapshot) VALUES ($1, $2, $3, $4::jsonb) RETURNING authority_snapshot_id`,
        [agentRunId, rootExecutionId, authority.digest, JSON.stringify(authority)],
      );
      await client.query(
        `INSERT INTO auth.execution_grants (execution_scope_id, agent_run_id, principal_id, grant_kind, authority_snapshot_id, revocation_epoch, grant_state)
         VALUES ($1, $2, $3, 'ROOT_RUN', $4, 0, 'ACTIVE')`,
        [rootExecutionId, agentRunId, principal.execution_principal_id, authoritySnapshotResult.rows[0].authority_snapshot_id],
      );
      await client.query(
        `INSERT INTO worker.agent_resource_leases (session_id, agent_run_id, lease_kind, fence_epoch, lease_state) VALUES ($1, $2, 'SESSION_RUN', 0, 'ACTIVE')`,
        [sessionId, agentRunId],
      );
      await client.query(
        `INSERT INTO worker.agent_admission_requests (admission_request_id, caller_scope_key, idempotency_key, submitted_intent_digest, resolved_spec_digest, submitted_intent, resolved_spec, project_id, initiating_user_id, initiating_principal_id, trigger_source, agent_run_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, 'MANUAL', $11)`,
        [admissionRequestId, callerScopeKey, request.idempotencyKey, submittedIntentDigest, resolvedSpecDigest, JSON.stringify(submittedIntent), JSON.stringify(resolvedSpec), project.project_id, actor.userId, principal.execution_principal_id, agentRunId],
      );
      await client.query(
        `INSERT INTO worker.execution_outbox (aggregate_type, aggregate_id, event_type, stable_workflow_id, payload, dispatch_state)
         VALUES ('AGENT_RUN', $1, 'AGENT_RUN_DISPATCH', $2, $3::jsonb, 'PENDING')`,
        [agentRunId, stableWorkflowId, JSON.stringify({ runId: agentRunId, executionContext, instruction: request.instruction, deadlineAt, fakeRuntimeCase: fakeCase })],
      );
      await appendEvent(client, { runId: agentRunId, sessionId, executionScopeId: rootExecutionId, eventType: 'AGENT_RUN_ADMITTED', sourceCursor: `admission:${admissionRequestId}`, payload: { admissionRequestId, submittedIntentDigest, resolvedSpecDigest, authoritySnapshotId: authoritySnapshotResult.rows[0].authority_snapshot_id, stableTemporalWorkflowId: stableWorkflowId, runtimeKind: selected.runtime_code, fakeRuntimeCaseId: fakeCase.caseId } });
      return { replayed: false, admissionRequestId, agentRunId, stableWorkflowId, authorityDigest: authority.digest, resolvedSpecDigest };
    });
  } catch (error) {
    if (error?.code === '23505') {
      const duplicate = await findExistingAdmission({ callerScopeKey, idempotencyKey: request.idempotencyKey, submittedIntentDigest });
      if (duplicate) return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: duplicate.admission_request_id, run: await getRunRow(duplicate.agent_run_id, actor), dispatch: { durable: true, replay: true } };
    }
    throw error;
  }

  if (accepted.replayed) return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: accepted.admissionRequestId, run: await getRunRow(accepted.agentRunId, actor), dispatch: { durable: true, replay: true } };
  dispatchAgentRun(accepted.agentRunId).catch((error) => console.warn(`[AgentExecution] Durable outbox dispatch deferred for ${accepted.agentRunId}: ${error.message}`));
  return { accepted: true, replayed: false, statusCode: 202, admissionRequestId: accepted.admissionRequestId, runId: accepted.agentRunId, stableTemporalWorkflowId: accepted.stableWorkflowId, authorityDigest: accepted.authorityDigest, resolvedSpecDigest: accepted.resolvedSpecDigest, dispatch: { durable: true, state: 'PENDING' } };
}

async function listAgentRuns(req, options = {}) {
  const actor = actorFromRequest(req);
  const limit = normalizeLimit(options.limit);
  const projectId = options.projectId ? assertUuid(options.projectId, 'projectId') : null;
  const result = await query(
    `SELECT ar.*, r.runtime_code, p.project_code, p.project_name, d.agent_code, v.revision AS agent_revision, pw.environment_code,
            jsonb_build_object('snapshotId', a.authority_snapshot_id, 'digest', a.digest) AS authority_snapshot,
            CASE WHEN rc.runtime_cell_id IS NULL THEN NULL ELSE jsonb_build_object('runtimeKind', rc.runtime_kind, 'workerGeneration', rc.worker_generation, 'readinessStatus', rc.readiness_status, 'observedAt', rc.observed_at) END AS runtime_cell,
            res.result_status
       FROM worker.agent_runs ar
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN core.projects p ON p.project_id = ar.project_id
       JOIN core.agent_definitions d ON d.definition_id = ar.definition_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
       JOIN core.project_workspaces pw ON pw.project_workspace_id = ar.project_workspace_id
       LEFT JOIN worker.agent_authority_snapshots a ON a.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_runtime_cells rc ON rc.agent_run_id = ar.agent_run_id
       LEFT JOIN worker.agent_results res ON res.agent_run_id = ar.agent_run_id
      WHERE ($1::uuid IS NULL OR ar.project_id = $1)
        AND ($2::boolean = TRUE OR $3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM core.project_members pm
          JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.active = TRUE AND pr.right_code = 'PROJECT_READ'
          WHERE pm.project_id = ar.project_id AND pm.user_id = $3 AND pm.membership_state = 'ACTIVE'
        ))
      ORDER BY ar.created_at DESC
      LIMIT $4`,
    [projectId, actor.adminAll, actor.userId, limit],
  );
  return { items: result.rows.map(toRunSummary), limit, total: result.rows.length };
}

async function getAgentRun(req, runId) {
  const actor = actorFromRequest(req);
  return getRunRow(assertUuid(runId, 'runId'), actor, { includeEvidence: true });
}

async function getAgentRunEvents(req, runId) {
  const detail = await getAgentRun(req, runId);
  return { runId: detail.runId, events: detail.events || [] };
}

async function getAgentRunResult(req, runId) {
  const detail = await getAgentRun(req, runId);
  if (!detail.result) throw new AgentExecutionServiceError(404, 'AGENT_RESULT_NOT_AVAILABLE', 'The Agent Run has no terminal result yet.');
  return { runId: detail.runId, ...detail.result };
}

async function signalRun(workflowId, signalName, payload) {
  const config = getTemporalConfig();
  const connection = await Connection.connect({ address: config.address });
  try {
    const client = new Client({ connection, namespace: config.namespace });
    await client.workflow.getHandle(workflowId).signal(signalName, payload);
  } finally {
    await connection.close();
  }
}

async function assertCancelPermission(req, row) {
  const actor = actorFromRequest(req);
  if (actor.adminAll || actor.internal) return actor;
  const own = actor.userId && actor.userId === row.initiating_user_id;
  const permission = own ? 'AGENT_RUN_CANCEL_OWN' : 'AGENT_RUN_CANCEL_PROJECT';
  if (!(await hasPermission(req, permission))) throw new AgentExecutionServiceError(403, 'AGENT_CANCEL_PERMISSION_REQUIRED', `Permission ${permission} is required.`);
  if (!own) {
    await withTransaction((client) => assertProjectAccess(client, row.project_id, actor, 'PROJECT_READ'));
  }
  return actor;
}

async function cancelAgentRun(req, runId) {
  const actor = actorFromRequest(req);
  const id = assertUuid(runId, 'runId');
  let result;
  try {
    result = await withTransaction(async (client) => {
      const rowResult = await client.query(`SELECT ar.*, es.status AS scope_status, es.revocation_epoch AS scope_revocation_epoch FROM worker.agent_runs ar JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id WHERE ar.agent_run_id = $1 FOR UPDATE`, [id]);
      if (rowResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_RUN_NOT_FOUND', 'The requested Agent Run is not visible to this user.');
      const row = rowResult.rows[0];
      await assertCancelPermission(req, row);
      if (['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED'].includes(row.status)) return { runId: id, workflowId: row.stable_temporal_workflow_id, status: row.status, idempotent: true };
      const nextEpoch = Math.max(Number(row.revocation_epoch), Number(row.scope_revocation_epoch)) + 1;
      await client.query(`UPDATE worker.execution_scopes SET revocation_epoch = $2, status = 'STOP_REQUESTED', stop_reason = 'RUN_CANCEL_REQUESTED' WHERE execution_scope_id = $1`, [row.execution_scope_id, nextEpoch]);
      await client.query(`UPDATE worker.agent_runs SET revocation_epoch = $2, status = 'CANCEL_REQUESTED', stop_state = 'REQUESTED' WHERE agent_run_id = $1`, [id, nextEpoch]);
      await client.query(`UPDATE auth.execution_grants SET grant_state = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_epoch = $2 WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'`, [id, nextEpoch]);
      const operationKey = `${id}:STOP_RUNTIME:${nextEpoch}`;
      await client.query(`INSERT INTO worker.agent_provider_operations (operation_key, agent_run_id, session_id, operation_type, provider_operation_reference, input_digest, fence_epoch, state, outcome_certainty, outcome) VALUES ($1, $2, $3, 'STOP_RUNTIME', $4, $5, $6, 'JOURNALED', 'NOT_CONFIRMED', $7::jsonb) ON CONFLICT (operation_key) DO NOTHING`, [operationKey, id, row.session_id, `fake-stop:${operationKey}`, sha256Digest({ operationKey }), nextEpoch, JSON.stringify({ requested: true, physicalStop: 'PENDING' })]);
      await appendEvent(client, { runId: id, sessionId: row.session_id, executionScopeId: row.execution_scope_id, eventType: 'RUN_CANCEL_REQUESTED', sourceCursor: `cancel:${nextEpoch}`, payload: { requestedBy: actor.internal ? 'INTERNAL_SERVICE' : actor.userId, revocationEpoch: nextEpoch, physicalStop: 'PENDING' } });
      return { runId: id, workflowId: row.stable_temporal_workflow_id, status: 'CANCEL_REQUESTED', revocationEpoch: nextEpoch, idempotent: false };
    });
  } catch (error) { throw error; }
  if (!result.idempotent) {
    try { await signalRun(result.workflowId, 'agentRunCancel', { reason: 'run_cancel_requested', revocationEpoch: result.revocationEpoch }); }
    catch (error) { result.signalState = 'PENDING_RECONCILIATION'; result.signalErrorCode = error?.code || 'TEMPORAL_SIGNAL_UNAVAILABLE'; }
  }
  return result;
}

async function stopExecutionScope(req, scopeId) {
  const actor = actorFromRequest(req);
  if (!(actor.adminAll || actor.internal || await hasPermission(req, 'AGENT_ROOT_STOP'))) throw new AgentExecutionServiceError(403, 'AGENT_ROOT_STOP_PERMISSION_REQUIRED', 'Permission AGENT_ROOT_STOP is required.');
  const id = assertUuid(scopeId, 'executionScopeId');
  const result = await withTransaction(async (client) => {
    const scopeResult = await client.query(`SELECT * FROM worker.execution_scopes WHERE execution_scope_id = $1 FOR UPDATE`, [id]);
    if (scopeResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_EXECUTION_SCOPE_NOT_FOUND', 'The requested root execution is not visible to this user.');
    const scope = scopeResult.rows[0];
    await assertProjectAccess(client, scope.project_id, actor, 'PROJECT_READ');
    const runs = await client.query(`SELECT * FROM worker.agent_runs WHERE execution_scope_id = $1 AND status NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED') FOR UPDATE`, [id]);
    const nextEpoch = Number(scope.revocation_epoch) + 1;
    await client.query(`UPDATE worker.execution_scopes SET revocation_epoch = $2, status = 'STOP_REQUESTED', stop_reason = 'ROOT_STOP_REQUESTED' WHERE execution_scope_id = $1`, [id, nextEpoch]);
    for (const run of runs.rows) {
      await client.query(`UPDATE worker.agent_runs SET revocation_epoch = $2, status = 'CANCEL_REQUESTED', stop_state = 'REQUESTED' WHERE agent_run_id = $1`, [run.agent_run_id, nextEpoch]);
      await client.query(`UPDATE auth.execution_grants SET grant_state = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_epoch = $2 WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'`, [run.agent_run_id, nextEpoch]);
      await appendEvent(client, { runId: run.agent_run_id, sessionId: run.session_id, executionScopeId: id, eventType: 'ROOT_STOP_REQUESTED', sourceCursor: `root-stop:${nextEpoch}`, payload: { revocationEpoch: nextEpoch, physicalStop: 'PENDING' } });
    }
    return { executionScopeId: id, status: 'STOP_REQUESTED', revocationEpoch: nextEpoch, runs: runs.rows.map((run) => ({ runId: run.agent_run_id, workflowId: run.stable_temporal_workflow_id })) };
  });
  for (const run of result.runs) {
    try { await signalRun(run.workflowId, 'agentRootStop', { reason: 'root_stop_requested', revocationEpoch: result.revocationEpoch }); }
    catch (error) { run.signalState = 'PENDING_RECONCILIATION'; run.signalErrorCode = error?.code || 'TEMPORAL_SIGNAL_UNAVAILABLE'; }
  }
  return result;
}

module.exports = {
  AgentExecutionServiceError,
  admitAgentRun,
  listAgentRuns,
  getAgentRun,
  getAgentRunEvents,
  getAgentRunResult,
  cancelAgentRun,
  stopExecutionScope,
  getRuntimeWorkerReadiness,
  normalizeRuntimeIdentity,
  projectRuntimeIdentity,
};
