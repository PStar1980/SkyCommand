const crypto = require('node:crypto');

const DEFAULT_ASSISTANT_PERMISSION_CODES = [
  'BROWSER_AUTOMATION_READ',
  'BROWSER_AUTOMATION_RUN',
];

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function getAssistantIntegrationConfig() {
  const permissionCodes = String(process.env.SKYCOMMAND_ASSISTANT_PERMISSION_CODES || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  return {
    enabled: parseBoolean(process.env.SKYCOMMAND_ASSISTANT_INTEGRATION_ENABLED, false),
    token: String(process.env.SKYCOMMAND_ASSISTANT_API_TOKEN || '').trim(),
    permissionCodes: permissionCodes.length ? [...new Set(permissionCodes)] : DEFAULT_ASSISTANT_PERMISSION_CODES,
  };
}

function extractAssistantToken(req) {
  const explicit = String(req.headers['x-skycommand-assistant-token'] || '').trim();
  if (explicit) return explicit;

  const authorization = String(req.headers.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function safeTokenEquals(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function buildPermission(permissionCode) {
  return {
    permissionId: null,
    permissionCode,
    resource: 'assistant_integration',
    action: 'allow',
    description: 'Granted through the bounded SkyCommand Assistant integration token.',
    grantedThroughRoles: ['ASSISTANT_INTEGRATION'],
    appId: null,
    appCode: 'SKYSERVER_ADMIN',
    appTitle: 'SkyCommand',
  };
}

function applyAssistantIdentity(req, config) {
  req.sessionToken = null;
  req.session = {
    sessionId: null,
    appCode: 'SKYSERVER_ADMIN',
    authMode: 'ASSISTANT_SERVICE_TOKEN',
  };
  req.user = {
    userId: null,
    email: 'skycommand-assistant@local',
    username: 'skycommand-assistant',
    displayName: 'SkyCommand Assistant Integration',
    status: 'ACTIVE',
    isSystemUser: true,
  };
  req.permissions = config.permissionCodes.map(buildPermission);
  req.assistantIntegration = {
    enabled: true,
    permissionCodes: [...config.permissionCodes],
  };
}

function requireAssistantIntegration(req, res, next) {
  const config = getAssistantIntegrationConfig();

  if (!config.enabled) {
    return res.status(503).json({
      ok: false,
      error: 'SkyCommand Assistant integration is disabled.',
      code: 'ASSISTANT_INTEGRATION_DISABLED',
    });
  }

  if (!config.token) {
    return res.status(503).json({
      ok: false,
      error: 'SkyCommand Assistant integration token is not configured.',
      code: 'ASSISTANT_INTEGRATION_TOKEN_NOT_CONFIGURED',
    });
  }

  const suppliedToken = extractAssistantToken(req);
  if (!suppliedToken || !safeTokenEquals(suppliedToken, config.token)) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid Assistant integration token.',
      code: 'ASSISTANT_INTEGRATION_UNAUTHORIZED',
    });
  }

  applyAssistantIdentity(req, config);
  return next();
}

module.exports = {
  DEFAULT_ASSISTANT_PERMISSION_CODES,
  extractAssistantToken,
  getAssistantIntegrationConfig,
  requireAssistantIntegration,
  safeTokenEquals,
};
