const authService = require('../services/authService');

const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS || 60000);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 8);
const LOGIN_RATE_LIMIT_BLOCK_MS = Number(process.env.AUTH_LOGIN_RATE_LIMIT_BLOCK_MS || 300000);

const loginAttemptsByKey = new Map();

function normalizeRateLimitPart(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return normalized || fallback;
}

function getLoginRateLimitKey({ email, context }) {
  const emailPart = normalizeRateLimitPart(email, 'no-email');
  const ipPart = normalizeRateLimitPart(context?.ipAddress, 'no-ip');

  return `${ipPart}:${emailPart}`;
}

function getLoginRateLimitState(key) {
  const now = Date.now();
  const current = loginAttemptsByKey.get(key);

  if (!current || now > current.windowExpiresAt) {
    const freshState = {
      attempts: 0,
      windowExpiresAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
      blockedUntil: 0,
    };

    loginAttemptsByKey.set(key, freshState);
    return freshState;
  }

  return current;
}

function assertLoginRateLimit({ email, context }) {
  const key = getLoginRateLimitKey({ email, context });
  const state = getLoginRateLimitState(key);
  const now = Date.now();

  if (state.blockedUntil && now < state.blockedUntil) {
    const retryAfterSeconds = Math.ceil((state.blockedUntil - now) / 1000);
    const error = new Error('Too many login attempts. Please wait before trying again.');
    error.statusCode = 429;
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  return key;
}

function recordLoginRateLimitFailure(key) {
  const state = getLoginRateLimitState(key);
  const now = Date.now();

  state.attempts += 1;

  if (state.attempts >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    state.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
    state.windowExpiresAt = Math.max(state.windowExpiresAt, state.blockedUntil);
  }

  loginAttemptsByKey.set(key, state);
}

function clearLoginRateLimit(key) {
  if (key) {
    loginAttemptsByKey.delete(key);
  }
}

async function login(req, res, next) {
  const { email, password } = req.body || {};
  const context = authService.getRequestContext(req);
  let rateLimitKey = null;

  try {
    rateLimitKey = assertLoginRateLimit({ email, context });

    const result = await authService.login({ email, password, context });
    clearLoginRateLimit(rateLimitKey);

    res.json({
      ok: true,
      user: result.user,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      permissions: result.permissions,
    });
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({
        ok: false,
        error: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }

    recordLoginRateLimitFailure(rateLimitKey);

    return res.status(401).json({
      ok: false,
      error: error.message || 'Login failed.',
    });
  }
}

async function logout(req, res, next) {
  try {
    const context = authService.getRequestContext(req);

    await authService.logout({
      sessionToken: req.sessionToken,
      userId: req.user?.userId,
      context,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const context = authService.getRequestContext(req);
    const result = await authService.changePassword({
      userId: req.user?.userId,
      sessionId: req.session?.sessionId,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
      confirmPassword: req.body?.confirmPassword,
      revokeOtherSessions: req.body?.revokeOtherSessions !== false,
      context,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      console.error('[SkyServer Auth] Password change failed:', error);
    }

    res.status(statusCode).json({
      ok: false,
      error: statusCode >= 500 ? 'Internal server error.' : error.message,
      ...(error.details && Object.keys(error.details).length > 0 ? { details: error.details } : {}),
    });
  }
}

async function me(req, res) {
  res.json({
    ok: true,
    user: req.user,
    session: req.session,
    permissions: req.permissions || [],
  });
}

async function permissions(req, res) {
  res.json({
    ok: true,
    permissions: req.permissions || [],
  });
}

module.exports = {
  login,
  logout,
  changePassword,
  me,
  permissions,
};
