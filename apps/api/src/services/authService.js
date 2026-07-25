const { pool, query } = require('../../../../packages/db/src/connection');
const {
  verifyPassword,
  hashPassword,
  createSessionToken,
  hashToken,
} = require('../../../../packages/auth/src/password');

const DEFAULT_SESSION_MINUTES = parsePositiveNumber(
  process.env.AUTH_SESSION_MINUTES,
  process.env.AUTH_SESSION_HOURS
    ? parsePositiveNumber(process.env.AUTH_SESSION_HOURS, 12) * 60
    : 12 * 60,
);

const REVOKE_SESSIONS_ON_START = parseBoolean(process.env.AUTH_REVOKE_SESSIONS_ON_START, false);
const MAX_FAILED_LOGIN_ATTEMPTS = parsePositiveInteger(
  process.env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS,
  5,
);
const LOCK_MINUTES = parsePositiveInteger(process.env.AUTH_LOCK_MINUTES, 15);
const DEFAULT_AUTH_APP_CODE = String(process.env.AUTH_APP_CODE || 'SKYSERVER_ADMIN')
  .trim()
  .toUpperCase();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parsePositiveInteger(value, fallback) {
  return Math.trunc(parsePositiveNumber(value, fallback));
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeAppCode(appCode, fallback = DEFAULT_AUTH_APP_CODE) {
  return String(appCode || fallback || '')
    .trim()
    .toUpperCase();
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token.trim();
}

function getRequestContext(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

function getSessionConfig() {
  return {
    sessionMinutes: DEFAULT_SESSION_MINUTES,
    revokeSessionsOnStart: REVOKE_SESSIONS_ON_START,
  };
}

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function shouldRevokeSessionsOnStart() {
  return REVOKE_SESSIONS_ON_START;
}

function sanitizeUser(user, roleCodes = []) {
  if (!user) {
    return null;
  }

  return {
    userId: user.user_id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    status: user.status,
    isSystemUser: user.is_system_user,
    lastLoginAt: user.last_login_at,
    roleCodes: [
      ...new Set(
        (roleCodes || [])
          .map((roleCode) => String(roleCode || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ],
  };
}

function sanitizePermission(permission) {
  return {
    permissionId: permission.permission_id,
    permissionCode: permission.permission_code,
    resource: permission.resource,
    action: permission.action,
    description: permission.permission_description || permission.description || null,
    grantedThroughRoles: permission.granted_through_roles || null,
    appId: permission.app_id || null,
    appCode: permission.app_code || null,
    appTitle: permission.app_title || null,
  };
}

async function recordAuditEvent({
  appCode = DEFAULT_AUTH_APP_CODE,
  userId = null,
  eventType,
  resourceType = null,
  resourceId = null,
  action,
  success,
  message = null,
  metadata = {},
  ipAddress = null,
  userAgent = null,
}) {
  await query(
    `
      INSERT INTO auth.audit_events (
        app_id,
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
      VALUES (
        (SELECT app_id FROM core.applications WHERE app_code = $1 LIMIT 1),
        $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11
      )
    `,
    [
      normalizeAppCode(appCode),
      userId,
      eventType,
      resourceType,
      resourceId === undefined || resourceId === null ? null : String(resourceId),
      action,
      success,
      message,
      JSON.stringify(metadata || {}),
      ipAddress,
      userAgent,
    ],
  );
}

async function recordAuditEventWithClient(
  client,
  {
    appCode = DEFAULT_AUTH_APP_CODE,
    userId = null,
    eventType,
    resourceType = null,
    resourceId = null,
    action,
    success,
    message = null,
    metadata = {},
    ipAddress = null,
    userAgent = null,
  },
) {
  await client.query(
    `
      INSERT INTO auth.audit_events (
        app_id,
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
      VALUES (
        (SELECT app_id FROM core.applications WHERE app_code = $1 LIMIT 1),
        $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11
      )
    `,
    [
      normalizeAppCode(appCode),
      userId,
      eventType,
      resourceType,
      resourceId === undefined || resourceId === null ? null : String(resourceId),
      action,
      success,
      message,
      JSON.stringify(metadata || {}),
      ipAddress || null,
      userAgent || null,
    ],
  );
}

async function recordLoginEvent({
  appCode = DEFAULT_AUTH_APP_CODE,
  userId = null,
  sessionId = null,
  emailAttempted,
  success,
  failureReason = null,
  ipAddress = null,
  userAgent = null,
}) {
  await query(
    `
      INSERT INTO auth.login_events (
        app_id,
        user_id,
        session_id,
        email_attempted,
        success,
        failure_reason,
        ip_address,
        user_agent
      )
      VALUES (
        (SELECT app_id FROM core.applications WHERE app_code = $1 LIMIT 1),
        $2, $3, $4, $5, $6, $7, $8
      )
    `,
    [
      normalizeAppCode(appCode),
      userId,
      sessionId,
      emailAttempted,
      success,
      failureReason,
      ipAddress,
      userAgent,
    ],
  );
}

async function findApplicationByCode(appCode) {
  const normalizedAppCode = normalizeAppCode(appCode);

  const result = await query(
    `
      SELECT app_id, app_code, title, active
      FROM core.applications
      WHERE app_code = $1
        AND active = TRUE
      LIMIT 1
    `,
    [normalizedAppCode],
  );

  return result.rows[0] || null;
}

async function assertUserApplicationAccess(userId, appCode) {
  const normalizedAppCode = normalizeAppCode(appCode);

  const result = await query(
    `
      SELECT 1
      FROM auth.user_applications ua
      JOIN core.applications app
        ON app.app_id = ua.app_id
      WHERE ua.user_id = $1
        AND app.app_code = $2
        AND ua.status = 'ACTIVE'
        AND app.active = TRUE
      LIMIT 1
    `,
    [userId, normalizedAppCode],
  );

  return result.rowCount > 0;
}

async function findUserByEmail(email) {
  const result = await query(
    `
      SELECT
        user_id,
        email,
        username,
        display_name,
        password_hash,
        status,
        is_system_user,
        failed_login_count,
        locked_until,
        last_login_at
      FROM auth.users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function createSession(userId, context = {}, appCode = DEFAULT_AUTH_APP_CODE) {
  const normalizedAppCode = normalizeAppCode(appCode);
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);

  const result = await query(
    `
      WITH app AS (
        SELECT app_id, app_code, title
        FROM core.applications
        WHERE app_code = $7
          AND active = TRUE
        LIMIT 1
      )
      INSERT INTO auth.sessions (
        app_id,
        user_id,
        session_token_hash,
        ip_address,
        user_agent,
        metadata,
        expires_at,
        last_seen_at
      )
      SELECT
        app.app_id,
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        CURRENT_TIMESTAMP + ($6::numeric * INTERVAL '1 minute'),
        CURRENT_TIMESTAMP
      FROM app
      RETURNING session_id, expires_at, app_id
    `,
    [
      userId,
      sessionTokenHash,
      context.ipAddress || null,
      context.userAgent || null,
      JSON.stringify({
        source:
          normalizedAppCode === 'SKYSERVER_ADMIN' ? 'admin-web' : normalizedAppCode.toLowerCase(),
        appCode: normalizedAppCode,
        sessionMinutes: DEFAULT_SESSION_MINUTES,
      }),
      DEFAULT_SESSION_MINUTES,
      normalizedAppCode,
    ],
  );

  if (result.rowCount === 0) {
    throw createHttpError(400, `Application is not active or not configured: ${normalizedAppCode}`);
  }

  return {
    sessionId: result.rows[0].session_id,
    sessionToken,
    expiresAt: result.rows[0].expires_at,
    appId: result.rows[0].app_id,
    appCode: normalizedAppCode,
  };
}

async function revokeActiveSessionsOnStartup({ reason = 'API_STARTUP' } = {}) {
  const result = await query(
    `
      UPDATE auth.sessions
      SET revoked_at = CURRENT_TIMESTAMP,
          revoked_reason = $1
      WHERE revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING session_id
    `,
    [reason],
  );

  const revokedCount = result.rowCount || 0;

  if (revokedCount > 0) {
    await recordAuditEvent({
      eventType: 'AUTH_SESSION_REVOKE',
      resourceType: 'auth.sessions',
      resourceId: reason,
      action: 'revoke_active_sessions_on_startup',
      success: true,
      message: `Revoked ${revokedCount} active session(s) during API startup.`,
      metadata: {
        reason,
        revokedCount,
      },
    });
  }

  return {
    revokedCount,
    reason,
  };
}

async function getRoleCodesForUser(userId, appCode = DEFAULT_AUTH_APP_CODE) {
  const normalizedAppCode = normalizeAppCode(appCode);
  const result = await query(
    `
      SELECT DISTINCT role.role_code
      FROM auth.user_roles user_role
      JOIN auth.roles role
        ON role.role_id = user_role.role_id
       AND role.active = TRUE
      JOIN core.applications app
        ON app.app_id = role.app_id
       AND app.active = TRUE
      WHERE user_role.user_id = $1
        AND user_role.active = TRUE
        AND app.app_code = $2
      ORDER BY role.role_code
    `,
    [userId, normalizedAppCode],
  );

  return result.rows.map((row) => row.role_code).filter(Boolean);
}

async function getPermissionsForUser(userId, appCode = DEFAULT_AUTH_APP_CODE) {
  const normalizedAppCode = normalizeAppCode(appCode);

  const result = await query(
    `
      SELECT
        permission_id,
        permission_code,
        resource,
        action,
        permission_description,
        granted_through_roles,
        app_id,
        app_code,
        app_title
      FROM auth.vw_user_permissions
      WHERE user_id = $1
        AND app_code = $2
      ORDER BY resource, action, permission_code
    `,
    [userId, normalizedAppCode],
  );

  return result.rows.map(sanitizePermission);
}

async function hasPermission(userId, permissionCode, appCode = DEFAULT_AUTH_APP_CODE) {
  const normalizedAppCode = normalizeAppCode(appCode);

  const result = await query(
    `
      SELECT 1
      FROM auth.vw_user_permissions
      WHERE user_id = $1
        AND permission_code = $2
        AND app_code = $3
      LIMIT 1
    `,
    [userId, permissionCode, normalizedAppCode],
  );

  return result.rowCount > 0;
}

async function markFailedLogin(user) {
  const nextFailedCount = Number(user.failed_login_count || 0) + 1;
  const shouldLock = nextFailedCount >= MAX_FAILED_LOGIN_ATTEMPTS;

  await query(
    `
      UPDATE auth.users
      SET failed_login_count = $1,
          locked_until = CASE
            WHEN $2 = TRUE THEN CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 minute')
            ELSE locked_until
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $4
    `,
    [nextFailedCount, shouldLock, LOCK_MINUTES, user.user_id],
  );

  return shouldLock;
}

async function resetSuccessfulLoginState(userId) {
  await query(
    `
      UPDATE auth.users
      SET failed_login_count = 0,
          locked_until = NULL,
          last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `,
    [userId],
  );
}

async function login({ email, password, context, appCode = DEFAULT_AUTH_APP_CODE }) {
  const normalizedEmail = normalizeEmail(email);
  const requestContext = context || {};
  const normalizedAppCode = normalizeAppCode(appCode);

  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required.');
  }

  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    await recordLoginEvent({
      appCode: normalizedAppCode,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: 'INVALID_CREDENTIALS',
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('Invalid email or password.');
  }

  if (user.status !== 'ACTIVE') {
    await recordLoginEvent({
      appCode: normalizedAppCode,
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: `USER_${user.status}`,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('User account is not active.');
  }

  const application = await findApplicationByCode(normalizedAppCode);

  if (!application) {
    await recordLoginEvent({
      appCode: normalizedAppCode,
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: 'APPLICATION_NOT_CONFIGURED',
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('Application is not available.');
  }

  const hasApplicationAccess = await assertUserApplicationAccess(user.user_id, normalizedAppCode);

  if (!hasApplicationAccess) {
    await recordLoginEvent({
      appCode: normalizedAppCode,
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: 'APPLICATION_ACCESS_DENIED',
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('User does not have access to this application.');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await recordLoginEvent({
      appCode: normalizedAppCode,
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: 'USER_LOCKED',
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('User account is temporarily locked.');
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    const locked = await markFailedLogin(user);

    await recordLoginEvent({
      appCode: normalizedAppCode,
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: locked ? 'INVALID_CREDENTIALS_LOCKED' : 'INVALID_CREDENTIALS',
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('Invalid email or password.');
  }

  await resetSuccessfulLoginState(user.user_id);

  const session = await createSession(user.user_id, requestContext, normalizedAppCode);
  const [permissions, roleCodes] = await Promise.all([
    getPermissionsForUser(user.user_id, normalizedAppCode),
    getRoleCodesForUser(user.user_id, normalizedAppCode),
  ]);

  await recordLoginEvent({
    appCode: normalizedAppCode,
    userId: user.user_id,
    sessionId: session.sessionId,
    emailAttempted: normalizedEmail,
    success: true,
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
  });

  await recordAuditEvent({
    appCode: normalizedAppCode,
    userId: user.user_id,
    eventType: 'AUTH_LOGIN',
    resourceType: 'auth.sessions',
    resourceId: session.sessionId,
    action: 'login',
    success: true,
    message: 'User logged in successfully.',
    metadata: { email: normalizedEmail },
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
  });

  return {
    user: sanitizeUser(user, roleCodes),
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    permissions,
  };
}

async function getSessionFromToken(sessionToken) {
  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash = hashToken(sessionToken);

  const result = await query(
    `
      UPDATE auth.sessions s
      SET last_seen_at = CURRENT_TIMESTAMP,
          expires_at = CURRENT_TIMESTAMP + ($2::numeric * INTERVAL '1 minute')
      FROM auth.users u, core.applications app, auth.user_applications ua
      WHERE s.user_id = u.user_id
        AND s.app_id = app.app_id
        AND ua.user_id = u.user_id
        AND ua.app_id = s.app_id
        AND s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.status = 'ACTIVE'
        AND ua.status = 'ACTIVE'
        AND app.active = TRUE
      RETURNING
        s.session_id,
        s.app_id,
        app.app_code,
        app.title AS app_title,
        s.expires_at,
        s.last_seen_at,
        u.user_id,
        u.email,
        u.username,
        u.display_name,
        u.status,
        u.is_system_user,
        u.last_login_at
    `,
    [sessionTokenHash, DEFAULT_SESSION_MINUTES],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  const [permissions, roleCodes] = await Promise.all([
    getPermissionsForUser(row.user_id, row.app_code),
    getRoleCodesForUser(row.user_id, row.app_code),
  ]);

  return {
    session: {
      sessionId: row.session_id,
      appId: row.app_id,
      appCode: row.app_code,
      appTitle: row.app_title,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      sessionMinutes: DEFAULT_SESSION_MINUTES,
    },
    user: sanitizeUser(row, roleCodes),
    permissions,
  };
}

async function changePassword({
  appCode = DEFAULT_AUTH_APP_CODE,
  userId,
  sessionId,
  currentPassword,
  newPassword,
  confirmPassword,
  revokeOtherSessions = true,
  context = {},
}) {
  const normalizedAppCode = normalizeAppCode(appCode);

  if (!userId) {
    throw createHttpError(401, 'Authentication required.');
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    throw createHttpError(400, 'Current password, new password, and confirmation are required.');
  }

  if (newPassword !== confirmPassword) {
    throw createHttpError(400, 'New password and confirmation do not match.');
  }

  if (newPassword === currentPassword) {
    throw createHttpError(400, 'New password must be different from the current password.');
  }

  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    throw createHttpError(400, 'Password must be at least 12 characters long.');
  }

  const userResult = await query(
    `
      SELECT
        user_id,
        email,
        username,
        display_name,
        password_hash,
        status,
        is_system_user,
        failed_login_count,
        locked_until,
        last_login_at
      FROM auth.users
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  const user = userResult.rows[0];

  if (!user || user.status !== 'ACTIVE') {
    throw createHttpError(404, 'Active user account not found.');
  }

  const currentPasswordMatches = await verifyPassword(currentPassword, user.password_hash);

  if (!currentPasswordMatches) {
    await recordAuditEvent({
      appCode: normalizedAppCode,
      userId,
      eventType: 'AUTH_PASSWORD_CHANGE',
      resourceType: 'auth.users',
      resourceId: String(userId),
      action: 'change_own_password',
      success: false,
      message: 'Password change rejected because the current password was incorrect.',
      metadata: { reason: 'INVALID_CURRENT_PASSWORD' },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    throw createHttpError(400, 'Current password is incorrect.');
  }

  const newPasswordHash = await hashPassword(newPassword);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updateResult = await client.query(
      `
        UPDATE auth.users
        SET password_hash = $2,
            failed_login_count = 0,
            locked_until = NULL,
            updated_by = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
        RETURNING
          user_id,
          email,
          username,
          display_name,
          status,
          is_system_user,
          last_login_at
      `,
      [userId, newPasswordHash, userId],
    );

    if (updateResult.rowCount === 0) {
      throw createHttpError(404, 'Active user account not found.');
    }

    let revokedOtherSessionsCount = 0;

    if (revokeOtherSessions) {
      const revokeResult = await client.query(
        `
          UPDATE auth.sessions
          SET revoked_at = CURRENT_TIMESTAMP,
              revoked_reason = 'PASSWORD_CHANGE'
          WHERE user_id = $1
            AND ($2::uuid IS NULL OR session_id <> $2::uuid)
            AND revoked_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
          RETURNING session_id
        `,
        [userId, sessionId || null],
      );

      revokedOtherSessionsCount = revokeResult.rowCount || 0;
    }

    await recordAuditEventWithClient(client, {
      appCode: normalizedAppCode,
      userId,
      eventType: 'AUTH_PASSWORD_CHANGE',
      resourceType: 'auth.users',
      resourceId: String(userId),
      action: 'change_own_password',
      success: true,
      message: 'User changed their own password successfully.',
      metadata: {
        revokeOtherSessions: Boolean(revokeOtherSessions),
        revokedOtherSessionsCount,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    await client.query('COMMIT');

    return {
      user: sanitizeUser(updateResult.rows[0]),
      changed: true,
      revokedOtherSessionsCount,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function logout({ sessionToken, userId = null, context = {} }) {
  if (!sessionToken) {
    return false;
  }

  const sessionTokenHash = hashToken(sessionToken);

  const result = await query(
    `
      UPDATE auth.sessions
      SET revoked_at = CURRENT_TIMESTAMP,
          revoked_reason = 'USER_LOGOUT'
      WHERE session_token_hash = $1
        AND revoked_at IS NULL
      RETURNING session_id, user_id
    `,
    [sessionTokenHash],
  );

  if (result.rowCount === 0) {
    return false;
  }

  const session = result.rows[0];

  await recordAuditEvent({
    userId: userId || session.user_id,
    eventType: 'AUTH_LOGOUT',
    resourceType: 'auth.sessions',
    resourceId: session.session_id,
    action: 'logout',
    success: true,
    message: 'User logged out successfully.',
    metadata: {},
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return true;
}

module.exports = {
  getBearerToken,
  getRequestContext,
  getSessionConfig,
  shouldRevokeSessionsOnStart,
  revokeActiveSessionsOnStartup,
  login,
  logout,
  changePassword,
  getSessionFromToken,
  getPermissionsForUser,
  getRoleCodesForUser,
  hasPermission,
  recordAuditEvent,
};
