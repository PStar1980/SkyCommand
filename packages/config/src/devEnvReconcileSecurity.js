const { isSecretSensitiveKey } = require('../../capability-catalog/src/redaction');

const TOOL_CODE = 'dev_env_reconcile';
const PATCH_PARAMETER_NAME = 'patchJson';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeParameterKey(key) {
  const normalized = String(key || '').trim();
  return isSecretSensitiveKey(normalized) ? '[REDACTED_KEY]' : normalized;
}

/**
 * Execution history must never persist the raw JSON patch. The child Tool
 * performs the authoritative validation, but the API/worker records its
 * STARTED row before spawning that child. Keep only safe key-level metadata.
 */
function summarizeDevEnvReconcileParameters(parameters = {}) {
  const rawPatch = parameters?.[PATCH_PARAMETER_NAME];
  let parsed = null;

  if (typeof rawPatch === 'string') {
    try {
      parsed = JSON.parse(rawPatch);
    } catch (_error) {
      parsed = null;
    }
  } else if (isPlainObject(rawPatch)) {
    parsed = rawPatch;
  }

  const keys = isPlainObject(parsed)
    ? Object.keys(parsed)
        .map(safeParameterKey)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
    : [];

  return {
    patchKeys: keys,
    patchKeyCount: keys.length,
    valuesRedacted: true,
    payloadRedacted: true,
  };
}

function summarizeToolParameters(tool, parameters = {}) {
  return tool?.tool_code === TOOL_CODE
    ? summarizeDevEnvReconcileParameters(parameters)
    : parameters || {};
}

module.exports = {
  PATCH_PARAMETER_NAME,
  TOOL_CODE,
  isPlainObject,
  summarizeDevEnvReconcileParameters,
  summarizeToolParameters,
};
