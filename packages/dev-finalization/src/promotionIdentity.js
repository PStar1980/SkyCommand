const crypto = require('node:crypto');

const DIGEST_PATTERN = /^[A-Fa-f0-9]{64}$/;
const IDENTITY_TEXT_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function normalizeIdentityText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !IDENTITY_TEXT_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a nonblank bounded identity value.`);
  }
  return normalized;
}

function isDigest(value) {
  return DIGEST_PATTERN.test(String(value ?? '').trim());
}

function normalizeDigest(value) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  return isDigest(normalized) ? normalized : null;
}

function buildPromotionRequestIdentity({
  principalScope,
  idempotencyKey,
  workflowCode,
  repositoryCode,
  environmentCode,
  configProfileCode,
  workflowDefinitionId = null,
  workflowVersionId = null,
  versionNumber = null,
  parameters = {},
} = {}) {
  const normalizedPrincipalScope = normalizeIdentityText(principalScope, 'principalScope');
  const normalizedIdempotencyKey = normalizeIdentityText(idempotencyKey, 'idempotencyKey');
  const request = {
    principalScope: normalizedPrincipalScope,
    workflowCode: String(workflowCode ?? '').trim(),
    workflowDefinitionId: workflowDefinitionId || null,
    workflowVersionId: workflowVersionId || null,
    versionNumber: Number.isFinite(Number(versionNumber)) ? Number(versionNumber) : null,
    repositoryCode: String(repositoryCode ?? '').trim(),
    environmentCode: String(environmentCode ?? '')
      .trim()
      .toUpperCase(),
    configProfileCode: String(configProfileCode ?? '')
      .trim()
      .toUpperCase(),
    parameters: safeObject(parameters),
  };

  return {
    principalScope: normalizedPrincipalScope,
    idempotencyKey: normalizedIdempotencyKey,
    idempotencyKeyHash: sha256(`${normalizedPrincipalScope}:${normalizedIdempotencyKey}`),
    requestDigest: sha256(canonicalJson(request)),
  };
}

function readStoredPromotionIdentity({ admission = {}, promotionRequest = {} } = {}) {
  const request = safeObject(promotionRequest);
  const idempotencyKeyHash = normalizeDigest(
    admission.idempotency_key_hash || request.idempotencyKeyHash,
  );
  const requestDigest = normalizeDigest(admission.request_digest || request.requestDigest);

  if (!idempotencyKeyHash || !requestDigest) return null;

  return {
    idempotencyKeyHash,
    requestDigest,
    principalScope: String(request.principalScope || '').trim() || null,
    requestId: String(request.requestId || '').trim() || null,
  };
}

module.exports = {
  buildPromotionRequestIdentity,
  canonicalJson,
  isDigest,
  normalizeDigest,
  readStoredPromotionIdentity,
  sha256,
};
