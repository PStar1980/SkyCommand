const { pool, query } = require('../../../../packages/db/src/connection');
const authService = require('./authService');
const {
  EXECUTION_SURFACES,
  EXECUTION_SURFACE_MODES,
  evaluateAuthority,
  intersectConstraints,
  intersectScopes,
  intersectExecutionSurfacePolicies,
  normalizeConstraints,
  normalizeScope,
} = require('../../../../packages/agents/src/authority');
const {
  normalizeRuntimeConfigurationIdentity,
  runtimeEligibility,
  evaluateRuntimeCompatibility,
  safeRuntimeInstallation,
} = require('../../../../packages/agents/src/runtimeConfiguration');
const { sha256Digest, uniqueSorted } = require('../../../../packages/agents/src/canonical');

const MAX_TEXT_LENGTH = 240;
const MAX_JSON_LENGTH = 20000;
const FORBIDDEN_KEYS = /(?:secret|token|password|credential|private.?key|root.?path|workspace.?path|executable|run.?id|parent.?id|root.?execution|provider.?launch|transport)/i;
const PROJECT_RIGHTS = Object.freeze(['PROJECT_READ', 'PROJECT_MANAGE', 'AUTHORITY_PREVIEW']);
const ADMIN_ALL_ROLE_CODES = Object.freeze(['SUPER_ADMIN', 'ADMIN_ALL']);

function createServiceError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code, ...details };
  return error;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function optionalText(value, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value);
  if (!normalized || normalized.length > maxLength) {
    throw createServiceError(400, 'AGENT_TEXT_INVALID', 'A text field is empty or exceeds the supported length.');
  }
  return normalized;
}

function requiredText(value, fieldName) {
  const normalized = optionalText(value);
  if (!normalized) throw createServiceError(400, 'AGENT_FIELD_REQUIRED', `${fieldName} is required.`);
  return normalized;
}

function assertUuid(value, fieldName) {
  const normalized = requiredText(value, fieldName);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw createServiceError(400, 'AGENT_ID_INVALID', `${fieldName} must be a valid registered identifier.`);
  }
  return normalized;
}

function actorId(req) {
  return req?.user?.userId || null;
}

function auditRequestContext(req) {
  return {
    ipAddress: req?.ip || req?.socket?.remoteAddress || null,
    userAgent: typeof req?.get === 'function' ? req.get('user-agent') : null,
  };
}

function registryAuditEvent(req, {
  resourceType,
  resourceId,
  action,
  message,
  metadata = {},
} = {}) {
  return {
    appCode: req?.session?.appCode,
    userId: actorId(req),
    eventType: 'AGENT_REGISTRY_MUTATION',
    resourceType,
    resourceId,
    action,
    success: true,
    message,
    metadata: {
      phase: '19.1',
      actorUserId: actorId(req),
      ...metadata,
    },
    ...auditRequestContext(req),
  };
}

async function withRegistryTransaction(work) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await work(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original mutation/audit failure for the caller.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function recordRegistryAuditWithClient(client, req, details) {
  return authService.recordAuditEventWithClient(client, registryAuditEvent(req, details));
}

function permissions(req) {
  return new Set((req?.permissions || []).map((permission) => permission.permissionCode || permission).filter(Boolean));
}

function hasGlobalPermission(req, permissionCode) {
  return permissions(req).has(permissionCode);
}

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createServiceError(400, 'AGENT_OBJECT_INVALID', `${fieldName} must be an object.`);
  }
  return value;
}

function assertNoForbiddenKeys(value, path = 'body') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) {
      throw createServiceError(400, 'AGENT_INPUT_NOT_ALLOWED', `${path}.${key} is not accepted by the Phase 19.1 registry surface.`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function safeJson(value, fieldName, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  assertPlainObject(value, fieldName);
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_JSON_LENGTH) {
    throw createServiceError(400, 'AGENT_JSON_TOO_LARGE', `${fieldName} exceeds the supported size.`);
  }
  assertNoForbiddenKeys(value, fieldName);
  return value;
}

function normalizeSurfacePolicy(value) {
  const policy = value && typeof value === 'object' ? value : {};
  const entries = Array.isArray(policy.surfaces) ? policy.surfaces : [];
  const seen = new Set();
  const surfaces = entries
    .filter((entry) => entry && EXECUTION_SURFACES.includes(entry.surface))
    .map((entry) => {
      if (seen.has(entry.surface)) {
        throw createServiceError(400, 'AGENT_SURFACE_DUPLICATE', `Execution surface ${entry.surface} is repeated.`);
      }
      seen.add(entry.surface);
      if (!EXECUTION_SURFACE_MODES.includes(entry.mode)) {
        throw createServiceError(400, 'AGENT_SURFACE_MODE_INVALID', `Execution surface ${entry.surface} has an invalid mode.`);
      }
      return {
        surface: entry.surface,
        mode: entry.mode,
        reason: optionalText(entry.reason, 300),
      };
    })
    .sort((left, right) => left.surface.localeCompare(right.surface));

  return {
    surfaces,
    permittedTransitions: Array.isArray(policy.permittedTransitions)
      ? policy.permittedTransitions
          .filter((entry) => EXECUTION_SURFACES.includes(entry?.from) && EXECUTION_SURFACES.includes(entry?.to))
          .map((entry) => ({ from: entry.from, to: entry.to, reason: requiredText(entry.reason, 'Transition reason') }))
      : [],
  };
}

function normalizePolicy(value, fieldName = 'policy') {
  const policy = safeJson(value, fieldName, {});
  const scope = normalizeScope(policy.scope || policy);
  const executionSurfaces = normalizeSurfacePolicy(policy.executionSurfaces || policy.surfaces || {});
  const constraints = normalizeConstraints(policy.constraints || {});
  const obligations = uniqueSorted(Array.isArray(policy.obligations) ? policy.obligations : []);

  return {
    scope,
    executionSurfaces,
    constraints,
    obligations,
    policyRevision: optionalText(policy.policyRevision, 120) || 'agent-policy.v1',
  };
}

function normalizeMemberRights(value) {
  const rights = value === undefined
    ? ['PROJECT_READ']
    : [...new Set((Array.isArray(value) ? value : [value]).map((right) => String(right || '').trim().toUpperCase()).filter(Boolean))];
  const invalid = rights.filter((right) => !PROJECT_RIGHTS.includes(right));
  if (invalid.length > 0) {
    throw createServiceError(400, 'AGENT_MEMBER_RIGHT_INVALID', `Unsupported project member right: ${invalid[0]}.`);
  }
  return rights;
}

function safeProject(row) {
  return {
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    description: row.description,
    lifecycleState: row.lifecycle_state,
    dataClassification: row.data_classification,
    policyRevision: row.policy_revision,
    authorityPolicy: row.authority_policy || {},
    recordVersion: row.record_version,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeAgent(row) {
  return {
    definitionId: row.definition_id,
    agentCode: row.agent_code,
    agentName: row.agent_name,
    description: row.description,
    lifecycleState: row.lifecycle_state,
    active: row.active,
    recordVersion: row.record_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeVersion(row) {
  return {
    definitionVersionId: row.definition_version_id,
    definitionId: row.definition_id,
    revision: row.revision,
    contentDigest: row.content_digest,
    instructionReference: row.instruction_reference,
    instructionDigest: row.instruction_digest,
    installationId: row.installation_id,
    accountBindingId: row.account_binding_id,
    capabilityProfileId: row.capability_profile_id,
    policyRevision: row.policy_revision,
    configuration: row.configuration || {},
    createdAt: row.created_at,
  };
}

function safeWorkspace(row) {
  return {
    projectWorkspaceId: row.project_workspace_id,
    projectId: row.project_id,
    repoPathId: row.repo_path_id,
    repoCode: row.repo_code,
    repoName: row.repo_name,
    profileCode: row.profile_code,
    environmentCode: row.environment_code,
    workspaceMode: row.workspace_mode,
    policyRevision: row.policy_revision,
    recordVersion: row.record_version,
    active: row.active,
  };
}

function safeAccount(row) {
  return {
    accountBindingId: row.account_binding_id,
    installationId: row.installation_id,
    accountCode: row.account_code,
    accountAlias: row.account_alias,
    trustDomain: row.trust_domain,
    usageVisibility: row.usage_visibility,
    accountState: row.account_state,
    ownerUserId: row.owner_user_id || null,
    policyRevision: row.policy_revision,
    executionEnabled: false,
  };
}

function safeCapabilityProfile(row) {
  return {
    capabilityProfileId: row.capability_profile_id,
    profileCode: row.profile_code,
    profileName: row.profile_name,
    policySchemaVersion: row.policy_schema_version,
    policyRevision: row.policy_revision,
    policyDigest: row.policy_digest,
    active: row.active,
    executionEnabled: false,
  };
}

function safeRuntime(row) {
  return safeRuntimeInstallation(row);
}

async function hasVerifiedAdminAll(req) {
  const userId = actorId(req);
  if (!userId || !hasGlobalPermission(req, 'AGENT_PROJECT_MANAGE')) return false;
  const roleCodes = new Set((req?.user?.roleCodes || []).map((roleCode) => String(roleCode).trim().toUpperCase()));
  if (!ADMIN_ALL_ROLE_CODES.some((roleCode) => roleCodes.has(roleCode))) return false;
  const result = await query(
    `SELECT EXISTS (
       SELECT 1
       FROM auth.user_roles ur
       JOIN auth.roles r ON r.role_id = ur.role_id
       JOIN core.applications app ON app.app_id = r.app_id AND app.app_code = 'SKYSERVER_ADMIN' AND app.active = TRUE
       WHERE ur.user_id = $1 AND ur.active = TRUE AND r.active = TRUE
         AND r.role_code = ANY($2::text[])
     ) AS verified_admin_all`,
    [userId, ADMIN_ALL_ROLE_CODES],
  );
  return result.rows[0]?.verified_admin_all === true;
}

function memberHasRight(memberships, userId, rightCode) {
  return (memberships || []).some((member) => (
    member.user_id === userId
    && member.membership_state === 'ACTIVE'
    && member.right_code === rightCode
    && member.active === true
  ));
}

async function getProjectAccess(projectId, req, rightCode = 'PROJECT_READ') {
  if (await hasVerifiedAdminAll(req)) return { allowed: true, global: true, adminAll: true, rightCode };
  const userId = actorId(req);
  if (!userId) return { allowed: false, global: false, rightCode };
  const result = await query(
    `
      SELECT pm.project_member_id, pm.user_id, pm.membership_state, pmr.right_code, pmr.active
      FROM core.project_members pm
      JOIN core.project_member_rights pmr ON pmr.project_member_id = pm.project_member_id
      WHERE pm.project_id = $1 AND pm.user_id = $2
        AND pm.membership_state = 'ACTIVE' AND pmr.right_code = $3 AND pmr.active = TRUE
      LIMIT 1
    `,
    [projectId, userId, rightCode],
  );
  return {
    allowed: memberHasRight(result.rows, userId, rightCode),
    global: false,
    adminAll: false,
    rightCode,
    member: result.rows[0] || null,
  };
}

async function requireProjectAccess(projectId, req, rightCode = 'PROJECT_READ') {
  const access = await getProjectAccess(projectId, req, rightCode);
  if (!access.allowed) {
    throw createServiceError(404, 'AGENT_PROJECT_NOT_FOUND', 'The requested Agent Project is not visible to this user.');
  }
  return access;
}

function requireGlobal(req, permissionCode) {
  if (!hasGlobalPermission(req, permissionCode)) {
    throw createServiceError(403, 'AGENT_PERMISSION_REQUIRED', `Permission ${permissionCode} is required.`);
  }
}

async function listProjects(req, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const global = await hasVerifiedAdminAll(req);
  const params = global ? [limit, offset] : [actorId(req), limit, offset];
  const visibility = global
    ? ''
    : `JOIN core.project_members visible_member ON visible_member.project_id = p.project_id
       JOIN core.project_member_rights visible_right ON visible_right.project_member_id = visible_member.project_member_id
         AND visible_right.right_code = 'PROJECT_READ' AND visible_right.active = TRUE
       WHERE visible_member.user_id = $1 AND visible_member.membership_state = 'ACTIVE'`;
  const limitParam = global ? '$1' : '$2';
  const offsetParam = global ? '$2' : '$3';
  const count = await query(`SELECT COUNT(DISTINCT p.project_id)::int AS total FROM core.projects p ${visibility}`, global ? [] : [actorId(req)]);
  const rows = await query(
    `SELECT DISTINCT p.* FROM core.projects p ${visibility}
     ORDER BY p.project_name, p.project_code LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );
  return { total: count.rows[0]?.total || 0, limit, offset, items: rows.rows.map(safeProject) };
}

async function getProject(projectId, req) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_READ');
  const projectResult = await query('SELECT * FROM core.projects WHERE project_id = $1 AND active = TRUE LIMIT 1', [id]);
  if (projectResult.rowCount === 0) throw createServiceError(404, 'AGENT_PROJECT_NOT_FOUND', 'The requested Agent Project is not visible to this user.');

  const [repositories, workspaces, members, allowRules] = await Promise.all([
    query(
      `SELECT pr.project_repository_id, pr.repo_id, r.repo_code, r.repo_name, pr.active
       FROM core.project_repositories pr JOIN core.repositories r ON r.repo_id = pr.repo_id
       WHERE pr.project_id = $1 ORDER BY r.repo_name`,
      [id],
    ),
    query(
      `SELECT pw.project_workspace_id, pw.project_id, pw.repo_path_id, pw.environment_code,
              pw.workspace_mode, pw.policy_revision, pw.record_version, pw.active,
              r.repo_code, r.repo_name, cp.profile_code
       FROM core.project_workspaces pw
       JOIN core.repository_paths rp ON rp.repo_path_id = pw.repo_path_id
       JOIN core.repositories r ON r.repo_id = rp.repo_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
       WHERE pw.project_id = $1 ORDER BY r.repo_name, cp.profile_code`,
      [id],
    ),
    query(
      `SELECT pm.project_member_id, pm.user_id, u.email, u.display_name, pm.membership_state,
              COALESCE(array_agg(pmr.right_code ORDER BY pmr.right_code) FILTER (WHERE pmr.active), ARRAY[]::text[]) AS rights
       FROM core.project_members pm JOIN auth.users u ON u.user_id = pm.user_id
       LEFT JOIN core.project_member_rights pmr ON pmr.project_member_id = pm.project_member_id
       WHERE pm.project_id = $1 GROUP BY pm.project_member_id, u.email, u.display_name
       ORDER BY u.display_name, u.email`,
      [id],
    ),
    query(
      `SELECT par.project_agent_allow_rule_id, par.definition_id, par.definition_version_id,
              d.agent_code, d.agent_name, par.allow_state, par.policy_revision
       FROM core.project_agent_allow_rules par JOIN core.agent_definitions d ON d.definition_id = par.definition_id
       WHERE par.project_id = $1 ORDER BY d.agent_name, par.definition_version_id NULLS FIRST`,
      [id],
    ),
  ]);
  return {
    project: safeProject(projectResult.rows[0]),
    repositories: repositories.rows.map((row) => ({
      projectRepositoryId: row.project_repository_id,
      repoId: row.repo_id,
      repoCode: row.repo_code,
      repoName: row.repo_name,
      active: row.active,
    })),
    workspaces: workspaces.rows.map(safeWorkspace),
    members: members.rows.map((row) => ({
      projectMemberId: row.project_member_id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      membershipState: row.membership_state,
      rights: row.rights,
    })),
    allowRules: allowRules.rows.map((row) => ({
      projectAgentAllowRuleId: row.project_agent_allow_rule_id,
      definitionId: row.definition_id,
      definitionVersionId: row.definition_version_id,
      agentCode: row.agent_code,
      agentName: row.agent_name,
      allowState: row.allow_state,
      policyRevision: row.policy_revision,
    })),
  };
}

async function createProject(req, body = {}) {
  requireGlobal(req, 'AGENT_PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const projectCode = requiredText(body.projectCode, 'projectCode');
  const projectName = requiredText(body.projectName, 'projectName');
  const policy = normalizePolicy(body.authorityPolicy, 'authorityPolicy');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const project = await client.query(
      `INSERT INTO core.projects (project_code, project_name, description, lifecycle_state, data_classification, policy_revision, authority_policy, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)
       RETURNING *`,
      [projectCode, projectName, optionalText(body.description), text(body.lifecycleState, 'DRAFT'), text(body.dataClassification, 'INTERNAL'), policy.policyRevision, JSON.stringify(policy), actorId(req)],
    );
    if (actorId(req)) {
      const member = await client.query(
        `INSERT INTO core.project_members (project_id, user_id, created_by, updated_by)
         VALUES ($1, $2, $2, $2) RETURNING project_member_id`,
        [project.rows[0].project_id, actorId(req)],
      );
      await client.query(
        `INSERT INTO core.project_member_rights (project_member_id, right_code, created_by, updated_by)
         SELECT $1, right_code, $2, $2 FROM unnest($3::text[]) AS right_code
         ON CONFLICT (project_member_id, right_code) DO UPDATE SET active = TRUE, updated_by = EXCLUDED.updated_by`,
        [member.rows[0].project_member_id, actorId(req), PROJECT_RIGHTS],
      );
      await client.query(
        `INSERT INTO auth.execution_principals (principal_type, user_id, principal_code, created_by, updated_by)
         VALUES ('USER', $1, $2, $1, $1) ON CONFLICT (principal_code) DO NOTHING`,
        [actorId(req), `user:${actorId(req)}`],
      );
      await recordRegistryAuditWithClient(client, req, {
        resourceType: 'core.project_members',
        resourceId: member.rows[0].project_member_id,
        action: 'create_project_owner_membership',
        message: 'Project owner membership and rights created with Agent Project.',
        metadata: {
          projectId: project.rows[0].project_id,
          projectMemberId: member.rows[0].project_member_id,
          memberUserId: actorId(req),
          rights: PROJECT_RIGHTS,
        },
      });
    }
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.projects',
      resourceId: project.rows[0].project_id,
      action: 'create_project',
      message: 'Agent Project registry record created.',
      metadata: {
        projectId: project.rows[0].project_id,
        policyRevision: project.rows[0].policy_revision,
        recordVersion: project.rows[0].record_version,
        ownerMembershipCreated: Boolean(actorId(req)),
      },
    });
    await client.query('COMMIT');
    return { project: safeProject(project.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw createServiceError(409, 'AGENT_PROJECT_CODE_CONFLICT', 'The project code is already registered.');
    throw error;
  } finally {
    client.release();
  }
}

async function updateProject(projectId, req, body = {}) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if (body.projectName !== undefined) add('project_name', requiredText(body.projectName, 'projectName'));
  if (body.description !== undefined) add('description', optionalText(body.description));
  if (body.lifecycleState !== undefined) add('lifecycle_state', requiredText(body.lifecycleState, 'lifecycleState'));
  if (body.dataClassification !== undefined) add('data_classification', requiredText(body.dataClassification, 'dataClassification'));
  if (body.authorityPolicy !== undefined) {
    const policy = normalizePolicy(body.authorityPolicy, 'authorityPolicy');
    add('authority_policy', JSON.stringify(policy));
    add('policy_revision', policy.policyRevision);
  }
  if (fields.length === 0) throw createServiceError(400, 'AGENT_UPDATE_EMPTY', 'At least one supported project field is required.');
  const expectedVersion = Number(body.expectedRecordVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw createServiceError(400, 'AGENT_VERSION_REQUIRED', 'expectedRecordVersion is required for project updates.');
  values.push(id, expectedVersion, actorId(req));
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `UPDATE core.projects SET ${fields.join(', ')}, record_version = record_version + 1, updated_by = $${values.length}
       WHERE project_id = $${values.length - 2} AND record_version = $${values.length - 1} RETURNING *`,
      values,
    );
    if (result.rowCount === 0) throw createServiceError(409, 'AGENT_PROJECT_VERSION_CONFLICT', 'The project changed since it was read. Refresh before saving.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.projects',
      resourceId: result.rows[0].project_id,
      action: 'update_project',
      message: 'Agent Project registry record updated.',
      metadata: {
        projectId: result.rows[0].project_id,
        changedFields: fields.map((field) => field.split(' = ')[0]),
        policyRevision: result.rows[0].policy_revision,
        recordVersion: result.rows[0].record_version,
      },
    });
    return { project: safeProject(result.rows[0]) };
  });
}

async function upsertProjectMember(projectId, req, body = {}) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const userId = assertUuid(body.userId, 'userId');
  const membershipState = text(body.membershipState, 'ACTIVE');
  if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(membershipState)) {
    throw createServiceError(400, 'AGENT_MEMBERSHIP_STATE_INVALID', 'membershipState is invalid.');
  }
  const rights = normalizeMemberRights(body.rights);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const member = await client.query(
      `INSERT INTO core.project_members (project_id, user_id, membership_state, created_by, updated_by)
       SELECT $1, user_id, $3, $4, $4
       FROM auth.users
       WHERE user_id = $2 AND status = 'ACTIVE'
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET membership_state = EXCLUDED.membership_state,
                     record_version = core.project_members.record_version + 1,
                     updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [id, userId, membershipState, actorId(req)],
    );
    if (member.rowCount === 0) throw createServiceError(404, 'AGENT_USER_NOT_FOUND', 'The selected active user is not registered.');
    await client.query(
      `UPDATE core.project_member_rights
       SET active = FALSE, updated_by = $2
       WHERE project_member_id = $1 AND NOT (right_code = ANY($3::text[]))`,
      [member.rows[0].project_member_id, actorId(req), rights],
    );
    if (rights.length > 0) {
      await client.query(
        `INSERT INTO core.project_member_rights (project_member_id, right_code, active, created_by, updated_by)
         SELECT $1, right_code, TRUE, $2, $2
         FROM unnest($3::text[]) AS right_code
         ON CONFLICT (project_member_id, right_code)
         DO UPDATE SET active = TRUE, updated_by = EXCLUDED.updated_by`,
        [member.rows[0].project_member_id, actorId(req), rights],
      );
    }
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.project_members',
      resourceId: member.rows[0].project_member_id,
      action: 'upsert_project_membership',
      message: 'Agent Project membership and rights updated.',
      metadata: {
        projectId: member.rows[0].project_id,
        projectMemberId: member.rows[0].project_member_id,
        memberUserId: member.rows[0].user_id,
        membershipState: member.rows[0].membership_state,
        rights,
        recordVersion: member.rows[0].record_version,
      },
    });
    await client.query('COMMIT');
    return {
      member: {
        projectMemberId: member.rows[0].project_member_id,
        projectId: member.rows[0].project_id,
        userId: member.rows[0].user_id,
        membershipState: member.rows[0].membership_state,
        rights,
        recordVersion: member.rows[0].record_version,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listProjectOptions(req) {
  requireGlobal(req, 'AGENT_PROJECT_READ');
  const [repositories, paths] = await Promise.all([
    query(`SELECT repo_id, repo_code, repo_name FROM core.repositories WHERE active = TRUE ORDER BY repo_name`),
    query(
      `SELECT rp.repo_path_id, rp.repo_id, r.repo_code, r.repo_name, cp.profile_code, cp.profile_name
       FROM core.repository_paths rp JOIN core.repositories r ON r.repo_id = rp.repo_id
       JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
       WHERE rp.active = TRUE AND r.active = TRUE AND cp.active = TRUE
       ORDER BY r.repo_name, cp.profile_code`,
    ),
  ]);
  return {
    repositories: repositories.rows.map((row) => ({ repoId: row.repo_id, repoCode: row.repo_code, repoName: row.repo_name })),
    workspaceBindings: paths.rows.map((row) => ({
      repoPathId: row.repo_path_id,
      repoId: row.repo_id,
      repoCode: row.repo_code,
      repoName: row.repo_name,
      profileCode: row.profile_code,
      profileName: row.profile_name,
      environmentCode: row.profile_code,
    })),
  };
}

async function listProjectUsers(projectId, req) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_MANAGE');
  const result = await query(
    `SELECT user_id, email, display_name
     FROM auth.users
     WHERE status = 'ACTIVE'
     ORDER BY display_name NULLS LAST, email`,
  );
  return {
    items: result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
    })),
  };
}

async function bindRepository(projectId, req, body = {}) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const repoId = assertUuid(body.repoId, 'repoId');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.project_repositories (project_id, repo_id, created_by, updated_by)
       SELECT $1, repo_id, $3, $3 FROM core.repositories WHERE repo_id = $2 AND active = TRUE
       ON CONFLICT (project_id, repo_id) DO UPDATE SET active = TRUE, updated_by = EXCLUDED.updated_by
       RETURNING project_repository_id, project_id, repo_id, active`,
      [id, repoId, actorId(req)],
    );
    if (result.rowCount === 0) throw createServiceError(404, 'AGENT_REPOSITORY_NOT_FOUND', 'The registered repository is not available.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.project_repositories',
      resourceId: result.rows[0].project_repository_id,
      action: 'bind_project_repository',
      message: 'Registered repository bound to Agent Project.',
      metadata: {
        projectId: result.rows[0].project_id,
        repoId: result.rows[0].repo_id,
        projectRepositoryId: result.rows[0].project_repository_id,
        active: result.rows[0].active,
      },
    });
    return { repository: result.rows[0] };
  });
}

async function bindWorkspace(projectId, req, body = {}) {
  const id = assertUuid(projectId, 'projectId');
  await requireProjectAccess(id, req, 'PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const repoPathId = assertUuid(body.repoPathId, 'repoPathId');
  const workspaceMode = text(body.workspaceMode, 'READ_ONLY');
  if (workspaceMode !== 'READ_ONLY') throw createServiceError(400, 'AGENT_WORKSPACE_MODE_NOT_AVAILABLE', 'Phase 19.1 permits READ_ONLY registered workspace bindings only.');
  const policy = normalizePolicy(body.workspacePolicy, 'workspacePolicy');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.project_workspaces (project_id, repo_path_id, environment_code, workspace_mode, policy_revision, workspace_policy, created_by, updated_by)
       SELECT $1, rp.repo_path_id, cp.profile_code, 'READ_ONLY', $3, $4::jsonb, $5, $5
       FROM core.repository_paths rp JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
       JOIN core.project_repositories pr ON pr.project_id = $1 AND pr.repo_id = rp.repo_id AND pr.active = TRUE
       WHERE rp.repo_path_id = $2 AND rp.active = TRUE AND cp.active = TRUE
       ON CONFLICT (project_id, repo_path_id, workspace_mode)
       DO UPDATE SET active = TRUE, policy_revision = EXCLUDED.policy_revision, workspace_policy = EXCLUDED.workspace_policy, updated_by = EXCLUDED.updated_by
       RETURNING project_workspace_id, project_id, repo_path_id, environment_code, workspace_mode, policy_revision, record_version, active`,
      [id, repoPathId, policy.policyRevision, JSON.stringify(policy), actorId(req)],
    );
    if (result.rowCount === 0) throw createServiceError(409, 'AGENT_WORKSPACE_NOT_REGISTERED', 'The workspace must use an active repository path already bound to this project.');
    const detail = await client.query(
      `SELECT pw.*, r.repo_code, r.repo_name, cp.profile_code
       FROM core.project_workspaces pw JOIN core.repository_paths rp ON rp.repo_path_id = pw.repo_path_id
       JOIN core.repositories r ON r.repo_id = rp.repo_id JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
       WHERE pw.project_workspace_id = $1`,
      [result.rows[0].project_workspace_id],
    );
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.project_workspaces',
      resourceId: result.rows[0].project_workspace_id,
      action: 'bind_project_workspace',
      message: 'Registered read-only workspace bound to Agent Project.',
      metadata: {
        projectId: result.rows[0].project_id,
        projectWorkspaceId: result.rows[0].project_workspace_id,
        repoPathId: result.rows[0].repo_path_id,
        environmentCode: result.rows[0].environment_code,
        workspaceMode: result.rows[0].workspace_mode,
        policyRevision: result.rows[0].policy_revision,
        recordVersion: result.rows[0].record_version,
      },
    });
    return { workspace: safeWorkspace(detail.rows[0]) };
  });
}

async function listAgents(req, options = {}) {
  requireGlobal(req, 'AGENT_READ');
  const projectId = options.projectId ? assertUuid(options.projectId, 'projectId') : null;
  const adminAll = await hasVerifiedAdminAll(req);
  if (projectId) await requireProjectAccess(projectId, req, 'PROJECT_READ');
  if (!projectId && !adminAll) throw createServiceError(404, 'AGENT_PROJECT_SCOPE_REQUIRED', 'Agent discovery requires a visible Project scope.');
  const definitionScope = projectId
    ? `JOIN core.project_agent_allow_rules par ON par.definition_id = d.definition_id
       AND par.project_id = $1 AND par.allow_state = 'ACTIVE'`
    : '';
  const versionScope = projectId
    ? `JOIN core.project_agent_allow_rules par ON par.definition_id = d.definition_id
       AND par.project_id = $1 AND par.allow_state = 'ACTIVE'
       AND (par.definition_version_id IS NULL OR par.definition_version_id = v.definition_version_id)`
    : '';
  const params = projectId ? [projectId] : [];
  const result = await query(
    `SELECT DISTINCT d.* FROM core.agent_definitions d ${definitionScope}
     WHERE d.active = TRUE ORDER BY d.agent_name, d.agent_code`,
    params,
  );
  const versions = await query(
    `SELECT DISTINCT v.* FROM core.agent_definition_versions v
     JOIN core.agent_definitions d ON d.definition_id = v.definition_id ${versionScope}
     WHERE d.active = TRUE ORDER BY v.definition_id, v.revision DESC`,
    params,
  );
  const byDefinition = new Map();
  for (const version of versions.rows) {
    const items = byDefinition.get(version.definition_id) || [];
    items.push(safeVersion(version));
    byDefinition.set(version.definition_id, items);
  }
  return {
    items: result.rows.map((row) => ({ ...safeAgent(row), versions: byDefinition.get(row.definition_id) || [] })),
  };
}

async function getAgent(definitionId, req, options = {}) {
  requireGlobal(req, 'AGENT_READ');
  const id = assertUuid(definitionId, 'definitionId');
  const projectId = options.projectId ? assertUuid(options.projectId, 'projectId') : null;
  const adminAll = await hasVerifiedAdminAll(req);
  if (projectId) await requireProjectAccess(projectId, req, 'PROJECT_READ');
  if (!projectId && !adminAll) throw createServiceError(404, 'AGENT_PROJECT_SCOPE_REQUIRED', 'Agent discovery requires a visible Project scope.');
  const scope = projectId
    ? `JOIN core.project_agent_allow_rules par ON par.definition_id = d.definition_id
       AND par.project_id = $2 AND par.allow_state = 'ACTIVE'`
    : '';
  const versionScope = projectId
    ? `JOIN core.project_agent_allow_rules par ON par.definition_id = v.definition_id
       AND par.project_id = $2 AND par.allow_state = 'ACTIVE'
       AND (par.definition_version_id IS NULL OR par.definition_version_id = v.definition_version_id)`
    : '';
  const params = projectId ? [id, projectId] : [id];
  const [definition, versions] = await Promise.all([
    query(`SELECT DISTINCT d.* FROM core.agent_definitions d ${scope} WHERE d.definition_id = $1 AND d.active = TRUE LIMIT 1`, params),
    query(`SELECT DISTINCT v.* FROM core.agent_definition_versions v ${versionScope} WHERE v.definition_id = $1 ORDER BY v.revision DESC`, params),
  ]);
  if (definition.rowCount === 0) throw createServiceError(404, 'AGENT_DEFINITION_NOT_FOUND', 'The requested Agent definition is not registered.');
  return { agent: safeAgent(definition.rows[0]), versions: versions.rows.map(safeVersion) };
}

async function createAgent(req, body = {}) {
  requireGlobal(req, 'AGENT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.agent_definitions (agent_code, agent_name, description, lifecycle_state, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [requiredText(body.agentCode, 'agentCode'), requiredText(body.agentName, 'agentName'), optionalText(body.description), text(body.lifecycleState, 'DRAFT'), actorId(req)],
    );
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_definitions',
      resourceId: result.rows[0].definition_id,
      action: 'create_agent_definition',
      message: 'Agent definition registry record created.',
      metadata: {
        definitionId: result.rows[0].definition_id,
        recordVersion: result.rows[0].record_version,
      },
    });
    return { agent: safeAgent(result.rows[0]) };
  });
}

async function updateAgent(definitionId, req, body = {}) {
  requireGlobal(req, 'AGENT_MANAGE');
  const id = assertUuid(definitionId, 'definitionId');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if (body.agentName !== undefined) add('agent_name', requiredText(body.agentName, 'agentName'));
  if (body.description !== undefined) add('description', optionalText(body.description));
  if (body.lifecycleState !== undefined) {
    const lifecycleState = requiredText(body.lifecycleState, 'lifecycleState');
    if (!['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(lifecycleState)) {
      throw createServiceError(400, 'AGENT_LIFECYCLE_STATE_INVALID', 'lifecycleState is invalid.');
    }
    add('lifecycle_state', lifecycleState);
  }
  if (fields.length === 0) throw createServiceError(400, 'AGENT_UPDATE_EMPTY', 'At least one supported Agent field is required.');
  const expectedVersion = Number(body.expectedRecordVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw createServiceError(400, 'AGENT_VERSION_REQUIRED', 'expectedRecordVersion is required for Agent updates.');
  values.push(id, expectedVersion, actorId(req));
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `UPDATE core.agent_definitions SET ${fields.join(', ')}, record_version = record_version + 1, updated_by = $${values.length}
       WHERE definition_id = $${values.length - 2} AND record_version = $${values.length - 1} AND active = TRUE RETURNING *`,
      values,
    );
    if (result.rowCount === 0) throw createServiceError(409, 'AGENT_VERSION_CONFLICT', 'The Agent changed since it was read. Refresh before saving.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_definitions',
      resourceId: result.rows[0].definition_id,
      action: 'update_agent_definition',
      message: 'Agent definition registry record updated.',
      metadata: {
        definitionId: result.rows[0].definition_id,
        changedFields: fields.map((field) => field.split(' = ')[0]),
        lifecycleState: result.rows[0].lifecycle_state,
        recordVersion: result.rows[0].record_version,
      },
    });
    return { agent: safeAgent(result.rows[0]) };
  });
}

async function createAgentVersion(definitionId, req, body = {}) {
  requireGlobal(req, 'AGENT_MANAGE');
  const id = assertUuid(definitionId, 'definitionId');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const installationId = assertUuid(body.installationId, 'installationId');
  const capabilityProfileId = assertUuid(body.capabilityProfileId, 'capabilityProfileId');
  const accountBindingId = body.accountBindingId ? assertUuid(body.accountBindingId, 'accountBindingId') : null;
  const configuration = safeJson(body.configuration, 'configuration');
  return withRegistryTransaction(async (client) => {
    const definition = await client.query('SELECT definition_id FROM core.agent_definitions WHERE definition_id = $1 AND active = TRUE FOR UPDATE', [id]);
    if (definition.rowCount === 0) throw createServiceError(404, 'AGENT_DEFINITION_NOT_FOUND', 'The requested Agent definition is not registered.');
    const installation = await client.query('SELECT installation_id FROM core.agent_runtime_installations WHERE installation_id = $1', [installationId]);
    if (installation.rowCount === 0) throw createServiceError(404, 'AGENT_INSTALLATION_NOT_FOUND', 'The selected runtime installation is not registered.');
    const profile = await client.query('SELECT capability_profile_id FROM core.agent_capability_profiles WHERE capability_profile_id = $1 AND active = TRUE', [capabilityProfileId]);
    if (profile.rowCount === 0) throw createServiceError(404, 'AGENT_CAPABILITY_PROFILE_NOT_FOUND', 'The selected capability profile is not registered.');
    if (accountBindingId) {
      const account = await client.query('SELECT account_binding_id, installation_id FROM core.agent_runtime_accounts WHERE account_binding_id = $1 AND account_state <> \'REVOKED\'', [accountBindingId]);
      if (account.rowCount === 0 || account.rows[0].installation_id !== installationId) throw createServiceError(409, 'AGENT_ACCOUNT_INSTALLATION_MISMATCH', 'The selected account is not bound to the selected installation.');
    }
    const latest = await client.query('SELECT revision FROM core.agent_definition_versions WHERE definition_id = $1 ORDER BY revision DESC LIMIT 1 FOR UPDATE', [id]);
    const latestRevision = Number(latest.rows[0]?.revision || 0);
    const requestedRevision = body.revision === undefined ? latestRevision + 1 : Number(body.revision);
    if (!Number.isInteger(requestedRevision) || requestedRevision !== latestRevision + 1) throw createServiceError(409, 'AGENT_VERSION_SEQUENCE_INVALID', 'A new Agent version must be the next immutable revision.');
    const contentDigest = text(body.contentDigest) || sha256Digest({ id, requestedRevision, configuration, installationId, capabilityProfileId, accountBindingId });
    const result = await client.query(
      `INSERT INTO core.agent_definition_versions
         (definition_id, revision, content_digest, instruction_reference, instruction_digest, installation_id, account_binding_id, capability_profile_id, policy_revision, configuration, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) RETURNING *`,
      [id, requestedRevision, contentDigest, optionalText(body.instructionReference), optionalText(body.instructionDigest, 200), installationId, accountBindingId, capabilityProfileId, optionalText(body.policyRevision, 120) || 'agent-definition-policy.v1', JSON.stringify(configuration), actorId(req)],
    );
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_definition_versions',
      resourceId: result.rows[0].definition_version_id,
      action: 'create_agent_revision',
      message: 'Immutable Agent revision created.',
      metadata: {
        definitionId: result.rows[0].definition_id,
        definitionVersionId: result.rows[0].definition_version_id,
        revision: result.rows[0].revision,
        installationId: result.rows[0].installation_id,
        accountBindingId: result.rows[0].account_binding_id,
        capabilityProfileId: result.rows[0].capability_profile_id,
        policyRevision: result.rows[0].policy_revision,
        contentDigest: result.rows[0].content_digest,
      },
    });
    return { version: safeVersion(result.rows[0]) };
  });
}

async function setProjectAgentAllowRule(projectId, req, body = {}) {
  const project = assertUuid(projectId, 'projectId');
  await requireProjectAccess(project, req, 'PROJECT_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const definitionId = assertUuid(body.definitionId, 'definitionId');
  const versionId = body.definitionVersionId ? assertUuid(body.definitionVersionId, 'definitionVersionId') : null;
  const state = text(body.allowState, 'ACTIVE');
  if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(state)) throw createServiceError(400, 'AGENT_ALLOW_STATE_INVALID', 'allowState is invalid.');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.project_agent_allow_rules (project_id, definition_id, definition_version_id, allow_state, policy_revision, created_by, updated_by)
       SELECT $1, d.definition_id, v.definition_version_id, $4, $5, $6, $6
       FROM core.agent_definitions d
       LEFT JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id AND ($3::uuid IS NULL OR v.definition_version_id = $3::uuid)
       WHERE d.definition_id = $2 AND ($3::uuid IS NULL OR v.definition_version_id IS NOT NULL)
       ON CONFLICT (project_id, definition_id, COALESCE(definition_version_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET allow_state = EXCLUDED.allow_state, policy_revision = EXCLUDED.policy_revision, updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [project, definitionId, versionId, state, optionalText(body.policyRevision, 120) || 'project-agent-allow.v1', actorId(req)],
    );
    if (result.rowCount === 0) throw createServiceError(404, 'AGENT_DEFINITION_NOT_FOUND', 'The requested Agent definition or version is not registered.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.project_agent_allow_rules',
      resourceId: result.rows[0].project_agent_allow_rule_id,
      action: 'set_project_agent_allow_rule',
      message: 'Project-to-Agent allow rule updated.',
      metadata: {
        projectId: result.rows[0].project_id,
        definitionId: result.rows[0].definition_id,
        definitionVersionId: result.rows[0].definition_version_id,
        allowState: result.rows[0].allow_state,
        policyRevision: result.rows[0].policy_revision,
      },
    });
    return { allowRule: result.rows[0] };
  });
}

async function listRuntimes(req) {
  requireGlobal(req, 'AGENT_RUNTIME_READ');
  const [installations, accounts, profiles] = await Promise.all([
    query(
      `SELECT i.*, r.runtime_code, r.runtime_name
       FROM core.agent_runtime_installations i JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
       WHERE r.active = TRUE ORDER BY r.runtime_name, i.installation_code`,
    ),
    query('SELECT * FROM core.agent_runtime_accounts WHERE account_state <> \'REVOKED\' ORDER BY account_code'),
    query('SELECT * FROM core.agent_capability_profiles WHERE active = TRUE ORDER BY profile_name, profile_code'),
  ]);
  return {
    runtimes: (await query('SELECT * FROM core.agent_runtimes WHERE active = TRUE ORDER BY runtime_name, runtime_code')).rows.map((row) => ({
      agentRuntimeId: row.agent_runtime_id,
      runtimeCode: row.runtime_code,
      runtimeName: row.runtime_name,
      description: row.description,
      active: row.active,
    })),
    installations: installations.rows.map(safeRuntime),
    accounts: accounts.rows.map(safeAccount),
    capabilityProfiles: profiles.rows.map(safeCapabilityProfile),
  };
}

async function createRuntime(req, body = {}) {
  requireGlobal(req, 'AGENT_RUNTIME_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.agent_runtimes (runtime_code, runtime_name, description, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING *`,
      [requiredText(body.runtimeCode, 'runtimeCode'), requiredText(body.runtimeName, 'runtimeName'), optionalText(body.description), actorId(req)],
    );
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_runtimes',
      resourceId: result.rows[0].agent_runtime_id,
      action: 'register_runtime',
      message: 'Agent runtime metadata registered.',
      metadata: { runtimeId: result.rows[0].agent_runtime_id },
    });
    return { runtime: { agentRuntimeId: result.rows[0].agent_runtime_id, runtimeCode: result.rows[0].runtime_code, runtimeName: result.rows[0].runtime_name, description: result.rows[0].description, active: result.rows[0].active } };
  });
}

async function createInstallation(runtimeId, req, body = {}) {
  requireGlobal(req, 'AGENT_RUNTIME_MANAGE');
  const id = assertUuid(runtimeId, 'runtimeId');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const manifest = safeJson(body.capabilityManifest, 'capabilityManifest');
  if (body.executionEnabled === true) throw createServiceError(400, 'AGENT_EXECUTION_DISABLED', 'Phase 19.1 runtime execution must remain disabled.');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.agent_runtime_installations
         (agent_runtime_id, installation_code, adapter_version, protocol_schema_digest, capability_manifest_revision, capability_manifest_digest, capability_manifest, host_code, runtime_profile, containment_class, certification_state, enabled, reviewed_source_revision, configuration_revision, configuration_digest, process_generation, service_generation, observed_at, freshness_status, metadata, created_by, updated_by)
       SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'UNVERIFIED', FALSE, $11, $12, $13, $14, $15, $16, 'UNKNOWN', $17::jsonb, $18, $18
       FROM core.agent_runtimes WHERE agent_runtime_id = $1 AND active = TRUE RETURNING *`,
      [id, requiredText(body.installationCode, 'installationCode'), optionalText(body.adapterVersion), optionalText(body.protocolSchemaDigest, 200), optionalText(body.capabilityManifestRevision, 120) || 'UNKNOWN', optionalText(body.capabilityManifestDigest, 200) || sha256Digest(manifest), JSON.stringify(manifest), optionalText(body.hostCode), optionalText(body.runtimeProfile, 120) || 'UNKNOWN', optionalText(body.containmentClass, 120), optionalText(body.reviewedSourceRevision, 200), optionalText(body.configurationRevision, 120) || 'UNKNOWN', optionalText(body.configurationDigest, 200) || sha256Digest({ id, manifest }), optionalText(body.processGeneration, 200), optionalText(body.serviceGeneration, 200), body.observedAt || null, JSON.stringify(safeJson(body.metadata, 'metadata')), actorId(req)],
    );
    if (result.rowCount === 0) throw createServiceError(404, 'AGENT_RUNTIME_NOT_FOUND', 'The selected runtime is not registered.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_runtime_installations',
      resourceId: result.rows[0].installation_id,
      action: 'register_runtime_installation',
      message: 'Agent runtime installation metadata registered in an unverified disabled state.',
      metadata: {
        runtimeId: result.rows[0].agent_runtime_id,
        installationId: result.rows[0].installation_id,
        certificationState: result.rows[0].certification_state,
        freshnessStatus: result.rows[0].freshness_status,
        enabled: result.rows[0].enabled,
        executionEnabled: false,
        capabilityManifestRevision: result.rows[0].capability_manifest_revision,
        capabilityManifestDigest: result.rows[0].capability_manifest_digest,
        configurationRevision: result.rows[0].configuration_revision,
        configurationDigest: result.rows[0].configuration_digest,
      },
    });
    return { installation: safeRuntime(result.rows[0]) };
  });
}

async function createAccount(installationId, req, body = {}) {
  requireGlobal(req, 'AGENT_RUNTIME_MANAGE');
  const id = assertUuid(installationId, 'installationId');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  if (body.executionEnabled === true) throw createServiceError(400, 'AGENT_EXECUTION_DISABLED', 'Phase 19.1 account execution must remain disabled.');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.agent_runtime_accounts
         (installation_id, account_code, account_alias, owner_user_id, trust_domain, usage_visibility, account_state, policy_revision, account_policy, metadata, created_by, updated_by)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $4, $4
       FROM core.agent_runtime_installations WHERE installation_id = $1 RETURNING *`,
      [id, requiredText(body.accountCode, 'accountCode'), optionalText(body.accountAlias), body.ownerUserId ? assertUuid(body.ownerUserId, 'ownerUserId') : actorId(req), optionalText(body.trustDomain), text(body.usageVisibility, 'OWNER_ONLY'), text(body.accountState, 'UNCONFIGURED'), optionalText(body.policyRevision, 120) || 'account-policy.v1', JSON.stringify(safeJson(body.accountPolicy, 'accountPolicy')), JSON.stringify(safeJson(body.metadata, 'metadata'))],
    );
    if (result.rowCount === 0) throw createServiceError(404, 'AGENT_INSTALLATION_NOT_FOUND', 'The selected runtime installation is not registered.');
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_runtime_accounts',
      resourceId: result.rows[0].account_binding_id,
      action: 'register_runtime_account',
      message: 'Agent runtime-account metadata registered.',
      metadata: {
        installationId: result.rows[0].installation_id,
        accountBindingId: result.rows[0].account_binding_id,
        ownerUserId: result.rows[0].owner_user_id,
        usageVisibility: result.rows[0].usage_visibility,
        accountState: result.rows[0].account_state,
        policyRevision: result.rows[0].policy_revision,
        executionEnabled: false,
      },
    });
    return { account: safeAccount(result.rows[0]) };
  });
}

async function createCapabilityProfile(req, body = {}) {
  requireGlobal(req, 'AGENT_RUNTIME_MANAGE');
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const policy = normalizePolicy(body.policy, 'policy');
  return withRegistryTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO core.agent_capability_profiles (profile_code, profile_name, policy_schema_version, policy_revision, policy_digest, policy, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7) RETURNING *`,
      [requiredText(body.profileCode, 'profileCode'), requiredText(body.profileName, 'profileName'), optionalText(body.policySchemaVersion, 120) || 'agent-capability-policy.v1', policy.policyRevision, optionalText(body.policyDigest, 200) || sha256Digest(policy), JSON.stringify(policy), actorId(req)],
    );
    await recordRegistryAuditWithClient(client, req, {
      resourceType: 'core.agent_capability_profiles',
      resourceId: result.rows[0].capability_profile_id,
      action: 'register_capability_profile',
      message: 'Agent capability profile registered.',
      metadata: {
        capabilityProfileId: result.rows[0].capability_profile_id,
        policyRevision: result.rows[0].policy_revision,
        policyDigest: result.rows[0].policy_digest,
        executionEnabled: false,
      },
    });
    return { capabilityProfile: safeCapabilityProfile(result.rows[0]) };
  });
}

function emptyScope() {
  return { capabilities: [], actions: [], resources: [], environments: [], dataClasses: [] };
}

function denySurfaces() {
  return { surfaces: EXECUTION_SURFACES.map((surface) => ({ surface, mode: 'DENY', reason: 'Runtime-account entitlement is not available for this preview.' })) };
}

function denyConstraints() {
  return { maxDurationMs: 0, maxChildren: 0, maxConcurrentChildren: 0 };
}

function evaluateRuntimeAccountEntitlement({ account = {}, actorUserId = null, adminAll = false, projectAccess = false } = {}) {
  if (!account.accountBindingId) return { entitled: false, code: 'RUNTIME_ACCOUNT_REQUIRED', message: 'An explicitly bound runtime account is required.' };
  if (account.accountState !== 'CONFIGURED') return { entitled: false, code: 'RUNTIME_ACCOUNT_NOT_CONFIGURED', message: 'The selected runtime account is not configured.' };
  if (account.executionEnabled !== false) return { entitled: false, code: 'ACCOUNT_EXECUTION_FLAG_INVALID', message: 'The runtime account execution flag is not safely disabled.' };
  if (adminAll) return { entitled: true, code: 'ADMIN_ALL', message: 'Verified admin-all boundary.' };
  if (account.usageVisibility === 'ADMIN_ONLY') return { entitled: false, code: 'RUNTIME_ACCOUNT_ADMIN_ONLY', message: 'The selected runtime account is restricted to the verified admin-all boundary.' };
  if (account.usageVisibility === 'OWNER_ONLY' && account.ownerUserId !== actorUserId) {
    return { entitled: false, code: 'RUNTIME_ACCOUNT_OWNER_ONLY', message: 'The selected runtime account is restricted to its owner.' };
  }
  if (account.usageVisibility === 'PROJECT_MEMBERS' && !projectAccess) {
    return { entitled: false, code: 'RUNTIME_ACCOUNT_PROJECT_MEMBERS_ONLY', message: 'The selected runtime account requires active Project membership.' };
  }
  return { entitled: true, code: 'ENTITLED', message: 'Runtime-account entitlement verified for this preview.' };
}

function policyFromRow(value) {
  return normalizePolicy(value || {});
}

async function previewAuthority(req, body = {}) {
  assertPlainObject(body, 'body');
  assertNoForbiddenKeys(body);
  const projectId = assertUuid(body.projectId, 'projectId');
  await requireProjectAccess(projectId, req, 'AUTHORITY_PREVIEW');
  const definitionId = assertUuid(body.definitionId, 'definitionId');
  const workspaceId = assertUuid(body.projectWorkspaceId, 'projectWorkspaceId');
  const requestedScope = normalizeScope(body.requestedScope || body.scope || {});
  const requestedSurfaces = normalizeSurfacePolicy(body.requestedExecutionSurfaces || body.executionSurfaces || {});
  const workspaceResult = await query(
    `SELECT pw.*, p.authority_policy, p.policy_revision AS project_policy_revision,
            r.repo_code, r.repo_name, cp.profile_code,
            rp.repo_id
     FROM core.project_workspaces pw
     JOIN core.projects p ON p.project_id = pw.project_id
     JOIN core.repository_paths rp ON rp.repo_path_id = pw.repo_path_id
     JOIN core.repositories r ON r.repo_id = rp.repo_id
     JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id
     WHERE pw.project_workspace_id = $1 AND pw.project_id = $2 AND pw.active = TRUE`,
    [workspaceId, projectId],
  );
  if (workspaceResult.rowCount === 0) throw createServiceError(404, 'AGENT_WORKSPACE_NOT_FOUND', 'The requested registered workspace is not visible to this project.');

  const versionId = body.definitionVersionId ? assertUuid(body.definitionVersionId, 'definitionVersionId') : null;
  const definitionResult = await query(
    `SELECT d.*, v.*, r.runtime_code, r.runtime_name, i.installation_code, i.adapter_version,
            i.protocol_schema_digest, i.capability_manifest_revision, i.capability_manifest_digest,
            i.runtime_profile, i.containment_class, i.certification_state, i.enabled AS installation_enabled,
            i.execution_enabled AS installation_execution_enabled, i.reviewed_source_revision,
            i.configuration_revision, i.configuration_digest, i.process_generation, i.service_generation,
            i.process_started_at, i.observed_at, i.freshness_status, i.capability_manifest,
            a.account_binding_id, a.owner_user_id, a.account_code, a.account_alias, a.trust_domain, a.usage_visibility, a.account_state,
            a.account_policy, a.execution_enabled AS account_execution_enabled,
            cp2.policy AS capability_policy, cp2.policy_revision AS capability_policy_revision
     FROM core.agent_definitions d
     JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id
     JOIN core.agent_runtime_installations i ON i.installation_id = v.installation_id
     JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
     LEFT JOIN core.agent_runtime_accounts a ON a.account_binding_id = v.account_binding_id
     JOIN core.agent_capability_profiles cp2 ON cp2.capability_profile_id = v.capability_profile_id
     JOIN core.project_agent_allow_rules par ON par.definition_id = d.definition_id AND par.project_id = $1
       AND par.allow_state = 'ACTIVE' AND (par.definition_version_id IS NULL OR par.definition_version_id = v.definition_version_id)
     WHERE d.definition_id = $2 AND d.active = TRUE AND ($3::uuid IS NULL OR v.definition_version_id = $3::uuid)
     ORDER BY v.revision DESC LIMIT 1`,
    [projectId, definitionId, versionId],
  );
  if (definitionResult.rowCount === 0) throw createServiceError(404, 'AGENT_SELECTION_NOT_ALLOWED', 'The selected Agent definition/version is not allowed for this project.');

  const workspace = workspaceResult.rows[0];
  const selected = definitionResult.rows[0];
  const projectPolicy = policyFromRow(workspace.authority_policy);
  const workspacePolicy = policyFromRow(workspace.workspace_policy);
  const definitionPolicy = policyFromRow(selected.configuration);
  const capabilityPolicy = policyFromRow(selected.capability_policy);
  const accountPolicy = policyFromRow(selected.account_policy);
  const runtimeManifestPolicy = policyFromRow(selected.capability_manifest);
  const adminAll = await hasVerifiedAdminAll(req);
  const accountEntitlement = evaluateRuntimeAccountEntitlement({
    account: {
      accountBindingId: selected.account_binding_id,
      accountState: selected.account_state || 'UNCONFIGURED',
      executionEnabled: selected.account_execution_enabled === true,
      usageVisibility: selected.usage_visibility || 'OWNER_ONLY',
      ownerUserId: selected.owner_user_id || null,
    },
    actorUserId: actorId(req),
    adminAll,
    projectAccess: true,
  });
  const configuredScope = intersectScopes([projectPolicy.scope, workspacePolicy.scope, definitionPolicy.scope]);
  const configuredSurfaces = intersectExecutionSurfacePolicies({
    requested: projectPolicy.executionSurfaces,
    configured: workspacePolicy.executionSurfaces,
    granted: definitionPolicy.executionSurfaces,
    policyRevision: workspace.policy_revision,
  }).granted;
  const runtime = normalizeRuntimeConfigurationIdentity({
    runtimeInstallationId: selected.installation_id,
    reviewedSourceRevision: selected.reviewed_source_revision,
    configurationRevision: selected.configuration_revision,
    configurationDigest: selected.configuration_digest,
    capabilityManifestRevision: selected.capability_manifest_revision,
    capabilityManifestDigest: selected.capability_manifest_digest,
    runtimeProfile: selected.runtime_profile,
    processGeneration: selected.process_generation,
    serviceGeneration: selected.service_generation,
    processStartedAt: selected.process_started_at,
    observedAt: selected.observed_at,
    freshnessStatus: selected.freshness_status,
    evidence: { certificationState: selected.certification_state },
  });
  const runtimeInstallation = {
    enabled: selected.installation_enabled === true,
    certificationState: selected.certification_state || 'UNVERIFIED',
    executionEnabled: selected.installation_execution_enabled === true,
    freshnessStatus: selected.freshness_status || 'UNKNOWN',
    capabilityManifest: selected.capability_manifest,
  };
  const runtimeCompatibilityCheck = evaluateRuntimeCompatibility({
    installation: runtimeInstallation,
    requiredCapabilities: requestedScope.capabilities,
  });
  const eligibility = runtimeEligibility({
    installation: runtimeInstallation,
    account: {
      accountState: selected.account_state || 'UNCONFIGURED',
      executionEnabled: selected.account_execution_enabled === true,
    },
    requiredCapabilities: requestedScope.capabilities,
  });
  const runtimeCompatibility = {
    contract: 'agent_runtime_compatibility.v1',
    compatible: runtimeCompatibilityCheck.compatible && accountEntitlement.entitled,
    runtimeCompatible: runtimeCompatibilityCheck.compatible,
    accountEntitled: accountEntitlement.entitled,
    reasons: uniqueSorted([
      ...runtimeCompatibilityCheck.reasons,
      ...(accountEntitlement.entitled ? [] : ['RUNTIME_ACCOUNT_ENTITLEMENT_REQUIRED', accountEntitlement.code]),
    ]),
    requiredCapabilities: runtimeCompatibilityCheck.requiredCapabilities,
    declaredCapabilities: runtimeCompatibilityCheck.declaredCapabilities,
    missingCapabilities: runtimeCompatibilityCheck.missingCapabilities,
    runtime: {
      enabled: runtimeInstallation.enabled,
      certificationState: runtimeInstallation.certificationState,
      freshnessStatus: runtimeInstallation.freshnessStatus,
      executionEnabled: false,
    },
    accountEntitlement: {
      entitled: accountEntitlement.entitled,
      code: accountEntitlement.code,
      message: accountEntitlement.message,
    },
    executionEnabled: false,
    phase: '19.1',
  };
  // Policy authority is evaluated independently from the Phase 19.1 execution
  // admission gate. A disabled admission must not erase the policy-effective
  // scope. Runtime compatibility is a separate fail-closed layer.
  const policyGrantedScope = intersectScopes([capabilityPolicy.scope, runtimeManifestPolicy.scope, accountPolicy.scope]);
  const policyGrantedSurfaces = intersectExecutionSurfacePolicies({
    requested: capabilityPolicy.executionSurfaces,
    configured: runtimeManifestPolicy.executionSurfaces,
    granted: accountPolicy.executionSurfaces,
  }).granted;
  const configuredConstraints = intersectConstraints([
    projectPolicy.constraints,
    workspacePolicy.constraints,
    definitionPolicy.constraints,
  ]);
  const policyGrantedConstraints = intersectConstraints([
    capabilityPolicy.constraints,
    runtimeManifestPolicy.constraints,
    accountPolicy.constraints,
  ]);
  const requestedConstraints = normalizeConstraints(body.constraints || {});
  const policyEffectiveAuthority = evaluateAuthority({
    authorityKind: 'POLICY_EFFECTIVE',
    policyRevision: workspace.policy_revision || 'agent-policy.v1',
    sourcePolicyRevision: selected.policy_revision,
    requested: requestedScope,
    configured: configuredScope,
    granted: policyGrantedScope,
    requestedSurfaces,
    configuredSurfaces,
    grantedSurfaces: policyGrantedSurfaces,
    constraints: requestedConstraints,
    configuredConstraints,
    grantedConstraints: policyGrantedConstraints,
    obligations: [
      'AGENT_EXECUTION_DISABLED_PHASE_19_1',
      'REGISTERED_WORKSPACE_ONLY',
      'NO_PROVIDER_LAUNCH_OR_EXTERNAL_TRANSPORT',
      'POLICY_EFFECTIVE_AUTHORITY_IS_ADVISORY_ONLY',
    ],
    runtimeConfiguration: runtime,
  });
  const runtimeCompatible = runtimeCompatibility.compatible;
  const runtimeGrantedScope = runtimeCompatible ? policyGrantedScope : emptyScope();
  const runtimeGrantedSurfaces = runtimeCompatible ? policyGrantedSurfaces : denySurfaces();
  const runtimeGrantedConstraints = runtimeCompatible ? policyGrantedConstraints : denyConstraints();
  const runtimeCompatibilityDenials = runtimeCompatible
    ? []
    : runtimeCompatibility.reasons.map((reason) => ({
        dimension: 'runtimeCompatibility',
        value: reason,
        reason: 'Authoritative runtime/account compatibility is required before this policy-effective authority can be runtime-compatible.',
      }));
  const runtimeCompatibleAuthority = evaluateAuthority({
    authorityKind: 'RUNTIME_COMPATIBLE',
    policyRevision: workspace.policy_revision || 'agent-policy.v1',
    sourcePolicyRevision: selected.policy_revision,
    requested: requestedScope,
    configured: configuredScope,
    granted: runtimeGrantedScope,
    requestedSurfaces,
    configuredSurfaces,
    grantedSurfaces: runtimeGrantedSurfaces,
    constraints: requestedConstraints,
    configuredConstraints,
    grantedConstraints: runtimeGrantedConstraints,
    obligations: [
      'AGENT_EXECUTION_DISABLED_PHASE_19_1',
      'REGISTERED_WORKSPACE_ONLY',
      'NO_PROVIDER_LAUNCH_OR_EXTERNAL_TRANSPORT',
      ...(runtimeCompatible ? ['RUNTIME_COMPATIBILITY_VERIFIED'] : ['RUNTIME_COMPATIBILITY_FAILED', ...runtimeCompatibility.reasons]),
    ],
    additionalDenials: runtimeCompatibilityDenials,
    runtimeConfiguration: runtime,
  });
  const executionAdmission = {
    contract: 'agent_execution_admission.v1',
    admitted: false,
    executionEnabled: false,
    phase: '19.1',
    code: 'AGENT_EXECUTION_DISABLED_PHASE_19_1',
    reason: 'Agent execution remains disabled for Phase 19.1 regardless of policy-effective or runtime-compatible authority.',
  };
  const preview = {
    executionEnabled: false,
    advisoryOnly: true,
    phase: '19.1',
    reason: 'AGENT_EXECUTION_DISABLED_PHASE_19_1',
    eligibility,
    executionAdmission,
    runtimeCompatibility,
    accountEntitlement,
    project: { projectId, policyRevision: workspace.project_policy_revision },
    agent: { definitionId: selected.definition_id, agentCode: selected.agent_code, agentName: selected.agent_name, definitionVersionId: selected.definition_version_id, revision: selected.revision },
    workspace: safeWorkspace(workspace),
    runtime: safeRuntime(selected),
    account: selected.account_binding_id ? safeAccount(selected) : null,
    capabilityProfile: safeCapabilityProfile({ capability_profile_id: selected.capability_profile_id, profile_code: null, profile_name: null, policy_schema_version: null, policy_revision: selected.capability_policy_revision, policy_digest: null, active: true }),
    policyEffectiveAuthority,
    runtimeCompatibleAuthority,
    authority: runtimeCompatibleAuthority,
  };
  await authService.recordAuditEvent({
    appCode: req.session?.appCode,
    userId: actorId(req),
    eventType: 'AGENT_AUTHORITY_PREVIEW',
    resourceType: 'agent_authority_snapshot',
    resourceId: runtimeCompatibleAuthority.snapshotId,
    action: 'preview',
    success: true,
    message: 'Phase 19.1 advisory Agent authority preview calculated.',
    metadata: {
      phase: '19.1', projectId, definitionId, definitionVersionId: selected.definition_version_id,
      projectWorkspaceId: workspaceId, policyEffectiveDigest: policyEffectiveAuthority.digest,
      runtimeCompatibleDigest: runtimeCompatibleAuthority.digest, executionEnabled: false,
      denialCount: runtimeCompatibleAuthority.denials.length,
      runtimeCompatibilityReasons: runtimeCompatibility.reasons,
      executionAdmission: executionAdmission.code,
    },
    ...authService.getRequestContext(req),
  });
  return { preview };
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  upsertProjectMember,
  listProjectOptions,
  listProjectUsers,
  bindRepository,
  bindWorkspace,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  createAgentVersion,
  setProjectAgentAllowRule,
  listRuntimes,
  createRuntime,
  createInstallation,
  createAccount,
  createCapabilityProfile,
  previewAuthority,
  evaluateRuntimeAccountEntitlement,
  memberHasRight,
  createServiceError,
};
