const { pool, query } = require('../../../../packages/db/src/connection');
const { hashPassword } = require('../../../../packages/auth/src/password');

const VALID_USER_STATUSES = new Set(['ACTIVE', 'DISABLED', 'LOCKED', 'PENDING']);
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const RESOURCE_ACTION_PATTERN = /^[a-z][a-z0-9_]*$/;
const CORE_ADMIN_PERMISSION_CODES = new Set([
  'ADMIN_USER_READ',
  'ADMIN_USER_WRITE',
  'ADMIN_ROLE_READ',
  'ADMIN_ROLE_WRITE',
  'ADMIN_PERMISSION_READ',
  'ADMIN_PERMISSION_WRITE',
]);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeRequiredString(value, label) {
  const text = String(value || '').trim();

  if (!text) {
    throw createHttpError(400, `${label} is required.`);
  }

  return text;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeEmail(value) {
  return normalizeRequiredString(value, 'email').toLowerCase();
}

function normalizeBoolean(value, label = 'value') {
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  throw createHttpError(400, `${label} must be true or false.`);
}

function normalizeOptionalBoolean(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return normalizeBoolean(value, label);
}

function normalizeUserStatus(value) {
  const status = normalizeRequiredString(value, 'status').toUpperCase();

  if (!VALID_USER_STATUSES.has(status)) {
    throw createHttpError(400, `Invalid user status: ${status}`);
  }

  return status;
}

function normalizeCode(value, label) {
  const code = normalizeRequiredString(value, label).toUpperCase();

  if (!CODE_PATTERN.test(code)) {
    throw createHttpError(
      400,
      `${label} must start with a letter and contain only uppercase letters, numbers, and underscores.`,
    );
  }

  return code;
}

function normalizeRepositoryCode(value) {
  const text = normalizeRequiredString(value, 'repoCode');

  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(text)) {
    throw createHttpError(
      400,
      'repoCode must start with a letter and contain only letters, numbers, underscores, or dashes.',
    );
  }

  return text;
}

function normalizeInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const numberValue = Number.parseInt(value, 10);

  if (!Number.isInteger(numberValue)) {
    throw createHttpError(400, `${label} must be an integer.`);
  }

  return numberValue;
}

function normalizePathPayload(value, label = 'rootPath') {
  return normalizeRequiredString(value, label);
}

function normalizeResourceAction(value, label) {
  const text = normalizeRequiredString(value, label).toLowerCase();

  if (!RESOURCE_ACTION_PATTERN.test(text)) {
    throw createHttpError(
      400,
      `${label} must start with a letter and contain only lowercase letters, numbers, and underscores.`,
    );
  }

  return text;
}

function normalizeStringArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError(400, `${label} must be an array.`);
  }

  return [...new Set(value.map((item) => normalizeRequiredString(item, label).toUpperCase()))];
}

function normalizeUuid(value, label) {
  const uuid = normalizeRequiredString(value, label);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(uuid)) {
    throw createHttpError(400, `${label} must be a valid UUID.`);
  }

  return uuid;
}

function normalizeNullableTextPatch(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, key)) {
    return {
      supplied: false,
      value: undefined,
    };
  }

  return {
    supplied: true,
    value: normalizeOptionalString(body[key]),
  };
}

function getActorUserId(actor) {
  return actor?.userId || actor?.user_id || null;
}

function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    isSystemUser: row.is_system_user,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function sanitizeRole(row) {
  if (!row) {
    return null;
  }

  return {
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    description: row.description,
    isSystemRole: row.is_system_role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizePermission(row) {
  if (!row) {
    return null;
  }

  return {
    permissionId: row.permission_id,
    permissionCode: row.permission_code,
    resource: row.resource,
    action: row.action,
    description: row.description || row.permission_description || null,
    active: row.active === undefined ? row.permission_active : row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeUserRole(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    userStatus: row.user_status,
    isSystemUser: row.is_system_user,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleDescription: row.role_description,
    isSystemRole: row.is_system_role,
    roleActive: row.role_active,
    userRoleActive: row.user_role_active,
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
  };
}

function sanitizeRolePermission(row) {
  if (!row) {
    return null;
  }

  return {
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleDescription: row.role_description,
    isSystemRole: row.is_system_role,
    roleActive: row.role_active,
    permissionId: row.permission_id,
    permissionCode: row.permission_code,
    resource: row.resource,
    action: row.action,
    permissionDescription: row.permission_description,
    permissionActive: row.permission_active,
    rolePermissionActive: row.role_permission_active,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
  };
}

function sanitizeSession(row) {
  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    userStatus: row.user_status,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    secondsUntilExpiry: row.seconds_until_expiry,
  };
}

function sanitizeRepository(row) {
  if (!row) {
    return null;
  }

  return {
    repoId: row.repo_id,
    repoCode: row.repo_code,
    repoName: row.repo_name,
    description: row.description,
    remoteUrl: row.remote_url,
    mainBranch: row.main_branch,
    devBranch: row.dev_branch,
    displayOrder: row.display_order,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeRepositoryPath(row) {
  if (!row) {
    return null;
  }

  return {
    repoPathId: row.repo_path_id || null,
    repoId: row.repo_id || null,
    profileId: row.profile_id,
    profileCode: row.profile_code,
    profileName: row.profile_name,
    rootPath: row.root_path || '',
    active: row.path_active === undefined ? row.active : row.path_active,
    createdAt: row.path_created_at || row.created_at || null,
    updatedAt: row.path_updated_at || row.updated_at || null,
  };
}

function sanitizeConfigProfile(row) {
  if (!row) {
    return null;
  }

  return {
    profileId: row.profile_id,
    profileCode: row.profile_code,
    profileName: row.profile_name,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
  };
}

async function actorHasRole(actor, roleCode) {
  const actorUserId = getActorUserId(actor);

  if (!actorUserId) {
    return false;
  }

  const result = await query(
    `
      SELECT 1
      FROM auth.vw_user_roles
      WHERE user_id = $1
        AND role_code = $2
      LIMIT 1
    `,
    [actorUserId, roleCode],
  );

  return result.rowCount > 0;
}

async function assertSuperAdmin({ actor, message }) {
  if (await actorHasRole(actor, 'SUPER_ADMIN')) {
    return;
  }

  throw createHttpError(403, message || 'Super Administrator role is required for this action.');
}

async function assertCanMutateSystemUser({ user, actor }) {
  if (!user?.is_system_user) {
    return;
  }

  await assertSuperAdmin({
    actor,
    message: 'System users may only be changed by a Super Administrator.',
  });
}

async function assertCanMutateSystemRole({ role, actor }) {
  if (!role?.is_system_role) {
    return;
  }

  await assertSuperAdmin({
    actor,
    message: 'System roles may only be changed by a Super Administrator.',
  });
}

async function assertCanMutateCoreAdminPermission({ permission, actor }) {
  if (!CORE_ADMIN_PERMISSION_CODES.has(permission?.permission_code)) {
    return;
  }

  await assertSuperAdmin({
    actor,
    message: 'Core admin permissions may only be changed by a Super Administrator.',
  });
}

function assertNotSelfStatusLockout({ targetUserId, actor, nextStatus }) {
  const actorUserId = getActorUserId(actor);

  if (!actorUserId || String(actorUserId) !== String(targetUserId)) {
    return;
  }

  if (nextStatus !== 'ACTIVE') {
    throw createHttpError(400, 'You cannot change your own account away from ACTIVE status.');
  }
}

function assertNotSelfRoleUpdate({ targetUserId, actor }) {
  const actorUserId = getActorUserId(actor);

  if (actorUserId && String(actorUserId) === String(targetUserId)) {
    throw createHttpError(
      400,
      'You cannot change your own role assignments through this endpoint.',
    );
  }
}

function assertNotSelfSessionRevoke({ targetUserId, actor }) {
  const actorUserId = getActorUserId(actor);

  if (actorUserId && String(actorUserId) === String(targetUserId)) {
    throw createHttpError(400, 'You cannot revoke your own sessions through this admin endpoint.');
  }
}

async function insertAuditEvent(
  client,
  {
    actor,
    context = {},
    eventType,
    resourceType,
    resourceId,
    action,
    success,
    message,
    metadata = {},
  },
) {
  await client.query(
    `
      INSERT INTO auth.audit_events (
        user_id,
        event_type,
        resource_type,
        resource_id,
        action,
        success,
        message,
        metadata,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
    `,
    [
      getActorUserId(actor),
      eventType,
      resourceType,
      resourceId === undefined || resourceId === null ? null : String(resourceId),
      action,
      success,
      message,
      JSON.stringify(metadata || {}),
      context.ipAddress || null,
      context.userAgent || null,
    ],
  );
}

async function getUserRowById(client, rawUserId, options = {}) {
  const userId = normalizeUuid(rawUserId, 'userId');
  const result = await client.query(
    `
      SELECT
        user_id,
        email,
        username,
        display_name,
        status,
        is_system_user,
        failed_login_count,
        locked_until,
        last_login_at,
        created_at,
        updated_at,
        created_by,
        updated_by
      FROM auth.users
      WHERE user_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}
    `,
    [userId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'User not found.');
  }

  return result.rows[0];
}

async function getRoleRowById(client, rawRoleId, options = {}) {
  const roleId = normalizeUuid(rawRoleId, 'roleId');
  const result = await client.query(
    `
      SELECT
        role_id,
        role_code,
        role_name,
        description,
        is_system_role,
        active,
        created_at,
        updated_at
      FROM auth.roles
      WHERE role_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}
    `,
    [roleId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Role not found.');
  }

  return result.rows[0];
}

async function getPermissionRowById(client, rawPermissionId, options = {}) {
  const permissionId = normalizeUuid(rawPermissionId, 'permissionId');
  const result = await client.query(
    `
      SELECT
        permission_id,
        permission_code,
        resource,
        action,
        description,
        active,
        created_at,
        updated_at
      FROM auth.permissions
      WHERE permission_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}
    `,
    [permissionId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Permission not found.');
  }

  return result.rows[0];
}

async function getRolesByCodes(client, roleCodes, { activeOnly = true } = {}) {
  if (roleCodes.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT role_id, role_code, role_name, is_system_role, active
      FROM auth.roles
      WHERE role_code = ANY($1::text[])
        ${activeOnly ? 'AND active = TRUE' : ''}
    `,
    [roleCodes],
  );

  const foundCodes = new Set(result.rows.map((row) => row.role_code));
  const missingCodes = roleCodes.filter((roleCode) => !foundCodes.has(roleCode));

  if (missingCodes.length > 0) {
    throw createHttpError(400, `Role code(s) not found or inactive: ${missingCodes.join(', ')}`);
  }

  return result.rows;
}

async function getPermissionsByCodes(client, permissionCodes, { activeOnly = true } = {}) {
  if (permissionCodes.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT permission_id, permission_code, resource, action, active
      FROM auth.permissions
      WHERE permission_code = ANY($1::text[])
        ${activeOnly ? 'AND active = TRUE' : ''}
    `,
    [permissionCodes],
  );

  const foundCodes = new Set(result.rows.map((row) => row.permission_code));
  const missingCodes = permissionCodes.filter((permissionCode) => !foundCodes.has(permissionCode));

  if (missingCodes.length > 0) {
    throw createHttpError(
      400,
      `Permission code(s) not found or inactive: ${missingCodes.join(', ')}`,
    );
  }

  return result.rows;
}

async function getUser(userId) {
  const client = await pool.connect();

  try {
    const user = await getUserRowById(client, userId);

    const rolesResult = await client.query(
      `
        SELECT *
        FROM auth.vw_user_roles
        WHERE user_id = $1
        ORDER BY role_code
      `,
      [user.user_id],
    );

    const permissionsResult = await client.query(
      `
        SELECT
          permission_id,
          permission_code,
          resource,
          action,
          permission_description,
          granted_through_roles
        FROM auth.vw_user_permissions
        WHERE user_id = $1
        ORDER BY resource, action, permission_code
      `,
      [user.user_id],
    );

    return {
      user: sanitizeUser(user),
      roles: rolesResult.rows.map(sanitizeUserRole),
      permissions: permissionsResult.rows.map((row) => ({
        permissionId: row.permission_id,
        permissionCode: row.permission_code,
        resource: row.resource,
        action: row.action,
        description: row.permission_description,
        grantedThroughRoles: row.granted_through_roles,
      })),
    };
  } finally {
    client.release();
  }
}

async function createUser({ body = {}, actor, context = {} }) {
  const email = normalizeEmail(body.email);
  const username = normalizeOptionalString(body.username);
  const displayName = normalizeOptionalString(body.displayName);
  const password = normalizeRequiredString(body.password, 'password');
  const status = body.status ? normalizeUserStatus(body.status) : 'ACTIVE';
  const roleCodes = normalizeStringArray(body.roleCodes || body.roles, 'roleCodes').map(
    (roleCode) => normalizeCode(roleCode, 'roleCode'),
  );
  const isSystemUser = normalizeOptionalBoolean(body.isSystemUser, false, 'isSystemUser');

  if (isSystemUser) {
    await assertSuperAdmin({
      actor,
      message: 'Only a Super Administrator can create a system user.',
    });
  }

  const passwordHash = await hashPassword(password);
  const actorUserId = getActorUserId(actor);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const roleRows = await getRolesByCodes(client, roleCodes);

    const userResult = await client.query(
      `
        INSERT INTO auth.users (
          email,
          username,
          display_name,
          password_hash,
          status,
          is_system_user,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING
          user_id,
          email,
          username,
          display_name,
          status,
          is_system_user,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at,
          created_by,
          updated_by
      `,
      [email, username, displayName, passwordHash, status, isSystemUser, actorUserId],
    );

    const user = userResult.rows[0];

    for (const role of roleRows) {
      await client.query(
        `
          INSERT INTO auth.user_roles (user_id, role_id, assigned_by, active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT (user_id, role_id)
          DO UPDATE SET
            assigned_at = CURRENT_TIMESTAMP,
            assigned_by = EXCLUDED.assigned_by,
            active = TRUE
        `,
        [user.user_id, role.role_id, actorUserId],
      );
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_CREATE',
      resourceType: 'auth.users',
      resourceId: user.user_id,
      action: 'create_user',
      success: true,
      message: 'User account created through Admin API.',
      metadata: {
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        status: user.status,
        roleCodes,
        isSystemUser,
      },
    });

    await client.query('COMMIT');

    return {
      user: sanitizeUser(user),
      roleCodes,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Email, username, role code, or permission code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateUser({ userId, body = {}, actor, context = {} }) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const actorUserId = getActorUserId(actor);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await getUserRowById(client, normalizedUserId, { forUpdate: true });
    await assertCanMutateSystemUser({ user, actor });

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      values.push(normalizeEmail(body.email));
      updates.push(`email = $${values.length}`);
    }

    const usernamePatch = normalizeNullableTextPatch(body, 'username');

    if (usernamePatch.supplied) {
      values.push(usernamePatch.value);
      updates.push(`username = $${values.length}`);
    }

    const displayNamePatch = normalizeNullableTextPatch(body, 'displayName');

    if (displayNamePatch.supplied) {
      values.push(displayNamePatch.value);
      updates.push(`display_name = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'isSystemUser')) {
      await assertSuperAdmin({
        actor,
        message: 'Only a Super Administrator can change the system-user flag.',
      });

      values.push(normalizeBoolean(body.isSystemUser, 'isSystemUser'));
      updates.push(`is_system_user = $${values.length}`);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return {
        user: sanitizeUser(user),
        changed: false,
      };
    }

    values.push(actorUserId);
    updates.push(`updated_by = $${values.length}`);

    values.push(normalizedUserId);

    const result = await client.query(
      `
        UPDATE auth.users
        SET ${updates.join(', ')}
        WHERE user_id = $${values.length}
        RETURNING
          user_id,
          email,
          username,
          display_name,
          status,
          is_system_user,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at,
          created_by,
          updated_by
      `,
      values,
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_UPDATE',
      resourceType: 'auth.users',
      resourceId: normalizedUserId,
      action: 'update_user',
      success: true,
      message: 'User account updated through Admin API.',
      metadata: {
        changedFields: updates.map((field) => field.split(' = ')[0]),
      },
    });

    await client.query('COMMIT');

    return {
      user: sanitizeUser(result.rows[0]),
      changed: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Email or username already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateUserStatus({ userId, body = {}, actor, context = {} }) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const status = normalizeUserStatus(body.status);
  assertNotSelfStatusLockout({ targetUserId: normalizedUserId, actor, nextStatus: status });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await getUserRowById(client, normalizedUserId, { forUpdate: true });
    await assertCanMutateSystemUser({ user, actor });

    const result = await client.query(
      `
        UPDATE auth.users
        SET status = $1,
            locked_until = CASE WHEN $1 = 'LOCKED' THEN locked_until ELSE NULL END,
            failed_login_count = CASE WHEN $1 = 'ACTIVE' THEN 0 ELSE failed_login_count END,
            updated_by = $2
        WHERE user_id = $3
        RETURNING
          user_id,
          email,
          username,
          display_name,
          status,
          is_system_user,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at,
          created_by,
          updated_by
      `,
      [status, getActorUserId(actor), normalizedUserId],
    );

    let revokedSessionCount = 0;

    if (status !== 'ACTIVE') {
      const revokeResult = await client.query(
        `
          UPDATE auth.sessions
          SET revoked_at = CURRENT_TIMESTAMP,
              revoked_reason = $1
          WHERE user_id = $2
            AND revoked_at IS NULL
          RETURNING session_id
        `,
        [`ADMIN_USER_STATUS_${status}`, normalizedUserId],
      );

      revokedSessionCount = revokeResult.rowCount || 0;
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_STATUS',
      resourceType: 'auth.users',
      resourceId: normalizedUserId,
      action: 'update_user_status',
      success: true,
      message: `User status changed to ${status}.`,
      metadata: {
        previousStatus: user.status,
        status,
        revokedSessionCount,
      },
    });

    await client.query('COMMIT');

    return {
      user: sanitizeUser(result.rows[0]),
      revokedSessionCount,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function resetUserPassword({ userId, body = {}, actor, context = {} }) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const password = normalizeRequiredString(body.password || body.newPassword, 'password');
  const revokeSessions = normalizeOptionalBoolean(body.revokeSessions, true, 'revokeSessions');
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await getUserRowById(client, normalizedUserId, { forUpdate: true });
    await assertCanMutateSystemUser({ user, actor });

    const result = await client.query(
      `
        UPDATE auth.users
        SET password_hash = $1,
            failed_login_count = 0,
            locked_until = NULL,
            updated_by = $2
        WHERE user_id = $3
        RETURNING
          user_id,
          email,
          username,
          display_name,
          status,
          is_system_user,
          failed_login_count,
          locked_until,
          last_login_at,
          created_at,
          updated_at,
          created_by,
          updated_by
      `,
      [passwordHash, getActorUserId(actor), normalizedUserId],
    );

    let revokedSessionCount = 0;

    if (revokeSessions) {
      const revokeResult = await client.query(
        `
          UPDATE auth.sessions
          SET revoked_at = CURRENT_TIMESTAMP,
              revoked_reason = 'ADMIN_PASSWORD_RESET'
          WHERE user_id = $1
            AND revoked_at IS NULL
          RETURNING session_id
        `,
        [normalizedUserId],
      );

      revokedSessionCount = revokeResult.rowCount || 0;
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_PASSWORD_RESET',
      resourceType: 'auth.users',
      resourceId: normalizedUserId,
      action: 'reset_user_password',
      success: true,
      message: 'User password reset through Admin API.',
      metadata: {
        revokeSessions,
        revokedSessionCount,
      },
    });

    await client.query('COMMIT');

    return {
      user: sanitizeUser(result.rows[0]),
      revokedSessionCount,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getUserRoles(userId) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const result = await query(
    `
      SELECT *
      FROM auth.vw_user_roles
      WHERE user_id = $1
      ORDER BY role_code
    `,
    [normalizedUserId],
  );

  return {
    userId: normalizedUserId,
    items: result.rows.map(sanitizeUserRole),
  };
}

async function updateUserRoles({ userId, body = {}, actor, context = {} }) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const roleCodes = normalizeStringArray(body.roleCodes || body.roles, 'roleCodes').map(
    (roleCode) => normalizeCode(roleCode, 'roleCode'),
  );
  assertNotSelfRoleUpdate({ targetUserId: normalizedUserId, actor });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await getUserRowById(client, normalizedUserId, { forUpdate: true });
    await assertCanMutateSystemUser({ user, actor });

    const roleRows = await getRolesByCodes(client, roleCodes);
    const roleIds = roleRows.map((role) => role.role_id);
    const actorUserId = getActorUserId(actor);

    if (roleIds.length === 0) {
      await client.query(
        `
          UPDATE auth.user_roles
          SET active = FALSE
          WHERE user_id = $1
            AND active = TRUE
        `,
        [normalizedUserId],
      );
    } else {
      await client.query(
        `
          UPDATE auth.user_roles
          SET active = FALSE
          WHERE user_id = $1
            AND role_id <> ALL($2::uuid[])
            AND active = TRUE
        `,
        [normalizedUserId, roleIds],
      );

      for (const role of roleRows) {
        await client.query(
          `
            INSERT INTO auth.user_roles (user_id, role_id, assigned_by, active)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (user_id, role_id)
            DO UPDATE SET
              assigned_at = CURRENT_TIMESTAMP,
              assigned_by = EXCLUDED.assigned_by,
              active = TRUE
          `,
          [normalizedUserId, role.role_id, actorUserId],
        );
      }
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_ROLES_UPDATE',
      resourceType: 'auth.user_roles',
      resourceId: normalizedUserId,
      action: 'update_user_roles',
      success: true,
      message: 'User roles replaced through Admin API.',
      metadata: {
        roleCodes,
      },
    });

    const rolesResult = await client.query(
      `
        SELECT *
        FROM auth.vw_user_roles
        WHERE user_id = $1
        ORDER BY role_code
      `,
      [normalizedUserId],
    );

    await client.query('COMMIT');

    return {
      userId: normalizedUserId,
      items: rolesResult.rows.map(sanitizeUserRole),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getUserSessions(userId) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const result = await query(
    `
      SELECT *
      FROM auth.vw_active_sessions
      WHERE user_id = $1
      ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
    `,
    [normalizedUserId],
  );

  return {
    userId: normalizedUserId,
    items: result.rows.map(sanitizeSession),
  };
}

async function revokeUserSessions({ userId, body = {}, actor, context = {} }) {
  const normalizedUserId = normalizeUuid(userId, 'userId');
  assertNotSelfSessionRevoke({ targetUserId: normalizedUserId, actor });

  const reason = normalizeOptionalString(body.reason) || 'ADMIN_REVOKE_USER_SESSIONS';
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await getUserRowById(client, normalizedUserId, { forUpdate: true });
    await assertCanMutateSystemUser({ user, actor });

    const result = await client.query(
      `
        UPDATE auth.sessions
        SET revoked_at = CURRENT_TIMESTAMP,
            revoked_reason = $1
        WHERE user_id = $2
          AND revoked_at IS NULL
        RETURNING session_id
      `,
      [reason, normalizedUserId],
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_USER_ADMIN_REVOKE_SESSIONS',
      resourceType: 'auth.sessions',
      resourceId: normalizedUserId,
      action: 'revoke_user_sessions',
      success: true,
      message: `Revoked ${result.rowCount || 0} user session(s).`,
      metadata: {
        reason,
        revokedSessionCount: result.rowCount || 0,
      },
    });

    await client.query('COMMIT');

    return {
      userId: normalizedUserId,
      revokedSessionCount: result.rowCount || 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getRole(roleId) {
  const client = await pool.connect();

  try {
    const role = await getRoleRowById(client, roleId);

    const permissionsResult = await client.query(
      `
        SELECT *
        FROM auth.vw_role_permissions
        WHERE role_id = $1
        ORDER BY resource, action, permission_code
      `,
      [role.role_id],
    );

    const usersResult = await client.query(
      `
        SELECT *
        FROM auth.vw_user_roles
        WHERE role_id = $1
        ORDER BY email
      `,
      [role.role_id],
    );

    return {
      role: sanitizeRole(role),
      permissions: permissionsResult.rows.map(sanitizeRolePermission),
      users: usersResult.rows.map(sanitizeUserRole),
    };
  } finally {
    client.release();
  }
}

async function createRole({ body = {}, actor, context = {} }) {
  const roleCode = normalizeCode(body.roleCode, 'roleCode');
  const roleName = normalizeRequiredString(body.roleName, 'roleName');
  const description = normalizeOptionalString(body.description);
  const isSystemRole = normalizeOptionalBoolean(body.isSystemRole, false, 'isSystemRole');
  const active = normalizeOptionalBoolean(body.active, true, 'active');

  if (isSystemRole) {
    await assertSuperAdmin({
      actor,
      message: 'Only a Super Administrator can create a system role.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO auth.roles (
          role_code,
          role_name,
          description,
          is_system_role,
          active
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          role_id,
          role_code,
          role_name,
          description,
          is_system_role,
          active,
          created_at,
          updated_at
      `,
      [roleCode, roleName, description, isSystemRole, active],
    );

    const role = result.rows[0];

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_ROLE_ADMIN_CREATE',
      resourceType: 'auth.roles',
      resourceId: role.role_id,
      action: 'create_role',
      success: true,
      message: 'Role created through Admin API.',
      metadata: {
        roleCode,
        roleName,
        isSystemRole,
        active,
      },
    });

    await client.query('COMMIT');

    return {
      role: sanitizeRole(role),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Role code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateRole({ roleId, body = {}, actor, context = {} }) {
  const normalizedRoleId = normalizeUuid(roleId, 'roleId');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const role = await getRoleRowById(client, normalizedRoleId, { forUpdate: true });
    await assertCanMutateSystemRole({ role, actor });

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'roleCode')) {
      if (role.is_system_role) {
        throw createHttpError(400, 'System role codes cannot be changed.');
      }

      values.push(normalizeCode(body.roleCode, 'roleCode'));
      updates.push(`role_code = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'roleName')) {
      values.push(normalizeRequiredString(body.roleName, 'roleName'));
      updates.push(`role_name = $${values.length}`);
    }

    const descriptionPatch = normalizeNullableTextPatch(body, 'description');

    if (descriptionPatch.supplied) {
      values.push(descriptionPatch.value);
      updates.push(`description = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'isSystemRole')) {
      await assertSuperAdmin({
        actor,
        message: 'Only a Super Administrator can change the system-role flag.',
      });

      values.push(normalizeBoolean(body.isSystemRole, 'isSystemRole'));
      updates.push(`is_system_role = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'active')) {
      values.push(normalizeBoolean(body.active, 'active'));
      updates.push(`active = $${values.length}`);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return {
        role: sanitizeRole(role),
        changed: false,
      };
    }

    values.push(normalizedRoleId);

    const result = await client.query(
      `
        UPDATE auth.roles
        SET ${updates.join(', ')}
        WHERE role_id = $${values.length}
        RETURNING
          role_id,
          role_code,
          role_name,
          description,
          is_system_role,
          active,
          created_at,
          updated_at
      `,
      values,
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_ROLE_ADMIN_UPDATE',
      resourceType: 'auth.roles',
      resourceId: normalizedRoleId,
      action: 'update_role',
      success: true,
      message: 'Role updated through Admin API.',
      metadata: {
        changedFields: updates.map((field) => field.split(' = ')[0]),
      },
    });

    await client.query('COMMIT');

    return {
      role: sanitizeRole(result.rows[0]),
      changed: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Role code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateRoleStatus({ roleId, body = {}, actor, context = {} }) {
  return updateRole({
    roleId,
    body: {
      active: normalizeBoolean(body.active, 'active'),
    },
    actor,
    context,
  });
}

async function getRolePermissions(roleId) {
  const normalizedRoleId = normalizeUuid(roleId, 'roleId');
  const result = await query(
    `
      SELECT *
      FROM auth.vw_role_permissions
      WHERE role_id = $1
      ORDER BY resource, action, permission_code
    `,
    [normalizedRoleId],
  );

  return {
    roleId: normalizedRoleId,
    items: result.rows.map(sanitizeRolePermission),
  };
}

async function updateRolePermissions({ roleId, body = {}, actor, context = {} }) {
  const normalizedRoleId = normalizeUuid(roleId, 'roleId');
  const permissionCodes = normalizeStringArray(
    body.permissionCodes || body.permissions,
    'permissionCodes',
  ).map((permissionCode) => normalizeCode(permissionCode, 'permissionCode'));

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const role = await getRoleRowById(client, normalizedRoleId, { forUpdate: true });
    await assertCanMutateSystemRole({ role, actor });

    const permissionRows = await getPermissionsByCodes(client, permissionCodes);
    const permissionIds = permissionRows.map((permission) => permission.permission_id);
    const actorUserId = getActorUserId(actor);

    if (permissionIds.length === 0) {
      await client.query(
        `
          UPDATE auth.role_permissions
          SET active = FALSE
          WHERE role_id = $1
            AND active = TRUE
        `,
        [normalizedRoleId],
      );
    } else {
      await client.query(
        `
          UPDATE auth.role_permissions
          SET active = FALSE
          WHERE role_id = $1
            AND permission_id <> ALL($2::uuid[])
            AND active = TRUE
        `,
        [normalizedRoleId, permissionIds],
      );

      for (const permission of permissionRows) {
        await client.query(
          `
            INSERT INTO auth.role_permissions (role_id, permission_id, granted_by, active)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (role_id, permission_id)
            DO UPDATE SET
              granted_at = CURRENT_TIMESTAMP,
              granted_by = EXCLUDED.granted_by,
              active = TRUE
          `,
          [normalizedRoleId, permission.permission_id, actorUserId],
        );
      }
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_ROLE_ADMIN_PERMISSIONS_UPDATE',
      resourceType: 'auth.role_permissions',
      resourceId: normalizedRoleId,
      action: 'update_role_permissions',
      success: true,
      message: 'Role permissions replaced through Admin API.',
      metadata: {
        roleCode: role.role_code,
        permissionCodes,
      },
    });

    const permissionsResult = await client.query(
      `
        SELECT *
        FROM auth.vw_role_permissions
        WHERE role_id = $1
        ORDER BY resource, action, permission_code
      `,
      [normalizedRoleId],
    );

    await client.query('COMMIT');

    return {
      roleId: normalizedRoleId,
      items: permissionsResult.rows.map(sanitizeRolePermission),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getRoleUsers(roleId) {
  const normalizedRoleId = normalizeUuid(roleId, 'roleId');
  const result = await query(
    `
      SELECT *
      FROM auth.vw_user_roles
      WHERE role_id = $1
      ORDER BY email
    `,
    [normalizedRoleId],
  );

  return {
    roleId: normalizedRoleId,
    items: result.rows.map(sanitizeUserRole),
  };
}

async function getPermission(permissionId) {
  const client = await pool.connect();

  try {
    const permission = await getPermissionRowById(client, permissionId);

    const rolesResult = await client.query(
      `
        SELECT *
        FROM auth.vw_role_permissions
        WHERE permission_id = $1
        ORDER BY role_code
      `,
      [permission.permission_id],
    );

    return {
      permission: sanitizePermission(permission),
      roles: rolesResult.rows.map(sanitizeRolePermission),
    };
  } finally {
    client.release();
  }
}

async function createPermission({ body = {}, actor, context = {} }) {
  const permissionCode = normalizeCode(body.permissionCode, 'permissionCode');
  const resource = normalizeResourceAction(body.resource, 'resource');
  const action = normalizeResourceAction(body.action, 'action');
  const description = normalizeOptionalString(body.description);
  const active = normalizeOptionalBoolean(body.active, true, 'active');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO auth.permissions (
          permission_code,
          resource,
          action,
          description,
          active
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          permission_id,
          permission_code,
          resource,
          action,
          description,
          active,
          created_at,
          updated_at
      `,
      [permissionCode, resource, action, description, active],
    );

    const permission = result.rows[0];

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_PERMISSION_ADMIN_CREATE',
      resourceType: 'auth.permissions',
      resourceId: permission.permission_id,
      action: 'create_permission',
      success: true,
      message: 'Permission created through Admin API.',
      metadata: {
        permissionCode,
        resource,
        action,
        active,
      },
    });

    await client.query('COMMIT');

    return {
      permission: sanitizePermission(permission),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Permission code or resource/action already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updatePermission({ permissionId, body = {}, actor, context = {} }) {
  const normalizedPermissionId = normalizeUuid(permissionId, 'permissionId');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const permission = await getPermissionRowById(client, normalizedPermissionId, {
      forUpdate: true,
    });

    await assertCanMutateCoreAdminPermission({ permission, actor });

    const updates = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, 'permissionCode')) {
      values.push(normalizeCode(body.permissionCode, 'permissionCode'));
      updates.push(`permission_code = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'resource')) {
      values.push(normalizeResourceAction(body.resource, 'resource'));
      updates.push(`resource = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'action')) {
      values.push(normalizeResourceAction(body.action, 'action'));
      updates.push(`action = $${values.length}`);
    }

    const descriptionPatch = normalizeNullableTextPatch(body, 'description');

    if (descriptionPatch.supplied) {
      values.push(descriptionPatch.value);
      updates.push(`description = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'active')) {
      values.push(normalizeBoolean(body.active, 'active'));
      updates.push(`active = $${values.length}`);
    }

    if (updates.length === 0) {
      await client.query('ROLLBACK');
      return {
        permission: sanitizePermission(permission),
        changed: false,
      };
    }

    values.push(normalizedPermissionId);

    const result = await client.query(
      `
        UPDATE auth.permissions
        SET ${updates.join(', ')}
        WHERE permission_id = $${values.length}
        RETURNING
          permission_id,
          permission_code,
          resource,
          action,
          description,
          active,
          created_at,
          updated_at
      `,
      values,
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'AUTH_PERMISSION_ADMIN_UPDATE',
      resourceType: 'auth.permissions',
      resourceId: normalizedPermissionId,
      action: 'update_permission',
      success: true,
      message: 'Permission updated through Admin API.',
      metadata: {
        previousPermissionCode: permission.permission_code,
        changedFields: updates.map((field) => field.split(' = ')[0]),
      },
    });

    await client.query('COMMIT');

    return {
      permission: sanitizePermission(result.rows[0]),
      changed: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Permission code or resource/action already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updatePermissionStatus({ permissionId, body = {}, actor, context = {} }) {
  return updatePermission({
    permissionId,
    body: {
      active: normalizeBoolean(body.active, 'active'),
    },
    actor,
    context,
  });
}

async function getPermissionRoles(permissionId) {
  const normalizedPermissionId = normalizeUuid(permissionId, 'permissionId');
  const result = await query(
    `
      SELECT *
      FROM auth.vw_role_permissions
      WHERE permission_id = $1
      ORDER BY role_code
    `,
    [normalizedPermissionId],
  );

  return {
    permissionId: normalizedPermissionId,
    items: result.rows.map(sanitizeRolePermission),
  };
}

async function listRepositories(filters = {}) {
  const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(filters.offset, 10) || 0, 0);
  const clauses = [];
  const values = [];

  const q = normalizeOptionalString(filters.q);

  if (q) {
    values.push(`%${q}%`);
    clauses.push(`(
      repo_code ILIKE $${values.length}
      OR repo_name ILIKE $${values.length}
      OR COALESCE(description, '') ILIKE $${values.length}
      OR COALESCE(remote_url, '') ILIKE $${values.length}
    )`);
  }

  if (filters.active !== undefined && filters.active !== null && filters.active !== '') {
    values.push(normalizeBoolean(filters.active, 'active'));
    clauses.push(`active = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM core.repositories
      ${whereClause}
    `,
    values,
  );

  const dataResult = await query(
    `
      SELECT
        repo_id,
        repo_code,
        repo_name,
        description,
        remote_url,
        main_branch,
        dev_branch,
        display_order,
        active,
        created_at,
        updated_at
      FROM core.repositories
      ${whereClause}
      ORDER BY display_order, repo_name, repo_code
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, limit, offset],
  );

  return {
    total: Number(countResult.rows[0]?.total || 0),
    limit,
    offset,
    items: dataResult.rows.map(sanitizeRepository),
  };
}

async function listConfigProfiles() {
  const result = await query(
    `
      SELECT profile_id, profile_code, profile_name, description, active, created_at
      FROM core.config_profiles
      ORDER BY profile_code
    `,
  );

  return {
    items: result.rows.map(sanitizeConfigProfile),
  };
}

async function getRepositoryRowById(client, rawRepoId, options = {}) {
  const repoId = normalizeUuid(rawRepoId, 'repoId');
  const result = await client.query(
    `
      SELECT
        repo_id,
        repo_code,
        repo_name,
        description,
        remote_url,
        main_branch,
        dev_branch,
        display_order,
        active,
        created_at,
        updated_at
      FROM core.repositories
      WHERE repo_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}
    `,
    [repoId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Repository not found.');
  }

  return result.rows[0];
}

async function getRepositoryPaths(client, repoId) {
  const result = await client.query(
    `
      SELECT
        cp.profile_id,
        cp.profile_code,
        cp.profile_name,
        rp.repo_path_id,
        rp.repo_id,
        rp.root_path,
        rp.active AS path_active,
        rp.created_at AS path_created_at,
        rp.updated_at AS path_updated_at
      FROM core.config_profiles cp
      LEFT JOIN core.repository_paths rp
        ON rp.profile_id = cp.profile_id
       AND rp.repo_id = $1
      WHERE cp.active = TRUE
      ORDER BY cp.profile_code
    `,
    [repoId],
  );

  return result.rows.map(sanitizeRepositoryPath);
}

async function getRepository(repoId) {
  const client = await pool.connect();

  try {
    const repository = await getRepositoryRowById(client, repoId);
    const paths = await getRepositoryPaths(client, repository.repo_id);

    return {
      repository: sanitizeRepository(repository),
      paths,
    };
  } finally {
    client.release();
  }
}

function normalizeRepositoryPayload(body = {}, options = {}) {
  const patch = Boolean(options.patch);
  const payload = {};

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'repoCode')) {
    payload.repoCode = normalizeRepositoryCode(body.repoCode);
  }

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'repoName')) {
    payload.repoName = normalizeRequiredString(body.repoName, 'repoName');
  }

  for (const [bodyKey, payloadKey] of [
    ['description', 'description'],
    ['remoteUrl', 'remoteUrl'],
  ]) {
    if (!patch || Object.prototype.hasOwnProperty.call(body, bodyKey)) {
      payload[payloadKey] = normalizeOptionalString(body[bodyKey]);
    }
  }

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'mainBranch')) {
    payload.mainBranch = normalizeRequiredString(body.mainBranch || 'main', 'mainBranch');
  }

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'devBranch')) {
    payload.devBranch = normalizeRequiredString(body.devBranch || 'dev', 'devBranch');
  }

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'displayOrder')) {
    payload.displayOrder = normalizeInteger(body.displayOrder, 999, 'displayOrder');
  }

  if (!patch || Object.prototype.hasOwnProperty.call(body, 'active')) {
    payload.active = normalizeOptionalBoolean(body.active, true, 'active');
  }

  return payload;
}

function normalizeRepositoryPathsPayload(paths) {
  if (!Array.isArray(paths)) {
    throw createHttpError(400, 'paths must be an array.');
  }

  return paths.map((pathItem) => {
    const profileId = normalizeUuid(pathItem.profileId, 'profileId');
    const active = normalizeOptionalBoolean(pathItem.active, true, 'path.active');
    const rootPath = active
      ? normalizePathPayload(pathItem.rootPath)
      : normalizeOptionalString(pathItem.rootPath);

    return {
      profileId,
      rootPath,
      active,
    };
  });
}

async function upsertRepositoryPaths(client, repoId, paths = []) {
  const normalizedPaths = normalizeRepositoryPathsPayload(paths);

  for (const pathItem of normalizedPaths) {
    if (!pathItem.rootPath && !pathItem.active) {
      await client.query(
        `
          UPDATE core.repository_paths
          SET active = FALSE,
              updated_at = CURRENT_TIMESTAMP
          WHERE repo_id = $1
            AND profile_id = $2
        `,
        [repoId, pathItem.profileId],
      );
      continue;
    }

    await client.query(
      `
        INSERT INTO core.repository_paths (repo_id, profile_id, root_path, active)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (repo_id, profile_id)
        DO UPDATE SET
          root_path = EXCLUDED.root_path,
          active = EXCLUDED.active,
          updated_at = CURRENT_TIMESTAMP
      `,
      [repoId, pathItem.profileId, pathItem.rootPath || '', pathItem.active],
    );
  }
}

async function createRepository({ body = {}, actor, context = {} }) {
  const payload = normalizeRepositoryPayload(body);
  const paths = Array.isArray(body.paths) ? body.paths : [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO core.repositories (
          repo_code,
          repo_name,
          description,
          remote_url,
          main_branch,
          dev_branch,
          display_order,
          active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
          repo_id,
          repo_code,
          repo_name,
          description,
          remote_url,
          main_branch,
          dev_branch,
          display_order,
          active,
          created_at,
          updated_at
      `,
      [
        payload.repoCode,
        payload.repoName,
        payload.description,
        payload.remoteUrl,
        payload.mainBranch,
        payload.devBranch,
        payload.displayOrder,
        payload.active,
      ],
    );

    const repository = result.rows[0];
    await upsertRepositoryPaths(client, repository.repo_id, paths);

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_REPOSITORY_CREATE',
      resourceType: 'core.repositories',
      resourceId: repository.repo_id,
      action: 'create_repository',
      success: true,
      message: 'Repository configuration created through Admin API.',
      metadata: {
        repoCode: repository.repo_code,
        repoName: repository.repo_name,
        pathCount: paths.length,
      },
    });

    await client.query('COMMIT');

    return {
      repository: sanitizeRepository(repository),
      paths: await getRepositoryPaths(client, repository.repo_id),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Repository code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateRepository({ repoId, body = {}, actor, context = {} }) {
  const normalizedRepoId = normalizeUuid(repoId, 'repoId');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await getRepositoryRowById(client, normalizedRepoId, { forUpdate: true });

    const payload = normalizeRepositoryPayload(body, { patch: true });
    const updates = [];
    const values = [];
    const fieldMap = [
      ['repoCode', 'repo_code'],
      ['repoName', 'repo_name'],
      ['description', 'description'],
      ['remoteUrl', 'remote_url'],
      ['mainBranch', 'main_branch'],
      ['devBranch', 'dev_branch'],
      ['displayOrder', 'display_order'],
      ['active', 'active'],
    ];

    for (const [payloadKey, columnName] of fieldMap) {
      if (Object.prototype.hasOwnProperty.call(payload, payloadKey)) {
        values.push(payload[payloadKey]);
        updates.push(`${columnName} = $${values.length}`);
      }
    }

    if (updates.length > 0) {
      values.push(normalizedRepoId);
      await client.query(
        `
          UPDATE core.repositories
          SET ${updates.join(', ')},
              updated_at = CURRENT_TIMESTAMP
          WHERE repo_id = $${values.length}
        `,
        values,
      );
    }

    if (Array.isArray(body.paths)) {
      await upsertRepositoryPaths(client, normalizedRepoId, body.paths);
    }

    const repository = await getRepositoryRowById(client, normalizedRepoId);

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_REPOSITORY_UPDATE',
      resourceType: 'core.repositories',
      resourceId: normalizedRepoId,
      action: 'update_repository',
      success: true,
      message: 'Repository configuration updated through Admin API.',
      metadata: {
        changedFields: Object.keys(payload),
        pathsUpdated: Array.isArray(body.paths),
      },
    });

    await client.query('COMMIT');

    return {
      repository: sanitizeRepository(repository),
      paths: await getRepositoryPaths(client, normalizedRepoId),
      changed: updates.length > 0 || Array.isArray(body.paths),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'Repository code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function updateRepositoryStatus({ repoId, body = {}, actor, context = {} }) {
  return updateRepository({
    repoId,
    body: {
      active: normalizeBoolean(body.active, 'active'),
    },
    actor,
    context,
  });
}

async function updateRepositoryPaths({ repoId, body = {}, actor, context = {} }) {
  return updateRepository({
    repoId,
    body: {
      paths: body.paths,
    },
    actor,
    context,
  });
}

async function deleteRepository({ repoId, body = {}, actor, context = {} }) {
  const normalizedRepoId = normalizeUuid(repoId, 'repoId');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const repository = await getRepositoryRowById(client, normalizedRepoId, { forUpdate: true });

    await client.query(
      `
        UPDATE core.repositories
        SET active = FALSE,
            updated_at = CURRENT_TIMESTAMP
        WHERE repo_id = $1
      `,
      [normalizedRepoId],
    );

    await client.query(
      `
        UPDATE core.repository_paths
        SET active = FALSE,
            updated_at = CURRENT_TIMESTAMP
        WHERE repo_id = $1
      `,
      [normalizedRepoId],
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_REPOSITORY_DELETE',
      resourceType: 'core.repositories',
      resourceId: normalizedRepoId,
      action: 'delete_repository',
      success: true,
      message: 'Repository configuration was disabled through Admin API.',
      metadata: {
        repoCode: repository.repo_code,
        repoName: repository.repo_name,
        deleteReason: normalizeOptionalString(body.reason),
        softDelete: true,
      },
    });

    await client.query('COMMIT');

    return {
      repository: sanitizeRepository({ ...repository, active: false }),
      deleted: true,
      softDelete: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function getAuthSettings() {
  return {
    auth: {
      sessionMinutes: Number(process.env.AUTH_SESSION_MINUTES || 12 * 60),
      revokeSessionsOnStart: String(process.env.AUTH_REVOKE_SESSIONS_ON_START || 'false'),
      maxFailedLoginAttempts: Number(process.env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS || 5),
      lockMinutes: Number(process.env.AUTH_LOCK_MINUTES || 15),
      loginRateLimitWindowMs: Number(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS || 60000),
      loginRateLimitMaxAttempts: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 8),
      loginRateLimitBlockMs: Number(process.env.AUTH_LOGIN_RATE_LIMIT_BLOCK_MS || 300000),
      bcryptRoundsConfigured: Boolean(process.env.AUTH_BCRYPT_ROUNDS),
    },
  };
}

async function getCoreSettings() {
  const [
    applicationsResult,
    profilesResult,
    repositoriesResult,
    channelsResult,
    runtimesResult,
    risksResult,
    toolCountResult,
  ] = await Promise.all([
    query(
      `
          SELECT app_code, title, manifest_version, description, active, created_at, updated_at
          FROM core.applications
          ORDER BY app_code
        `,
    ),
    query(
      `
          SELECT profile_code, profile_name, description, active, created_at
          FROM core.config_profiles
          ORDER BY profile_code
        `,
    ),
    query(
      `
          SELECT profile_code, repo_id, repo_code, repo_name, remote_url, main_branch, dev_branch, display_order, root_path
          FROM core.vw_repository_paths
          ORDER BY profile_code, display_order, repo_name
        `,
    ),
    query(
      `
          SELECT channel_code, channel_name, description, active
          FROM core.visibility_channels
          ORDER BY channel_code
        `,
    ),
    query(
      `
          SELECT runtime_code, runtime_name, executable, description, active
          FROM core.runtimes
          ORDER BY runtime_code
        `,
    ),
    query(
      `
          SELECT risk_code, risk_name, risk_rank, description, active
          FROM core.risk_levels
          ORDER BY risk_rank
        `,
    ),
    query(
      `
          SELECT
            COUNT(*)::int AS tool_count,
            COUNT(*) FILTER (WHERE tool_enabled = TRUE)::int AS enabled_tool_count,
            COUNT(DISTINCT category_code)::int AS category_count
          FROM core.vw_tool_manifest
        `,
    ),
  ]);

  return {
    applications: applicationsResult.rows,
    profiles: profilesResult.rows,
    repositories: repositoriesResult.rows,
    visibilityChannels: channelsResult.rows,
    runtimes: runtimesResult.rows,
    riskLevels: risksResult.rows,
    toolSummary: toolCountResult.rows[0] || {
      tool_count: 0,
      enabled_tool_count: 0,
      category_count: 0,
    },
  };
}

module.exports = {
  createHttpError,
  getUser,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  getUserRoles,
  updateUserRoles,
  getUserSessions,
  revokeUserSessions,
  getRole,
  createRole,
  updateRole,
  updateRoleStatus,
  getRolePermissions,
  updateRolePermissions,
  getRoleUsers,
  getPermission,
  createPermission,
  updatePermission,
  updatePermissionStatus,
  getPermissionRoles,
  listRepositories,
  listConfigProfiles,
  getRepository,
  createRepository,
  updateRepository,
  updateRepositoryStatus,
  updateRepositoryPaths,
  deleteRepository,
  getAuthSettings,
  getCoreSettings,
};
