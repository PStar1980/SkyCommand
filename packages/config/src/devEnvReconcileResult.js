const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../tools/src/toolResultContract');

const DEV_ENV_RECONCILE_OUTPUT_TYPE = 'dev_env_reconcile_summary.v1';
const OUTCOMES = new Set(['CHANGED', 'NO_CHANGES', 'BLOCKED', 'FAILED']);
const EXAMPLE_OUTCOMES = new Set(['CHANGED', 'NO_CHANGES', 'NOT_APPLICABLE', 'BLOCKED', 'FAILED']);
const CHANGE_TYPES = new Set(['ADDED', 'UPDATED', 'NO_CHANGE', 'PRESERVED', 'REJECTED']);
const CONCURRENCY_OUTCOMES = new Set(['NOT_REQUESTED', 'MATCHED', 'REPLACED', 'CONFLICT']);

const SAFE_ERROR_MESSAGES = Object.freeze({
  RECONCILIATION_KEY_NOT_ALLOWLISTED:
    'The requested configuration key is not eligible for R3 reconciliation.',
  PROTECTED_CONFIGURATION_KEY:
    'The requested configuration key belongs to a protected configuration class.',
  SECRET_KEY_NOT_ALLOWED:
    'Secret configuration keys cannot be supplied to the generic R3 reconciliation Tool.',
  REQUIRED_SECRET_UNAVAILABLE:
    'A required secret is unavailable in the registered DEV_LOCAL environment.',
  PATCH_REQUIRED: 'A structured non-secret configuration patch is required.',
  PATCH_JSON_INVALID: 'The structured configuration patch is not valid JSON.',
  PATCH_OBJECT_REQUIRED: 'The structured configuration patch must be a JSON object.',
  PATCH_EMPTY: 'The structured configuration patch must contain at least one eligible key.',
  PATCH_TOO_MANY_KEYS: 'The structured configuration patch contains too many keys.',
  PATCH_KEY_INVALID: 'The structured configuration patch contains an invalid key name.',
  PATCH_VALUE_INVALID: 'The requested configuration value does not satisfy its typed constraint.',
  DUPLICATE_ELIGIBLE_KEY:
    'The target file contains duplicate eligible keys and cannot be reconciled unambiguously.',
  EXISTING_VALUE_INVALID:
    'An existing eligible configuration value does not satisfy its typed constraint.',
  TARGET_FILE_MISSING: 'A registered configuration target file is unavailable.',
  CONCURRENT_EDIT: 'A target configuration file changed during reconciliation.',
  ATOMIC_REPLACE_FAILED:
    'The atomic configuration replacement failed; the original target remains usable.',
  POST_REPLACE_VERIFICATION_FAILED:
    'The replaced configuration file did not match its verified planned state.',
  REGISTERED_CONTEXT_INVALID: 'The registered DEV_LOCAL SkyCommand environment binding is invalid.',
  RECONCILIATION_FAILED: 'The R3 configuration reconciliation failed safely.',
});

function stringValue(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function nullableString(value) {
  const normalized = stringValue(value).trim();
  return normalized || null;
}

function nonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeOutcome(value, fallback = 'FAILED') {
  return OUTCOMES.has(value) ? value : fallback;
}

function normalizeExampleOutcome(value) {
  return EXAMPLE_OUTCOMES.has(value) ? value : 'FAILED';
}

function normalizeChange(value = {}) {
  const change = CHANGE_TYPES.has(value.change) ? value.change : 'REJECTED';
  return {
    key: stringValue(value.key).trim(),
    classification: stringValue(value.classification || 'UNKNOWN').trim(),
    change,
  };
}

function normalizeBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    environmentCode: stringValue(value.environmentCode).trim(),
    repositoryCode: stringValue(value.repositoryCode).trim(),
    repositoryId: stringValue(value.repositoryId).trim(),
    toolCode: stringValue(value.toolCode).trim(),
    toolId: stringValue(value.toolId).trim(),
    permissionCode: stringValue(value.permissionCode).trim(),
  };
}

function normalizeError(error) {
  if (!error) return null;
  const code = stringValue(error.code || 'RECONCILIATION_FAILED').trim();
  const details = error.details && typeof error.details === 'object' ? error.details : {};
  const safeMessage = SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES.RECONCILIATION_FAILED;
  const normalized = {
    code,
    message: safeMessage,
  };

  if (details.key) normalized.key = stringValue(details.key).trim();
  if (details.classification) {
    normalized.classification = stringValue(details.classification).trim();
  }
  return normalized;
}

function normalizeRevision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const digest = stringValue(value.digest).trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(digest)) return null;
  return {
    algorithm: 'SHA-256_NON_SECRET_EFFECTIVE_CONFIGURATION',
    digest,
  };
}

function normalizeConcurrency(value = {}) {
  return {
    checked: value.checked === true,
    outcome: CONCURRENCY_OUTCOMES.has(value.outcome) ? value.outcome : 'NOT_REQUESTED',
    files: Array.isArray(value.files)
      ? value.files.map((file) => ({
          target: stringValue(file?.target || 'unknown').trim(),
          outcome: CONCURRENCY_OUTCOMES.has(file?.outcome) ? file.outcome : 'NOT_REQUESTED',
        }))
      : [],
  };
}

function normalizeRestart(value = {}) {
  return {
    required: value.required === true,
    services: Array.isArray(value.services)
      ? value.services.map((service) => stringValue(service).trim()).filter(Boolean)
      : [],
    reasonCode: nullableString(value.reasonCode),
  };
}

function normalizeTiming(value = {}) {
  const startedAt = stringValue(value.startedAt || new Date().toISOString());
  const completedAt = stringValue(value.completedAt || startedAt);
  return {
    startedAt,
    completedAt,
    durationMs: nonNegativeNumber(value.durationMs),
  };
}

function normalizeOutput(value = {}) {
  const outcome = normalizeOutcome(value.outcome);
  const requestedKeys = Array.isArray(value.requestedKeys)
    ? value.requestedKeys.map((key) => stringValue(key).trim()).filter(Boolean)
    : [];
  const changedKeys = Array.isArray(value.changedKeys)
    ? value.changedKeys.map((key) => stringValue(key).trim()).filter(Boolean)
    : [];

  return {
    contract: 'dev_env_reconcile_summary.v1',
    outcome,
    binding: normalizeBinding(value.binding),
    requestedKeys,
    changedKeys,
    classifications: Array.isArray(value.classifications)
      ? value.classifications.map(normalizeChange)
      : [],
    missingRequiredSecrets: Array.isArray(value.missingRequiredSecrets)
      ? value.missingRequiredSecrets.map((item) => ({
          key: stringValue(item?.key).trim(),
          classification: stringValue(item?.classification || 'SECRET').trim(),
        }))
      : [],
    envExample: {
      outcome: normalizeExampleOutcome(value.envExample?.outcome),
      changedKeys: Array.isArray(value.envExample?.changedKeys)
        ? value.envExample.changedKeys.map((key) => stringValue(key).trim()).filter(Boolean)
        : [],
      classifications: Array.isArray(value.envExample?.classifications)
        ? value.envExample.classifications.map(normalizeChange)
        : [],
    },
    configurationRevision: normalizeRevision(value.configurationRevision),
    concurrency: normalizeConcurrency(value.concurrency),
    restart: normalizeRestart(value.restart),
    execution: {
      correlationId: nullableString(value.execution?.correlationId),
    },
    timing: normalizeTiming(value.timing),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.map((warning) => stringValue(warning))
      : [],
    error: normalizeError(value.error),
  };
}

function createDevEnvReconcileToolResult(result = {}) {
  const output = normalizeOutput(result);
  const success = ['CHANGED', 'NO_CHANGES'].includes(output.outcome);

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message:
      output.outcome === 'CHANGED'
        ? `Reconciled ${output.changedKeys.length} eligible configuration key(s).`
        : output.outcome === 'NO_CHANGES'
          ? 'DEV_LOCAL configuration is already at the requested state; no changes were applied.'
          : output.error?.message ||
            'DEV_LOCAL configuration reconciliation was blocked or failed.',
    outputType: DEV_ENV_RECONCILE_OUTPUT_TYPE,
    output,
    warnings: output.warnings,
    error: success
      ? null
      : {
          code: output.error?.code || 'RECONCILIATION_FAILED',
          message: output.error?.message || 'DEV_LOCAL configuration reconciliation failed.',
        },
    metadata: {
      valuesRedacted: true,
      revisionAlgorithm: 'SHA-256_NON_SECRET_EFFECTIVE_CONFIGURATION',
      targetEnvironment: 'DEV_LOCAL',
    },
  });
}

function createDevEnvReconcileFailureToolResult(error) {
  return createDevEnvReconcileToolResult({
    outcome: 'FAILED',
    error,
    timing: {
      completedAt: new Date().toISOString(),
    },
  });
}

module.exports = {
  DEV_ENV_RECONCILE_OUTPUT_TYPE,
  SAFE_ERROR_MESSAGES,
  createDevEnvReconcileFailureToolResult,
  createDevEnvReconcileToolResult,
  normalizeError,
  normalizeOutput,
};
