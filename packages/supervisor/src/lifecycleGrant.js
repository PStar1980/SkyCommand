const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');

const GRANT_AUDIENCE = 'skycommand-supervisor';
const GRANT_ISSUER = 'skycommand-api';
const GRANT_VERSION = 1;
const DEFAULT_GRANT_TTL_SECONDS = 45;
const MAX_GRANT_TTL_SECONDS = 120;
const ALLOWED_GRANT_ACTIONS = new Set(['STOP', 'RESTART', 'REBUILD_WEB']);

class SupervisorGrantError extends Error {
  constructor(message, code = 'SKYCOMMAND_SUPERVISOR_GRANT_INVALID') {
    super(message);
    this.name = 'SupervisorGrantError';
    this.code = code;
  }
}

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeAction(value) {
  const action = normalizeText(value).toUpperCase();
  if (!ALLOWED_GRANT_ACTIONS.has(action)) {
    throw new SupervisorGrantError(
      `SkyCommand Supervisor lifecycle grant action '${action || 'blank'}' is not allowed.`,
      'SKYCOMMAND_SUPERVISOR_GRANT_ACTION_NOT_ALLOWED',
    );
  }
  return action;
}

function normalizeTtlSeconds(value, fallback = DEFAULT_GRANT_TTL_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_GRANT_TTL_SECONDS);
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant payload is malformed.',
      'SKYCOMMAND_SUPERVISOR_GRANT_MALFORMED',
    );
  }
}

function assertSecret(secret) {
  const normalized = normalizeText(secret);
  if (!normalized) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant signing secret is not configured.',
      'SKYCOMMAND_SUPERVISOR_GRANT_NOT_CONFIGURED',
    );
  }
  return normalized;
}

function signBody(body, secret) {
  return createHmac('sha256', assertSecret(secret)).update(body).digest('base64url');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function issueLifecycleGrant({
  secret,
  action,
  subject,
  sessionId,
  ttlSeconds = DEFAULT_GRANT_TTL_SECONDS,
  nowMs = Date.now(),
  nonce = randomUUID(),
} = {}) {
  const normalizedAction = normalizeAction(action);
  const issuedAt = Math.floor(Number(nowMs) / 1000);
  const ttl = normalizeTtlSeconds(ttlSeconds);
  const payload = {
    v: GRANT_VERSION,
    iss: GRANT_ISSUER,
    aud: GRANT_AUDIENCE,
    action: normalizedAction,
    sub: normalizeText(subject) || 'unknown',
    sid: normalizeText(sessionId) || null,
    nonce: normalizeText(nonce) || randomUUID(),
    iat: issuedAt,
    exp: issuedAt + ttl,
  };
  const body = encodeJson(payload);
  const signature = signBody(body, secret);

  return {
    token: `${body}.${signature}`,
    payload,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

function verifyLifecycleGrant(token, {
  secret,
  action,
  nowMs = Date.now(),
  clockSkewSeconds = 5,
} = {}) {
  const normalizedToken = normalizeText(token);
  const [body, signature, extra] = normalizedToken.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant format is invalid.',
      'SKYCOMMAND_SUPERVISOR_GRANT_MALFORMED',
    );
  }

  const expectedSignature = signBody(body, secret);
  if (!secureEqual(signature, expectedSignature)) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant signature is invalid.',
      'SKYCOMMAND_SUPERVISOR_GRANT_SIGNATURE_INVALID',
    );
  }

  const payload = decodeJson(body);
  const expectedAction = normalizeAction(action);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const skew = Math.max(Number(clockSkewSeconds) || 0, 0);

  if (
    payload?.v !== GRANT_VERSION ||
    payload?.iss !== GRANT_ISSUER ||
    payload?.aud !== GRANT_AUDIENCE ||
    payload?.action !== expectedAction ||
    !normalizeText(payload?.nonce)
  ) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant claims are invalid.',
      'SKYCOMMAND_SUPERVISOR_GRANT_CLAIMS_INVALID',
    );
  }

  if (!Number.isFinite(Number(payload.iat)) || !Number.isFinite(Number(payload.exp))) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant timestamps are invalid.',
      'SKYCOMMAND_SUPERVISOR_GRANT_CLAIMS_INVALID',
    );
  }

  if (Number(payload.iat) > nowSeconds + skew) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant is not active yet.',
      'SKYCOMMAND_SUPERVISOR_GRANT_NOT_ACTIVE',
    );
  }

  if (Number(payload.exp) < nowSeconds - skew) {
    throw new SupervisorGrantError(
      'SkyCommand Supervisor lifecycle grant has expired.',
      'SKYCOMMAND_SUPERVISOR_GRANT_EXPIRED',
    );
  }

  return payload;
}

module.exports = {
  ALLOWED_GRANT_ACTIONS,
  DEFAULT_GRANT_TTL_SECONDS,
  GRANT_AUDIENCE,
  GRANT_ISSUER,
  GRANT_VERSION,
  MAX_GRANT_TTL_SECONDS,
  SupervisorGrantError,
  issueLifecycleGrant,
  normalizeAction,
  normalizeTtlSeconds,
  verifyLifecycleGrant,
};
