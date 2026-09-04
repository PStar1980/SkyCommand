const {
  DEFAULT_GRANT_TTL_SECONDS,
  issueLifecycleGrant,
  normalizeAction,
  normalizeTtlSeconds,
} = require('../../../../packages/supervisor/src/lifecycleGrant');

const RUNTIME_CONTROL_PERMISSION = 'INFRASTRUCTURE_DOCKER_CONTROL';
const RUNTIME_CONTROL_EVENT_TYPE = 'SKYCOMMAND_RUNTIME_CONTROL_AUTHORIZED';
const RUNTIME_RESOURCE_TYPE = 'skycommand_runtime';
const RUNTIME_RESOURCE_ID = 'skycommand';

async function defaultAuditRecorder(event) {
  const authService = require('./authService');
  return authService.recordAuditEvent(event);
}

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function createServiceError(statusCode, code, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = { code, ...details };
  return error;
}

function getGrantSecret() {
  return normalizeText(
    process.env.SKYCOMMAND_SUPERVISOR_GRANT_SECRET,
    process.env.SKYCOMMAND_SUPERVISOR_CONTROL_TOKEN,
  );
}

function getGrantTtlSeconds() {
  return normalizeTtlSeconds(
    process.env.SKYCOMMAND_SUPERVISOR_GRANT_TTL_SECONDS,
    DEFAULT_GRANT_TTL_SECONDS,
  );
}

async function authorizeRuntimeControl({
  action,
  confirmed = false,
  actor = {},
  session = {},
  requestContext = {},
  auditRecorder = defaultAuditRecorder,
  nowMs = Date.now(),
} = {}) {
  let normalizedAction;
  try {
    normalizedAction = normalizeAction(action);
  } catch (error) {
    throw createServiceError(
      400,
      error?.code || 'SKYCOMMAND_RUNTIME_CONTROL_ACTION_NOT_ALLOWED',
      error?.message || 'SkyCommand runtime lifecycle action is not allowed.',
    );
  }

  if (!confirmed) {
    throw createServiceError(
      400,
      'SKYCOMMAND_RUNTIME_CONTROL_CONFIRMATION_REQUIRED',
      'SkyCommand runtime stop/restart requires explicit confirmation.',
    );
  }

  const secret = getGrantSecret();
  if (!secret) {
    throw createServiceError(
      503,
      'SKYCOMMAND_SUPERVISOR_GRANT_NOT_CONFIGURED',
      'Authenticated SkyCommand runtime controls are not configured. Set SKYCOMMAND_SUPERVISOR_GRANT_SECRET and restart the Supervisor and API.',
    );
  }

  const issued = issueLifecycleGrant({
    secret,
    action: normalizedAction,
    subject: actor?.userId || actor?.username || actor?.email || 'unknown',
    sessionId: session?.sessionId || null,
    ttlSeconds: getGrantTtlSeconds(),
    nowMs,
  });

  const message = `${normalizedAction} authorized for the SkyCommand backend runtime through the host-native Supervisor.`;

  // High-risk self-lifecycle control fails closed if the authorization audit cannot be persisted.
  await auditRecorder({
    appCode: session?.appCode,
    userId: actor?.userId || null,
    eventType: RUNTIME_CONTROL_EVENT_TYPE,
    resourceType: RUNTIME_RESOURCE_TYPE,
    resourceId: RUNTIME_RESOURCE_ID,
    action: normalizedAction.toLowerCase(),
    success: true,
    message,
    metadata: {
      transport: 'SUPERVISOR_SIGNED_GRANT',
      permissionCode: RUNTIME_CONTROL_PERMISSION,
      grantId: issued.payload.nonce,
      expiresAt: issued.expiresAt,
      requestedAction: normalizedAction,
    },
    ipAddress: requestContext?.ipAddress || null,
    userAgent: requestContext?.userAgent || null,
  });

  return {
    authorization: {
      action: normalizedAction,
      grant: issued.token,
      grantId: issued.payload.nonce,
      expiresAt: issued.expiresAt,
    },
    message,
  };
}

module.exports = {
  RUNTIME_CONTROL_EVENT_TYPE,
  RUNTIME_CONTROL_PERMISSION,
  RUNTIME_RESOURCE_ID,
  RUNTIME_RESOURCE_TYPE,
  authorizeRuntimeControl,
  getGrantSecret,
  getGrantTtlSeconds,
};
