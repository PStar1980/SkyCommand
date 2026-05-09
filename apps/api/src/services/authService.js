const { query } = require('../../../../packages/db/src/connection');
const {
  verifyPassword,
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

function shouldRevokeSessionsOnStart() {
  return REVOKE_SESSIONS_ON_START;
}

function sanitizeUser(user) {
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
  };
}

async function recordAuditEvent({
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
      userId,
      eventType,
      resourceType,
      resourceId,
      action,
      success,
      message,
      JSON.stringify(metadata || {}),
      ipAddress,
      userAgent,
    ],
  );
}

async function recordLoginEvent({
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
        user_id,
        session_id,
        email_attempted,
        success,
        failure_reason,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [userId, sessionId, emailAttempted, success, failureReason, ipAddress, userAgent],
  );
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

async function createSession(userId, context = {}) {
  const sessionToken = createSessionToken();
  const sessionTokenHash = hashToken(sessionToken);

  const result = await query(
    `
      INSERT INTO auth.sessions (
        user_id,
        session_token_hash,
        ip_address,
        user_agent,
        metadata,
        expires_at,
        last_seen_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        CURRENT_TIMESTAMP + ($6::numeric * INTERVAL '1 minute'),
        CURRENT_TIMESTAMP
      )
      RETURNING session_id, expires_at
    `,
    [
      userId,
      sessionTokenHash,
      context.ipAddress || null,
      context.userAgent || null,
      JSON.stringify({
        source: 'admin-web',
        sessionMinutes: DEFAULT_SESSION_MINUTES,
      }),
      DEFAULT_SESSION_MINUTES,
    ],
  );

  return {
    sessionId: result.rows[0].session_id,
    sessionToken,
    expiresAt: result.rows[0].expires_at,
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

async function getPermissionsForUser(userId) {
  const result = await query(
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
    [userId],
  );

  return result.rows.map(sanitizePermission);
}

async function hasPermission(userId, permissionCode) {
  const result = await query(
    `
      SELECT 1
      FROM auth.vw_user_permissions
      WHERE user_id = $1
        AND permission_code = $2
      LIMIT 1
    `,
    [userId, permissionCode],
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

async function login({ email, password, context }) {
  const normalizedEmail = normalizeEmail(email);
  const requestContext = context || {};

  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required.');
  }

  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    await recordLoginEvent({
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
      userId: user.user_id,
      emailAttempted: normalizedEmail,
      success: false,
      failureReason: `USER_${user.status}`,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    throw new Error('User account is not active.');
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await recordLoginEvent({
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

  const session = await createSession(user.user_id, requestContext);
  const permissions = await getPermissionsForUser(user.user_id);

  await recordLoginEvent({
    userId: user.user_id,
    sessionId: session.sessionId,
    emailAttempted: normalizedEmail,
    success: true,
    ipAddress: requestContext.ipAddress,
    userAgent: requestContext.userAgent,
  });

  await recordAuditEvent({
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
    user: sanitizeUser(user),
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
      FROM auth.users u
      WHERE s.user_id = u.user_id
        AND s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.status = 'ACTIVE'
      RETURNING
        s.session_id,
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
  const permissions = await getPermissionsForUser(row.user_id);

  return {
    session: {
      sessionId: row.session_id,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      sessionMinutes: DEFAULT_SESSION_MINUTES,
    },
    user: sanitizeUser(row),
    permissions,
  };
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
  getSessionFromToken,
  getPermissionsForUser,
  hasPermission,
  recordAuditEvent,
};
