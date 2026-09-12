const path = require('node:path');

const { pool, query } = require('../../../../packages/db/src/connection');

const AUTOMATION_CODE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const OUTPUT_TYPE_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_BROWSER_TYPES = new Set(['chromium']);
const ALLOWED_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'repo', 'select', 'path', 'date', 'json']);
const ALLOWED_SIDE_EFFECT_LEVELS = new Set(['READ_ONLY', 'MUTATING', 'HIGH_IMPACT']);
const ALLOWED_IDEMPOTENCY_MODES = new Set(['READ_ONLY', 'IDEMPOTENT', 'DEDUPLICATED', 'NON_IDEMPOTENT']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeText(value, fallback = '') {
  const normalized = value === undefined || value === null ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeBoolean(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  throw createHttpError(400, `${label} must be true or false.`);
}

function normalizeInteger(value, fallback, label, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw createHttpError(400, `${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function normalizeUuid(value, label) {
  const normalized = normalizeText(value);
  if (!UUID_PATTERN.test(normalized)) throw createHttpError(400, `${label} must be a valid UUID.`);
  return normalized;
}

function normalizeAutomationCode(value) {
  const automationCode = normalizeText(value).toLowerCase();
  if (!AUTOMATION_CODE_PATTERN.test(automationCode)) {
    throw createHttpError(
      400,
      'automationCode must start with a lowercase letter and contain only lowercase letters, numbers, underscores, and hyphens.',
    );
  }
  if (automationCode === 'runs') {
    throw createHttpError(400, "automationCode 'runs' is reserved for Playwright Automation operations.");
  }
  return automationCode;
}

function normalizeParameterName(value) {
  const parameterName = normalizeText(value);
  if (!PARAMETER_NAME_PATTERN.test(parameterName)) {
    throw createHttpError(400, 'parameterName must start with a letter and contain only letters, numbers, and underscores.');
  }
  return parameterName;
}

function normalizeEnvironmentCode(value) {
  const code = normalizeText(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    throw createHttpError(400, 'environmentCode must use uppercase letters, numbers, and underscores.');
  }
  return code;
}

function normalizeBrowserType(value) {
  const browserType = normalizeText(value, 'chromium').toLowerCase();
  if (!ALLOWED_BROWSER_TYPES.has(browserType)) {
    throw createHttpError(400, `browserType must be one of: ${[...ALLOWED_BROWSER_TYPES].join(', ')}.`);
  }
  return browserType;
}

function normalizeSideEffectLevel(value) {
  const level = normalizeText(value, 'READ_ONLY').toUpperCase();
  if (!ALLOWED_SIDE_EFFECT_LEVELS.has(level)) {
    throw createHttpError(400, `sideEffectLevel must be one of: ${[...ALLOWED_SIDE_EFFECT_LEVELS].join(', ')}.`);
  }
  return level;
}

function normalizeIdempotencyMode(value) {
  const mode = normalizeText(value, 'READ_ONLY').toUpperCase();
  if (!ALLOWED_IDEMPOTENCY_MODES.has(mode)) {
    throw createHttpError(400, `idempotencyMode must be one of: ${[...ALLOWED_IDEMPOTENCY_MODES].join(', ')}.`);
  }
  return mode;
}

function normalizeOutputType(value) {
  const outputType = normalizeText(value);
  if (!OUTPUT_TYPE_PATTERN.test(outputType)) {
    throw createHttpError(400, 'outputType must be a structured contract identifier such as browser_automation_summary.v1.');
  }
  return outputType;
}

function normalizeOutputSchemaPath(value) {
  const raw = normalizeText(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!raw) throw createHttpError(400, 'outputSchemaPath is required.');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes('\0')) {
    throw createHttpError(400, 'outputSchemaPath must be repository-relative.');
  }
  const normalized = path.posix.normalize(raw);
  if (normalized.includes('../') || !/\.schema\.json$/i.test(normalized)) {
    throw createHttpError(400, 'outputSchemaPath must reference a repository-relative *.schema.json file.');
  }
  return normalized;
}

function normalizeAutomationScriptPath(value) {
  const raw = normalizeText(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!raw) throw createHttpError(400, 'scriptPath is required.');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes('\0')) {
    throw createHttpError(400, 'scriptPath must be repository-relative.');
  }
  const normalized = path.posix.normalize(raw);
  if (
    !normalized.startsWith('browser-automation/scripts/') ||
    normalized.includes('../') ||
    !/\.(?:cjs|mjs|js)$/i.test(normalized)
  ) {
    throw createHttpError(400, 'scriptPath must reference JavaScript beneath browser-automation/scripts/.');
  }
  return normalized;
}

function normalizeStringArray(value, label, { uppercase = false } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw createHttpError(400, `${label} must be an array.`);
  return [...new Set(value.map((item) => {
    const normalized = normalizeText(item);
    if (!normalized) throw createHttpError(400, `${label} cannot contain blank values.`);
    return uppercase ? normalized.toUpperCase() : normalized;
  }))];
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function normalizePageSize(value) {
  return normalizeInteger(value, DEFAULT_PAGE_SIZE, 'limit', 1, MAX_PAGE_SIZE);
}

function normalizeOffset(value) {
  return normalizeInteger(value, 0, 'offset', 0, 1000000);
}

function sanitizeCategory(row) {
  return {
    categoryId: row.category_id,
    categoryCode: row.category_code,
    name: row.category_name || row.name,
    label: row.category_label || row.label,
    description: row.category_description || row.description || null,
    displayOrder: Number(row.category_display_order ?? row.display_order ?? 0),
    enabled: row.category_enabled === undefined ? toBoolean(row.enabled) : toBoolean(row.category_enabled),
  };
}

function sanitizeEnvironment(row) {
  return {
    environmentCode: row.environment_code,
    environmentName: row.environment_name,
    description: row.environment_description || row.description || null,
    baseUrl: row.base_url,
    displayOrder: Number(row.environment_display_order ?? row.display_order ?? 0),
    enabled: row.environment_enabled === undefined ? toBoolean(row.enabled) : toBoolean(row.environment_enabled),
  };
}

function parseDefaultValue(type, value) {
  if (value === undefined || value === null || value === '') return null;
  if (type === 'boolean') return normalizeBoolean(value, false, 'defaultValue');
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === 'json') {
    try {
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (_error) {
      return value;
    }
  }
  return value;
}

function sanitizeParameter(row, options = []) {
  return {
    parameterId: row.parameter_id,
    parameterName: row.parameter_name,
    label: row.label,
    type: row.param_type_code,
    prompt: row.prompt || null,
    required: toBoolean(row.required),
    defaultValue: parseDefaultValue(row.param_type_code, row.default_value),
    optionSourceCode: row.option_source_code || null,
    displayOrder: Number(row.display_order || 0),
    enabled: toBoolean(row.enabled),
    options: options.map((option) => ({
      optionId: option.option_id,
      label: option.option_label,
      value: option.option_value,
      displayOrder: Number(option.display_order || 0),
      enabled: toBoolean(option.enabled),
    })),
  };
}

function sanitizeAutomationRow(row) {
  return {
    automationId: row.automation_id,
    automationCode: row.automation_code,
    name: row.name,
    label: row.label,
    description: row.description || null,
    category: {
      categoryId: row.category_id,
      categoryCode: row.category_code,
      label: row.category_label,
    },
    scriptRepository: {
      repoId: row.script_repo_id,
      repoCode: row.script_repo_code,
      repoName: row.script_repo_name,
    },
    scriptPath: row.script_path,
    browserType: row.browser_type,
    defaultEnvironmentCode: row.default_environment_code,
    timeoutSeconds: Number(row.timeout_seconds || 0),
    retryCount: Number(row.retry_count || 0),
    maxConcurrency: Number(row.max_concurrency || 1),
    permissionCode: row.permission_code || null,
    riskCode: row.risk_code,
    riskName: row.risk_name,
    riskRank: Number(row.risk_rank || 0),
    requiresConfirmation: toBoolean(row.requires_confirmation),
    assistantEnabled: toBoolean(row.assistant_enabled),
    confirmationText: row.confirmation_text || null,
    sideEffectLevel: row.side_effect_level,
    idempotencyMode: row.idempotency_mode,
    outputType: row.output_type,
    outputSchemaPath: row.output_schema_path,
    displayOrder: Number(row.display_order || 0),
    enabled: toBoolean(row.enabled),
    managedBySkyCommand: toBoolean(row.managed_by_skycommand),
    registeredAt: row.registered_at || null,
    registeredBy: row.registered_by || null,
    parameterCount: Number(row.parameter_count || 0),
    environmentCount: Number(row.environment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const AUTOMATION_SELECT = `
  SELECT
    ba.*,
    bac.category_code,
    bac.label AS category_label,
    r.repo_code AS script_repo_code,
    r.repo_name AS script_repo_name,
    rl.risk_name,
    rl.risk_rank,
    (SELECT COUNT(*) FROM core.browser_automation_parameters p WHERE p.automation_id = ba.automation_id AND p.enabled = TRUE) AS parameter_count,
    (SELECT COUNT(*) FROM core.browser_automation_environments e WHERE e.automation_id = ba.automation_id) AS environment_count
  FROM core.browser_automations ba
  JOIN core.browser_automation_categories bac ON bac.category_id = ba.category_id
  JOIN core.repositories r ON r.repo_id = ba.script_repo_id
  JOIN core.risk_levels rl ON rl.risk_code = ba.risk_code
`;

async function loadAutomationParameters(automationId, client = null) {
  const db = client || { query };
  const parameterResult = await db.query(
    `SELECT * FROM core.browser_automation_parameters WHERE automation_id = $1 ORDER BY display_order, parameter_name`,
    [automationId],
  );
  if (parameterResult.rows.length === 0) return [];

  const parameterIds = parameterResult.rows.map((row) => row.parameter_id);
  const optionResult = await db.query(
    `SELECT * FROM core.browser_automation_parameter_options WHERE parameter_id = ANY($1::uuid[]) ORDER BY parameter_id, display_order, option_label`,
    [parameterIds],
  );
  const optionsByParameter = new Map();
  for (const option of optionResult.rows) {
    if (!optionsByParameter.has(option.parameter_id)) optionsByParameter.set(option.parameter_id, []);
    optionsByParameter.get(option.parameter_id).push(option);
  }

  let repositoryOptions = null;
  let workflowOptions = null;
  if (parameterResult.rows.some((row) => row.param_type_code === 'repo' || row.option_source_code === 'repositories')) {
    const repositoryResult = await db.query(
      `SELECT repo_code, repo_name, display_order FROM core.repositories WHERE active = TRUE ORDER BY display_order, repo_name, repo_code`,
    );
    repositoryOptions = repositoryResult.rows.map((row) => ({
      option_id: null,
      option_label: row.repo_name || row.repo_code,
      option_value: row.repo_code,
      display_order: row.display_order,
      enabled: true,
    }));
  }
  if (parameterResult.rows.some((row) => row.option_source_code === 'skyserver_workflows')) {
    const workflowResult = await db.query(
      `SELECT workflow_code, display_name
       FROM worker.vw_workflow_definitions
       WHERE status = 'ACTIVE' AND enabled = TRUE AND visible_in_admin = TRUE AND published_version_id IS NOT NULL
       ORDER BY display_name, workflow_code`,
    );
    workflowOptions = workflowResult.rows.map((row, index) => ({
      option_id: null,
      option_label: `${row.display_name} (${row.workflow_code})`,
      option_value: row.workflow_code,
      display_order: index * 10 + 10,
      enabled: true,
    }));
  }

  return parameterResult.rows.map((row) => {
    let options = optionsByParameter.get(row.parameter_id) || [];
    if (row.param_type_code === 'repo' || row.option_source_code === 'repositories') options = repositoryOptions || [];
    if (row.option_source_code === 'skyserver_workflows') options = workflowOptions || [];
    return sanitizeParameter(row, options);
  });
}

async function loadAutomationEnvironments(automationId, client = null) {
  const db = client || { query };
  const result = await db.query(
    `SELECT be.*
     FROM core.browser_automation_environments bae
     JOIN core.browser_environments be ON be.environment_code = bae.environment_code
     WHERE bae.automation_id = $1
     ORDER BY be.display_order, be.environment_code`,
    [automationId],
  );
  return result.rows.map(sanitizeEnvironment);
}

async function loadAutomationDetailBy(column, value, { includeDisabled = true } = {}) {
  const allowedColumns = new Set(['ba.automation_id', 'ba.automation_code']);
  if (!allowedColumns.has(column)) throw new Error('Unsafe Playwright Automation lookup column.');
  const result = await query(
    `${AUTOMATION_SELECT}
     WHERE ${column} = $1
       ${includeDisabled ? '' : 'AND ba.enabled = TRUE AND bac.enabled = TRUE'}
     LIMIT 1`,
    [value],
  );
  if (!result.rows[0]) return null;
  const automation = sanitizeAutomationRow(result.rows[0]);
  automation.parameters = await loadAutomationParameters(automation.automationId);
  automation.environments = await loadAutomationEnvironments(automation.automationId);
  return automation;
}

async function getBrowserAutomationByCode(automationCode, options = {}) {
  return loadAutomationDetailBy('ba.automation_code', normalizeAutomationCode(automationCode), options);
}

async function getBrowserAutomationById(automationId, options = {}) {
  return loadAutomationDetailBy('ba.automation_id', normalizeUuid(automationId, 'automationId'), options);
}

async function listBrowserAutomations(filters = {}, { admin = false } = {}) {
  const values = [];
  const clauses = [];
  if (!admin) clauses.push('ba.enabled = TRUE', 'bac.enabled = TRUE');

  const search = normalizeText(filters.search || filters.query);
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      ba.automation_code ILIKE $${values.length}
      OR ba.name ILIKE $${values.length}
      OR ba.label ILIKE $${values.length}
      OR COALESCE(ba.description, '') ILIKE $${values.length}
      OR ba.script_path ILIKE $${values.length}
    )`);
  }

  const categoryCode = normalizeText(filters.categoryCode).toLowerCase();
  if (categoryCode) {
    values.push(categoryCode);
    clauses.push(`bac.category_code = $${values.length}`);
  }

  const environmentCode = normalizeText(filters.environmentCode).toUpperCase();
  if (environmentCode) {
    values.push(environmentCode);
    clauses.push(`EXISTS (
      SELECT 1 FROM core.browser_automation_environments e
      WHERE e.automation_id = ba.automation_id AND e.environment_code = $${values.length}
    )`);
  }

  const sideEffectLevel = normalizeText(filters.sideEffectLevel).toUpperCase();
  if (sideEffectLevel) {
    if (!ALLOWED_SIDE_EFFECT_LEVELS.has(sideEffectLevel)) throw createHttpError(400, 'Unknown sideEffectLevel filter.');
    values.push(sideEffectLevel);
    clauses.push(`ba.side_effect_level = $${values.length}`);
  }

  if (admin && filters.enabled !== undefined && filters.enabled !== '') {
    values.push(normalizeBoolean(filters.enabled, true, 'enabled'));
    clauses.push(`ba.enabled = $${values.length}`);
  }

  if (filters.assistantEnabled !== undefined && filters.assistantEnabled !== '') {
    values.push(normalizeBoolean(filters.assistantEnabled, true, 'assistantEnabled'));
    clauses.push(`ba.assistant_enabled = $${values.length}`);
  }

  const limit = normalizePageSize(filters.limit);
  const offset = normalizeOffset(filters.offset);
  values.push(limit, offset);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query(
    `${AUTOMATION_SELECT}
     ${where}
     ORDER BY bac.display_order, ba.display_order, ba.label, ba.automation_code
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return { items: result.rows.map(sanitizeAutomationRow), limit, offset };
}

async function getAdminOptions() {
  const [categories, repositories, risks, paramTypes, optionSources, environments, permissions] = await Promise.all([
    query(`SELECT * FROM core.browser_automation_categories ORDER BY display_order, label`),
    query(`SELECT repo_id, repo_code, repo_name, active FROM core.repositories ORDER BY display_order, repo_name`),
    query(`SELECT risk_code, risk_name, risk_rank, active FROM core.risk_levels ORDER BY risk_rank`),
    query(`SELECT param_type_code, param_type_name, description, active FROM core.param_types ORDER BY param_type_name`),
    query(`SELECT option_source_code, option_source_name, description, active FROM core.option_sources ORDER BY option_source_name`),
    query(`SELECT * FROM core.browser_environments ORDER BY display_order, environment_name`),
    query(`SELECT permission_code, resource, action, description, active FROM auth.permissions WHERE active = TRUE ORDER BY permission_code`),
  ]);

  return {
    categories: categories.rows.map(sanitizeCategory),
    repositories: repositories.rows.map((row) => ({
      repoId: row.repo_id,
      repoCode: row.repo_code,
      repoName: row.repo_name,
      active: toBoolean(row.active),
    })),
    risks: risks.rows.map((row) => ({
      riskCode: row.risk_code,
      riskName: row.risk_name,
      riskRank: Number(row.risk_rank || 0),
      active: toBoolean(row.active),
    })),
    parameterTypes: paramTypes.rows
      .filter((row) => ALLOWED_PARAM_TYPES.has(row.param_type_code))
      .map((row) => ({
        code: row.param_type_code,
        name: row.param_type_name,
        description: row.description || null,
        active: toBoolean(row.active),
      })),
    optionSources: optionSources.rows.map((row) => ({
      code: row.option_source_code,
      name: row.option_source_name,
      description: row.description || null,
      active: toBoolean(row.active),
    })),
    environments: environments.rows.map(sanitizeEnvironment),
    permissions: permissions.rows.map((row) => ({
      permissionCode: row.permission_code,
      resource: row.resource,
      action: row.action,
      description: row.description || null,
      active: toBoolean(row.active),
    })),
    browserTypes: [...ALLOWED_BROWSER_TYPES],
    sideEffectLevels: [...ALLOWED_SIDE_EFFECT_LEVELS],
    idempotencyModes: [...ALLOWED_IDEMPOTENCY_MODES],
    defaultOutputContract: {
      outputType: 'browser_automation_summary.v1',
      outputSchemaPath: 'packages/browser/contracts/browser_automation_summary.v1.schema.json',
    },
  };
}

function assertSafetyConsistency(definition, current = null) {
  const sideEffectLevel = definition.sideEffectLevel ?? current?.side_effect_level ?? 'READ_ONLY';
  const idempotencyMode = definition.idempotencyMode ?? current?.idempotency_mode ?? 'READ_ONLY';
  const retryCount = definition.retryCount ?? Number(current?.retry_count || 0);
  const requiresConfirmation = definition.requiresConfirmation ?? toBoolean(current?.requires_confirmation);
  const assistantEnabled = definition.assistantEnabled ?? toBoolean(current?.assistant_enabled);
  const permissionCode = definition.permissionCode === undefined
    ? normalizeOptionalText(current?.permission_code)
    : definition.permissionCode;
  const confirmationText = definition.confirmationText === undefined
    ? normalizeOptionalText(current?.confirmation_text)
    : definition.confirmationText;

  if ((sideEffectLevel === 'READ_ONLY') !== (idempotencyMode === 'READ_ONLY')) {
    throw createHttpError(400, 'READ_ONLY side effects must use READ_ONLY idempotency, and READ_ONLY idempotency is reserved for read-only automations.');
  }
  if (retryCount > 0 && idempotencyMode === 'NON_IDEMPOTENT') {
    throw createHttpError(400, 'NON_IDEMPOTENT automations must use retryCount 0.');
  }
  if (sideEffectLevel === 'HIGH_IMPACT' && !requiresConfirmation) {
    throw createHttpError(400, 'HIGH_IMPACT automations must require confirmation.');
  }
  if (requiresConfirmation && !confirmationText) {
    throw createHttpError(400, 'confirmationText is required when confirmation is enabled.');
  }
  if (assistantEnabled && requiresConfirmation) {
    throw createHttpError(400, 'Assistant execution cannot be enabled for confirmation-required Playwright Automations.');
  }
  if (assistantEnabled && !permissionCode) {
    throw createHttpError(400, 'Assistant-enabled Playwright Automations must define an execution permission.');
  }
}

function normalizeAutomationDefinition(body = {}, { partial = false } = {}) {
  const normalized = {
    automationCode: partial && body.automationCode === undefined ? undefined : normalizeAutomationCode(body.automationCode),
    categoryId: partial && body.categoryId === undefined ? undefined : normalizeUuid(body.categoryId, 'categoryId'),
    name: partial && body.name === undefined ? undefined : normalizeText(body.name),
    label: partial && body.label === undefined ? undefined : normalizeText(body.label),
    description: partial && body.description === undefined ? undefined : normalizeOptionalText(body.description),
    scriptRepoId: partial && body.scriptRepoId === undefined ? undefined : normalizeUuid(body.scriptRepoId, 'scriptRepoId'),
    scriptPath: partial && body.scriptPath === undefined ? undefined : normalizeAutomationScriptPath(body.scriptPath),
    browserType: partial && body.browserType === undefined ? undefined : normalizeBrowserType(body.browserType),
    defaultEnvironmentCode: partial && body.defaultEnvironmentCode === undefined
      ? undefined
      : normalizeEnvironmentCode(body.defaultEnvironmentCode || 'LOCAL'),
    timeoutSeconds: partial && body.timeoutSeconds === undefined
      ? undefined
      : normalizeInteger(body.timeoutSeconds, 120, 'timeoutSeconds', 1, 3600),
    retryCount: partial && body.retryCount === undefined
      ? undefined
      : normalizeInteger(body.retryCount, 0, 'retryCount', 0, 3),
    maxConcurrency: partial && body.maxConcurrency === undefined
      ? undefined
      : normalizeInteger(body.maxConcurrency, 1, 'maxConcurrency', 1, 8),
    permissionCode: partial && body.permissionCode === undefined
      ? undefined
      : normalizeOptionalText(body.permissionCode) || 'BROWSER_AUTOMATION_RUN',
    riskCode: partial && body.riskCode === undefined
      ? undefined
      : normalizeText(body.riskCode, 'low').toLowerCase(),
    requiresConfirmation: partial && body.requiresConfirmation === undefined
      ? undefined
      : normalizeBoolean(body.requiresConfirmation, false, 'requiresConfirmation'),
    assistantEnabled: partial && body.assistantEnabled === undefined
      ? undefined
      : normalizeBoolean(body.assistantEnabled, false, 'assistantEnabled'),
    confirmationText: partial && body.confirmationText === undefined
      ? undefined
      : normalizeOptionalText(body.confirmationText),
    sideEffectLevel: partial && body.sideEffectLevel === undefined
      ? undefined
      : normalizeSideEffectLevel(body.sideEffectLevel),
    idempotencyMode: partial && body.idempotencyMode === undefined
      ? undefined
      : normalizeIdempotencyMode(body.idempotencyMode),
    outputType: partial && body.outputType === undefined ? undefined : normalizeOutputType(body.outputType),
    outputSchemaPath: partial && body.outputSchemaPath === undefined ? undefined : normalizeOutputSchemaPath(body.outputSchemaPath),
    displayOrder: partial && body.displayOrder === undefined
      ? undefined
      : normalizeInteger(body.displayOrder, 999, 'displayOrder', 0, 1000000),
    enabled: partial && body.enabled === undefined
      ? undefined
      : normalizeBoolean(body.enabled, true, 'enabled'),
  };

  if (!partial) {
    if (!normalized.name) throw createHttpError(400, 'name is required.');
    if (!normalized.label) throw createHttpError(400, 'label is required.');
  } else {
    if (normalized.name !== undefined && !normalized.name) throw createHttpError(400, 'name cannot be blank.');
    if (normalized.label !== undefined && !normalized.label) throw createHttpError(400, 'label cannot be blank.');
  }

  return normalized;
}

function normalizeParameterDefinition(item = {}, index = 0) {
  const type = normalizeText(item.type || item.paramTypeCode, 'string').toLowerCase();
  if (!ALLOWED_PARAM_TYPES.has(type)) throw createHttpError(400, `parameters[${index}].type is not supported.`);
  const parameter = {
    parameterName: normalizeParameterName(item.parameterName || item.name),
    label: normalizeText(item.label),
    type,
    prompt: normalizeOptionalText(item.prompt || item.helpText),
    required: normalizeBoolean(item.required, false, `parameters[${index}].required`),
    defaultValue: item.defaultValue === undefined || item.defaultValue === null ? null : item.defaultValue,
    optionSourceCode: normalizeOptionalText(item.optionSourceCode),
    displayOrder: normalizeInteger(item.displayOrder ?? index * 10 + 10, index * 10 + 10, `parameters[${index}].displayOrder`, 0, 1000000),
    enabled: normalizeBoolean(item.enabled, true, `parameters[${index}].enabled`),
    options: Array.isArray(item.options) ? item.options : [],
  };
  if (!parameter.label) throw createHttpError(400, `parameters[${index}].label is required.`);
  if (type === 'json' && parameter.defaultValue !== null && typeof parameter.defaultValue === 'string') {
    try { JSON.parse(parameter.defaultValue); } catch (_error) {
      throw createHttpError(400, `parameters[${index}].defaultValue must contain valid JSON.`);
    }
  }
  if (type === 'repo' && !parameter.optionSourceCode) parameter.optionSourceCode = 'repositories';
  return parameter;
}

function serializeDefaultValue(parameter) {
  if (parameter.defaultValue === null || parameter.defaultValue === undefined) return null;
  if (parameter.type === 'json') return typeof parameter.defaultValue === 'string' ? parameter.defaultValue : JSON.stringify(parameter.defaultValue);
  if (parameter.type === 'boolean') return normalizeBoolean(parameter.defaultValue, false, 'defaultValue') ? 'true' : 'false';
  return String(parameter.defaultValue);
}

async function replaceParametersWithClient(client, automationId, parameters) {
  if (!Array.isArray(parameters)) throw createHttpError(400, 'parameters must be an array.');
  const normalized = parameters.map(normalizeParameterDefinition);
  const names = normalized.map((parameter) => parameter.parameterName.toLowerCase());
  if (new Set(names).size !== names.length) throw createHttpError(400, 'Playwright Automation parameter names must be unique.');

  await client.query('DELETE FROM core.browser_automation_parameters WHERE automation_id = $1', [automationId]);
  for (const parameter of normalized) {
    const result = await client.query(
      `INSERT INTO core.browser_automation_parameters (
         automation_id, parameter_name, label, param_type_code, prompt, required,
         default_value, option_source_code, display_order, enabled
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING parameter_id`,
      [
        automationId,
        parameter.parameterName,
        parameter.label,
        parameter.type,
        parameter.prompt,
        parameter.required,
        serializeDefaultValue(parameter),
        parameter.optionSourceCode,
        parameter.displayOrder,
        parameter.enabled,
      ],
    );
    const parameterId = result.rows[0].parameter_id;
    for (let index = 0; index < parameter.options.length; index += 1) {
      const option = parameter.options[index] || {};
      const label = normalizeText(option.label || option.optionLabel);
      const value = normalizeText(option.value ?? option.optionValue);
      if (!label || !value) throw createHttpError(400, `Option ${index + 1} for ${parameter.parameterName} requires label and value.`);
      await client.query(
        `INSERT INTO core.browser_automation_parameter_options (parameter_id, option_label, option_value, display_order, enabled)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          parameterId,
          label,
          value,
          normalizeInteger(option.displayOrder, index * 10 + 10, 'option.displayOrder', 0, 1000000),
          normalizeBoolean(option.enabled, true, 'option.enabled'),
        ],
      );
    }
  }
}

async function replaceEnvironmentsWithClient(client, automationId, environmentCodes, defaultEnvironmentCode = null) {
  const normalized = normalizeStringArray(environmentCodes, 'environmentCodes', { uppercase: true }).map(normalizeEnvironmentCode);
  if (normalized.length === 0) throw createHttpError(400, 'At least one environmentCode is required.');
  if (defaultEnvironmentCode && !normalized.includes(defaultEnvironmentCode)) {
    throw createHttpError(400, 'The default Playwright Automation environment must remain in the allowed environment list.');
  }
  const environmentCheck = await client.query(
    'SELECT environment_code FROM core.browser_environments WHERE environment_code = ANY($1::text[]) AND enabled = TRUE',
    [normalized],
  );
  const found = new Set(environmentCheck.rows.map((row) => row.environment_code));
  const missing = normalized.filter((code) => !found.has(code));
  if (missing.length) throw createHttpError(400, `Unknown or disabled browser environment(s): ${missing.join(', ')}.`);

  await client.query('DELETE FROM core.browser_automation_environments WHERE automation_id = $1', [automationId]);
  for (const environmentCode of normalized) {
    await client.query(
      'INSERT INTO core.browser_automation_environments (automation_id, environment_code) VALUES ($1,$2)',
      [automationId, environmentCode],
    );
  }
}

async function createBrowserAutomation({ body = {}, actor = null }) {
  const definition = normalizeAutomationDefinition(body);
  assertSafetyConsistency(definition);
  const environments = normalizeStringArray(
    body.environmentCodes || [definition.defaultEnvironmentCode],
    'environmentCodes',
    { uppercase: true },
  ).map(normalizeEnvironmentCode);
  if (!environments.includes(definition.defaultEnvironmentCode)) environments.push(definition.defaultEnvironmentCode);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO core.browser_automations (
         category_id, automation_code, name, label, description,
         script_repo_id, script_path, browser_type, default_environment_code,
         timeout_seconds, retry_count, max_concurrency, permission_code, risk_code,
         requires_confirmation, confirmation_text, assistant_enabled, side_effect_level, idempotency_mode,
         output_type, output_schema_path, display_order, enabled,
         managed_by_skycommand, registered_at, registered_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,TRUE,CURRENT_TIMESTAMP,$24
       ) RETURNING automation_id`,
      [
        definition.categoryId,
        definition.automationCode,
        definition.name,
        definition.label,
        definition.description,
        definition.scriptRepoId,
        definition.scriptPath,
        definition.browserType,
        definition.defaultEnvironmentCode,
        definition.timeoutSeconds,
        definition.retryCount,
        definition.maxConcurrency,
        definition.permissionCode,
        definition.riskCode,
        definition.requiresConfirmation,
        definition.confirmationText,
        definition.assistantEnabled,
        definition.sideEffectLevel,
        definition.idempotencyMode,
        definition.outputType,
        definition.outputSchemaPath,
        definition.displayOrder,
        definition.enabled,
        actor?.userId || actor?.user_id || null,
      ],
    );
    const automationId = result.rows[0].automation_id;
    await replaceEnvironmentsWithClient(client, automationId, environments, definition.defaultEnvironmentCode);
    if (Array.isArray(body.parameters)) await replaceParametersWithClient(client, automationId, body.parameters);
    await client.query('COMMIT');
    return getBrowserAutomationById(automationId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      throw createHttpError(409, 'A Playwright Automation with that automationCode already exists.', {
        code: 'BROWSER_AUTOMATION_CODE_EXISTS',
        automationCode: definition.automationCode,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateBrowserAutomation({ automationId, body = {} }) {
  const id = normalizeUuid(automationId, 'automationId');
  const definition = normalizeAutomationDefinition(body, { partial: true });
  const fieldMap = {
    automationCode: 'automation_code',
    categoryId: 'category_id',
    name: 'name',
    label: 'label',
    description: 'description',
    scriptRepoId: 'script_repo_id',
    scriptPath: 'script_path',
    browserType: 'browser_type',
    defaultEnvironmentCode: 'default_environment_code',
    timeoutSeconds: 'timeout_seconds',
    retryCount: 'retry_count',
    maxConcurrency: 'max_concurrency',
    permissionCode: 'permission_code',
    riskCode: 'risk_code',
    requiresConfirmation: 'requires_confirmation',
    confirmationText: 'confirmation_text',
    assistantEnabled: 'assistant_enabled',
    sideEffectLevel: 'side_effect_level',
    idempotencyMode: 'idempotency_mode',
    outputType: 'output_type',
    outputSchemaPath: 'output_schema_path',
    displayOrder: 'display_order',
    enabled: 'enabled',
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT * FROM core.browser_automations WHERE automation_id = $1 FOR UPDATE', [id]);
    const current = currentResult.rows[0];
    if (!current) throw createHttpError(404, 'Playwright Automation not found.');
    assertSafetyConsistency(definition, current);

    if (definition.defaultEnvironmentCode !== undefined) {
      const environmentResult = await client.query(
        `SELECT environment_code FROM core.browser_environments WHERE environment_code = $1 AND enabled = TRUE`,
        [definition.defaultEnvironmentCode],
      );
      if (!environmentResult.rows[0]) {
        throw createHttpError(400, `Browser environment ${definition.defaultEnvironmentCode} is not registered or enabled.`);
      }
    }

    const assignments = [];
    const values = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      if (definition[key] !== undefined) {
        values.push(definition[key]);
        assignments.push(`${column} = $${values.length}`);
      }
    }
    if (assignments.length > 0) {
      values.push(id);
      await client.query(`UPDATE core.browser_automations SET ${assignments.join(', ')} WHERE automation_id = $${values.length}`, values);
    }

    if (definition.defaultEnvironmentCode !== undefined) {
      await client.query(
        `INSERT INTO core.browser_automation_environments (automation_id, environment_code)
         VALUES ($1,$2) ON CONFLICT (automation_id, environment_code) DO NOTHING`,
        [id, definition.defaultEnvironmentCode],
      );
    }

    await client.query('COMMIT');
    return getBrowserAutomationById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw createHttpError(409, 'A Playwright Automation with that automationCode already exists.');
    throw error;
  } finally {
    client.release();
  }
}

async function replaceBrowserAutomationParameters({ automationId, parameters }) {
  const id = normalizeUuid(automationId, 'automationId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM core.browser_automations WHERE automation_id = $1', [id]);
    if (!exists.rows[0]) throw createHttpError(404, 'Playwright Automation not found.');
    await replaceParametersWithClient(client, id, parameters);
    await client.query('COMMIT');
    return getBrowserAutomationById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function replaceBrowserAutomationEnvironments({ automationId, environmentCodes }) {
  const id = normalizeUuid(automationId, 'automationId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT default_environment_code FROM core.browser_automations WHERE automation_id = $1', [id]);
    if (!result.rows[0]) throw createHttpError(404, 'Playwright Automation not found.');
    await replaceEnvironmentsWithClient(client, id, environmentCodes, result.rows[0].default_environment_code);
    await client.query('COMMIT');
    return getBrowserAutomationById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateBrowserAutomationStatus({ automationId, enabled }) {
  const id = normalizeUuid(automationId, 'automationId');
  const value = normalizeBoolean(enabled, true, 'enabled');
  const result = await query(
    'UPDATE core.browser_automations SET enabled = $1 WHERE automation_id = $2 RETURNING automation_id',
    [value, id],
  );
  if (!result.rows[0]) throw createHttpError(404, 'Playwright Automation not found.');
  return getBrowserAutomationById(id);
}

module.exports = {
  ALLOWED_IDEMPOTENCY_MODES,
  ALLOWED_SIDE_EFFECT_LEVELS,
  createBrowserAutomation,
  getAdminOptions,
  getBrowserAutomationByCode,
  getBrowserAutomationById,
  listBrowserAutomations,
  replaceBrowserAutomationEnvironments,
  replaceBrowserAutomationParameters,
  updateBrowserAutomation,
  updateBrowserAutomationStatus,
};
