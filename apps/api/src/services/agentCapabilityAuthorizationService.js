const { createHash, randomBytes, randomUUID } = require('node:crypto');

const { pool, query } = require('../../../../packages/db/src/connection');
const { sha256Digest } = require('../../../../packages/agents/src/canonical');
const browserAutomationRegistryService = require('./browserAutomationRegistryService');
const browserAutomationExecutionService = require('./browserAutomationExecutionService');

const MANAGED_CREDENTIAL_AUDIENCE = 'SKYCOMMAND_MANAGED_AGENT_CAPABILITY';
const CAPABILITY_KIND = 'BROWSER_AUTOMATION';
const CAPABILITY_VERSION = 'registered.v1';
const CAPABILITY_CODE = 'command-center-status-snapshot';
const CAPABILITY_SURFACE = 'SKYCOMMAND_MCP_API';
const CAPABILITY_ENVIRONMENT = 'LOCAL';
const CREDENTIAL_TTL_MS = 5 * 60 * 1000;
const BROWSER_WAIT_TIMEOUT_MS = 90 * 1000;
const TERMINAL_BROWSER_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT']);

const MANAGED_BROWSER_CASES = Object.freeze({
  'browser-capability-success': { duplicateDeliveries: 1, revokeBeforeDispatch: false, simulateUnknownDispatch: false },
  'browser-capability-duplicate-retry': { duplicateDeliveries: 2, revokeBeforeDispatch: false, simulateUnknownDispatch: false },
  'browser-capability-revoked-before-dispatch': { duplicateDeliveries: 1, revokeBeforeDispatch: true, simulateUnknownDispatch: false },
  'browser-capability-unknown-dispatch': { duplicateDeliveries: 1, revokeBeforeDispatch: false, simulateUnknownDispatch: true },
  'browser-capability-unknown-send': { duplicateDeliveries: 1, revokeBeforeDispatch: false, simulateUnknownDispatch: false },
});

function createCapabilityError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function isManagedBrowserCase(caseId) {
  return Boolean(MANAGED_BROWSER_CASES[text(caseId)]);
}

function managedBrowserCase(caseId) {
  return MANAGED_BROWSER_CASES[text(caseId)] || null;
}

function hashCredential(credential) {
  return createHash('sha256').update(String(credential || ''), 'utf8').digest('hex').toUpperCase();
}

function grantMetadata(grant) {
  if (!grant || grant.grant_metadata === null || grant.grant_metadata === undefined) return {};
  if (typeof grant.grant_metadata === 'object') return grant.grant_metadata;
  try {
    const parsed = JSON.parse(String(grant.grant_metadata));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeManagedCredential(row, grant = null) {
  if (!grant) return null;
  const state = grant.grant_state || null;
  const closedAt = grant.revoked_at || null;
  const metadata = grantMetadata(grant);
  const grantId = grant.execution_grant_id || grant.grant_id || null;
  return {
    grantId,
    reference: row?.managed_credential_reference || (grantId ? `grant:${grantId}` : null),
    credentialFingerprint: grant.credential_hash || null,
    audience: grant.grant_audience || null,
    issuedAt: grant.granted_at || null,
    expiresAt: grant.credential_expires_at || null,
    state,
    closedAt,
    revokedAt: state === 'REVOKED' ? closedAt : null,
    expiredAt: state === 'EXPIRED' ? closedAt : null,
    statusReason: metadata.revocationReason || metadata.lifecycleReason || metadata.statusReason || null,
    revocationEpoch: grant.revocationEpoch
      ?? grant.revocation_epoch
      ?? grant.grant_revocation_epoch
      ?? row?.grant_revocation_epoch
      ?? null,
  };
}

function isManagedCredentialValid({ grant, credential, run, effect, now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return Boolean(
    grant
      && grant.grant_audience === MANAGED_CREDENTIAL_AUDIENCE
      && grant.grant_state === 'ACTIVE'
      && grant.credential_expires_at
      && Number.isFinite(nowMs)
      && new Date(grant.credential_expires_at).getTime() > nowMs
      && hashCredential(credential) === grant.credential_hash
      && Number(grant.revocation_epoch) === Number(run?.scope_revocation_epoch)
      && Number(effect?.authority_epoch) === Number(run?.scope_revocation_epoch),
  );
}

function buildManagedRequest(caseId) {
  return {
    capabilityKind: CAPABILITY_KIND,
    capabilityCode: CAPABILITY_CODE,
    capabilityVersion: CAPABILITY_VERSION,
    environmentCode: CAPABILITY_ENVIRONMENT,
    parameters: {},
    caseId: text(caseId),
  };
}

function policyScopeAllows(policy, request) {
  const scope = policy && typeof policy === 'object' ? policy.scope || {} : {};
  const required = {
    capabilities: [CAPABILITY_KIND],
    actions: ['RUN'],
    resources: [CAPABILITY_CODE],
    environments: [CAPABILITY_ENVIRONMENT],
    dataClasses: ['INTERNAL'],
  };
  return Object.entries(required).every(([dimension, values]) => {
    const configured = Array.isArray(scope[dimension]) ? scope[dimension].map((value) => String(value)) : [];
    return values.every((value) => configured.includes(value));
  });
}

function policySurfaceAllows(policy) {
  const entries = policy?.executionSurfaces?.surfaces;
  if (!Array.isArray(entries)) return false;
  return entries.some((entry) => entry?.surface === CAPABILITY_SURFACE && entry?.mode === 'ALLOW');
}

function policyCapabilityAllows(policy) {
  const configured = policy?.managedCapabilities?.[CAPABILITY_KIND];
  const allowlist = policy?.managedCapabilityAllowlist;
  if (allowlist) {
    return Boolean(
      allowlist.kind === CAPABILITY_KIND
        && Array.isArray(allowlist.codes)
        && allowlist.codes.includes(CAPABILITY_CODE)
        && allowlist.version === CAPABILITY_VERSION,
    );
  }
  return Boolean(
    configured
      && Array.isArray(configured.codes)
      && configured.codes.includes(CAPABILITY_CODE)
      && configured.version === CAPABILITY_VERSION
      && configured.sideEffectLevel === 'READ_ONLY'
      && configured.idempotencyMode === 'READ_ONLY'
      && configured.requiresConfirmation === false
      && configured.environment === CAPABILITY_ENVIRONMENT
      && configured.parameterMode === 'EMPTY_OBJECT',
  );
}

function normalizeActorSnapshot(run) {
  if (run.initiating_actor_snapshot && typeof run.initiating_actor_snapshot === 'object') {
    return run.initiating_actor_snapshot;
  }
  return {
    kind: run.initiating_actor_kind,
    id: run.initiating_actor_id,
    displayNameSnapshot: null,
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

async function loadRun(client, runId, forUpdate = false) {
  const result = await client.query(
    `SELECT ar.*,
            es.status AS scope_status,
            es.revocation_epoch AS scope_revocation_epoch,
            p.project_code,
            p.policy_revision AS project_policy_revision,
            p.authority_policy,
            pw.workspace_policy,
            pw.policy_revision AS workspace_policy_revision,
            d.agent_code,
            v.revision AS agent_revision,
            v.configuration AS definition_configuration,
            i.capability_manifest,
            i.capability_manifest_revision,
            a.account_policy,
            cp.policy AS capability_policy,
            cp.policy_revision AS capability_policy_revision,
            snap.authority_snapshot_id,
            snap.digest AS authority_snapshot_digest,
            snap.snapshot AS authority_snapshot,
            root.execution_grant_id AS root_grant_id,
            root.grant_state AS root_grant_state,
            root.revocation_epoch AS root_grant_epoch
       FROM worker.agent_runs ar
       JOIN worker.execution_scopes es ON es.execution_scope_id = ar.execution_scope_id
       JOIN core.projects p ON p.project_id = ar.project_id
       JOIN core.project_workspaces pw ON pw.project_workspace_id = ar.project_workspace_id
       JOIN core.agent_definitions d ON d.definition_id = ar.definition_id
       JOIN core.agent_definition_versions v ON v.definition_version_id = ar.definition_version_id
       JOIN core.agent_runtime_installations i ON i.installation_id = ar.installation_id
       JOIN core.agent_runtime_accounts a ON a.account_binding_id = ar.account_binding_id
       JOIN core.agent_capability_profiles cp ON cp.capability_profile_id = ar.capability_profile_id
       LEFT JOIN worker.agent_authority_snapshots snap ON snap.agent_run_id = ar.agent_run_id
       LEFT JOIN auth.execution_grants root
         ON root.agent_run_id = ar.agent_run_id
        AND root.grant_kind = 'ROOT_RUN'
      WHERE ar.agent_run_id = $1
      ${forUpdate ? 'FOR UPDATE OF ar, es' : ''}`,
    [runId],
  );
  return result.rows[0] || null;
}

async function appendEvent(client, { run, eventType, sourceCursor, payload = {}, availability = 'REPORTED' }) {
  const next = await client.query(
    'SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence FROM worker.agent_events WHERE agent_run_id = $1',
    [run.agent_run_id],
  );
  await client.query(
    `INSERT INTO worker.agent_events (
       agent_run_id, session_id, execution_scope_id, event_sequence,
       event_type, event_scope, source_kind, source_instance, source_cursor,
       availability, freshness, observed_at, payload
     ) VALUES ($1, $2, $3, $4, $5, 'RUN', 'SKYCOMMAND_AGENT_CAPABILITY_AUTHORIZATION', 'control-plane', $6, $7, 'CURRENT', CURRENT_TIMESTAMP, $8::jsonb)
     ON CONFLICT (agent_run_id, source_kind, source_instance, source_cursor) DO NOTHING`,
    [
      run.agent_run_id,
      run.session_id,
      run.execution_scope_id,
      Number(next.rows[0].next_sequence),
      eventType,
      sourceCursor,
      availability,
      JSON.stringify(payload),
    ],
  );
}

async function hasCurrentBrowserPermission(client, run) {
  if (!run.initiating_user_id) return false;
  const result = await client.query(
    `SELECT 1
       FROM auth.vw_user_permissions
      WHERE user_id = $1
        AND app_code = 'SKYSERVER_ADMIN'
        AND permission_code = 'BROWSER_AUTOMATION_RUN'
      LIMIT 1`,
    [run.initiating_user_id],
  );
  return result.rowCount > 0;
}

async function hasCurrentProjectRead(client, run) {
  if (!run.initiating_user_id) return false;
  const admin = await client.query(
    `SELECT 1
       FROM auth.user_roles ur
       JOIN auth.roles r ON r.role_id = ur.role_id AND r.active = TRUE
       JOIN core.applications app ON app.app_id = r.app_id AND app.active = TRUE
      WHERE ur.user_id = $1
        AND ur.active = TRUE
        AND app.app_code = 'SKYSERVER_ADMIN'
        AND r.role_code IN ('SUPER_ADMIN', 'ADMIN_ALL')
      LIMIT 1`,
    [run.initiating_user_id],
  );
  if (admin.rowCount > 0) return true;
  const member = await client.query(
    `SELECT 1
       FROM core.project_members pm
       JOIN core.project_member_rights pr
         ON pr.project_member_id = pm.project_member_id
        AND pr.right_code = 'PROJECT_READ'
        AND pr.active = TRUE
      WHERE pm.project_id = $1
        AND pm.user_id = $2
        AND pm.membership_state = 'ACTIVE'
      LIMIT 1`,
    [run.project_id, run.initiating_user_id],
  );
  return member.rowCount > 0;
}

async function loadAutomation() {
  const automation = await browserAutomationRegistryService.getBrowserAutomationByCode(
    CAPABILITY_CODE,
    { includeDisabled: false },
  );
  if (!automation) return { automation: null, reason: 'REGISTERED_AUTOMATION_NOT_FOUND' };
  if (
    automation.scriptRepository?.repoCode !== 'SkyCommand'
    || automation.sideEffectLevel !== 'READ_ONLY'
    || automation.idempotencyMode !== 'READ_ONLY'
    || automation.requiresConfirmation
    || automation.permissionCode !== 'BROWSER_AUTOMATION_RUN'
    || !(automation.environments || []).some((entry) => entry.enabled && entry.environmentCode === CAPABILITY_ENVIRONMENT)
  ) {
    return { automation: null, reason: 'REGISTERED_AUTOMATION_NOT_ALLOWLISTED' };
  }
  return { automation, reason: null };
}

async function evaluateLiveAuthorization(client, run, request) {
  if (!run) return { decision: 'DENY', reason: 'AGENT_RUN_NOT_FOUND' };
  if (run.scope_status !== 'ACTIVE' || ['CANCEL_REQUESTED', 'CANCELLING', 'CANCELED'].includes(run.status)) {
    return { decision: 'DENY', reason: 'RUN_OR_ROOT_REVOKED' };
  }
  if (run.root_grant_state !== 'ACTIVE' || Number(run.root_grant_epoch) !== Number(run.scope_revocation_epoch)) {
    return { decision: 'DENY', reason: 'ROOT_GRANT_REVOKED_OR_EPOCH_MISMATCH' };
  }
  if (!await hasCurrentProjectRead(client, run)) {
    return { decision: 'DENY', reason: 'PROJECT_ACCESS_REVOKED' };
  }
  if (!await hasCurrentBrowserPermission(client, run)) {
    return { decision: 'DENY', reason: 'BROWSER_AUTOMATION_RUN_PERMISSION_MISSING' };
  }

  const { automation, reason: automationReason } = await loadAutomation();
  if (!automation) return { decision: 'DENY', reason: automationReason };

  const policies = [
    run.authority_policy,
    run.workspace_policy,
    run.definition_configuration,
    run.capability_policy,
    run.capability_manifest,
    run.account_policy,
  ];
  const allScopesAllow = policies.every((policy) => policyScopeAllows(policy, request));
  const allSurfacesAllow = policies.every(policySurfaceAllows);
  const allCapabilityAllow = policies.every((policy, index) => index < 2 || policyCapabilityAllows(policy));
  if (!allScopesAllow || !allSurfacesAllow || !allCapabilityAllow) {
    return {
      decision: 'DENY',
      reason: 'CURRENT_POLICY_CEILING_MISSING',
      policyDigest: sha256Digest(policies),
    };
  }

  if (automation.requiresConfirmation) {
    return { decision: 'EXPLICIT_APPROVAL_REQUIRED', reason: 'REGISTERED_AUTOMATION_REQUIRES_CONFIRMATION' };
  }

  return {
    decision: 'ALLOW',
    reason: null,
    automation,
    policyRevision: run.project_policy_revision || 'agent-policy.v1',
    policyDigest: sha256Digest(policies),
    executionSurfaceDecision: {
      surface: CAPABILITY_SURFACE,
      mode: 'ALLOW',
      reason: 'The admitted Agent surface is the bounded SkyCommand MCP/API bridge to the registered Browser Automation service.',
    },
  };
}

function safeEffect(row, grant = null) {
  if (!row) return null;
  return {
    effectId: row.agent_capability_effect_id,
    effectKey: row.effect_key,
    executionScopeId: row.execution_scope_id,
    runId: row.agent_run_id,
    sessionId: row.session_id,
    turnId: row.agent_turn_id || null,
    providerOperationId: row.provider_operation_id || null,
    projectId: row.project_id,
    agentDefinitionId: row.agent_definition_id,
    definitionVersionId: row.definition_version_id,
    initiatingUserId: row.initiating_user_id || null,
    initiatingActor: row.initiating_actor_snapshot || null,
    capabilityKind: row.capability_kind,
    capabilityCode: row.capability_code,
    capabilityVersion: row.capability_version,
    requestDigest: row.request_digest,
    requestMetadata: row.request_metadata || {},
    authorityDecision: row.authority_decision,
    authoritySnapshotId: row.authority_snapshot_id || null,
    authorityEpoch: row.authority_epoch,
    policyRevision: row.policy_revision,
    policyDigest: row.policy_digest || null,
    executionSurfaceDecision: row.execution_surface_decision || {},
    managedCredential: safeManagedCredential(row, grant),
    nativeBrowserExecutionId: row.native_browser_execution_id || null,
    nativeBrowserWorkflowId: row.native_browser_workflow_id || null,
    browserAutomationRunId: row.browser_automation_run_id || null,
    runtimeWorker: row.runtime_worker_identity ? {
      identity: row.runtime_worker_identity,
      generation: row.runtime_worker_generation || null,
      taskQueue: row.runtime_task_queue || null,
      observedAt: row.runtime_observed_at || null,
    } : null,
    dispatchState: row.dispatch_state,
    outcomeCertainty: row.outcome_certainty,
    denialReason: row.denial_reason || null,
    reconciliation: row.reconciliation_metadata || {},
    result: row.result_summary || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadEffect(client, effectId, forUpdate = false) {
  const result = await client.query(
    `SELECT e.*,
            g.execution_grant_id,
            g.grant_audience,
            g.credential_hash,
            g.credential_expires_at,
            g.grant_state,
            g.granted_at,
            g.revoked_at,
            g.grant_metadata,
            g.revocation_epoch AS grant_revocation_epoch
       FROM worker.agent_capability_effects e
       LEFT JOIN auth.execution_grants g
         ON g.capability_effect_id = e.agent_capability_effect_id
        AND g.grant_kind = 'MANAGED_CAPABILITY'
      WHERE e.agent_capability_effect_id = $1
      ${forUpdate ? 'FOR UPDATE OF e' : ''}`,
    [effectId],
  );
  return result.rows[0] || null;
}

async function prepareManagedCapabilityEffect({ runId, operationId, turnId, caseId } = {}) {
  const request = buildManagedRequest(caseId);
  const caseConfig = managedBrowserCase(caseId);
  if (!caseConfig) return { decision: 'SKIP', capabilityRequest: null, effect: null };

  return withTransaction(async (client) => {
    const run = await loadRun(client, runId, true);
    if (!run) throw createCapabilityError('AGENT_RUN_NOT_FOUND', 'Agent Run not found while preparing a managed capability effect.');
    const effectKey = `browser:${request.capabilityCode}:${text(caseId)}`;
    const requestDigest = sha256Digest({ effectKey, ...request });
    const existingResult = await client.query(
      'SELECT * FROM worker.agent_capability_effects WHERE agent_run_id = $1 AND effect_key = $2 FOR UPDATE',
      [runId, effectKey],
    );
    if (existingResult.rowCount > 0) {
      const existing = existingResult.rows[0];
      if (existing.request_digest !== requestDigest) {
        throw createCapabilityError('AGENT_CAPABILITY_IDEMPOTENCY_CONFLICT', 'The managed capability effect key was reused with different content.', { effectId: existing.agent_capability_effect_id });
      }
      const grant = await client.query(
        `SELECT execution_grant_id, grant_audience, credential_hash, credential_expires_at,
                grant_state, granted_at, revoked_at, grant_metadata, revocation_epoch
           FROM auth.execution_grants
          WHERE capability_effect_id = $1 AND grant_kind = 'MANAGED_CAPABILITY'`,
        [existing.agent_capability_effect_id],
      );
      return {
        decision: existing.authority_decision,
        replayed: true,
        capabilityRequest: null,
        effect: safeEffect(existing, grant.rows[0] || null),
      };
    }

    const authorization = await evaluateLiveAuthorization(client, run, request);
    const effectId = randomUUID();
    const executionGrantId = authorization.decision === 'ALLOW' ? randomUUID() : null;
    const managedCredentialReference = executionGrantId ? `grant:${executionGrantId}` : null;
    const nativeExecutionId = authorization.decision === 'ALLOW' ? randomUUID() : null;
    const nativeWorkflowId = authorization.decision === 'ALLOW'
      ? browserAutomationExecutionService.buildWorkflowId(request.capabilityCode)
      : null;
    const effectState = authorization.decision === 'ALLOW'
      ? 'INTENT'
      : authorization.decision === 'EXPLICIT_APPROVAL_REQUIRED' ? 'APPROVAL_REQUIRED' : 'DENIED';
    const metadata = {
      caseId: request.caseId,
      environmentCode: request.environmentCode,
      parameters: request.parameters,
      automationCode: request.capabilityCode,
      allocation: nativeExecutionId ? 'PREALLOCATED_BEFORE_DISPATCH' : 'NOT_ALLOCATED_DUE_TO_DENIAL',
      duplicateDeliveries: caseConfig.duplicateDeliveries,
    };
    const inserted = await client.query(
      `INSERT INTO worker.agent_capability_effects (
         agent_capability_effect_id, effect_key, execution_scope_id, agent_run_id,
         session_id, agent_turn_id, provider_operation_id, project_id,
         agent_definition_id, definition_version_id, initiating_user_id,
         initiating_actor_kind, initiating_actor_id, initiating_actor_snapshot,
         capability_kind, capability_code, capability_version, request_digest,
         request_metadata, authority_decision, authority_snapshot_id,
         authority_epoch, policy_revision, policy_digest,
         execution_surface_decision, managed_credential_reference,
         native_browser_execution_id, native_browser_workflow_id,
         dispatch_state, outcome_certainty, denial_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25::jsonb,$26,$27,$28,$29,$30,$31)
       RETURNING *`,
      [
        effectId,
        effectKey,
        run.execution_scope_id,
        run.agent_run_id,
        run.session_id,
        turnId || null,
        operationId || null,
        run.project_id,
        run.definition_id,
        run.definition_version_id,
        run.initiating_user_id,
        run.initiating_actor_kind,
        run.initiating_actor_id,
        JSON.stringify(normalizeActorSnapshot(run)),
        CAPABILITY_KIND,
        request.capabilityCode,
        request.capabilityVersion,
        requestDigest,
        JSON.stringify(metadata),
        authorization.decision,
        run.authority_snapshot_id,
        Math.max(Number(run.revocation_epoch), Number(run.scope_revocation_epoch)),
        authorization.policyRevision || run.project_policy_revision || 'agent-policy.v1',
        authorization.policyDigest || sha256Digest({ decision: authorization.decision, reason: authorization.reason }),
        JSON.stringify(authorization.executionSurfaceDecision || { surface: CAPABILITY_SURFACE, mode: 'DENY', reason: authorization.reason }),
        managedCredentialReference,
        nativeExecutionId,
        nativeWorkflowId,
        effectState,
        authorization.decision === 'ALLOW' ? 'UNKNOWN' : 'REJECTED',
        authorization.reason || null,
      ],
    );
    const effect = inserted.rows[0];
    let grant = null;
    let managedCredential = null;
    if (authorization.decision === 'ALLOW') {
      managedCredential = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + CREDENTIAL_TTL_MS);
      const grantResult = await client.query(
        `INSERT INTO auth.execution_grants (
           execution_grant_id, execution_scope_id, agent_run_id, principal_id, grant_kind,
           authority_snapshot_id, revocation_epoch, grant_state,
           capability_effect_id, grant_audience, credential_hash,
           credential_expires_at, grant_metadata
         ) VALUES ($1,$2,$3,$4,'MANAGED_CAPABILITY',$5,$6,'ACTIVE',$7,$8,$9,$10,$11::jsonb)
         RETURNING execution_grant_id, grant_audience, credential_hash, credential_expires_at,
                   grant_state, granted_at, revoked_at, grant_metadata, revocation_epoch`,
        [
          executionGrantId,
          run.execution_scope_id,
          run.agent_run_id,
          run.initiating_principal_id,
          run.authority_snapshot_id,
          Math.max(Number(run.revocation_epoch), Number(run.scope_revocation_epoch)),
          effectId,
          MANAGED_CREDENTIAL_AUDIENCE,
          hashCredential(managedCredential),
          expiresAt.toISOString(),
          JSON.stringify({
            capabilityKind: CAPABILITY_KIND,
            capabilityCode: CAPABILITY_CODE,
            effectId,
            credentialReference: managedCredentialReference,
          }),
        ],
      );
      grant = grantResult.rows[0];
    }
    await appendEvent(client, {
      run,
      eventType: 'AGENT_CAPABILITY_AUTHORIZATION_DECIDED',
      sourceCursor: `capability:${effectId}:decision`,
      availability: authorization.decision === 'ALLOW' ? 'REPORTED' : 'ERROR',
      payload: {
        effectId,
        effectKey,
        capabilityKind: CAPABILITY_KIND,
        capabilityCode: CAPABILITY_CODE,
        capabilityVersion: CAPABILITY_VERSION,
        decision: authorization.decision,
        reason: authorization.reason || null,
        authorityEpoch: Math.max(Number(run.revocation_epoch), Number(run.scope_revocation_epoch)),
        policyRevision: authorization.policyRevision || run.project_policy_revision || 'agent-policy.v1',
        requestDigest,
        nativeBrowserWorkflowId: nativeWorkflowId,
        managedCredential: grant ? safeManagedCredential(effect, grant) : null,
      },
    });
    const safe = safeEffect(effect, grant);
    return {
      decision: authorization.decision,
      replayed: false,
      effect: safe,
      capabilityRequest: authorization.decision === 'ALLOW'
        ? {
          effectId,
          effectKey,
          credential: managedCredential,
          audience: MANAGED_CREDENTIAL_AUDIENCE,
          capabilityKind: CAPABILITY_KIND,
          capabilityCode: CAPABILITY_CODE,
          capabilityVersion: CAPABILITY_VERSION,
          environmentCode: CAPABILITY_ENVIRONMENT,
          parameters: {},
          requestDigest,
        }
        : {
          effectId,
          effectKey,
          credential: null,
          audience: null,
          capabilityKind: CAPABILITY_KIND,
          capabilityCode: CAPABILITY_CODE,
          capabilityVersion: CAPABILITY_VERSION,
          environmentCode: CAPABILITY_ENVIRONMENT,
          parameters: {},
          requestDigest,
          decision: authorization.decision,
        },
    };
  });
}

async function revokeBeforeDispatch({ runId, effectId } = {}) {
  return withTransaction(async (client) => {
    const run = await loadRun(client, runId, true);
    if (!run) throw createCapabilityError('AGENT_RUN_NOT_FOUND', 'Agent Run not found while revoking the managed capability fixture.');
    const effect = await loadEffect(client, effectId, true);
    if (!effect) throw createCapabilityError('AGENT_CAPABILITY_EFFECT_NOT_FOUND', 'Managed capability effect not found while revoking.');
    const nextEpoch = Math.max(Number(run.revocation_epoch), Number(run.scope_revocation_epoch)) + 1;
    await client.query(
      `UPDATE worker.execution_scopes
          SET revocation_epoch = $2, status = 'STOP_REQUESTED', stop_reason = 'PHASE19_2B_CAPABILITY_REVOCATION'
        WHERE execution_scope_id = $1`,
      [run.execution_scope_id, nextEpoch],
    );
    await client.query(
      `UPDATE worker.agent_runs
          SET revocation_epoch = $2, status = CASE WHEN status IN ('COMPLETED','FAILED','TIMED_OUT','CANCELED','RECOVERY_REQUIRED') THEN status ELSE 'CANCEL_REQUESTED' END,
              stop_state = CASE WHEN status IN ('COMPLETED','FAILED','TIMED_OUT','CANCELED','RECOVERY_REQUIRED') THEN stop_state ELSE 'REQUESTED' END
        WHERE agent_run_id = $1`,
      [run.agent_run_id, nextEpoch],
    );
    await client.query(
      `UPDATE auth.execution_grants
          SET grant_state = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, revocation_epoch = $2,
              grant_metadata = jsonb_set(
                COALESCE(grant_metadata, '{}'::jsonb),
                '{revocationReason}',
                to_jsonb('REVOCATION_EPOCH_CHANGED_BEFORE_DISPATCH'::text),
                TRUE
              )
        WHERE agent_run_id = $1 AND grant_state = 'ACTIVE'`,
      [run.agent_run_id, nextEpoch],
    );
    await client.query(
      `UPDATE worker.agent_capability_effects
          SET dispatch_state = 'DENIED', outcome_certainty = 'REJECTED', denial_reason = 'REVOCATION_EPOCH_CHANGED_BEFORE_DISPATCH',
              reconciliation_metadata = jsonb_build_object('revokedBeforeDispatch', TRUE, 'revocationEpoch', $2::integer)
        WHERE agent_capability_effect_id = $1 AND dispatch_state IN ('INTENT','DISPATCHING','RECONCILING')`,
      [effectId, nextEpoch],
    );
    await appendEvent(client, {
      run,
      eventType: 'AGENT_CAPABILITY_REVOKED_BEFORE_DISPATCH',
      sourceCursor: `capability:${effectId}:revoked:${nextEpoch}`,
      availability: 'ERROR',
      payload: { effectId, revocationEpoch: nextEpoch, nativeBrowserExecutionStarted: false },
    });
    return { effectId, runId, revocationEpoch: nextEpoch, decision: 'DENY', reason: 'REVOCATION_EPOCH_CHANGED_BEFORE_DISPATCH' };
  });
}

async function beginDispatch({ effectId, credential, runtimeWorker } = {}) {
  return withTransaction(async (client) => {
    const effect = await loadEffect(client, effectId, true);
    if (!effect) throw createCapabilityError('AGENT_CAPABILITY_EFFECT_NOT_FOUND', 'Managed capability effect not found.');
    const run = await loadRun(client, effect.agent_run_id, true);
    if (!run) throw createCapabilityError('AGENT_RUN_NOT_FOUND', 'Agent Run not found for managed capability effect.');
    if (['COMPLETED', 'FAILED', 'DENIED', 'APPROVAL_REQUIRED', 'CANCELED'].includes(effect.dispatch_state)) {
      return {
        replayed: true,
        denied: effect.dispatch_state === 'DENIED' || effect.dispatch_state === 'APPROVAL_REQUIRED',
        effect: safeEffect(effect, effect),
        run,
        nativeBrowserWorkflowId: effect.native_browser_workflow_id,
      };
    }

    const grantResult = await client.query(
      `SELECT execution_grant_id, grant_audience, credential_hash, credential_expires_at,
              grant_state, granted_at, revoked_at, grant_metadata, revocation_epoch
         FROM auth.execution_grants
        WHERE capability_effect_id = $1 AND grant_kind = 'MANAGED_CAPABILITY'
        FOR UPDATE`,
      [effectId],
    );
    const grant = grantResult.rows[0];
    const request = {
      capabilityKind: effect.capability_kind,
      capabilityCode: effect.capability_code,
      capabilityVersion: effect.capability_version,
      environmentCode: effect.request_metadata?.environmentCode || CAPABILITY_ENVIRONMENT,
      parameters: effect.request_metadata?.parameters || {},
      caseId: effect.request_metadata?.caseId || null,
    };
    const authorization = await evaluateLiveAuthorization(client, run, request);
    const credentialValid = isManagedCredentialValid({ grant, credential, run, effect });
    if (authorization.decision !== 'ALLOW' || !credentialValid) {
      const reason = authorization.reason || (!credentialValid ? 'MANAGED_CREDENTIAL_INVALID_OR_STALE' : 'MANAGED_CAPABILITY_DENIED');
      await client.query(
        `UPDATE worker.agent_capability_effects
            SET dispatch_state = CASE WHEN $2 = 'EXPLICIT_APPROVAL_REQUIRED' THEN 'APPROVAL_REQUIRED' ELSE 'DENIED' END,
                outcome_certainty = 'REJECTED', denial_reason = $3,
                reconciliation_metadata = jsonb_build_object('checkedAt', CURRENT_TIMESTAMP, 'runtimeWorker', $4::jsonb)
          WHERE agent_capability_effect_id = $1`,
        [effectId, authorization.decision, reason, JSON.stringify(runtimeWorker || {})],
      );
      await appendEvent(client, {
        run,
        eventType: 'AGENT_CAPABILITY_DISPATCH_DENIED',
        sourceCursor: `capability:${effectId}:dispatch-denied:${sha256Digest({ reason, epoch: run.scope_revocation_epoch })}`,
        availability: 'ERROR',
        payload: { effectId, reason, decision: authorization.decision, authorityEpoch: run.scope_revocation_epoch, nativeBrowserExecutionStarted: false },
      });
      const denied = await loadEffect(client, effectId);
      return { replayed: false, denied: true, effect: safeEffect(denied, grant), run, nativeBrowserWorkflowId: effect.native_browser_workflow_id };
    }

    await client.query(
      `UPDATE worker.agent_capability_effects
          SET dispatch_state = 'DISPATCHING',
              runtime_worker_identity = $2,
              runtime_worker_generation = $3,
              runtime_task_queue = $4,
              runtime_observed_at = CURRENT_TIMESTAMP
        WHERE agent_capability_effect_id = $1`,
      [effectId, runtimeWorker?.identity || null, runtimeWorker?.generation || null, runtimeWorker?.taskQueue || null],
    );
    return {
      replayed: false,
      denied: false,
      effect,
      run,
      grant,
      automation: authorization.automation,
      nativeBrowserWorkflowId: effect.native_browser_workflow_id,
      nativeBrowserExecutionId: effect.native_browser_execution_id,
      managedContext: {
        effectId,
        projectId: run.project_id,
        executionScopeId: run.execution_scope_id,
        agentRunId: run.agent_run_id,
        sessionId: run.session_id,
        turnId: effect.agent_turn_id,
        agentDefinitionId: run.definition_id,
        definitionVersionId: run.definition_version_id,
        initiatingUserId: run.initiating_user_id,
        initiatingActor: normalizeActorSnapshot(run),
        authoritySnapshotId: run.authority_snapshot_id,
        authorityEpoch: effect.authority_epoch,
        policyRevision: effect.policy_revision,
      },
    };
  });
}

function safeBrowserResult(run) {
  if (!run) return null;
  return {
    browserAutomationRunId: run.browserAutomationRunId || run.browser_automation_run_id || null,
    executionId: run.executionId || null,
    workflowId: run.workflowId || null,
    runId: run.runId || null,
    automationCode: run.automationCode || null,
    status: run.status || null,
    temporalStatus: run.temporalStatus || null,
    artifactCount: Number(run.artifactCount || 0),
    sourceCommit: run.sourceCommit || null,
  };
}

async function waitForBrowserResult(workflowId) {
  const started = Date.now();
  let current = null;
  while (Date.now() - started <= BROWSER_WAIT_TIMEOUT_MS) {
    current = await browserAutomationExecutionService.getRun(workflowId, { internalManaged: true });
    if (current && TERMINAL_BROWSER_STATUSES.has(String(current.status || '').toUpperCase())) return current;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return current;
}

async function finishEffect(effectId, { state, certainty, result = null, reason = null, reconciliation = {} } = {}) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE worker.agent_capability_effects
          SET dispatch_state = $2,
              outcome_certainty = $3,
              result_summary = $4::jsonb,
              denial_reason = $5,
              reconciliation_metadata = $6::jsonb
        WHERE agent_capability_effect_id = $1`,
      [effectId, state, certainty, result ? JSON.stringify(result) : null, reason, JSON.stringify(reconciliation || {})],
    );
    const row = await loadEffect(client, effectId);
    return safeEffect(row, row);
  });
}

async function dispatchManagedCapability({ effectId, credential, runtimeWorker, simulateUnknownDispatch = false } = {}) {
  const begun = await beginDispatch({ effectId, credential, runtimeWorker });
  if (begun.replayed || begun.denied) {
    return { ...begun.effect, browserResult: begun.effect?.result || null, replayed: Boolean(begun.replayed), denied: Boolean(begun.denied) };
  }

  try {
    const started = await browserAutomationExecutionService.startRegisteredAutomation({
      automationCode: begun.automation.automationCode,
      body: {
        environmentCode: begun.automation.defaultEnvironmentCode || CAPABILITY_ENVIRONMENT,
        parameters: begun.effect.requestMetadata?.parameters || {},
        executionMode: 'HEADLESS',
        confirmed: false,
      },
      permissions: [{ permissionCode: 'BROWSER_AUTOMATION_RUN' }],
      actor: {
        userId: begun.run.initiating_user_id,
        displayName: begun.managedContext.initiatingActor?.displayNameSnapshot || 'Managed Agent Run User',
        roleCodes: [],
      },
      triggerSource: 'AGENT_MANAGED',
      preallocatedExecution: {
        executionId: begun.nativeBrowserExecutionId,
        workflowId: begun.nativeBrowserWorkflowId,
      },
      managedContext: begun.managedContext,
    });
    const workflowId = begun.nativeBrowserWorkflowId || started.execution.workflowId;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE worker.agent_capability_effects
            SET dispatch_state = 'RECONCILING',
                browser_automation_run_id = $2,
                native_browser_execution_id = COALESCE(native_browser_execution_id, $3),
                native_browser_workflow_id = COALESCE(native_browser_workflow_id, $4)
          WHERE agent_capability_effect_id = $1`,
        [effectId, started.execution.browserAutomationRunId, started.execution.executionId, workflowId],
      );
    });

    // The unknown-dispatch fixture deliberately does not trust the start response.
    // It reconciles using the already persisted native workflow identity.
    const browserRun = await waitForBrowserResult(workflowId);
    const browserSummary = safeBrowserResult(browserRun);
    const status = String(browserRun?.status || 'UNKNOWN').toUpperCase();
    const terminalSuccess = status === 'SUCCESS';
    const terminalFailure = TERMINAL_BROWSER_STATUSES.has(status) && !terminalSuccess;
    const effect = await finishEffect(effectId, {
      state: terminalSuccess ? 'COMPLETED' : terminalFailure ? 'FAILED' : 'RECONCILING',
      certainty: terminalSuccess ? 'ACKNOWLEDGED' : terminalFailure ? 'REJECTED' : 'UNKNOWN',
      result: browserSummary,
      reason: terminalFailure ? `NATIVE_BROWSER_${status}` : null,
      reconciliation: {
        nativeIdReused: true,
        simulatedUnknownDispatch: Boolean(simulateUnknownDispatch),
        reconciledWorkflowId: workflowId,
        browserStatus: status,
      },
    });
    return { ...effect, browserResult: browserSummary, replayed: false, denied: false };
  } catch (error) {
    const effect = await finishEffect(effectId, {
      state: 'FAILED',
      certainty: 'UNKNOWN',
      reason: error.code || 'MANAGED_BROWSER_DISPATCH_FAILED',
      reconciliation: { message: text(error.message, 'Managed Browser dispatch failed.') },
    });
    return { ...effect, browserResult: null, replayed: false, denied: false };
  }
}

async function getManagedCapabilityEffects(runId) {
  const result = await query(
    `SELECT e.*,
            g.execution_grant_id,
            g.grant_audience,
            g.credential_hash,
            g.credential_expires_at,
            g.grant_state,
            g.granted_at,
            g.revoked_at,
            g.grant_metadata,
            g.revocation_epoch AS grant_revocation_epoch
       FROM worker.agent_capability_effects e
       LEFT JOIN auth.execution_grants g
         ON g.capability_effect_id = e.agent_capability_effect_id
        AND g.grant_kind = 'MANAGED_CAPABILITY'
      WHERE e.agent_run_id = $1
      ORDER BY e.created_at, e.agent_capability_effect_id`,
    [runId],
  );
  return result.rows.map((row) => safeEffect(row, row));
}

module.exports = {
  CAPABILITY_CODE,
  CAPABILITY_KIND,
  CAPABILITY_SURFACE,
  MANAGED_CREDENTIAL_AUDIENCE,
  MANAGED_BROWSER_CASES,
  dispatchManagedCapability,
  getManagedCapabilityEffects,
  hashCredential,
  isManagedCredentialValid,
  isManagedBrowserCase,
  prepareManagedCapabilityEffect,
  revokeBeforeDispatch,
  safeManagedCredential,
};
