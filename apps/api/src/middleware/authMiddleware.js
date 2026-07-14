const authService = require('../services/authService');

const INTERNAL_SERVICE_PERMISSION_CODES = [
  'WORKFLOW_READ',
  'WORKFLOW_START',
  'WORKFLOW_RUN',
  'TEMPORAL_WORKFLOW_READ',
  'TEMPORAL_WORKFLOW_START',
  'WORKER_SCHEDULE_READ',
  'WORKER_SCHEDULE_RUN',
  'WORKER_SCHEDULE_RUN_IMMEDIATE',
];

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

function getInternalServiceToken(req) {
  return String(req.headers['x-skyserver-internal-token'] || '').trim();
}

function getConfiguredInternalServiceToken() {
  return String(process.env.SKYSERVER_INTERNAL_API_TOKEN || '').trim();
}

function isInternalServiceAuthEnabled() {
  return parseBoolean(process.env.SKYSERVER_INTERNAL_API_AUTH_ENABLED, true);
}

function buildInternalServicePermission(permissionCode) {
  return {
    permissionId: null,
    permissionCode,
    resource: 'internal_service',
    action: 'allow',
    description: 'Granted through SkyServer internal service token.',
    grantedThroughRoles: ['INTERNAL_SERVICE'],
    appId: null,
    appCode: 'SKYSERVER_ADMIN',
    appTitle: 'SkyCommand',
  };
}

function applyInternalServiceIdentity(req) {
  req.sessionToken = null;
  req.session = {
    sessionId: null,
    appCode: 'SKYSERVER_ADMIN',
    authMode: 'INTERNAL_SERVICE_TOKEN',
  };
  req.user = {
    userId: null,
    email: 'skyserver-internal@local',
    username: 'skyserver-internal',
    displayName: 'SkyServer Internal Service',
    status: 'ACTIVE',
    isSystemUser: true,
  };
  req.permissions = INTERNAL_SERVICE_PERMISSION_CODES.map(buildInternalServicePermission);
}

async function requireAuth(req, res, next) {
  try {
    const internalToken = getInternalServiceToken(req);
    const configuredInternalToken = getConfiguredInternalServiceToken();

    if (
      isInternalServiceAuthEnabled() &&
      configuredInternalToken &&
      internalToken === configuredInternalToken
    ) {
      applyInternalServiceIdentity(req);
      return next();
    }

    const sessionToken = authService.getBearerToken(req);

    if (!sessionToken) {
      return res.status(401).json({
        ok: false,
        error: 'Missing bearer token.',
      });
    }

    const sessionData = await authService.getSessionFromToken(sessionToken);

    if (!sessionData) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired session.',
      });
    }

    req.sessionToken = sessionToken;
    req.session = sessionData.session;
    req.user = sessionData.user;
    req.permissions = sessionData.permissions;

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireAuth,
};
