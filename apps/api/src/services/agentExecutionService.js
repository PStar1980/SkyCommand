const { createHash, randomUUID } = require('node:crypto');
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
const { normalizeRuntimeConfigurationIdentity, resolvePersistedRecoveryRuntime } = require('../../../../packages/agents/src/runtimeConfiguration');
const { buildExecutionContext } = require('../../../../packages/agents/src/executionContext');
const { sha256Digest } = require('../../../../packages/agents/src/canonical');
const { selectFinalRevalidatableContinuationResult } = require('../../../../packages/agents/src/continuationResult');
const { resolveFakeRuntimeCase } = require('../../../../packages/agents/src/fakeRuntime');
const { getAgentRuntimeTaskQueue } = require('../../../../packages/agents/src/runtimeWorker');
const { getTemporalConfig } = require('../../../../packages/temporal/src/config');
const { dispatchAgentRun } = require('./agentRunDispatcher');
const { normalizeRuntimeIdentity, projectRuntimeIdentity } = require('./agentRuntimeProjection');
const agentCapabilityAuthorizationService = require('./agentCapabilityAuthorizationService');
const agentInteractionService = require('./agentInteractionService');
const managedCodexBootstrapService = require('./managedCodexBootstrapService');
const agentSessionService = require('./agentSessionService');
const {
  TERMINAL_RUNTIME_RELEASE_STATUSES,
  releaseMarker,
  runtimeBusyConditionSql,
  runtimeOwnershipReleasedSql,
} = require('./agentRuntimeAvailability');

const MAX_INSTRUCTION_LENGTH = 20000;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MIN_DEADLINE_MS = 1000;
const MAX_DEADLINE_MS = 15 * 60 * 1000;
const MAX_RECOVERY_ATTEMPTS = 2;
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

function sha256Text(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').toUpperCase();
}

function validateDurableTerminalObservation(value, row = {}) {
  if (!isPlainObject(value)) return null;
  if (value.schemaVersion !== 'AGENT_PROVIDER_TERMINAL_OBSERVATION_V1'
    || value.providerBacked !== true
    || value.sendAcceptance !== 'ACKNOWLEDGED'
    || !['COMPLETED', 'FAILED', 'CANCELED', 'CANCELLED', 'INTERRUPTED'].includes(String(value.providerTerminalStatus || '').toUpperCase())
    || !value.providerTurnId) return null;
  if (row.provider_turn_id && value.providerTurnId !== row.provider_turn_id) return null;
  if (row.provider_session_reference && value.providerSessionReference !== row.provider_session_reference) return null;
  if (row.provider_operation_reference && value.providerOperationReference && value.providerOperationReference !== row.provider_operation_reference) return null;
  return JSON.parse(JSON.stringify(value));
}

function resolveDurableTerminalObservation(outcome, row = {}) {
  if (!isPlainObject(outcome)) return null;
  return validateDurableTerminalObservation(outcome.durableTerminalObservation, row);
}

function historicalObservationMatchesRuntimeResult(observation, outcome, row = {}) {
  if (!observation || !isPlainObject(outcome) || !isPlainObject(outcome.runtimeResult)) return false;
  const runtimeResult = outcome.runtimeResult;
  if (runtimeResult.providerBacked !== true
    || runtimeResult.sendAcceptance !== observation.sendAcceptance
    || runtimeResult.outcomeCertainty !== observation.outcomeCertainty
    || String(runtimeResult.providerTerminalStatus || '').toUpperCase() !== observation.providerTerminalStatus
    || (runtimeResult.providerTerminalFailure === true) !== (observation.providerTerminalFailure === true)
    || text(runtimeResult.providerTurnId) !== text(observation.providerTurnId)
    || text(runtimeResult.providerSessionReference) !== text(observation.providerSessionReference)
    || text(runtimeResult.providerOperationReference) !== text(observation.providerOperationReference)
    || (runtimeResult.providerErrorCode || null) !== (observation.providerErrorCode || null)) return false;
  if (row.provider_turn_id && runtimeResult.providerTurnId !== row.provider_turn_id) return false;
  if (row.provider_session_reference && runtimeResult.providerSessionReference !== row.provider_session_reference) return false;
  if (row.provider_operation_reference && runtimeResult.providerOperationReference !== row.provider_operation_reference) return false;
  const runtimeMessage = runtimeResult.taskOutputCandidate?.message;
  const observationMessage = observation.taskOutputCandidate?.message;
  if (typeof runtimeMessage !== 'string' || typeof observationMessage !== 'string') return false;
  return sha256Text(runtimeMessage) === sha256Text(observationMessage);
}

function resolveHistoricalDurableTerminalObservation(outcome, eventRow, row = {}) {
  const direct = resolveDurableTerminalObservation(outcome, row);
  if (direct) return { observation: direct, source: 'PROVIDER_OPERATION_OUTCOME' };
  if (!eventRow || eventRow.availability !== 'REPORTED' || eventRow.freshness !== 'CURRENT') return null;
  const expectedCursor = row.provider_operation_id ? `operation:${row.provider_operation_id}:terminal-observed` : null;
  if (!expectedCursor || eventRow.source_cursor !== expectedCursor) return null;
  if (eventRow.agent_turn_id && row.agent_turn_id && eventRow.agent_turn_id !== row.agent_turn_id) return null;
  const historical = validateDurableTerminalObservation(eventRow.payload, row);
  if (!historical || !historicalObservationMatchesRuntimeResult(historical, outcome, row)) return null;
  return { observation: historical, source: 'PROVIDER_TERMINAL_OBSERVED_EVENT' };
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
    requestedExecutionSurfaces: sanitizeJson(body.requestedExecutionSurfaces || { surfaces: [{ surface: 'SKYCOMMAND_MCP_API', mode: 'ALLOW', reason: 'Bounded managed capability admission.' }] }, 'requestedExecutionSurfaces'),
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
            i.capability_manifest_revision,
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
  if (!['FAKE_PERSISTENT', 'FAKE_EPHEMERAL'].includes(selected.runtime_code)) throw new AgentExecutionServiceError(422, 'AGENT_REAL_RUNTIME_DISABLED', 'Only source-controlled internal fake runtimes are executable in the bounded Phase 19.2B path.');
  if (selected.installation_enabled !== true || selected.certification_state !== 'CERTIFIED' || selected.installation_execution_enabled !== true || selected.installation_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_NOT_EXECUTION_READY', 'The fake runtime installation is not certified, enabled, fresh, and source-controlled for execution.');
  if (selected.freshness_status !== 'CURRENT') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_STALE', 'The fake runtime installation freshness is not CURRENT.');
  if (selected.account_state !== 'CONFIGURED' || selected.account_execution_enabled !== true || selected.account_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_ACCOUNT_NOT_EXECUTION_READY', 'The fake runtime account is not configured and execution-enabled by the internal fixture.');
  if (selected.profile_execution_enabled !== true || selected.profile_enablement_source !== 'INTERNAL_FAKE_FIXTURE') throw new AgentExecutionServiceError(422, 'AGENT_PROFILE_NOT_EXECUTION_READY', 'The fake runtime capability profile is not enabled by the internal fixture.');
}

function assertCodexRuntimeEligibility(selected) {
  if (selected.runtime_code !== 'OPENAI_CODEX_APP_SERVER') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_NOT_ALLOWLISTED', 'The selected runtime is not the bounded managed Codex pilot.');
  if (selected.installation_enabled !== true || selected.certification_state !== 'CERTIFIED' || selected.installation_execution_enabled !== true || selected.installation_enablement_source !== 'GOVERNED_CODEX_PILOT' || selected.runtime_profile !== 'CODEX_READ_ONLY_PILOT') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_NOT_EXECUTION_READY', 'The managed Codex installation is not certified and execution-enabled for the bounded read-only pilot.');
  if (selected.freshness_status !== 'CURRENT') throw new AgentExecutionServiceError(422, 'AGENT_RUNTIME_STALE', 'The managed Codex installation freshness is not CURRENT.');
  if (selected.account_state !== 'CONFIGURED' || selected.account_execution_enabled !== true || selected.account_enablement_source !== 'GOVERNED_CODEX_PILOT') throw new AgentExecutionServiceError(422, 'AGENT_ACCOUNT_NOT_EXECUTION_READY', 'The managed Codex account is not configured and execution-enabled by the governed pilot profile.');
  if (selected.profile_code !== 'CODEX_READ_ONLY_PILOT' || selected.profile_execution_enabled !== true || selected.profile_enablement_source !== 'GOVERNED_CODEX_PILOT') throw new AgentExecutionServiceError(422, 'AGENT_PROFILE_NOT_EXECUTION_READY', 'The managed Codex read-only capability profile is not enabled by the governed pilot.');
}

function isRealCodexSelection(selected) {
  return selected?.runtime_code === 'OPENAI_CODEX_APP_SERVER';
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
    obligations: isRealCodexSelection(selected)
      ? ['REGISTERED_WORKSPACE_SNAPSHOT_ONLY', 'REAL_CODEX_READ_ONLY_PILOT', 'MANAGED_BROWSER_CAPABILITY_ONLY', 'NO_NATIVE_TOOLS', 'NO_PROVIDER_CREDENTIALS']
      : ['REGISTERED_WORKSPACE_ONLY', 'INTERNAL_FAKE_RUNTIME_ONLY', 'MANAGED_BROWSER_CAPABILITY_ONLY', 'NO_PROVIDER_CREDENTIALS'],
    runtimeConfiguration,
  });
  const requestedSurfaceModes = new Map(authority.executionSurfaces.requested.surfaces.map((entry) => [entry.surface, entry.mode]));
  const deniedRequestedSurface = authority.executionSurfaces.granted.surfaces.find((entry) => entry.mode === 'DENY' && requestedSurfaceModes.get(entry.surface) !== 'DENY');
  const relevantDenials = authority.denials.filter((denial) => denial.dimension !== 'executionSurface' || requestedSurfaceModes.get(denial.value) !== 'DENY');
  if (deniedRequestedSurface || relevantDenials.length > 0) throw new AgentExecutionServiceError(422, 'AGENT_AUTHORITY_DENIED', 'The requested Agent Run is denied by the pinned Project, workspace, Agent, runtime, or account authority.', { denials: relevantDenials, deniedSurface: deniedRequestedSurface?.surface || null });
  return authority;
}

function narrowSessionAuthority(current, prior) {
  if (!prior?.granted || !prior?.executionSurfaces?.granted || !prior?.constraints) throw new AgentExecutionServiceError(409, 'SESSION_AUTHORITY_REVOKED', 'The owned Session has no certifiable prior authority ceiling.');
  const narrowed = evaluateAuthority({
    snapshotId: current.snapshotId,
    authorityKind: current.authorityKind,
    policyRevision: current.policyRevision,
    sourcePolicyRevision: current.sourcePolicyRevision,
    requested: current.requested,
    configured: intersectScopes([current.configured, prior.configured]),
    granted: intersectScopes([current.granted, prior.granted]),
    requestedSurfaces: current.executionSurfaces.requested,
    configuredSurfaces: current.executionSurfaces.configured,
    grantedSurfaces: intersectExecutionSurfacePolicies({ requested: current.executionSurfaces.granted, configured: prior.executionSurfaces.granted, granted: prior.executionSurfaces.granted }).granted,
    requestedConstraints: current.constraints,
    configuredConstraints: current.constraints,
    grantedConstraints: prior.constraints,
    obligations: [...current.obligations, 'OWNED_SESSION_CONTINUATION'],
    runtimeConfiguration: current.runtimeConfiguration,
  });
  const requestedModes = new Map(narrowed.executionSurfaces.requested.surfaces.map((entry) => [entry.surface, entry.mode]));
  const denials = narrowed.denials.filter((denial) => denial.dimension !== 'executionSurface' || requestedModes.get(denial.value) !== 'DENY');
  if (denials.length) throw new AgentExecutionServiceError(409, 'SESSION_AUTHORITY_REVOKED', 'Current authority cannot preserve the requested continuation within the previous Session ceiling.', { denials });
  return narrowed;
}

// Projection and admission use the same authority calculation. Prior grants are
// ceilings only; no expired grant is reused as current authority.
function resolveSessionAuthority(row) {
  const requested = row.requested_authority || {};
  const runtimeConfiguration = normalizeRuntimeConfigurationIdentity({ runtimeInstallationId: row.installation_id, runtimeProfile: row.runtime_profile, configurationRevision: row.configuration_revision, configurationDigest: row.configuration_digest, capabilityManifestRevision: row.capability_manifest_revision, freshnessStatus: row.freshness_status });
  return narrowSessionAuthority(buildAuthority({
    request: { requestedScope: requested.requested || {}, requestedExecutionSurfaces: requested.surfaces || {}, constraints: requested.constraints || {} },
    project: { authority_policy: row.authority_policy, policy_revision: row.project_policy_revision },
    workspace: { workspace_policy: row.workspace_policy },
    selected: row,
    runtimeConfiguration,
  }), row.prior_authority);
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
    stopEvidence: row.stop_evidence || {},
    revocationEpoch: row.revocation_epoch,
    stableTemporalWorkflowId: row.stable_temporal_workflow_id,
    authoritySnapshot: row.authority_snapshot || null,
    runtimeCell: row.runtime_cell || null,
    resultStatus: row.result_status || null,
    capabilityEffectCount: Number(row.capability_effect_count || 0),
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
            CASE WHEN rc.runtime_cell_id IS NULL THEN NULL ELSE jsonb_build_object('runtimeCellId', rc.runtime_cell_id, 'runtimeKind', rc.runtime_kind, 'adapterVersion', rc.adapter_version, 'taskQueue', rc.task_queue, 'workerIdentity', rc.worker_identity, 'workerGeneration', rc.worker_generation, 'readinessStatus', rc.readiness_status, 'observedAt', rc.observed_at, 'heartbeatAt', rc.heartbeat_at, 'containmentProfile', rc.containment_profile, 'quarantineState', rc.quarantine_state, 'quarantineReason', rc.quarantine_reason, 'quarantinedAt', rc.quarantined_at, 'quarantineEvidence', rc.quarantine_evidence, 'quarantineClearedAt', rc.quarantine_cleared_at) END AS runtime_cell,
            CASE WHEN ar.status = 'COMPLETED' AND EXISTS (
              SELECT 1 FROM worker.agent_events rv
               WHERE rv.agent_run_id = ar.agent_run_id
                 AND rv.event_type = 'AGENT_CONTINUATION_RESULT_REVALIDATED'
            ) THEN 'COMPLETED' ELSE res.result_status END AS result_status,
            res.result AS terminal_result,
            capability_counts.capability_effect_count
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
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::int AS capability_effect_count
              FROM worker.agent_capability_effects ce
              WHERE ce.agent_run_id = ar.agent_run_id
            ) capability_counts ON TRUE
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
  const [events, operations, resultRow, capabilityEffects, interactions] = await Promise.all([
    query(`SELECT agent_event_id AS "eventId", event_sequence AS "sequence", event_type AS "eventType", event_scope AS "scope", source_kind AS "sourceKind", source_instance AS "sourceInstance", source_cursor AS "sourceCursor", availability, freshness, observed_at AS "observedAt", payload FROM worker.agent_events WHERE agent_run_id = $1 ORDER BY event_sequence`, [runId]),
    query(`SELECT po.provider_operation_id AS "operationId", po.operation_key AS "operationKey", po.operation_type AS "operationType", po.provider_operation_reference AS "providerOperationReference", po.input_digest AS "inputDigest", po.fence_epoch AS "fenceEpoch", po.state, po.outcome_certainty AS "outcomeCertainty", po.outcome, t.provider_turn_id AS "providerTurnId", t.provider_session_reference AS "providerSessionReference", po.created_at AS "createdAt", po.updated_at AS "updatedAt" FROM worker.agent_provider_operations po LEFT JOIN worker.agent_turns t ON t.agent_turn_id = po.agent_turn_id WHERE po.agent_run_id = $1 ORDER BY po.created_at`, [runId]),
    query(`SELECT agent_result_id AS "resultId", result_status AS "resultStatus", result_digest AS "resultDigest", result, published_at AS "publishedAt" FROM worker.agent_results WHERE agent_run_id = $1`, [runId]),
    agentCapabilityAuthorizationService.getManagedCapabilityEffects(runId),
    agentInteractionService.listAgentInteractionsForRun(runId),
  ]);
  const originalResult = resultRow.rows[0] || null;
  const revalidationEvent = [...events.rows].reverse().find((event) => event.eventType === 'AGENT_CONTINUATION_RESULT_REVALIDATED' && event.payload?.effectiveResult);
  const projectedResult = revalidationEvent
    ? {
      ...(originalResult || {}),
      resultStatus: 'COMPLETED',
      resultDigest: revalidationEvent.payload.effectiveResultDigest,
      result: revalidationEvent.payload.effectiveResult,
      revalidated: true,
      originalResult: originalResult ? {
        resultId: originalResult.resultId,
        resultStatus: originalResult.resultStatus,
        resultDigest: originalResult.resultDigest,
        publishedAt: originalResult.publishedAt,
      } : null,
      revalidationEventId: revalidationEvent.eventId,
    }
    : originalResult;
  if (revalidationEvent) summary.resultStatus = 'COMPLETED';
  return { ...summary, executionContext: row.execution_context, authoritySnapshot: row.authority_snapshot, events: events.rows, providerOperations: operations.rows, capabilityEffects, interactions: interactions, result: projectedResult };
}

async function admitAgentRun(req, body = {}, options = {}) {
  const actor = actorFromRequest(req);
  const ownedSession = options.sessionId ? await agentSessionService.loadOwnedSession({ query }, options.sessionId, actor) : null;
  if (ownedSession) for (const key of Object.keys(body)) if (!['instruction', 'idempotencyKey', 'deadlineMs'].includes(key)) throw new AgentExecutionServiceError(400, 'AGENT_INPUT_NOT_ALLOWED', `body.${key} is not an accepted Session continuation input.`);
  const request = normalizePublicRequest(req, ownedSession ? {
    projectId: ownedSession.project_id,
    definitionId: ownedSession.definition_id,
    definitionVersionId: ownedSession.definition_version_id,
    projectWorkspaceId: ownedSession.project_workspace_id,
    requestedScope: ownedSession.requested_authority?.requested || {},
    requestedExecutionSurfaces: ownedSession.requested_authority?.surfaces || {},
    constraints: ownedSession.requested_authority?.constraints || {},
    fakeRuntimeCaseId: ownedSession.fake_runtime_case_id,
    ...body,
  } : body);
  const submittedIntent = ownedSession ? {
    sessionId: ownedSession.session_id,
    instruction: request.instruction,
    deadlineMs: request.deadlineMs,
  } : {
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
  const callerScopeKey = `${actor.internal ? 'internal' : actor.userId}:${ownedSession ? 'AGENT_SESSION_CONTINUATION' : 'AGENT_RUN'}`;

  const existing = await findExistingAdmission({ callerScopeKey, idempotencyKey: request.idempotencyKey, submittedIntentDigest });
  if (existing) {
    return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: existing.admission_request_id, run: await getRunRow(existing.agent_run_id, actor), dispatch: { durable: true, replay: true } };
  }

  const runtimeReadiness = await getRuntimeWorkerReadiness();
  const requestId = requestContext(req);
  const admissionRequestId = randomUUID();
  const rootExecutionId = randomUUID();
  const sessionId = ownedSession?.session_id || randomUUID();
  const agentRunId = randomUUID();
  const stableWorkflowId = `agent-run/${agentRunId}`;
  const requestedDeadlineAt = new Date(Date.now() + request.deadlineMs).toISOString();

  let accepted;
  try {
    accepted = await withTransaction(async (client) => {
      const continuation = ownedSession ? await agentSessionService.loadOwnedSession(client, sessionId, actor, { forUpdate: true }) : null;
      const duplicate = await client.query(`SELECT admission_request_id, agent_run_id, submitted_intent_digest, resolved_spec_digest FROM worker.agent_admission_requests WHERE caller_scope_key = $1 AND idempotency_key = $2 FOR UPDATE`, [callerScopeKey, request.idempotencyKey]);
      if (duplicate.rowCount > 0) {
        if (duplicate.rows[0].submitted_intent_digest !== submittedIntentDigest) throw new AgentExecutionServiceError(409, 'AGENT_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different submitted content.', { agentRunId: duplicate.rows[0].agent_run_id });
        return { replayed: true, admissionRequestId: duplicate.rows[0].admission_request_id, agentRunId: duplicate.rows[0].agent_run_id };
      }

      if (continuation) agentSessionService.assertContinuationEligible(continuation);

      const principal = await ensurePrincipal(client, actor);
      const project = await assertProjectAccess(client, request.projectId, actor, 'PROJECT_READ');
      const workspace = await resolveWorkspace(client, request, project);
      const selected = await resolveAgentSelection(client, request, project, workspace);
      const realCodexRuntime = isRealCodexSelection(selected);
      if (realCodexRuntime) assertCodexRuntimeEligibility(selected);
      else assertFakeRuntimeEligibility(selected);
      if (realCodexRuntime) {
        // The certified managed MCP gateway has one current capability context.
        // Serialize all provider-backed Runs sharing this existing installation
        // before binding a context, including first turns in different Sessions.
        await client.query(`SELECT installation_id FROM core.agent_runtime_installations WHERE installation_id = $1 FOR UPDATE`, [selected.installation_id]);
        const occupied = await client.query(`SELECT EXISTS (
          SELECT 1 FROM worker.agent_runs busy
          WHERE busy.installation_id = $1 AND ${runtimeBusyConditionSql('busy')}
        ) AS busy`, [selected.installation_id]);
        if (occupied.rows[0]?.busy) throw new AgentExecutionServiceError(409, 'SESSION_RUNTIME_BUSY', 'The managed runtime is occupied by an active or unresolved operation.', { retriable: true, outcomeCertainty: 'NOT_ACCEPTED' });
      }
      const codexReadiness = realCodexRuntime ? await managedCodexBootstrapService.getBootstrapReadiness() : null;
      if (realCodexRuntime && (!codexReadiness.ok || codexReadiness.executionEnabled !== true)) {
        throw new AgentExecutionServiceError(503, 'AGENT_CODEX_RUNTIME_NOT_READY', 'The managed Codex runtime is not currently ready for the bounded read-only Agent Run.', { readiness: codexReadiness.readiness, readinessReason: codexReadiness.readinessReason });
      }
      const runtimeCaseId = realCodexRuntime ? null : request.fakeRuntimeCaseId || selected.configuration?.runtimeCaseId || (selected.runtime_code === 'FAKE_PERSISTENT' ? 'persistent-delayed-usage' : 'ephemeral-absent-usage');
      const fakeCase = realCodexRuntime ? { caseId: null, sessionModel: 'PERSISTENT' } : resolveFakeRuntimeCase(runtimeCaseId, selected.runtime_code);
      const runtimeConfiguration = normalizeRuntimeConfigurationIdentity({
        runtimeInstallationId: selected.installation_id,
        reviewedSourceRevision: selected.reviewed_source_revision,
        configurationRevision: selected.configuration_revision,
        configurationDigest: selected.configuration_digest,
        capabilityManifestRevision: selected.capability_manifest_revision || 'phase19.2a',
        capabilityManifestDigest: sha256Digest(selected.capability_manifest || {}),
        runtimeProfile: selected.runtime_profile,
        processGeneration: realCodexRuntime ? codexReadiness.runtimeGeneration : runtimeReadiness.workerIdentity,
        serviceGeneration: realCodexRuntime ? codexReadiness.runtimeGeneration : runtimeReadiness.workerIdentity,
        processStartedAt: selected.process_started_at,
        observedAt: runtimeReadiness.observedAt,
        freshnessStatus: selected.freshness_status,
        evidence: { taskQueue: runtimeReadiness.taskQueue, pollerCount: runtimeReadiness.pollerCount, sourceControlledFixture: !realCodexRuntime, providerRuntimeGeneration: codexReadiness?.runtimeGeneration || null, providerReadiness: codexReadiness?.readiness || null },
      });
      const freshAuthority = buildAuthority({ request, project, workspace, selected, runtimeConfiguration });
      const authority = continuation ? narrowSessionAuthority(freshAuthority, continuation.prior_authority) : freshAuthority;
      let effectiveDeadlineMs = request.deadlineMs;
      if (continuation && Number.isInteger(authority.constraints.maxDurationMs)) {
        const durationCeiling = authority.constraints.maxDurationMs;
        const explicitDeadline = body.deadlineMs !== undefined && body.deadlineMs !== null && body.deadlineMs !== '';
        if (durationCeiling < MIN_DEADLINE_MS || explicitDeadline && request.deadlineMs > durationCeiling) {
          throw new AgentExecutionServiceError(422, 'SESSION_DEADLINE_EXCEEDS_AUTHORITY', 'The continuation deadline exceeds the current narrowed Session duration ceiling.', { retriable: false, outcomeCertainty: 'NOT_ACCEPTED', maxDurationMs: durationCeiling });
        }
        effectiveDeadlineMs = Math.min(request.deadlineMs, durationCeiling);
      }
      const deadlineAt = continuation ? new Date(Date.now() + effectiveDeadlineMs).toISOString() : requestedDeadlineAt;
      const sessionBinding = continuation ? {
        mode: 'CONTINUE',
        priorRunId: continuation.latest_run_id,
        providerConversation: {
          conversationReference: continuation.provider_conversation_reference || continuation.provider_session_reference,
          providerSessionReference: continuation.provider_session_reference,
        },
        adapterVersion: selected.adapter_version || null,
        model: realCodexRuntime ? selected.configuration?.model || null : null,
        reasoningEffort: realCodexRuntime ? selected.configuration?.reasoningEffort || null : null,
      } : null;
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
        providerModel: realCodexRuntime ? selected.configuration?.model || null : null,
        providerReasoningEffort: realCodexRuntime ? selected.configuration?.reasoningEffort || null : null,
        deadlineAt,
        ...(continuation ? { effectiveDeadlineMs } : {}),
        authorityDigest: authority.digest,
        runtimeConfiguration,
        workflowId: stableWorkflowId,
        ...(sessionBinding ? { sessionBinding } : {}),
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
        runtime: {
          runtimeKind: selected.runtime_code,
          runtimeMode: realCodexRuntime ? 'PROVIDER_BACKED' : 'FIXTURE',
          providerBacked: realCodexRuntime,
          recoverySupported: realCodexRuntime,
          adapterVersion: selected.adapter_version || null,
          installationId: selected.installation_id,
          accountBindingId: selected.account_binding_id,
          capabilityProfileId: selected.capability_profile_id,
          configurationRevision: runtimeConfiguration.configurationRevision,
          configurationDigest: runtimeConfiguration.configurationDigest,
          workerTaskQueue: runtimeReadiness.taskQueue,
          workerGeneration: runtimeReadiness.workerIdentity,
        },
        environmentProfile: { environmentCode: workspace.environment_code, profileCode: workspace.profile_code },
        admission: { admissionRequestId, submittedIntentDigest, resolvedSpecDigest, ...(continuation ? { deadlineAt, effectiveDeadlineMs } : {}) },
        ...(sessionBinding ? { sessionBinding } : {}),
      });

      await client.query(
        `INSERT INTO worker.execution_scopes (execution_scope_id, project_id, initiating_user_id, initiating_principal_id, initiating_actor_kind, initiating_actor_id, initiating_actor_snapshot, requesting_actor_kind, requesting_actor_id, requesting_actor_snapshot, trigger_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $5, $6, $7::jsonb, 'MANUAL')`,
        [rootExecutionId, project.project_id, actor.userId, principal.execution_principal_id, initiatingActor.kind, initiatingActor.id, JSON.stringify(initiatingActor)],
      );
      if (!continuation) await client.query(
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
           trigger_source, instruction, deadline_at, fake_runtime_case_id, requested_authority,
           execution_context, submitted_intent_digest, resolved_spec_digest,
           stable_temporal_workflow_id, status, revocation_epoch
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $13, $14, 'MANUAL', $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22, $23, 'ADMITTED', 0)`,
        [agentRunId, rootExecutionId, sessionId, project.project_id, selected.definition_id, selected.definition_version_id, workspace.project_workspace_id, selected.installation_id, selected.account_binding_id, selected.capability_profile_id, actor.userId, principal.execution_principal_id, initiatingActor.kind, initiatingActor.id, JSON.stringify(initiatingActor), request.instruction, deadlineAt, fakeCase.caseId, JSON.stringify({ requested: request.requestedScope, surfaces: request.requestedExecutionSurfaces, constraints: request.constraints }), JSON.stringify(executionContext), submittedIntentDigest, resolvedSpecDigest, stableWorkflowId],
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
        [agentRunId, stableWorkflowId, JSON.stringify({ runId: agentRunId, executionContext, instruction: request.instruction, deadlineAt, fakeRuntimeCase: realCodexRuntime ? null : fakeCase })],
      );
      await appendEvent(client, { runId: agentRunId, sessionId, executionScopeId: rootExecutionId, eventType: 'AGENT_RUN_ADMITTED', sourceCursor: `admission:${admissionRequestId}`, payload: { admissionRequestId, submittedIntentDigest, resolvedSpecDigest, authoritySnapshotId: authoritySnapshotResult.rows[0].authority_snapshot_id, stableTemporalWorkflowId: stableWorkflowId, runtimeKind: selected.runtime_code, fakeRuntimeCaseId: fakeCase.caseId, providerModel: resolvedSpec.providerModel, providerReasoningEffort: resolvedSpec.providerReasoningEffort } });
      return { replayed: false, admissionRequestId, agentRunId, stableWorkflowId, authorityDigest: authority.digest, resolvedSpecDigest };
    });
  } catch (error) {
    if (error?.code === '23505') {
      const duplicate = await findExistingAdmission({ callerScopeKey, idempotencyKey: request.idempotencyKey, submittedIntentDigest });
      if (duplicate) return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: duplicate.admission_request_id, run: await getRunRow(duplicate.agent_run_id, actor), dispatch: { durable: true, replay: true } };
      if (ownedSession && error.constraint === 'uq_agent_session_active_run_lease') throw new AgentExecutionServiceError(409, 'SESSION_ALREADY_ACTIVE', 'The Session already has an active Run.', { retriable: true, outcomeCertainty: 'NOT_ACCEPTED' });
    }
    throw error;
  }

  if (accepted.replayed) return { accepted: true, replayed: true, statusCode: 202, admissionRequestId: accepted.admissionRequestId, run: await getRunRow(accepted.agentRunId, actor), dispatch: { durable: true, replay: true } };
  dispatchAgentRun(accepted.agentRunId).catch((error) => console.warn(`[AgentExecution] Durable outbox dispatch deferred for ${accepted.agentRunId}: ${error.message}`));
  return { accepted: true, replayed: false, statusCode: 202, admissionRequestId: accepted.admissionRequestId, runId: accepted.agentRunId, stableTemporalWorkflowId: accepted.stableWorkflowId, authorityDigest: accepted.authorityDigest, resolvedSpecDigest: accepted.resolvedSpecDigest, dispatch: { durable: true, state: 'PENDING' } };
}

async function getAgentRunOptions(req) {
  const actor = actorFromRequest(req);
  const result = await query(
    `SELECT p.project_id, p.project_code, p.project_name,
            pw.project_workspace_id, pw.environment_code, pw.workspace_mode,
            pw.policy_revision AS workspace_policy_revision, pw.workspace_policy,
            d.definition_id, d.agent_code, d.agent_name,
            v.definition_version_id, v.revision AS agent_revision,
            i.installation_id, i.installation_code, i.runtime_profile,
            i.certification_state, i.enabled AS installation_enabled,
            i.execution_enabled AS installation_execution_enabled,
            i.freshness_status,
            a.account_binding_id, a.account_code, a.account_alias, a.account_state,
            a.execution_enabled AS account_execution_enabled,
            cp.capability_profile_id, cp.profile_code,
            par.policy_revision AS allow_rule_policy_revision
       FROM core.projects p
       JOIN core.project_workspaces pw ON pw.project_id = p.project_id AND pw.active = TRUE AND pw.environment_code NOT IN ('PRODUCTION', 'PROD') AND pw.workspace_mode = 'READ_ONLY'
       JOIN core.project_agent_allow_rules par ON par.project_id = p.project_id AND par.allow_state = 'ACTIVE'
       JOIN core.agent_definitions d ON d.definition_id = par.definition_id AND d.active = TRUE AND d.lifecycle_state = 'ACTIVE'
       JOIN core.agent_definition_versions v ON v.definition_version_id = COALESCE(par.definition_version_id, (
         SELECT latest.definition_version_id FROM core.agent_definition_versions latest WHERE latest.definition_id = d.definition_id ORDER BY latest.revision DESC LIMIT 1
       ))
       JOIN core.agent_runtime_installations i ON i.installation_id = v.installation_id
       JOIN core.agent_runtime_accounts a ON a.account_binding_id = v.account_binding_id
       JOIN core.agent_capability_profiles cp ON cp.capability_profile_id = v.capability_profile_id
      WHERE p.active = TRUE
        AND i.installation_code = 'phase19-3a0-managed-codex'
        AND cp.profile_code = 'CODEX_READ_ONLY_PILOT'
        AND ($1::boolean = TRUE OR EXISTS (
          SELECT 1 FROM core.project_members pm
          JOIN core.project_member_rights pr ON pr.project_member_id = pm.project_member_id AND pr.active = TRUE AND pr.right_code = 'PROJECT_READ'
          WHERE pm.project_id = p.project_id AND pm.user_id = $2 AND pm.membership_state = 'ACTIVE'
        ))
      ORDER BY p.project_name, d.agent_code, v.revision DESC`,
    [actor.adminAll, actor.userId],
  );
  let readiness = { ok: false, readiness: 'RUNTIME_OFFLINE', executionEnabled: false };
  try { readiness = await managedCodexBootstrapService.getBootstrapReadiness(); }
  catch (error) { readiness = { ok: false, readiness: 'RUNTIME_OFFLINE', readinessReason: error.code || 'CODEX_RUNTIME_UNAVAILABLE', executionEnabled: false }; }
  return {
    readiness,
    capability: {
      kind: 'BROWSER_AUTOMATION',
      code: 'command-center-status-snapshot',
      version: 'registered.v1',
      environmentCode: 'LOCAL',
      sideEffectLevel: 'READ_ONLY',
      idempotencyMode: 'READ_ONLY',
      parameters: {},
    },
    nativeRoutes: { shell: 'DENY', filesystemWrite: 'DENY', git: 'DENY', docker: 'DENY', externalMessaging: 'DENY', spawn: 'DENY', providerNativeTools: 'DENY' },
    items: result.rows.map((row) => ({
      project: { projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name },
      workspace: { projectWorkspaceId: row.project_workspace_id, environmentCode: row.environment_code, workspaceMode: row.workspace_mode, policyRevision: row.workspace_policy_revision, snapshotRequired: true, liveCheckoutMount: false },
      agent: { definitionId: row.definition_id, definitionVersionId: row.definition_version_id, agentCode: row.agent_code, agentName: row.agent_name, revision: row.agent_revision },
      runtime: { runtimeKind: 'OPENAI_CODEX_APP_SERVER', installationId: row.installation_id, installationCode: row.installation_code, runtimeProfile: row.runtime_profile, certificationState: row.certification_state, installationEnabled: row.installation_enabled, executionEnabled: row.installation_execution_enabled, freshnessStatus: row.freshness_status, accountBindingId: row.account_binding_id, accountCode: row.account_code, accountAlias: row.account_alias, accountState: row.account_state, accountExecutionEnabled: row.account_execution_enabled, capabilityProfileId: row.capability_profile_id, profileCode: row.profile_code },
      policyRevision: row.allow_rule_policy_revision,
    })),
  };
}

async function listAgentRuns(req, options = {}) {
  const actor = actorFromRequest(req);
  const limit = normalizeLimit(options.limit);
  const projectId = options.projectId ? assertUuid(options.projectId, 'projectId') : null;
  const result = await query(
    `SELECT ar.*, r.runtime_code, p.project_code, p.project_name, d.agent_code, v.revision AS agent_revision, pw.environment_code,
            jsonb_build_object('snapshotId', a.authority_snapshot_id, 'digest', a.digest) AS authority_snapshot,
            CASE WHEN rc.runtime_cell_id IS NULL THEN NULL ELSE jsonb_build_object('runtimeKind', rc.runtime_kind, 'workerGeneration', rc.worker_generation, 'readinessStatus', rc.readiness_status, 'observedAt', rc.observed_at) END AS runtime_cell,
            CASE WHEN ar.status = 'COMPLETED' AND EXISTS (
              SELECT 1 FROM worker.agent_events rv
               WHERE rv.agent_run_id = ar.agent_run_id
                 AND rv.event_type = 'AGENT_CONTINUATION_RESULT_REVALIDATED'
            ) THEN 'COMPLETED' ELSE res.result_status END AS result_status,
            (SELECT COUNT(*)::int FROM worker.agent_capability_effects ce WHERE ce.agent_run_id = ar.agent_run_id) AS capability_effect_count
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

const RECOVERY_REFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

function assertRecoveryReference(value, fieldName) {
  const normalized = text(value);
  if (!RECOVERY_REFERENCE_PATTERN.test(normalized)) {
    throw new AgentExecutionServiceError(422, 'AGENT_RECOVERY_REFERENCE_INVALID', `${fieldName} must be a bounded provider reference.`);
  }
  return normalized;
}

function assertRecoveryRequest(body = {}) {
  if (!isPlainObject(body)) throw new AgentExecutionServiceError(400, 'AGENT_RECOVERY_REQUEST_INVALID', 'Recovery request must be a JSON object.');
  const allowed = new Set([
    'providerOperationReference',
    'providerTurnId',
    'providerSessionReference',
    'threadId',
    'providerModel',
    'providerReasoningEffort',
    'timeoutMs',
  ]);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new AgentExecutionServiceError(400, 'AGENT_RECOVERY_INPUT_NOT_ALLOWED', 'Recovery accepts only the recorded provider references and bounded observation settings.');
  const timeoutMs = body.timeoutMs === undefined ? 120000 : Number(body.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new AgentExecutionServiceError(422, 'AGENT_RECOVERY_TIMEOUT_INVALID', 'timeoutMs must be between 1000 and 120000.');
  }
  const reasoning = body.providerReasoningEffort === undefined || body.providerReasoningEffort === null
    ? null
    : text(body.providerReasoningEffort);
  if (reasoning && !['low', 'medium', 'high'].includes(reasoning)) {
    throw new AgentExecutionServiceError(422, 'AGENT_RECOVERY_REASONING_INVALID', 'providerReasoningEffort is not supported by the certified pilot.');
  }
  return {
    providerOperationReference: assertRecoveryReference(body.providerOperationReference, 'providerOperationReference'),
    providerTurnId: assertRecoveryReference(body.providerTurnId, 'providerTurnId'),
    providerSessionReference: assertRecoveryReference(body.providerSessionReference, 'providerSessionReference'),
    threadId: assertRecoveryReference(body.threadId, 'threadId'),
    providerModel: body.providerModel === undefined || body.providerModel === null ? null : assertRecoveryReference(body.providerModel, 'providerModel'),
    providerReasoningEffort: reasoning,
    timeoutMs,
  };
}

async function recoverAgentRun(req, runId, body = {}) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_RECOVERY_INTERNAL_ONLY', 'Provider-operation recovery is restricted to the governed internal Agent service.');
  const id = assertUuid(runId, 'runId');
  const recovery = assertRecoveryRequest(body);
  const rowResult = await query(
    `SELECT ar.agent_run_id, ar.status, ar.session_id, ar.stable_temporal_workflow_id,
            ar.execution_context,
            r.runtime_code, po.provider_operation_id, po.operation_key,
            po.provider_operation_reference, po.state AS operation_state,
            po.outcome_certainty, po.deadline_at, po.outcome AS provider_operation_outcome, t.agent_turn_id,
            t.provider_turn_id, t.provider_session_reference,
            v.configuration AS definition_configuration
       FROM worker.agent_runs ar
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN worker.agent_provider_operations po ON po.agent_run_id = ar.agent_run_id
       JOIN worker.agent_turns t ON t.agent_turn_id = po.agent_turn_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
      WHERE ar.agent_run_id = $1
        AND po.operation_type = 'SUBMIT_TURN'
      ORDER BY po.created_at DESC
      LIMIT 1`,
    [id],
  );
  if (rowResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_RECOVERY_OPERATION_NOT_FOUND', 'The provider operation is not available for recovery.');
  const row = rowResult.rows[0];
  if (['COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED'].includes(row.status)) {
    return { runId: id, status: row.status, idempotent: true, recoveryStarted: false };
  }
  const recoveryRuntime = resolvePersistedRecoveryRuntime({
    executionContext: row.execution_context,
    expectedRuntimeKind: row.runtime_code,
  });
  if (recoveryRuntime.status === 'UNSUPPORTED') {
    throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_RUNTIME_UNSUPPORTED', 'The persisted runtime execution context does not authorize recovery for this operation.');
  }
  if (recoveryRuntime.status === 'IDENTITY_MISMATCH') {
    throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_RUNTIME_IDENTITY_MISMATCH', 'The persisted runtime identity does not match the admitted runtime identity.');
  }
  if (recoveryRuntime.status !== 'READY') {
    throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_RUNTIME_CONTEXT_INVALID', 'The persisted runtime execution context is internally inconsistent and cannot be recovered safely.');
  }
  const runtimeContext = recoveryRuntime.runtime;
  if (!['JOURNALED', 'SENT', 'ACKNOWLEDGED', 'UNKNOWN', 'RECONCILING'].includes(row.operation_state)) {
    throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_OPERATION_STATE_INVALID', 'The provider operation is not in a recoverable state.');
  }
  if (recovery.providerOperationReference !== row.provider_operation_reference) {
    throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_OPERATION_REFERENCE_MISMATCH', 'Recovery must use the exact durable provider operation reference.');
  }

  const segments = await query(
    `SELECT temporal_workflow_id AS "workflowId", temporal_run_id AS "temporalRunId",
            segment_kind AS "segmentKind", status
       FROM worker.agent_temporal_segments
      WHERE agent_run_id = $1
      ORDER BY started_at DESC`,
    [id],
  );
  const recoverySegments = segments.rows.filter((segment) => segment.segmentKind === 'RECOVERY');
  const activeSegments = segments.rows.filter((segment) => segment.status === 'RUNNING');
  if (activeSegments.length > 0) {
    const temporalConfig = getTemporalConfig();
    const temporalConnection = await Connection.connect({ address: temporalConfig.address });
    try {
      const temporalClient = new Client({ connection: temporalConnection, namespace: temporalConfig.namespace });
      for (const activeSegment of activeSegments) {
        let temporalStatus = null;
        try {
          const temporalHandle = temporalClient.workflow.getHandle(activeSegment.workflowId, activeSegment.temporalRunId || undefined);
          const description = await temporalHandle.describe();
          temporalStatus = String(description?.status?.name || description?.status || '').toUpperCase() || null;
        } catch {
          temporalStatus = null;
        }

        const terminalSegmentStatus = {
          COMPLETED: 'COMPLETED',
          FAILED: 'FAILED',
          CANCELED: 'CANCELED',
          TERMINATED: 'FAILED',
          TIMED_OUT: 'FAILED',
        }[temporalStatus];
        if (!terminalSegmentStatus) {
          if (!temporalStatus) {
            await query(
              `UPDATE worker.agent_temporal_segments
                  SET status = 'UNKNOWN', ended_at = CURRENT_TIMESTAMP
                WHERE agent_run_id = $1 AND temporal_run_id = $2 AND status = 'RUNNING'`,
              [id, activeSegment.temporalRunId],
            );
            return { runId: id, ...activeSegment, status: 'UNKNOWN', idempotent: true, recoveryStarted: false, recoveryBlocked: true };
          }
          return {
            runId: id,
            ...activeSegment,
            status: temporalStatus,
            idempotent: true,
            recoveryStarted: activeSegment.segmentKind === 'RECOVERY',
            recoveryBlocked: activeSegment.segmentKind !== 'RECOVERY',
          };
        }
        await query(
          `UPDATE worker.agent_temporal_segments
              SET status = $3, ended_at = CURRENT_TIMESTAMP
            WHERE agent_run_id = $1 AND temporal_run_id = $2 AND status = 'RUNNING'`,
          [id, activeSegment.temporalRunId, terminalSegmentStatus],
        );
      }
    } finally {
      await temporalConnection.close();
    }
  }
  const attempt = recoverySegments.length + 1;
  if (attempt > MAX_RECOVERY_ATTEMPTS) throw new AgentExecutionServiceError(409, 'AGENT_RECOVERY_ATTEMPTS_EXHAUSTED', `The maximum ${MAX_RECOVERY_ATTEMPTS} bounded recovery attempts for this provider operation has been reached.`);

  const durableTerminalObservation = resolveDurableTerminalObservation(row.provider_operation_outcome, row);
  const definitionConfiguration = isPlainObject(row.definition_configuration) ? row.definition_configuration : {};
  const providerModel = recovery.providerModel || definitionConfiguration.model || null;
  const providerReasoningEffort = recovery.providerReasoningEffort || definitionConfiguration.reasoningEffort || null;
  const recoveryWorkflowId = `agent-run-recovery/${id}/${attempt}`;
  const recoveryDeadlineAt = new Date(Date.now() + recovery.timeoutMs).toISOString();
  const config = getTemporalConfig();
  const connection = await Connection.connect({ address: config.address });
  let temporalRunId = null;
  try {
    const client = new Client({ connection, namespace: config.namespace });
    let handle;
    try {
      handle = await client.workflow.start('agentRunWorkflow', {
        taskQueue: config.taskQueue,
        workflowId: recoveryWorkflowId,
        args: [{
          runId: id,
          recovery: {
            mode: 'OBSERVE_PROVIDER_OPERATION',
            runtimeKind: runtimeContext.runtimeKind,
            runtimeMode: runtimeContext.runtimeMode || null,
            providerBacked: runtimeContext.providerBacked === true,
            recoverySupported: runtimeContext.recoverySupported === true,
            adapterVersion: runtimeContext.adapterVersion || null,
            operationId: row.provider_operation_id,
            turnId: row.agent_turn_id,
            sessionId: row.session_id,
            providerOperationReference: recovery.providerOperationReference,
            runtimeEvidenceBoundary: isPlainObject(row.provider_operation_outcome)
              ? row.provider_operation_outcome.runtimeEvidenceBoundary || null : null,
            durableTerminalObservation,
            providerTurnId: recovery.providerTurnId,
            providerSessionReference: recovery.providerSessionReference,
            threadId: recovery.threadId,
            providerModel,
            providerReasoningEffort,
            deadlineAt: recoveryDeadlineAt,
            timeoutMs: recovery.timeoutMs,
          },
        }],
      });
    } catch (error) {
      if (!/already started|workflow execution already exists|ALREADY_EXISTS/i.test(String(error?.message || error))) throw error;
      handle = client.workflow.getHandle(recoveryWorkflowId);
    }
    try {
      const description = await handle.describe();
      temporalRunId = description?.runId || description?.workflowExecution?.runId || handle.firstExecutionRunId || null;
    } catch {
      temporalRunId = handle.firstExecutionRunId || null;
    }
  } finally {
    await connection.close();
  }

  await query(
    `INSERT INTO worker.agent_temporal_segments (
       agent_run_id, temporal_workflow_id, temporal_run_id, segment_kind, status
     ) VALUES ($1, $2, $3, 'RECOVERY', 'RUNNING')
     ON CONFLICT (agent_run_id, temporal_run_id) DO NOTHING`,
    [id, recoveryWorkflowId, temporalRunId || `unknown:${recoveryWorkflowId}`],
  );
  return {
    runId: id,
    workflowId: recoveryWorkflowId,
    temporalRunId,
    attempt,
    operationId: row.provider_operation_id,
    idempotent: false,
    recoveryStarted: true,
  };
}


function temporalWorkflowNotFound(error) {
  const value = `${error?.name || ''} ${error?.code || ''} ${error?.message || error || ''}`;
  return /WorkflowNotFound|WorkflowNotFoundError|workflow[^\n]{0,120}not found/i.test(value);
}

async function reconcileHistoricalTemporalSegments(runId) {
  const segments = await query(
    `SELECT temporal_workflow_id AS "workflowId", temporal_run_id AS "temporalRunId", segment_kind AS "segmentKind", status
       FROM worker.agent_temporal_segments
      WHERE agent_run_id = $1 AND status = 'RUNNING'
      ORDER BY started_at`,
    [runId],
  );
  if (segments.rowCount === 0) return { reconciled: 0, active: 0 };
  const config = getTemporalConfig();
  const connection = await Connection.connect({ address: config.address });
  let reconciled = 0;
  try {
    const temporalClient = new Client({ connection, namespace: config.namespace });
    for (const segment of segments.rows) {
      let temporalStatus = null;
      try {
        const handle = temporalClient.workflow.getHandle(segment.workflowId, segment.temporalRunId || undefined);
        const description = await handle.describe();
        temporalStatus = String(description?.status?.name || description?.status || '').toUpperCase() || null;
      } catch (error) {
        if (!temporalWorkflowNotFound(error)) {
          throw new AgentExecutionServiceError(503, 'AGENT_RUNTIME_HOLD_TEMPORAL_OBSERVATION_UNAVAILABLE', 'Temporal status could not be verified while releasing historical runtime ownership.', { retriable: true, outcomeCertainty: 'UNKNOWN' });
        }
        await query(
          `UPDATE worker.agent_temporal_segments
              SET status = 'UNKNOWN', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
            WHERE agent_run_id = $1 AND temporal_workflow_id = $2 AND status = 'RUNNING'`,
          [runId, segment.workflowId],
        );
        reconciled += 1;
        continue;
      }
      const mapped = { COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELED: 'CANCELED', TERMINATED: 'FAILED', TIMED_OUT: 'FAILED' }[temporalStatus];
      if (!mapped) {
        throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_TEMPORAL_STILL_ACTIVE', 'A historical Temporal execution is still active; runtime ownership cannot be released.', { retriable: true, outcomeCertainty: 'UNKNOWN', temporalStatus });
      }
      await query(
        `UPDATE worker.agent_temporal_segments
            SET status = $3, ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
          WHERE agent_run_id = $1 AND temporal_workflow_id = $2 AND status = 'RUNNING'`,
        [runId, segment.workflowId, mapped],
      );
      reconciled += 1;
    }
  } finally {
    await connection.close();
  }
  return { reconciled, active: 0 };
}

function historicalRuntimeGeneration(row = {}) {
  return text(
    row.provider_operation_outcome?.runtimeEvidenceBoundary?.generation
      || row.admitted_runtime_generation
      || row.runtime_cell_generation,
  ) || null;
}


function historicalAuthorityResidueMarker({ runId, sourceCursor, reconciledAt, activeGrantCount = 0, deniedPreDispatchEffectCount = 0, temporalSegmentsReconciled = 0 } = {}) {
  return {
    contract: 'agent_historical_authority_residue_reconciliation.v1',
    reconciled: true,
    runId: runId || null,
    reason: 'TERMINAL_RUN_STALE_AUTHORITY',
    activeGrantCount: Number(activeGrantCount || 0),
    deniedPreDispatchEffectCount: Number(deniedPreDispatchEffectCount || 0),
    temporalSegmentsReconciled: Number(temporalSegmentsReconciled || 0),
    sourceCursor: sourceCursor || null,
    reconciledAt: reconciledAt || new Date().toISOString(),
  };
}

async function loadHistoricalAuthorityResidueEvidence(client, runId, { lock = false } = {}) {
  const runLock = lock ? ' FOR UPDATE OF ar, es' : '';
  const rowResult = await client.query(
    `SELECT ar.agent_run_id, ar.session_id, ar.execution_scope_id, ar.installation_id, ar.status,
            ar.outcome, ar.stop_state, ar.revocation_epoch, ar.terminal_at,
            es.status AS scope_status, es.revocation_epoch AS scope_revocation_epoch,
            r.runtime_code
       FROM worker.agent_runs ar
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
      WHERE ar.agent_run_id = $1${runLock}`,
    [runId],
  );
  if (rowResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_AUTHORITY_RESIDUE_RUN_NOT_FOUND', 'The historical Agent Run was not found.');
  const row = rowResult.rows[0];
  const grantLock = lock ? ' FOR UPDATE' : '';
  const effectLock = lock ? ' FOR UPDATE' : '';
  const grants = await client.query(
    `SELECT execution_grant_id, grant_kind, capability_effect_id, grant_state, revocation_epoch,
            credential_expires_at, grant_metadata
       FROM auth.execution_grants
      WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'
      ORDER BY granted_at, execution_grant_id${grantLock}`,
    [runId],
  );
  const leases = await client.query(
    `SELECT resource_lease_id, lease_state
       FROM worker.agent_resource_leases
      WHERE agent_run_id = $1 AND lease_state IN ('ACTIVE', 'QUARANTINED')
      ORDER BY acquired_at`,
    [runId],
  );
  const providerHolds = await client.query(
    `SELECT po.provider_operation_id, po.state, po.outcome_certainty
       FROM worker.agent_provider_operations po
      WHERE po.agent_run_id = $1
        AND po.operation_type = 'SUBMIT_TURN'
        AND (po.outcome_certainty = 'UNKNOWN' OR po.state IN ('UNKNOWN', 'RECOVERY_REQUIRED', 'JOURNALED', 'SENT', 'ACKNOWLEDGED', 'RECONCILING'))
        AND NOT (${runtimeOwnershipReleasedSql('po')})
      ORDER BY po.created_at`,
    [runId],
  );
  const effects = await client.query(
    `SELECT agent_capability_effect_id, dispatch_state, outcome_certainty,
            native_browser_execution_id, native_browser_workflow_id, browser_automation_run_id
       FROM worker.agent_capability_effects
      WHERE agent_run_id = $1
        AND dispatch_state IN ('INTENT', 'DISPATCHING', 'DISPATCHED', 'RECONCILING')
        AND outcome_certainty IN ('UNKNOWN', 'NOT_CONFIRMED')
      ORDER BY created_at, agent_capability_effect_id${effectLock}`,
    [runId],
  );
  const effectEvidence = [];
  for (const effect of effects.rows) {
    const native = await client.query(
      `SELECT browser_automation_run_id, execution_id, temporal_workflow_id, status, temporal_status
         FROM worker.browser_automation_runs
        WHERE managed_effect_id = $1
           OR ($2::text IS NOT NULL AND execution_id = $2::text)
           OR ($3::text IS NOT NULL AND temporal_workflow_id = $3)
           OR ($4::uuid IS NOT NULL AND browser_automation_run_id = $4::uuid)
        ORDER BY created_at
        LIMIT 1`,
      [
        effect.agent_capability_effect_id,
        effect.native_browser_execution_id || null,
        effect.native_browser_workflow_id || null,
        effect.browser_automation_run_id || null,
      ],
    );
    effectEvidence.push({
      ...effect,
      nativeBrowserEvidence: native.rowCount > 0,
      nativeBrowserStatus: native.rows[0]?.status || null,
      nativeBrowserTemporalStatus: native.rows[0]?.temporal_status || null,
    });
  }
  const temporal = await client.query(
    `SELECT temporal_workflow_id, temporal_run_id, segment_kind, status
       FROM worker.agent_temporal_segments
      WHERE agent_run_id = $1 AND status = 'RUNNING'
      ORDER BY started_at`,
    [runId],
  );
  const activeSiblingRuns = await client.query(
    `SELECT agent_run_id, status
       FROM worker.agent_runs
      WHERE execution_scope_id = $1
        AND agent_run_id <> $2
        AND status NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED')
      ORDER BY created_at`,
    [row.execution_scope_id, runId],
  );
  const unsafeEffects = effectEvidence.filter((effect) => effect.dispatch_state !== 'INTENT' || effect.nativeBrowserEvidence === true);
  const terminal = TERMINAL_RUNTIME_RELEASE_STATUSES.includes(row.status);
  return {
    row,
    terminal,
    activeGrants: grants.rows,
    activeLeases: leases.rows,
    providerHolds: providerHolds.rows,
    unresolvedEffects: effectEvidence,
    unsafeEffects,
    runningTemporalSegments: temporal.rows,
    activeSiblingRuns: activeSiblingRuns.rows,
    hasResidue: grants.rowCount > 0 || effectEvidence.length > 0,
    safeCandidate: terminal
      && row.runtime_code === 'OPENAI_CODEX_APP_SERVER'
      && leases.rowCount === 0
      && providerHolds.rowCount === 0
      && activeSiblingRuns.rowCount === 0
      && unsafeEffects.length === 0,
  };
}

function safeHistoricalAuthorityResidueEvidence(evidence) {
  return {
    runId: evidence.row.agent_run_id,
    sessionId: evidence.row.session_id,
    executionScopeId: evidence.row.execution_scope_id,
    installationId: evidence.row.installation_id,
    runtimeCode: evidence.row.runtime_code,
    runStatus: evidence.row.status,
    scopeStatus: evidence.row.scope_status,
    terminal: evidence.terminal,
    hasResidue: evidence.hasResidue,
    safeCandidate: evidence.safeCandidate,
    activeGrantCount: evidence.activeGrants.length,
    activeGrants: evidence.activeGrants.map((grant) => ({
      grantId: grant.execution_grant_id,
      grantKind: grant.grant_kind,
      capabilityEffectId: grant.capability_effect_id || null,
      credentialExpiresAt: grant.credential_expires_at || null,
    })),
    activeLeaseCount: evidence.activeLeases.length,
    unreleasedProviderHoldCount: evidence.providerHolds.length,
    unresolvedEffectCount: evidence.unresolvedEffects.length,
    effects: evidence.unresolvedEffects.map((effect) => ({
      effectId: effect.agent_capability_effect_id,
      dispatchState: effect.dispatch_state,
      outcomeCertainty: effect.outcome_certainty,
      nativeBrowserExecutionId: effect.native_browser_execution_id || null,
      nativeBrowserWorkflowId: effect.native_browser_workflow_id || null,
      browserAutomationRunId: effect.browser_automation_run_id || null,
      nativeBrowserEvidence: effect.nativeBrowserEvidence === true,
      nativeBrowserStatus: effect.nativeBrowserStatus || null,
      nativeBrowserTemporalStatus: effect.nativeBrowserTemporalStatus || null,
    })),
    unsafeEffectCount: evidence.unsafeEffects.length,
    runningTemporalSegmentCount: evidence.runningTemporalSegments.length,
    activeSiblingRunCount: evidence.activeSiblingRuns.length,
  };
}

async function inspectHistoricalAuthorityResidue(req, runId) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_AUTHORITY_RESIDUE_INTERNAL_ONLY', 'Historical authority-residue inspection is restricted to the governed internal Agent service.');
  const id = assertUuid(runId, 'runId');
  return withTransaction(async (client) => ({ authorityResidue: safeHistoricalAuthorityResidueEvidence(await loadHistoricalAuthorityResidueEvidence(client, id)) }));
}

async function reconcileHistoricalAuthorityResidue(req, runId, body = {}) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_AUTHORITY_RESIDUE_INTERNAL_ONLY', 'Historical authority-residue reconciliation is restricted to the governed internal Agent service.');
  if (Object.keys(body || {}).length) throw new AgentExecutionServiceError(400, 'AGENT_AUTHORITY_RESIDUE_INPUT_NOT_ALLOWED', 'Historical authority-residue reconciliation does not accept caller-supplied mutation parameters.');
  const id = assertUuid(runId, 'runId');

  const readiness = await managedCodexBootstrapService.getBootstrapReadiness();
  if (!readiness?.ok || readiness?.executionEnabled !== true || !text(readiness?.runtimeGeneration)) {
    throw new AgentExecutionServiceError(503, 'AGENT_AUTHORITY_RESIDUE_RUNTIME_NOT_CURRENT', 'The managed Codex runtime must be CURRENT and execution-enabled before historical authority residue can be reconciled.', { retriable: true, readiness: readiness?.readiness || 'UNKNOWN' });
  }

  const temporal = await reconcileHistoricalTemporalSegments(id);
  return withTransaction(async (client) => {
    const evidence = await loadHistoricalAuthorityResidueEvidence(client, id, { lock: true });
    if (!evidence.terminal) throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_RUN_NOT_TERMINAL', 'Historical authority residue may be reconciled only for a terminal Agent Run.');
    if (evidence.row.runtime_code !== 'OPENAI_CODEX_APP_SERVER') throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_RUNTIME_UNSUPPORTED', 'Historical authority-residue reconciliation is only supported for the managed Codex runtime.');
    if (evidence.activeLeases.length) throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_ACTIVE_LEASE', 'A historical Run still owns an active or quarantined resource lease. Reconcile runtime ownership before authority residue.', { leaseCount: evidence.activeLeases.length });
    if (evidence.providerHolds.length) throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_PROVIDER_HOLD', 'A historical Run still has unreleased provider-operation ownership. Use the provider runtime-hold reconciliation path first.', { providerHoldCount: evidence.providerHolds.length });
    if (evidence.activeSiblingRuns.length) throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_SHARED_SCOPE_ACTIVE', 'The execution scope still contains another non-terminal Run; its authority epoch cannot be changed safely.', { activeSiblingRunCount: evidence.activeSiblingRuns.length });
    if (evidence.runningTemporalSegments.length) throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_TEMPORAL_STILL_ACTIVE', 'A historical Temporal execution is still active after reconciliation.', { temporalSegmentCount: evidence.runningTemporalSegments.length });
    if (evidence.unsafeEffects.length) {
      const effect = evidence.unsafeEffects[0];
      throw new AgentExecutionServiceError(409, 'AGENT_AUTHORITY_RESIDUE_EFFECT_UNRESOLVED', 'A historical capability effect has durable native Browser execution evidence or passed the pre-dispatch INTENT boundary.', {
        effectId: effect.agent_capability_effect_id,
        dispatchState: effect.dispatch_state,
        nativeBrowserEvidence: effect.nativeBrowserEvidence === true,
        nativeBrowserStatus: effect.nativeBrowserStatus || null,
        nativeBrowserTemporalStatus: effect.nativeBrowserTemporalStatus || null,
      });
    }

    const previousEvent = await client.query(
      `SELECT source_cursor, payload
         FROM worker.agent_events
        WHERE agent_run_id = $1 AND event_type = 'AGENT_HISTORICAL_AUTHORITY_RESIDUE_RECONCILED'
        ORDER BY event_sequence DESC
        LIMIT 1`,
      [id],
    );
    if (!evidence.hasResidue) {
      return {
        runId: id,
        sessionId: evidence.row.session_id,
        authorityResidueReconciled: previousEvent.rowCount > 0,
        activeGrantsExpired: 0,
        preDispatchEffectsDenied: 0,
        temporalSegmentsReconciled: temporal.reconciled,
        sourceCursor: previousEvent.rows[0]?.source_cursor || null,
        idempotent: true,
        alreadyClean: true,
      };
    }

    const nextEpoch = Math.max(Number(evidence.row.revocation_epoch || 0), Number(evidence.row.scope_revocation_epoch || 0)) + 1;
    const reconciledAt = new Date().toISOString();
    const sourceCursor = `authority-residue:${id}:epoch:${nextEpoch}`;
    const marker = historicalAuthorityResidueMarker({
      runId: id,
      sourceCursor,
      reconciledAt,
      activeGrantCount: evidence.activeGrants.length,
      deniedPreDispatchEffectCount: evidence.unresolvedEffects.length,
      temporalSegmentsReconciled: temporal.reconciled,
    });

    await client.query(
      `UPDATE worker.execution_scopes
          SET revocation_epoch = $2, updated_at = CURRENT_TIMESTAMP
        WHERE execution_scope_id = $1`,
      [evidence.row.execution_scope_id, nextEpoch],
    );
    await client.query(
      `UPDATE worker.agent_runs
          SET revocation_epoch = $2,
              stop_evidence = COALESCE(stop_evidence, '{}'::jsonb)
                || jsonb_build_object('historicalAuthorityResidueReconciliation', $3::jsonb),
              updated_at = CURRENT_TIMESTAMP
        WHERE agent_run_id = $1`,
      [id, nextEpoch, JSON.stringify(marker)],
    );
    await client.query(
      `UPDATE auth.execution_grants
          SET grant_state = 'EXPIRED',
              revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
              revocation_epoch = $2,
              grant_metadata = COALESCE(grant_metadata, '{}'::jsonb)
                || jsonb_build_object('historicalAuthorityResidueReconciliation', $3::jsonb)
        WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'`,
      [id, nextEpoch, JSON.stringify(marker)],
    );
    for (const effect of evidence.unresolvedEffects) {
      await client.query(
        `UPDATE worker.agent_capability_effects
            SET dispatch_state = 'DENIED', outcome_certainty = 'REJECTED',
                denial_reason = 'HISTORICAL_AUTHORITY_RESIDUE_RECONCILED_BEFORE_DISPATCH',
                reconciliation_metadata = COALESCE(reconciliation_metadata, '{}'::jsonb)
                  || jsonb_build_object(
                    'historicalAuthorityResidueReconciliation', $2::jsonb,
                    'nativeBrowserIdentityDisposition', 'PREALLOCATED_WITHOUT_DURABLE_NATIVE_EXECUTION'
                  ),
                updated_at = CURRENT_TIMESTAMP
          WHERE agent_capability_effect_id = $1
            AND dispatch_state = 'INTENT'
            AND outcome_certainty IN ('UNKNOWN', 'NOT_CONFIRMED')`,
        [effect.agent_capability_effect_id, JSON.stringify(marker)],
      );
    }
    await appendEvent(client, {
      runId: id,
      sessionId: evidence.row.session_id,
      executionScopeId: evidence.row.execution_scope_id,
      eventType: 'AGENT_HISTORICAL_AUTHORITY_RESIDUE_RECONCILED',
      sourceCursor,
      payload: {
        activeGrantsExpired: evidence.activeGrants.length,
        preDispatchEffectsDenied: evidence.unresolvedEffects.length,
        temporalSegmentsReconciled: temporal.reconciled,
        authorityEpoch: nextEpoch,
        executionLivenessProvenAbsent: true,
      },
    });

    return {
      runId: id,
      sessionId: evidence.row.session_id,
      authorityResidueReconciled: true,
      activeGrantsExpired: evidence.activeGrants.length,
      preDispatchEffectsDenied: evidence.unresolvedEffects.length,
      temporalSegmentsReconciled: temporal.reconciled,
      revocationEpoch: nextEpoch,
      sourceCursor,
      idempotent: false,
      alreadyClean: false,
    };
  });
}


function safeContinuationRevalidationEvidence(evidence = {}) {
  const selected = evidence.selection?.normalized || null;
  return {
    runId: evidence.row?.agent_run_id || null,
    sessionId: evidence.row?.session_id || null,
    runStatus: evidence.row?.status || null,
    runOutcome: evidence.row?.outcome || null,
    sessionStatus: evidence.row?.session_status || null,
    sessionModel: evidence.row?.session_model || null,
    runtimeCode: evidence.row?.runtime_code || null,
    scopeStatus: evidence.row?.scope_status || null,
    originalResultStatus: evidence.row?.result_status || null,
    originalResultDigest: evidence.row?.result_digest || null,
    providerOperationId: evidence.row?.provider_operation_id || null,
    providerOperationState: evidence.row?.operation_state || null,
    providerOutcomeCertainty: evidence.row?.outcome_certainty || null,
    providerTurnId: evidence.row?.provider_turn_id || null,
    providerSessionReference: evidence.row?.provider_session_reference || null,
    durableProviderTerminalStatus: evidence.observation?.providerTerminalStatus || null,
    durableProviderErrorCode: evidence.observation?.providerErrorCode || null,
    durableProviderObservationSource: evidence.observationSource || null,
    candidateMessageDigest: evidence.messageDigest || null,
    adjacentJsonValueCount: evidence.selection?.valueCount || 0,
    selectedValueIndex: Number.isInteger(evidence.selection?.selectedIndex) ? evidence.selection.selectedIndex : null,
    selectedSummary: selected?.previous_task_summary || null,
    selectedCapabilityResult: selected?.capability_result || null,
    capabilityEffect: evidence.effect ? {
      effectId: evidence.effect.agent_capability_effect_id,
      capabilityCode: evidence.effect.capability_code,
      authorityDecision: evidence.effect.authority_decision,
      dispatchState: evidence.effect.dispatch_state,
      outcomeCertainty: evidence.effect.outcome_certainty,
      browserAutomationRunId: evidence.effect.browser_automation_run_id || null,
      nativeBrowserExecutionId: evidence.effect.native_browser_execution_id || null,
      nativeBrowserWorkflowId: evidence.effect.native_browser_workflow_id || null,
    } : null,
    nativeBrowser: evidence.browser ? {
      browserAutomationRunId: evidence.browser.browser_automation_run_id,
      executionId: evidence.browser.execution_id || null,
      temporalWorkflowId: evidence.browser.temporal_workflow_id || null,
      status: evidence.browser.status || null,
      temporalStatus: evidence.browser.temporal_status || null,
      origin: evidence.browser.trigger_source || null,
    } : null,
    activeLeaseCount: evidence.activeLeaseCount || 0,
    activeSiblingRunCount: evidence.activeSiblingRunCount || 0,
    alreadyRevalidated: Boolean(evidence.revalidationEvent),
    candidate: evidence.candidate === true,
    blocker: evidence.blocker || null,
  };
}

async function loadContinuationResultRevalidationEvidence(client, runId, { lock = false } = {}) {
  const lockClause = lock ? ' FOR UPDATE OF ar, s' : '';
  const rowResult = await client.query(
    `SELECT ar.agent_run_id, ar.session_id, ar.execution_scope_id, ar.status, ar.outcome,
            ar.execution_context, ar.project_id, ar.definition_id, ar.initiating_user_id,
            ar.initiating_actor_snapshot, ar.trigger_source,
            es.status AS scope_status,
            s.status AS session_status, s.session_model, s.archived_at,
            r.runtime_code, v.revision AS agent_revision,
            res.agent_result_id, res.result_status, res.result_digest, res.result AS terminal_result, res.published_at,
            t.agent_turn_id, t.status AS turn_status, t.output_digest,
            t.provider_turn_id, t.provider_session_reference,
            po.provider_operation_id, po.provider_operation_reference,
            po.state AS operation_state, po.outcome_certainty, po.outcome AS provider_operation_outcome
       FROM worker.agent_runs ar
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       JOIN worker.agent_sessions s ON s.session_id = ar.session_id
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
       LEFT JOIN worker.agent_results res ON res.agent_run_id = ar.agent_run_id
       LEFT JOIN LATERAL (
         SELECT turn.*
           FROM worker.agent_turns turn
          WHERE turn.agent_run_id = ar.agent_run_id
          ORDER BY turn.turn_number DESC, turn.created_at DESC
          LIMIT 1
       ) t ON TRUE
       LEFT JOIN worker.agent_provider_operations po
         ON po.agent_turn_id = t.agent_turn_id
        AND po.operation_type = 'SUBMIT_TURN'
      WHERE ar.agent_run_id = $1${lockClause}`,
    [runId],
  );
  if (rowResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_CONTINUATION_REVALIDATION_RUN_NOT_FOUND', 'The Agent Run was not found.');
  const row = rowResult.rows[0];

  const revalidation = await client.query(
    `SELECT agent_event_id, source_cursor, payload
       FROM worker.agent_events
      WHERE agent_run_id = $1
        AND event_type = 'AGENT_CONTINUATION_RESULT_REVALIDATED'
      ORDER BY event_sequence DESC
      LIMIT 1`,
    [runId],
  );
  const revalidationEvent = revalidation.rows[0] || null;

  const observationEvents = await client.query(
    `SELECT agent_event_id, agent_turn_id, source_cursor, availability, freshness, payload
       FROM worker.agent_events
      WHERE agent_run_id = $1
        AND event_type = 'PROVIDER_TERMINAL_OBSERVED'
        AND source_kind = 'SKYCOMMAND_AGENT_RUNTIME_ADAPTER'
        AND source_cursor = $2
      ORDER BY event_sequence DESC
      LIMIT 2`,
    [runId, row.provider_operation_id ? `operation:${row.provider_operation_id}:terminal-observed` : ''],
  );
  const observationEvent = observationEvents.rowCount === 1 ? observationEvents.rows[0] : null;
  const resolvedObservation = resolveHistoricalDurableTerminalObservation(row.provider_operation_outcome, observationEvent, row);
  const observation = resolvedObservation?.observation || null;
  const observationSource = resolvedObservation?.source || null;
  const message = observation?.taskOutputCandidate?.message || null;
  const selection = message ? selectFinalRevalidatableContinuationResult(message) : { valid: false, code: 'CONTINUATION_RESULT_DURABLE_MESSAGE_MISSING', valueCount: 0 };
  const messageDigest = message ? sha256Text(message) : null;

  const effects = await client.query(
    `SELECT agent_capability_effect_id, capability_code, authority_decision,
            dispatch_state, outcome_certainty, native_browser_execution_id,
            native_browser_workflow_id, browser_automation_run_id
       FROM worker.agent_capability_effects
      WHERE agent_run_id = $1
      ORDER BY created_at, agent_capability_effect_id`,
    [runId],
  );
  const effect = effects.rowCount === 1 ? effects.rows[0] : null;
  let browser = null;
  if (effect) {
    const native = await client.query(
      `SELECT browser_automation_run_id, execution_id, temporal_workflow_id,
              status, temporal_status, trigger_source, managed_effect_id,
              managed_agent_run_id, managed_session_id, managed_turn_id
         FROM worker.browser_automation_runs
        WHERE managed_effect_id = $1
           OR ($2::uuid IS NOT NULL AND browser_automation_run_id = $2::uuid)
        ORDER BY created_at
        LIMIT 2`,
      [effect.agent_capability_effect_id, effect.browser_automation_run_id || null],
    );
    if (native.rowCount === 1) browser = native.rows[0];
  }

  const leases = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM worker.agent_resource_leases
      WHERE agent_run_id = $1 AND lease_state IN ('ACTIVE', 'QUARANTINED')`,
    [runId],
  );
  const siblings = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM worker.agent_runs sibling
      WHERE sibling.session_id = $1
        AND sibling.agent_run_id <> $2
        AND sibling.status NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'RECOVERY_REQUIRED')`,
    [row.session_id, runId],
  );
  const activeLeaseCount = Number(leases.rows[0]?.count || 0);
  const activeSiblingRunCount = Number(siblings.rows[0]?.count || 0);

  let blocker = null;
  if (revalidationEvent && row.status === 'COMPLETED' && row.session_status === 'ACTIVE') blocker = null;
  else if (row.runtime_code !== 'OPENAI_CODEX_APP_SERVER') blocker = 'AGENT_CONTINUATION_REVALIDATION_RUNTIME_UNSUPPORTED';
  else if (row.status !== 'FAILED' || row.outcome !== 'PROVIDER_TERMINAL_FAILED') blocker = 'AGENT_CONTINUATION_REVALIDATION_RUN_STATE_INVALID';
  else if (row.session_model !== 'PERSISTENT' || row.session_status !== 'CLOSED' || row.archived_at) blocker = 'AGENT_CONTINUATION_REVALIDATION_SESSION_STATE_INVALID';
  else if (row.scope_status !== 'ACTIVE') blocker = 'AGENT_CONTINUATION_REVALIDATION_SCOPE_NOT_ACTIVE';
  else if (row.result_status !== 'FAILED' || !row.result_digest || !row.terminal_result) blocker = 'AGENT_CONTINUATION_REVALIDATION_ORIGINAL_RESULT_MISSING';
  else if (activeLeaseCount) blocker = 'AGENT_CONTINUATION_REVALIDATION_ACTIVE_LEASE';
  else if (activeSiblingRunCount) blocker = 'AGENT_CONTINUATION_REVALIDATION_SESSION_BUSY';
  else if (row.operation_state !== 'COMPLETED' || row.outcome_certainty !== 'ACKNOWLEDGED') blocker = 'AGENT_CONTINUATION_REVALIDATION_PROVIDER_OPERATION_INVALID';
  else if (!observation
    || observation.sendAcceptance !== 'ACKNOWLEDGED'
    || observation.outcomeCertainty !== 'ACKNOWLEDGED'
    || observation.providerTerminalStatus !== 'COMPLETED'
    || observation.providerTerminalFailure !== true
    || observation.providerErrorCode !== 'CODEX_CONTINUATION_RESULT_INVALID') blocker = 'AGENT_CONTINUATION_REVALIDATION_PROVIDER_OBSERVATION_INVALID';
  else if (!selection.valid || selection.valueCount < 2) blocker = selection.code || 'AGENT_CONTINUATION_REVALIDATION_RESULT_INVALID';
  else if (effects.rowCount !== 1 || !effect) blocker = 'AGENT_CONTINUATION_REVALIDATION_EFFECT_COUNT_INVALID';
  else if (effect.capability_code !== 'command-center-status-snapshot'
    || effect.authority_decision !== 'ALLOW'
    || effect.dispatch_state !== 'COMPLETED'
    || effect.outcome_certainty !== 'ACKNOWLEDGED'
    || !effect.browser_automation_run_id) blocker = 'AGENT_CONTINUATION_REVALIDATION_EFFECT_INVALID';
  else if (!browser
    || browser.status !== 'SUCCESS'
    || browser.temporal_status !== 'COMPLETED'
    || browser.trigger_source !== 'AGENT_MANAGED'
    || browser.managed_effect_id !== effect.agent_capability_effect_id
    || browser.managed_agent_run_id !== row.agent_run_id
    || browser.managed_session_id !== row.session_id
    || browser.managed_turn_id !== row.agent_turn_id) blocker = 'AGENT_CONTINUATION_REVALIDATION_BROWSER_LEDGER_INVALID';
  else {
    const capability = selection.normalized.capability_result;
    if (capability.effectId !== effect.agent_capability_effect_id
      || capability.browserAutomationRunId !== String(effect.browser_automation_run_id)
      || capability.dispatchState !== effect.dispatch_state
      || capability.outcomeCertainty !== effect.outcome_certainty
      || capability.ok !== true) blocker = 'AGENT_CONTINUATION_REVALIDATION_CAPABILITY_MISMATCH';
  }

  return {
    row,
    observation,
    observationSource,
    messageDigest,
    selection,
    effect,
    browser,
    activeLeaseCount,
    activeSiblingRunCount,
    revalidationEvent,
    blocker,
    candidate: !blocker && !revalidationEvent,
  };
}

async function inspectContinuationResultRevalidation(req, runId) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_CONTINUATION_REVALIDATION_INTERNAL_ONLY', 'Continuation result revalidation inspection is restricted to the governed internal Agent service.');
  const id = assertUuid(runId, 'runId');
  return withTransaction(async (client) => ({
    continuationResultRevalidation: safeContinuationRevalidationEvidence(await loadContinuationResultRevalidationEvidence(client, id)),
  }));
}

async function revalidateContinuationResult(req, runId, body = {}) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_CONTINUATION_REVALIDATION_INTERNAL_ONLY', 'Continuation result revalidation is restricted to the governed internal Agent service.');
  if (Object.keys(body || {}).length) throw new AgentExecutionServiceError(400, 'AGENT_CONTINUATION_REVALIDATION_INPUT_NOT_ALLOWED', 'Continuation result revalidation does not accept caller-supplied mutation parameters.');
  const id = assertUuid(runId, 'runId');

  const readiness = await managedCodexBootstrapService.getBootstrapReadiness();
  if (!readiness?.ok || readiness?.executionEnabled !== true || !text(readiness?.runtimeGeneration)) {
    throw new AgentExecutionServiceError(503, 'AGENT_CONTINUATION_REVALIDATION_RUNTIME_NOT_CURRENT', 'The managed Codex runtime must be CURRENT and execution-enabled before restoring Session eligibility.', { retriable: true, readiness: readiness?.readiness || 'UNKNOWN' });
  }

  return withTransaction(async (client) => {
    const evidence = await loadContinuationResultRevalidationEvidence(client, id, { lock: true });
    if (evidence.revalidationEvent) {
      return {
        runId: id,
        sessionId: evidence.row.session_id,
        revalidated: true,
        idempotent: true,
        alreadyRevalidated: true,
        sourceCursor: evidence.revalidationEvent.source_cursor,
        effectiveResultDigest: evidence.revalidationEvent.payload?.effectiveResultDigest || null,
      };
    }
    if (evidence.blocker) {
      throw new AgentExecutionServiceError(409, evidence.blocker, 'The durable continuation evidence does not satisfy the bounded deterministic revalidation contract.', {
        revalidation: safeContinuationRevalidationEvidence(evidence),
      });
    }

    const selected = evidence.selection.normalized;
    const originalResult = JSON.parse(JSON.stringify(evidence.row.terminal_result));
    const recoveredTaskOutput = {
      ...(evidence.observation.taskOutputCandidate || {}),
      previous_task_summary: selected.previous_task_summary,
      capability_result: selected.capability_result,
      message: evidence.selection.selectedSlice,
      deterministicRevalidation: {
        contract: 'agent_continuation_result_revalidation.v1',
        source: evidence.observationSource || 'DURABLE_PROVIDER_TERMINAL_OBSERVATION',
        selectedValueIndex: evidence.selection.selectedIndex,
        adjacentJsonValueCount: evidence.selection.valueCount,
        originalMessageDigest: evidence.messageDigest,
      },
    };
    const effectiveResult = {
      ...originalResult,
      status: 'COMPLETED',
      outcome: 'SUCCESS',
      summary: 'Managed Codex Agent Run completed after deterministic revalidation of the already-acknowledged provider Turn.',
      taskOutput: recoveredTaskOutput,
      taskOutputSchema: 'agent-provider-result.v1',
      errorCode: null,
      providerEvidence: originalResult.providerEvidence ? {
        ...originalResult.providerEvidence,
        providerErrorCode: null,
      } : originalResult.providerEvidence,
      revalidation: {
        contract: 'agent_continuation_result_revalidation.v1',
        originalResultStatus: evidence.row.result_status,
        originalResultDigest: evidence.row.result_digest,
        originalLocalValidationErrorCode: 'CODEX_CONTINUATION_RESULT_INVALID',
        providerOperationId: evidence.row.provider_operation_id,
        providerTurnId: evidence.row.provider_turn_id,
        providerSessionReference: evidence.row.provider_session_reference,
        durableProviderObservationSource: evidence.observationSource || null,
        capabilityEffectId: evidence.effect.agent_capability_effect_id,
        browserAutomationRunId: evidence.effect.browser_automation_run_id,
        browserExecutionId: evidence.browser.execution_id || null,
        originalMessageDigest: evidence.messageDigest,
        selectedValueIndex: evidence.selection.selectedIndex,
        adjacentJsonValueCount: evidence.selection.valueCount,
      },
    };
    const effectiveResultDigest = sha256Digest(effectiveResult);
    const sourceCursor = `continuation-result-revalidation:${id}:${effectiveResultDigest}`;

    await appendEvent(client, {
      runId: id,
      sessionId: evidence.row.session_id,
      executionScopeId: evidence.row.execution_scope_id,
      eventType: 'AGENT_CONTINUATION_RESULT_REVALIDATED',
      sourceCursor,
      payload: {
        contract: 'agent_continuation_result_revalidation.v1',
        originalResultId: evidence.row.agent_result_id,
        originalResultStatus: evidence.row.result_status,
        originalResultDigest: evidence.row.result_digest,
        originalLocalValidationErrorCode: 'CODEX_CONTINUATION_RESULT_INVALID',
        providerOperationId: evidence.row.provider_operation_id,
        providerTurnId: evidence.row.provider_turn_id,
        providerSessionReference: evidence.row.provider_session_reference,
        durableProviderObservationSource: evidence.observationSource || null,
        originalMessageDigest: evidence.messageDigest,
        selectedValueIndex: evidence.selection.selectedIndex,
        adjacentJsonValueCount: evidence.selection.valueCount,
        capabilityEffectId: evidence.effect.agent_capability_effect_id,
        browserAutomationRunId: evidence.effect.browser_automation_run_id,
        browserExecutionId: evidence.browser.execution_id || null,
        effectiveResultStatus: 'COMPLETED',
        effectiveResultDigest,
        effectiveResult,
        noProviderTurnSubmitted: true,
        noBrowserExecutionCreated: true,
      },
    });

    await client.query(
      `UPDATE worker.agent_runs
          SET status = 'COMPLETED', outcome = 'SUCCESS', updated_at = CURRENT_TIMESTAMP
        WHERE agent_run_id = $1
          AND status = 'FAILED'
          AND outcome = 'PROVIDER_TERMINAL_FAILED'`,
      [id],
    );
    await client.query(
      `UPDATE worker.agent_sessions
          SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
        WHERE session_id = $1
          AND session_model = 'PERSISTENT'
          AND status = 'CLOSED'
          AND archived_at IS NULL`,
      [evidence.row.session_id],
    );

    return {
      runId: id,
      sessionId: evidence.row.session_id,
      revalidated: true,
      idempotent: false,
      alreadyRevalidated: false,
      sourceCursor,
      effectiveResultDigest,
      providerTurnId: evidence.row.provider_turn_id,
      providerSessionReference: evidence.row.provider_session_reference,
      capabilityEffectId: evidence.effect.agent_capability_effect_id,
      browserAutomationRunId: evidence.effect.browser_automation_run_id,
      noProviderTurnSubmitted: true,
      noBrowserExecutionCreated: true,
    };
  });
}

async function releaseHistoricalRuntimeHold(req, runId, body = {}) {
  const actor = actorFromRequest(req);
  if (!actor.internal) throw new AgentExecutionServiceError(403, 'AGENT_RUNTIME_HOLD_RELEASE_INTERNAL_ONLY', 'Historical runtime-hold release is restricted to the governed internal Agent service.');
  const unexpected = Object.keys(body || {}).filter((key) => key !== 'providerOperationId');
  if (unexpected.length) throw new AgentExecutionServiceError(400, 'AGENT_RUNTIME_HOLD_RELEASE_INPUT_NOT_ALLOWED', 'Historical runtime-hold release accepts only the exact providerOperationId when supplied.');
  const id = assertUuid(runId, 'runId');
  const expectedOperationId = body?.providerOperationId ? assertUuid(body.providerOperationId, 'providerOperationId') : null;

  const readiness = await managedCodexBootstrapService.getBootstrapReadiness();
  const currentRuntimeGeneration = text(readiness?.runtimeGeneration) || null;
  if (!readiness?.ok || readiness?.executionEnabled !== true || !currentRuntimeGeneration) {
    throw new AgentExecutionServiceError(503, 'AGENT_RUNTIME_HOLD_RELEASE_RUNTIME_NOT_CURRENT', 'The managed Codex runtime must be ready on a known current generation before historical ownership can be released.', { retriable: true, outcomeCertainty: 'UNKNOWN', readiness: readiness?.readiness || 'UNKNOWN' });
  }

  const temporal = await reconcileHistoricalTemporalSegments(id);

  return withTransaction(async (client) => {
    const rowResult = await client.query(
      `SELECT ar.agent_run_id, ar.session_id, ar.execution_scope_id, ar.installation_id, ar.status, ar.outcome,
              ar.stop_state, ar.revocation_epoch, ar.execution_context,
              es.status AS scope_status, es.revocation_epoch AS scope_revocation_epoch,
              r.runtime_code,
              po.provider_operation_id, po.operation_type, po.provider_operation_reference,
              po.state AS operation_state, po.outcome_certainty, po.outcome AS provider_operation_outcome,
              t.agent_turn_id, t.status AS turn_status, t.provider_turn_id, t.provider_session_reference,
              rc.worker_generation AS runtime_cell_generation, rc.quarantine_state,
              adr.resolved_spec->'runtimeConfiguration'->>'processGeneration' AS admitted_runtime_generation
         FROM worker.agent_runs ar
         JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
         JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
         JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
         JOIN worker.agent_provider_operations po ON po.agent_run_id = ar.agent_run_id AND po.operation_type = 'SUBMIT_TURN'
         LEFT JOIN worker.agent_turns t ON t.agent_turn_id = po.agent_turn_id
         LEFT JOIN worker.agent_runtime_cells rc ON rc.agent_run_id = ar.agent_run_id
         LEFT JOIN worker.agent_admission_requests adr ON adr.agent_run_id = ar.agent_run_id
        WHERE ar.agent_run_id = $1
        ORDER BY po.created_at DESC
        LIMIT 1
        FOR UPDATE OF ar, es, po`,
      [id],
    );
    if (rowResult.rowCount === 0) throw new AgentExecutionServiceError(404, 'AGENT_RUNTIME_HOLD_RELEASE_OPERATION_NOT_FOUND', 'No historical provider submission is available for runtime-hold release.');
    const row = rowResult.rows[0];
    const priorRelease = row.provider_operation_outcome?.runtimeOwnershipRelease;
    if (priorRelease?.released === true) {
      return {
        runId: id,
        sessionId: row.session_id,
        providerOperationId: row.provider_operation_id,
        status: row.status,
        runtimeOwnershipReleased: true,
        providerOutcomePreservedAsUnknown: priorRelease.outcomePreservedAsUnknown === true,
        previousRuntimeGeneration: priorRelease.previousRuntimeGeneration || null,
        currentRuntimeGeneration: priorRelease.currentRuntimeGeneration || null,
        sourceCursor: priorRelease.sourceCursor || null,
        idempotent: true,
      };
    }
    if (row.runtime_code !== 'OPENAI_CODEX_APP_SERVER') throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_RELEASE_RUNTIME_UNSUPPORTED', 'Historical runtime-hold release is only supported for the managed Codex runtime.');
    if (expectedOperationId && expectedOperationId !== row.provider_operation_id) throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_RELEASE_OPERATION_MISMATCH', 'The requested provider operation does not match the durable historical submission.');
    if (!['JOURNALED', 'SENT', 'ACKNOWLEDGED', 'UNKNOWN', 'RECONCILING', 'RECOVERY_REQUIRED'].includes(row.operation_state)) {
      throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_RELEASE_OPERATION_TERMINAL', 'The provider operation is already terminal and does not require historical runtime-hold release.');
    }

    await client.query('SELECT installation_id FROM core.agent_runtime_installations WHERE installation_id = $1 FOR UPDATE', [row.installation_id]);
    const previousRuntimeGeneration = historicalRuntimeGeneration(row);
    if (!previousRuntimeGeneration) {
      throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_RELEASE_GENERATION_UNPROVEN', 'The historical provider runtime generation is not durably known, so execution liveness cannot be fenced safely.');
    }
    if (previousRuntimeGeneration === currentRuntimeGeneration) {
      throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_RELEASE_GENERATION_STILL_CURRENT', 'The historical operation belongs to the current provider runtime generation and cannot be released as stale.', { retriable: true, outcomeCertainty: 'UNKNOWN' });
    }

    const effects = await client.query(
      `SELECT agent_capability_effect_id, dispatch_state, outcome_certainty,
              native_browser_execution_id, native_browser_workflow_id, browser_automation_run_id
         FROM worker.agent_capability_effects
        WHERE agent_run_id = $1
          AND dispatch_state IN ('INTENT', 'DISPATCHING', 'DISPATCHED', 'RECONCILING')
          AND outcome_certainty IN ('UNKNOWN', 'NOT_CONFIRMED')
        FOR UPDATE`,
      [id],
    );
    const preDispatchEffects = [];
    let unsafeEffect = null;
    for (const effect of effects.rows) {
      if (effect.dispatch_state !== 'INTENT') {
        unsafeEffect = { ...effect, nativeBrowserEvidence: true };
        break;
      }
      // Managed Browser execution/workflow ids are preallocated when authority is
      // approved, before startRegisteredAutomation persists a native run. Treat
      // the ids as reservation evidence only; the durable Browser ledger is the
      // irreversible-dispatch boundary.
      const nativeEvidence = await client.query(
        `SELECT browser_automation_run_id, execution_id, temporal_workflow_id, status, temporal_status
           FROM worker.browser_automation_runs
          WHERE managed_effect_id = $1
             OR ($2::text IS NOT NULL AND execution_id = $2::text)
             OR ($3::text IS NOT NULL AND temporal_workflow_id = $3)
             OR ($4::uuid IS NOT NULL AND browser_automation_run_id = $4::uuid)
          ORDER BY created_at
          LIMIT 1`,
        [
          effect.agent_capability_effect_id,
          effect.native_browser_execution_id || null,
          effect.native_browser_workflow_id || null,
          effect.browser_automation_run_id || null,
        ],
      );
      if (nativeEvidence.rowCount > 0) {
        unsafeEffect = {
          ...effect,
          nativeBrowserEvidence: true,
          nativeBrowserStatus: nativeEvidence.rows[0]?.status || null,
          nativeBrowserTemporalStatus: nativeEvidence.rows[0]?.temporal_status || null,
        };
        break;
      }
      preDispatchEffects.push(effect);
    }
    if (unsafeEffect) {
      throw new AgentExecutionServiceError(
        409,
        'AGENT_RUNTIME_HOLD_RELEASE_EFFECT_UNRESOLVED',
        'A historical managed capability effect has durable native Browser execution evidence or passed the pre-dispatch INTENT boundary and must be reconciled before runtime ownership can be released.',
        {
          retriable: false,
          outcomeCertainty: 'UNKNOWN',
          effectId: unsafeEffect.agent_capability_effect_id,
          nativeBrowserEvidence: unsafeEffect.nativeBrowserEvidence === true,
          nativeBrowserStatus: unsafeEffect.nativeBrowserStatus || null,
          nativeBrowserTemporalStatus: unsafeEffect.nativeBrowserTemporalStatus || null,
        },
      );
    }

    const activeSegments = await client.query(`SELECT COUNT(*)::int AS count FROM worker.agent_temporal_segments WHERE agent_run_id = $1 AND status = 'RUNNING'`, [id]);
    if (Number(activeSegments.rows[0]?.count || 0) > 0) {
      throw new AgentExecutionServiceError(409, 'AGENT_RUNTIME_HOLD_TEMPORAL_STILL_ACTIVE', 'A historical Temporal execution is still marked active after reconciliation.', { retriable: true, outcomeCertainty: 'UNKNOWN' });
    }

    const releasedAt = new Date().toISOString();
    const sourceCursor = `runtime-hold:${row.provider_operation_id}:released:${currentRuntimeGeneration}`;
    const release = releaseMarker({ previousRuntimeGeneration, currentRuntimeGeneration, sourceCursor, releasedAt });
    const nextEpoch = Math.max(Number(row.revocation_epoch || 0), Number(row.scope_revocation_epoch || 0)) + 1;

    await client.query(
      `UPDATE worker.execution_scopes
          SET revocation_epoch = $2, status = 'RECOVERY_REQUIRED',
              stop_reason = COALESCE(stop_reason, 'HISTORICAL_PROVIDER_OUTCOME_UNKNOWN_RUNTIME_FENCED'),
              stopped_at = COALESCE(stopped_at, CURRENT_TIMESTAMP)
        WHERE execution_scope_id = $1`,
      [row.execution_scope_id, nextEpoch],
    );
    await client.query(
      `UPDATE worker.agent_runs
          SET revocation_epoch = $2, status = 'RECOVERY_REQUIRED',
              outcome = COALESCE(outcome, 'HISTORICAL_PROVIDER_OUTCOME_UNKNOWN_RUNTIME_FENCED'),
              stop_state = CASE WHEN stop_state = 'CONFIRMED' THEN stop_state ELSE 'UNCONFIRMED' END,
              stop_evidence = COALESCE(stop_evidence, '{}'::jsonb) || jsonb_build_object('runtimeOwnershipRelease', $3::jsonb),
              terminal_at = COALESCE(terminal_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE agent_run_id = $1`,
      [id, nextEpoch, JSON.stringify(release)],
    );
    await client.query(
      `UPDATE auth.execution_grants
          SET grant_state = 'REVOKED', revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revocation_epoch = $2,
              grant_metadata = COALESCE(grant_metadata, '{}'::jsonb) || jsonb_build_object('runtimeOwnershipRelease', $3::jsonb)
        WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'`,
      [id, nextEpoch, JSON.stringify(release)],
    );
    for (const effect of preDispatchEffects) {
      await client.query(
        `UPDATE worker.agent_capability_effects
            SET dispatch_state = 'DENIED', outcome_certainty = 'REJECTED',
                denial_reason = 'HISTORICAL_RUNTIME_OWNERSHIP_RELEASED_BEFORE_DISPATCH',
                reconciliation_metadata = COALESCE(reconciliation_metadata, '{}'::jsonb)
                  || jsonb_build_object(
                    'runtimeOwnershipRelease', $2::jsonb,
                    'nativeBrowserIdentityDisposition', 'PREALLOCATED_WITHOUT_DURABLE_NATIVE_EXECUTION'
                  ),
                updated_at = CURRENT_TIMESTAMP
          WHERE agent_capability_effect_id = $1 AND dispatch_state = 'INTENT'`,
        [effect.agent_capability_effect_id, JSON.stringify(release)],
      );
    }
    await client.query(
      `UPDATE worker.agent_resource_leases
          SET lease_state = 'RELEASED', released_at = COALESCE(released_at, CURRENT_TIMESTAMP),
              quarantine_evidence = COALESCE(quarantine_evidence, '{}'::jsonb) || jsonb_build_object('runtimeOwnershipRelease', $2::jsonb)
        WHERE agent_run_id = $1 AND lease_state IN ('ACTIVE', 'QUARANTINED')`,
      [id, JSON.stringify(release)],
    );
    await client.query(
      `UPDATE worker.agent_runtime_cells
          SET quarantine_state = 'CLEARED', quarantine_reason = COALESCE(quarantine_reason, 'HISTORICAL_PROVIDER_RUNTIME_GENERATION_REPLACED'),
              quarantine_cleared_at = COALESCE(quarantine_cleared_at, CURRENT_TIMESTAMP),
              quarantine_evidence = COALESCE(quarantine_evidence, '{}'::jsonb) || jsonb_build_object('runtimeOwnershipRelease', $2::jsonb),
              updated_at = CURRENT_TIMESTAMP
        WHERE agent_run_id = $1`,
      [id, JSON.stringify(release)],
    );
    await client.query(
      `UPDATE worker.agent_provider_operations
          SET state = 'RECOVERY_REQUIRED',
              outcome = COALESCE(outcome, '{}'::jsonb) || jsonb_build_object('runtimeOwnershipRelease', $2::jsonb),
              updated_at = CURRENT_TIMESTAMP
        WHERE provider_operation_id = $1`,
      [row.provider_operation_id, JSON.stringify(release)],
    );
    if (row.agent_turn_id) {
      await client.query(
        `UPDATE worker.agent_turns
            SET status = CASE WHEN status IN ('COMPLETED', 'FAILED', 'CANCELED', 'REJECTED') THEN status ELSE 'RECOVERY_REQUIRED' END,
                updated_at = CURRENT_TIMESTAMP
          WHERE agent_turn_id = $1`,
        [row.agent_turn_id],
      );
    }
    await client.query(`UPDATE worker.agent_sessions SET status = 'RECOVERY_REQUIRED', updated_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [row.session_id]);
    await appendEvent(client, {
      runId: id,
      sessionId: row.session_id,
      executionScopeId: row.execution_scope_id,
      eventType: 'AGENT_HISTORICAL_RUNTIME_OWNERSHIP_RELEASED',
      sourceCursor,
      payload: {
        providerOperationId: row.provider_operation_id,
        previousRuntimeGeneration,
        currentRuntimeGeneration,
        providerOutcomePreservedAsUnknown: true,
        revokedAuthorityEpoch: nextEpoch,
        deniedPreDispatchEffects: preDispatchEffects.length,
        temporalSegmentsReconciled: temporal.reconciled,
      },
    });

    return {
      runId: id,
      sessionId: row.session_id,
      providerOperationId: row.provider_operation_id,
      status: 'RECOVERY_REQUIRED',
      runtimeOwnershipReleased: true,
      providerOutcomePreservedAsUnknown: true,
      previousRuntimeGeneration,
      currentRuntimeGeneration,
      revokedAuthorityEpoch: nextEpoch,
      deniedPreDispatchEffects: preDispatchEffects.length,
      temporalSegmentsReconciled: temporal.reconciled,
      sourceCursor,
    };
  });
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
  await agentInteractionService.cancelAgentInteractionsForRun({ runId: id, reason: 'RUN_CANCEL_REQUESTED' });
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
    await agentInteractionService.cancelAgentInteractionsForRun({ runId: run.runId, reason: 'ROOT_STOP_REQUESTED' });
  }
  for (const run of result.runs) {
    try { await signalRun(run.workflowId, 'agentRootStop', { reason: 'root_stop_requested', revocationEpoch: result.revocationEpoch }); }
    catch (error) { run.signalState = 'PENDING_RECONCILIATION'; run.signalErrorCode = error?.code || 'TEMPORAL_SIGNAL_UNAVAILABLE'; }
  }
  return result;
}

module.exports = {
  AgentExecutionServiceError,
  admitAgentRun,
  getAgentRunOptions,
  listAgentRuns,
  getAgentRun,
  getAgentRunEvents,
  getAgentRunResult,
  cancelAgentRun,
  recoverAgentRun,
  inspectHistoricalAuthorityResidue,
  reconcileHistoricalAuthorityResidue,
  inspectContinuationResultRevalidation,
  revalidateContinuationResult,
  releaseHistoricalRuntimeHold,
  stopExecutionScope,
  getRuntimeWorkerReadiness,
  normalizeRuntimeIdentity,
  projectRuntimeIdentity,
  resolveSessionAuthority,
  narrowSessionAuthority,
};
