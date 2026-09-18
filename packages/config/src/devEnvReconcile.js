#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const { isSecretSensitiveKey } = require('../../capability-catalog/src/redaction');
const { translateWorkspacePath } = require('../../core/src/runtimePathResolver');
const { runToolCli } = require('../../tools/src/toolCliAdapter');
const {
  createDevEnvReconcileFailureToolResult,
  createDevEnvReconcileToolResult,
  DEV_ENV_RECONCILE_OUTPUT_TYPE,
} = require('./devEnvReconcileResult');
const { PATCH_PARAMETER_NAME, TOOL_CODE } = require('./devEnvReconcileSecurity');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const ENVIRONMENT_CODE = 'DEV_LOCAL';
const REPOSITORY_CODE = 'SkyCommand';
const PERMISSION_CODE = 'DEV_ENV_RECONCILE';
const SCRIPT_PATH = 'packages/config/src/devEnvReconcile.js';
const REQUIRED_CHANNELS = ['admin-web', 'api', 'cli', 'worker'];
const MAX_PATCH_KEYS = 8;
const REQUIRED_SECRET_KEYS = Object.freeze(['PGPASSWORD', 'JWT_SECRET']);
const ENV_FILE_NAME = '.env';
const ENV_EXAMPLE_FILE_NAME = '.env.example';

const CONFIGURATION_ALLOWLIST = Object.freeze({
  API_TELEMETRY_RETENTION_DAYS: Object.freeze({
    type: 'integer',
    minimum: 1,
    maximum: 3650,
    classification: 'NON_SECRET_APPLICATION',
    allowAdd: true,
    allowUpdate: true,
    examplePolicy: 'SAFE_DEFAULT',
    exampleDefault: 30,
    restartRequired: true,
    restartServices: Object.freeze(['api']),
    restartReasonCode: 'PROCESS_START_CONFIGURATION',
  }),
  SKYCOMMAND_TOOL_RESULT_MAX_BYTES: Object.freeze({
    type: 'integer',
    minimum: 4096,
    maximum: 5000000,
    classification: 'NON_SECRET_APPLICATION',
    allowAdd: true,
    allowUpdate: true,
    examplePolicy: 'SYNC_VALUE',
    restartRequired: true,
    restartServices: Object.freeze(['api', 'worker', 'cli']),
    restartReasonCode: 'PROCESS_START_CONFIGURATION',
  }),
});

const PROTECTED_KEY_RULES = Object.freeze([
  { pattern: /^PG(?:HOST|PORT|USER|DATABASE)$/i, classification: 'DATABASE_IDENTITY' },
  {
    pattern:
      /^(?:PG|DB|DATABASE)_(?:HOST|PORT|USER|NAME|DATABASE|SYSTEM_IDENTIFIER|TARGET|CLUSTER|IDENTITY)/i,
    classification: 'DATABASE_IDENTITY',
  },
  {
    pattern: /(?:AUTH|AUTHORIZATION|PERMISSION|ROLE|RBAC|JWT)/i,
    classification: 'AUTHENTICATION_AUTHORIZATION',
  },
  { pattern: /(?:ROOT|PATH|DIR|DIRECTORY|REPOSITORY|REPO)/i, classification: 'REPOSITORY_ROOT' },
  {
    pattern: /(?:ENABLE|ENABLED|EXECUTION|PRIVILEGE|PRODUCTION|PROFILE|ENVIRONMENT|TARGET)/i,
    classification: 'SECURITY_OR_EXECUTION_BOUNDARY',
  },
]);

class ReconcileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReconcileError';
    this.code = code;
    this.details = details;
  }
}

function reconcileError(code, details = {}) {
  return new ReconcileError(code, code, details);
}

function getProfileCode(environment = process.env) {
  return String(
    environment.SKYCOMMAND_CONFIG_PROFILE ||
      environment.SKYSERVER_CONFIG_PROFILE ||
      environment.SKYCOMMAND_CORE_PROFILE ||
      environment.SKYSERVER_CORE_PROFILE ||
      environment.CONFIG_PROFILE ||
      ENVIRONMENT_CODE,
  )
    .trim()
    .toUpperCase();
}

function normalizeRoot(value) {
  return path
    .normalize(path.resolve(String(value || '')))
    .replace(/[\\/]$/, '')
    .toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidKeyName(key) {
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(String(key || ''));
}

function protectedClassification(key) {
  const normalized = String(key || '').trim();
  if (!normalized) return null;

  if (
    isSecretSensitiveKey(normalized) ||
    /^(?:PGPASSWORD|MONGO_URI|DATABASE_URL|REDIS_URL)$/i.test(normalized)
  ) {
    return 'SECRET';
  }

  return PROTECTED_KEY_RULES.find((rule) => rule.pattern.test(normalized))?.classification || null;
}

function normalizeIntegerValue(value, definition, key, source = 'requested') {
  let numeric = value;
  if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim())) {
    numeric = Number(value.trim());
  }

  if (
    typeof numeric !== 'number' ||
    !Number.isSafeInteger(numeric) ||
    numeric < definition.minimum ||
    numeric > definition.maximum
  ) {
    throw reconcileError(source === 'existing' ? 'EXISTING_VALUE_INVALID' : 'PATCH_VALUE_INVALID', {
      key,
      classification: definition.classification,
    });
  }

  return numeric;
}

function normalizeDefinitionValue(key, value, source = 'requested') {
  const definition = CONFIGURATION_ALLOWLIST[key];
  if (!definition) {
    throw reconcileError('RECONCILIATION_KEY_NOT_ALLOWLISTED', { key });
  }

  if (definition.type === 'integer') {
    return normalizeIntegerValue(value, definition, key, source);
  }

  throw reconcileError('PATCH_VALUE_INVALID', {
    key,
    classification: definition.classification,
  });
}

function normalizePatch(patch) {
  if (!isPlainObject(patch)) {
    throw reconcileError('PATCH_OBJECT_REQUIRED');
  }

  const keys = Object.keys(patch).sort((left, right) => left.localeCompare(right));
  if (keys.length === 0) throw reconcileError('PATCH_EMPTY');
  if (keys.length > MAX_PATCH_KEYS) throw reconcileError('PATCH_TOO_MANY_KEYS');

  const normalized = {};
  for (const key of keys) {
    if (!isValidKeyName(key)) throw reconcileError('PATCH_KEY_INVALID', { key });

    const protectedClass = protectedClassification(key);
    if (protectedClass === 'SECRET') {
      throw reconcileError('SECRET_KEY_NOT_ALLOWED', { key, classification: protectedClass });
    }
    if (protectedClass) {
      throw reconcileError('PROTECTED_CONFIGURATION_KEY', {
        key,
        classification: protectedClass,
      });
    }

    if (!CONFIGURATION_ALLOWLIST[key]) {
      throw reconcileError('RECONCILIATION_KEY_NOT_ALLOWLISTED', { key });
    }

    normalized[key] = normalizeDefinitionValue(key, patch[key]);
  }

  return normalized;
}

function splitLines(content) {
  const text = String(content || '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = text.endsWith('\n');
  const lines = text.split(/\r?\n/);
  if (finalNewline && lines.at(-1) === '') lines.pop();
  if (lines.length === 1 && lines[0] === '' && text === '') return [];
  return { lines, newline, finalNewline };
}

function parseAssignment(line, lineIndex) {
  const match = String(line || '').match(
    /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/,
  );
  if (!match) return null;

  const rawValue = match[4];
  return {
    key: match[2],
    lineIndex,
    prefix: match[1],
    separator: match[3],
    rawValue,
  };
}

function parseEnvFile(content) {
  const split = splitLines(content);
  const assignments = split.lines.map(parseAssignment).filter(Boolean);
  const byKey = new Map();
  for (const assignment of assignments) {
    const entries = byKey.get(assignment.key) || [];
    entries.push(assignment);
    byKey.set(assignment.key, entries);
  }

  return {
    ...split,
    assignments,
    byKey,
  };
}

function rawValueCore(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  if (raw.startsWith('"') || raw.startsWith("'")) {
    const quote = raw[0];
    const closing = raw.indexOf(quote, 1);
    if (closing > 0) return raw.slice(0, closing + 1);
  }

  const comment = raw.search(/\s+#/);
  return comment >= 0 ? raw.slice(0, comment).trim() : raw;
}

function unquoteValue(value) {
  const raw = String(value || '').trim();
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function existingTypedValue(assignment, key) {
  if (!assignment) return null;
  const core = unquoteValue(rawValueCore(assignment.rawValue));
  if (!core) {
    throw reconcileError('EXISTING_VALUE_INVALID', {
      key,
      classification: CONFIGURATION_ALLOWLIST[key].classification,
    });
  }
  return normalizeDefinitionValue(key, core, 'existing');
}

function trailingSuffix(rawValue) {
  const raw = String(rawValue || '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const closing = trimmed.indexOf(trimmed[0], 1);
    if (closing >= 0) {
      const suffix = trimmed.slice(closing + 1);
      return /^\s+#/.test(suffix) ? suffix : '';
    }
  }

  const comment = raw.match(/(\s+#.*)$/);
  return comment ? comment[1] : '';
}

function formatScalar(value, assignment = null) {
  const text = String(value);
  const raw = assignment?.rawValue?.trim() || '';
  const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : '';
  return quote ? `${quote}${text}${quote}` : text;
}

function formatAssignment(assignment, value) {
  return `${assignment.prefix}${assignment.key}${assignment.separator}${formatScalar(value, assignment)}${trailingSuffix(assignment.rawValue)}`;
}

function renderFile(parsed, lineUpdates, appendedAssignments) {
  const lines = [...parsed.lines];
  for (const [lineIndex, line] of lineUpdates.entries()) lines[lineIndex] = line;
  for (const assignment of appendedAssignments) {
    lines.push(`${assignment.key}=${assignment.value}`);
  }

  const rendered = lines.join(parsed.newline);
  return parsed.finalNewline && lines.length > 0 ? `${rendered}${parsed.newline}` : rendered;
}

function ensureSingleEligibleAssignment(parsed, key) {
  const entries = parsed.byKey.get(key) || [];
  if (entries.length > 1) throw reconcileError('DUPLICATE_ELIGIBLE_KEY', { key });
  return entries[0] || null;
}

function planFile({ content, patch, target }) {
  const parsed = parseEnvFile(content);
  const lineUpdates = new Map();
  const appendedAssignments = [];
  const classifications = [];
  const changedKeys = [];

  for (const key of Object.keys(patch).sort((left, right) => left.localeCompare(right))) {
    const definition = CONFIGURATION_ALLOWLIST[key];
    if (target === 'env.example' && !definition.examplePolicy) continue;

    const assignment = ensureSingleEligibleAssignment(parsed, key);
    const desiredValue =
      target === 'env.example' && definition.examplePolicy === 'SAFE_DEFAULT'
        ? definition.exampleDefault
        : patch[key];
    let change = 'NO_CHANGE';

    if (assignment) {
      let currentValue = null;
      try {
        currentValue = existingTypedValue(assignment, key);
      } catch (error) {
        if (target !== 'env.example') throw error;
      }
      if (currentValue !== desiredValue) {
        change = 'UPDATED';
        lineUpdates.set(assignment.lineIndex, formatAssignment(assignment, desiredValue));
      }
    } else {
      if (target === 'env' && !definition.allowAdd) {
        throw reconcileError('RECONCILIATION_KEY_NOT_ALLOWLISTED', { key });
      }
      change = 'ADDED';
      appendedAssignments.push({ key, value: formatScalar(desiredValue) });
    }

    classifications.push({ key, classification: definition.classification, change });
    if (change !== 'NO_CHANGE') changedKeys.push(key);
  }

  return {
    content: renderFile(parsed, lineUpdates, appendedAssignments),
    classifications,
    changedKeys,
    changed: changedKeys.length > 0,
  };
}

function readSnapshot(filePath, fileSystem = fs) {
  if (!fileSystem.existsSync(filePath)) throw reconcileError('TARGET_FILE_MISSING');
  const bytes = Buffer.from(fileSystem.readFileSync(filePath));
  return {
    bytes,
    content: bytes.toString('utf8'),
  };
}

function sameBytes(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function assertUnchanged(filePath, originalBytes, fileSystem = fs) {
  const current = readSnapshot(filePath, fileSystem);
  if (!sameBytes(current.bytes, originalBytes)) throw reconcileError('CONCURRENT_EDIT');
}

function temporaryPath(filePath) {
  const suffix = crypto.randomBytes(8).toString('hex');
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.skycommand-${process.pid}-${suffix}.tmp`,
  );
}

function replaceFileAtomically({
  filePath,
  target,
  originalBytes,
  nextContent,
  fileSystem = fs,
  onBeforeFinalRevalidation = null,
}) {
  if (typeof onBeforeFinalRevalidation === 'function') {
    onBeforeFinalRevalidation({ target, filePath });
  }

  assertUnchanged(filePath, originalBytes, fileSystem);
  const tempFilePath = temporaryPath(filePath);

  try {
    fileSystem.writeFileSync(tempFilePath, nextContent, { encoding: 'utf8', mode: 0o600 });
    assertUnchanged(filePath, originalBytes, fileSystem);
    fileSystem.renameSync(tempFilePath, filePath);

    const written = readSnapshot(filePath, fileSystem);
    if (!sameBytes(written.bytes, Buffer.from(nextContent, 'utf8'))) {
      throw reconcileError('POST_REPLACE_VERIFICATION_FAILED');
    }
  } catch (error) {
    try {
      if (fileSystem.existsSync(tempFilePath)) fileSystem.rmSync(tempFilePath, { force: true });
    } catch (_cleanupError) {
      // The original target remains the authoritative recovery surface.
    }
    if (error instanceof ReconcileError) throw error;
    throw reconcileError('ATOMIC_REPLACE_FAILED');
  }
}

function requiredSecretState(parsed) {
  return REQUIRED_SECRET_KEYS.map((key) => {
    const assignments = parsed.byKey.get(key) || [];
    const available = assignments.some((assignment) => rawValueCore(assignment.rawValue) !== '');
    return available ? null : { key, classification: 'SECRET' };
  }).filter(Boolean);
}

function computeConfigurationRevision(content) {
  const parsed = parseEnvFile(content);
  const effective = {};

  for (const key of Object.keys(CONFIGURATION_ALLOWLIST).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const assignment = ensureSingleEligibleAssignment(parsed, key);
    effective[key] = assignment ? existingTypedValue(assignment, key) : null;
  }

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(effective), 'utf8')
    .digest('hex')
    .toUpperCase();
  return {
    algorithm: 'SHA-256_NON_SECRET_EFFECTIVE_CONFIGURATION',
    digest,
  };
}

function baseResult(startedAt, binding, requestedKeys, executionId) {
  return {
    binding: binding || null,
    requestedKeys,
    changedKeys: [],
    classifications: [],
    missingRequiredSecrets: [],
    envExample: {
      outcome: 'NOT_APPLICABLE',
      changedKeys: [],
      classifications: [],
    },
    configurationRevision: null,
    concurrency: {
      checked: false,
      outcome: 'NOT_REQUESTED',
      files: [],
    },
    restart: {
      required: false,
      services: [],
      reasonCode: null,
    },
    execution: {
      correlationId: executionId || null,
    },
    timing: {
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
    },
    warnings: [],
    error: null,
  };
}

function completeResult(result, startedAt) {
  const completedAt = new Date().toISOString();
  return {
    ...result,
    timing: {
      startedAt,
      completedAt,
      durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    },
  };
}

const BLOCKING_ERROR_CODES = new Set([
  'RECONCILIATION_KEY_NOT_ALLOWLISTED',
  'PROTECTED_CONFIGURATION_KEY',
  'SECRET_KEY_NOT_ALLOWED',
  'REQUIRED_SECRET_UNAVAILABLE',
  'PATCH_REQUIRED',
  'PATCH_JSON_INVALID',
  'PATCH_OBJECT_REQUIRED',
  'PATCH_EMPTY',
  'PATCH_TOO_MANY_KEYS',
  'PATCH_KEY_INVALID',
  'PATCH_VALUE_INVALID',
  'EXISTING_VALUE_INVALID',
  'DUPLICATE_ELIGIBLE_KEY',
  'TARGET_FILE_MISSING',
  'CONCURRENT_EDIT',
  'REGISTERED_CONTEXT_INVALID',
]);

function restartMetadata(changedKeys) {
  const definitions = changedKeys.map((key) => CONFIGURATION_ALLOWLIST[key]).filter(Boolean);
  const services = [
    ...new Set(definitions.flatMap((definition) => definition.restartServices || [])),
  ].sort();
  const reasons = [
    ...new Set(definitions.map((definition) => definition.restartReasonCode).filter(Boolean)),
  ].sort();
  return {
    required: definitions.some((definition) => definition.restartRequired === true),
    services,
    reasonCode: reasons[0] || null,
  };
}

function reconcileEnvironment({
  repositoryRoot = REPOSITORY_ROOT,
  patch,
  binding = null,
  fileSystem = fs,
  executionId = null,
  onBeforeFinalRevalidation = null,
} = {}) {
  const startedAt = new Date().toISOString();
  let requestedKeys = isPlainObject(patch)
    ? Object.keys(patch).sort((left, right) => left.localeCompare(right))
    : [];
  let result = baseResult(startedAt, binding, requestedKeys, executionId);

  try {
    const normalizedPatch = normalizePatch(patch);
    requestedKeys = Object.keys(normalizedPatch);
    result = baseResult(startedAt, binding, requestedKeys, executionId);

    const root = path.resolve(repositoryRoot);
    const envPath = path.join(root, ENV_FILE_NAME);
    const examplePath = path.join(root, ENV_EXAMPLE_FILE_NAME);
    const envSnapshot = readSnapshot(envPath, fileSystem);
    const exampleSnapshot = readSnapshot(examplePath, fileSystem);
    const envParsed = parseEnvFile(envSnapshot.content);
    const missingRequiredSecrets = requiredSecretState(envParsed);

    if (missingRequiredSecrets.length > 0) {
      return completeResult(
        {
          ...result,
          outcome: 'BLOCKED',
          missingRequiredSecrets,
          error: {
            code: 'REQUIRED_SECRET_UNAVAILABLE',
            details: {
              key: missingRequiredSecrets[0].key,
              classification: 'SECRET',
            },
          },
        },
        startedAt,
      );
    }

    const envPlan = planFile({
      content: envSnapshot.content,
      patch: normalizedPatch,
      target: 'env',
    });
    const examplePlan = planFile({
      content: exampleSnapshot.content,
      patch: normalizedPatch,
      target: 'env.example',
    });
    const changedTargets = [];
    if (envPlan.changed)
      changedTargets.push({
        target: 'env',
        filePath: envPath,
        snapshot: envSnapshot,
        plan: envPlan,
      });
    if (examplePlan.changed) {
      changedTargets.push({
        target: 'env.example',
        filePath: examplePath,
        snapshot: exampleSnapshot,
        plan: examplePlan,
      });
    }

    const noChangeRevision = computeConfigurationRevision(envSnapshot.content);
    if (changedTargets.length === 0) {
      return completeResult(
        {
          ...result,
          outcome: 'NO_CHANGES',
          classifications: envPlan.classifications,
          envExample: {
            outcome: 'NO_CHANGES',
            changedKeys: [],
            classifications: examplePlan.classifications,
          },
          configurationRevision: noChangeRevision,
          concurrency: {
            checked: true,
            outcome: 'MATCHED',
            files: [
              { target: 'env', outcome: 'MATCHED' },
              { target: 'env.example', outcome: 'MATCHED' },
            ],
          },
        },
        startedAt,
      );
    }

    const concurrencyFiles = [];
    for (const target of changedTargets) {
      replaceFileAtomically({
        filePath: target.filePath,
        target: target.target,
        originalBytes: target.snapshot.bytes,
        nextContent: target.plan.content,
        fileSystem,
        onBeforeFinalRevalidation,
      });
      concurrencyFiles.push({ target: target.target, outcome: 'REPLACED' });
    }

    const finalEnvSnapshot = readSnapshot(envPath, fileSystem);
    const finalRevision = computeConfigurationRevision(finalEnvSnapshot.content);
    const liveChangedKeys = envPlan.changedKeys;
    const exampleChanged = examplePlan.changed;
    return completeResult(
      {
        ...result,
        outcome: 'CHANGED',
        changedKeys: liveChangedKeys,
        classifications: envPlan.classifications,
        envExample: {
          outcome: exampleChanged ? 'CHANGED' : 'NO_CHANGES',
          changedKeys: examplePlan.changedKeys,
          classifications: examplePlan.classifications,
        },
        configurationRevision: finalRevision,
        concurrency: {
          checked: true,
          outcome: 'REPLACED',
          files: concurrencyFiles,
        },
        restart: restartMetadata(liveChangedKeys),
      },
      startedAt,
    );
  } catch (error) {
    const isConflict = error?.code === 'CONCURRENT_EDIT';
    const isBlocked = BLOCKING_ERROR_CODES.has(error?.code);
    return completeResult(
      {
        ...result,
        outcome: isBlocked ? 'BLOCKED' : 'FAILED',
        concurrency: {
          checked: true,
          outcome: isConflict ? 'CONFLICT' : 'NOT_REQUESTED',
          files: [],
        },
        error,
      },
      startedAt,
    );
  }
}

async function verifyRegisteredDevContext({
  environment = process.env,
  query = null,
  repositoryRoot = null,
} = {}) {
  const profileCode = getProfileCode(environment);
  if (profileCode !== ENVIRONMENT_CODE && profileCode !== 'DOCKER_LOCAL') {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const databaseQuery = query || require('../../db/src/connection').query;
  const resolvedRepositoryRoot =
    repositoryRoot ||
    (await resolveRegisteredRepositoryRoot({
      environment,
      query: databaseQuery,
    }));
  const bindingResult = await databaseQuery(
    `
      SELECT cp.profile_code, r.repo_id, r.repo_code, rp.root_path
      FROM core.config_profiles cp
      JOIN core.repository_paths rp ON rp.profile_id = cp.profile_id
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND rp.active = TRUE
        AND r.active = TRUE
        AND r.is_skycommand_repository = TRUE
    `,
    [profileCode],
  );

  if (bindingResult.rowCount !== 1 || bindingResult.rows[0].repo_code !== REPOSITORY_CODE) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  if (
    normalizeRoot(bindingResult.rows[0].root_path) !==
    normalizeRoot(resolvedRepositoryRoot)
  ) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const toolResult = await databaseQuery(
    `
      SELECT t.tool_id, t.tool_code, t.script_path, t.runtime_code,
             t.permission_code, t.risk_code, t.requires_confirmation,
             t.allow_params, t.enabled, t.script_repo_id, r.repo_code
      FROM core.tools t
      JOIN core.repositories r ON r.repo_id = t.script_repo_id
      WHERE t.tool_code = $1
    `,
    [TOOL_CODE],
  );

  if (toolResult.rowCount !== 1) throw reconcileError('REGISTERED_CONTEXT_INVALID');
  const tool = toolResult.rows[0];
  if (
    tool.repo_code !== REPOSITORY_CODE ||
    tool.script_repo_id !== bindingResult.rows[0].repo_id ||
    tool.script_path !== SCRIPT_PATH ||
    tool.runtime_code !== 'node' ||
    tool.permission_code !== PERMISSION_CODE ||
    tool.risk_code !== 'medium' ||
    tool.requires_confirmation !== false ||
    tool.allow_params !== true ||
    tool.enabled !== true
  ) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const parameterResult = await databaseQuery(
    `
      SELECT p.parameter_name, p.param_type_code, p.required, p.enabled,
             p.argument_mode, p.cli_flag
      FROM core.tool_parameters p
      WHERE p.tool_id = $1
        AND p.enabled = TRUE
      ORDER BY p.display_order, p.parameter_name
    `,
    [tool.tool_id],
  );
  if (
    parameterResult.rowCount !== 1 ||
    parameterResult.rows[0].parameter_name !== PATCH_PARAMETER_NAME ||
    parameterResult.rows[0].param_type_code !== 'string' ||
    parameterResult.rows[0].required !== true
  ) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const visibilityResult = await databaseQuery(
    `
      SELECT channel_code
      FROM core.tool_visibility
      WHERE tool_id = $1
      ORDER BY channel_code
    `,
    [tool.tool_id],
  );
  const channels = visibilityResult.rows.map((row) => row.channel_code);
  if (REQUIRED_CHANNELS.some((channel) => !channels.includes(channel))) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  return {
    environmentCode: profileCode,
    repositoryCode: REPOSITORY_CODE,
    repositoryId: bindingResult.rows[0].repo_id,
    toolCode: TOOL_CODE,
    toolId: tool.tool_id,
    permissionCode: PERMISSION_CODE,
  };
}

async function resolveRegisteredRepositoryRoot({ environment = process.env, query = null } = {}) {
  const profileCode = getProfileCode(environment);
  if (profileCode !== ENVIRONMENT_CODE && profileCode !== 'DOCKER_LOCAL') {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const databaseQuery = query || require('../../db/src/connection').query;
  const result = await databaseQuery(
    `
      SELECT cp.profile_code, r.repo_code, rp.root_path
      FROM core.config_profiles cp
      JOIN core.repository_paths rp ON rp.profile_id = cp.profile_id
      JOIN core.repositories r ON r.repo_id = rp.repo_id
      WHERE cp.profile_code = $1
        AND cp.active = TRUE
        AND rp.active = TRUE
        AND r.active = TRUE
        AND r.is_skycommand_repository = TRUE
        AND LOWER(r.repo_code) = LOWER($2)
    `,
    [profileCode, REPOSITORY_CODE],
  );

  if (result.rowCount !== 1 || result.rows[0].repo_code !== REPOSITORY_CODE) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  const repositoryRoot = path.resolve(
    String(
      translateWorkspacePath(result.rows[0].root_path, {
        environment,
        profileCode,
      }),
    ),
  );
  if (!fs.existsSync(repositoryRoot) || !fs.statSync(repositoryRoot).isDirectory()) {
    throw reconcileError('REGISTERED_CONTEXT_INVALID');
  }

  return repositoryRoot;
}

function parseCliArguments(args = []) {
  const values = Array.isArray(args) ? args.map((value) => String(value || '')) : [];
  if (values.length !== 1 || !values[0].trim()) throw reconcileError('PATCH_REQUIRED');
  if (values[0].startsWith('-')) throw reconcileError('PATCH_JSON_INVALID');

  let parsed;
  try {
    parsed = JSON.parse(values[0]);
  } catch (_error) {
    throw reconcileError('PATCH_JSON_INVALID');
  }
  if (!isPlainObject(parsed)) throw reconcileError('PATCH_OBJECT_REQUIRED');
  return parsed;
}

async function executeCli(args) {
  const patch = parseCliArguments(args);
  const repositoryRoot = await resolveRegisteredRepositoryRoot();
  const binding = await verifyRegisteredDevContext({ repositoryRoot });
  return reconcileEnvironment({
    repositoryRoot,
    patch,
    binding,
    executionId: process.env.SKYCOMMAND_EXECUTION_ID || null,
  });
}

function renderReconcileResult(result) {
  console.log(
    `[SkyCommand DEV env] ${result.outcome}: ${result.changedKeys?.length || 0} live key(s) changed, ${result.envExample?.changedKeys?.length || 0} example key(s) changed.`,
  );
}

async function main() {
  dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env'), quiet: true });
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: DEV_ENV_RECONCILE_OUTPUT_TYPE,
    outputSchema: require('../../tools/contracts/dev_env_reconcile_summary.v1.schema.json'),
    args: process.argv.slice(2),
    execute: executeCli,
    createToolResult: createDevEnvReconcileToolResult,
    createFailureToolResult: createDevEnvReconcileFailureToolResult,
    renderConsole: renderReconcileResult,
  });
}

if (require.main === module) main();

module.exports = {
  CONFIGURATION_ALLOWLIST,
  ENVIRONMENT_CODE,
  ENV_EXAMPLE_FILE_NAME,
  ENV_FILE_NAME,
  MAX_PATCH_KEYS,
  OUTPUT_TYPE: DEV_ENV_RECONCILE_OUTPUT_TYPE,
  PATCH_PARAMETER_NAME,
  PERMISSION_CODE,
  RECONCILE_TOOL_CODE: TOOL_CODE,
  REPOSITORY_CODE,
  REPOSITORY_ROOT,
  REQUIRED_CHANNELS,
  REQUIRED_SECRET_KEYS,
  SCRIPT_PATH,
  ReconcileError,
  computeConfigurationRevision,
  executeCli,
  formatAssignment,
  getProfileCode,
  main,
  normalizePatch,
  parseCliArguments,
  parseEnvFile,
  planFile,
  protectedClassification,
  reconcileEnvironment,
  renderReconcileResult,
  verifyRegisteredDevContext,
  resolveRegisteredRepositoryRoot,
};
