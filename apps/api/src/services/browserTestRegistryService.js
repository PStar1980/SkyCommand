const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Connection, Client } = require('@temporalio/client');

const { pool, query } = require('../../../../packages/db/src/connection');
const { getBrowserRuntimeConfig } = require('../../../../packages/browser/src/config');

const TEST_CODE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_BROWSER_TYPES = new Set(['chromium']);
const ALLOWED_PARAM_TYPES = new Set(['string', 'number', 'boolean', 'repo', 'select', 'path', 'date', 'json']);
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
  if (!UUID_PATTERN.test(normalized)) {
    throw createHttpError(400, `${label} must be a valid UUID.`);
  }
  return normalized;
}

function normalizeTestCode(value) {
  const testCode = normalizeText(value).toLowerCase();
  if (!TEST_CODE_PATTERN.test(testCode)) {
    throw createHttpError(
      400,
      'testCode must start with a lowercase letter and contain only lowercase letters, numbers, underscores, and hyphens.',
    );
  }
  return testCode;
}

function normalizeParameterName(value) {
  const parameterName = normalizeText(value);
  if (!PARAMETER_NAME_PATTERN.test(parameterName)) {
    throw createHttpError(
      400,
      'parameterName must start with a letter and contain only letters, numbers, and underscores.',
    );
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

function normalizeBrowserSpecPath(value) {
  const raw = normalizeText(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!raw) throw createHttpError(400, 'scriptPath is required.');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes('\0')) {
    throw createHttpError(400, 'scriptPath must be repository-relative.');
  }
  const normalized = path.posix.normalize(raw);
  if (
    !normalized.startsWith('tests/browser/specs/') ||
    normalized.includes('../') ||
    !/\.spec\.[cm]?[jt]s$/i.test(normalized)
  ) {
    throw createHttpError(
      400,
      'scriptPath must reference a Playwright spec beneath tests/browser/specs/.',
    );
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

function permissionCodeSet(permissions = []) {
  return new Set(
    (Array.isArray(permissions) ? permissions : [])
      .map((permission) => permission?.permissionCode || permission?.permission_code || permission)
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );
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

function sanitizeTestRow(row) {
  return {
    testId: row.test_id,
    testCode: row.test_code,
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
    grepPattern: row.grep_pattern || null,
    permissionCode: row.permission_code || null,
    riskCode: row.risk_code,
    riskName: row.risk_name,
    riskRank: Number(row.risk_rank || 0),
    requiresConfirmation: toBoolean(row.requires_confirmation),
    confirmationText: row.confirmation_text || null,
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

const TEST_SELECT = `
  SELECT
    bt.*,
    btc.category_code,
    btc.label AS category_label,
    r.repo_code AS script_repo_code,
    r.repo_name AS script_repo_name,
    rl.risk_name,
    rl.risk_rank,
    (SELECT COUNT(*) FROM core.browser_test_parameters p WHERE p.test_id = bt.test_id AND p.enabled = TRUE) AS parameter_count,
    (SELECT COUNT(*) FROM core.browser_test_environments e WHERE e.test_id = bt.test_id) AS environment_count
  FROM core.browser_tests bt
  JOIN core.browser_test_categories btc ON btc.category_id = bt.category_id
  JOIN core.repositories r ON r.repo_id = bt.script_repo_id
  JOIN core.risk_levels rl ON rl.risk_code = bt.risk_code
`;

async function loadTestParameters(testId, client = null) {
  const db = client || { query };
  const parameterResult = await db.query(
    `
      SELECT *
      FROM core.browser_test_parameters
      WHERE test_id = $1
      ORDER BY display_order, parameter_name
    `,
    [testId],
  );
  if (parameterResult.rows.length === 0) return [];

  const parameterIds = parameterResult.rows.map((row) => row.parameter_id);
  const optionResult = await db.query(
    `
      SELECT *
      FROM core.browser_test_parameter_options
      WHERE parameter_id = ANY($1::uuid[])
      ORDER BY parameter_id, display_order, option_label
    `,
    [parameterIds],
  );
  const optionsByParameter = new Map();
  for (const option of optionResult.rows) {
    if (!optionsByParameter.has(option.parameter_id)) optionsByParameter.set(option.parameter_id, []);
    optionsByParameter.get(option.parameter_id).push(option);
  }

  let repositoryOptions = null;
  let workflowOptions = null;
  if (
    parameterResult.rows.some(
      (row) => row.param_type_code === 'repo' || row.option_source_code === 'repositories',
    )
  ) {
    const repositoryResult = await db.query(
      `
        SELECT repo_code, repo_name, display_order
        FROM core.repositories
        WHERE active = TRUE
        ORDER BY display_order, repo_name, repo_code
      `,
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
      `
        SELECT workflow_code, display_name
        FROM worker.vw_workflow_definitions
        WHERE status = 'ACTIVE'
          AND enabled = TRUE
          AND visible_in_admin = TRUE
          AND published_version_id IS NOT NULL
        ORDER BY display_name, workflow_code
      `,
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
    if (row.param_type_code === 'repo' || row.option_source_code === 'repositories') {
      options = repositoryOptions || [];
    } else if (row.option_source_code === 'skyserver_workflows') {
      options = workflowOptions || [];
    }
    return sanitizeParameter(row, options);
  });
}

async function loadTestEnvironments(testId, client = null) {
  const db = client || { query };
  const result = await db.query(
    `
      SELECT be.*
      FROM core.browser_test_environments bte
      JOIN core.browser_environments be ON be.environment_code = bte.environment_code
      WHERE bte.test_id = $1
      ORDER BY be.display_order, be.environment_code
    `,
    [testId],
  );
  return result.rows.map(sanitizeEnvironment);
}

async function loadTestDetailBy(column, value, { includeDisabled = true } = {}) {
  const allowedColumns = new Set(['bt.test_id', 'bt.test_code']);
  if (!allowedColumns.has(column)) throw new Error('Unsafe Browser Test lookup column.');
  const result = await query(
    `${TEST_SELECT}
     WHERE ${column} = $1
       ${includeDisabled ? '' : 'AND bt.enabled = TRUE AND btc.enabled = TRUE'}
     LIMIT 1`,
    [value],
  );
  if (!result.rows[0]) return null;
  const test = sanitizeTestRow(result.rows[0]);
  test.parameters = await loadTestParameters(test.testId);
  test.environments = await loadTestEnvironments(test.testId);
  return test;
}

async function getBrowserTestByCode(testCode, options = {}) {
  return loadTestDetailBy('bt.test_code', normalizeTestCode(testCode), options);
}

async function getBrowserTestById(testId, options = {}) {
  return loadTestDetailBy('bt.test_id', normalizeUuid(testId, 'testId'), options);
}

async function listBrowserTests(filters = {}, { admin = false } = {}) {
  const values = [];
  const clauses = [];
  if (!admin) clauses.push('bt.enabled = TRUE', 'btc.enabled = TRUE');

  const search = normalizeText(filters.search || filters.query);
  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      bt.test_code ILIKE $${values.length}
      OR bt.name ILIKE $${values.length}
      OR bt.label ILIKE $${values.length}
      OR COALESCE(bt.description, '') ILIKE $${values.length}
    )`);
  }

  const categoryCode = normalizeText(filters.categoryCode).toLowerCase();
  if (categoryCode) {
    values.push(categoryCode);
    clauses.push(`btc.category_code = $${values.length}`);
  }

  const environmentCode = normalizeText(filters.environmentCode).toUpperCase();
  if (environmentCode) {
    values.push(environmentCode);
    clauses.push(`EXISTS (
      SELECT 1 FROM core.browser_test_environments e
      WHERE e.test_id = bt.test_id AND e.environment_code = $${values.length}
    )`);
  }

  if (admin && filters.enabled !== undefined && filters.enabled !== '') {
    values.push(normalizeBoolean(filters.enabled, true, 'enabled'));
    clauses.push(`bt.enabled = $${values.length}`);
  }

  const limit = normalizePageSize(filters.limit);
  const offset = normalizeOffset(filters.offset);
  values.push(limit, offset);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await query(
    `${TEST_SELECT}
     ${where}
     ORDER BY btc.display_order, bt.display_order, bt.label, bt.test_code
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    items: result.rows.map(sanitizeTestRow),
    limit,
    offset,
  };
}

async function getAdminOptions() {
  const [categories, repositories, risks, paramTypes, optionSources, environments, permissions] = await Promise.all([
    query(`SELECT * FROM core.browser_test_categories ORDER BY display_order, label`),
    query(`SELECT repo_id, repo_code, repo_name, active FROM core.repositories ORDER BY display_order, repo_name`),
    query(`SELECT risk_code, risk_name, risk_rank, active FROM core.risk_levels ORDER BY risk_rank`),
    query(`SELECT param_type_code, param_type_name, description, active FROM core.param_types ORDER BY param_type_name`),
    query(`SELECT option_source_code, option_source_name, description, active FROM core.option_sources ORDER BY option_source_name`),
    query(`SELECT * FROM core.browser_environments ORDER BY display_order, environment_name`),
    query(`
      SELECT permission_code, resource, action, description, active
      FROM auth.permissions
      WHERE active = TRUE
      ORDER BY permission_code
    `),
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
  };
}

function normalizeTestDefinition(body = {}, { partial = false } = {}) {
  const normalized = {
    testCode: partial && body.testCode === undefined ? undefined : normalizeTestCode(body.testCode),
    categoryId: partial && body.categoryId === undefined ? undefined : normalizeUuid(body.categoryId, 'categoryId'),
    name: partial && body.name === undefined ? undefined : normalizeText(body.name),
    label: partial && body.label === undefined ? undefined : normalizeText(body.label),
    description: partial && body.description === undefined ? undefined : normalizeOptionalText(body.description),
    scriptRepoId: partial && body.scriptRepoId === undefined ? undefined : normalizeUuid(body.scriptRepoId, 'scriptRepoId'),
    scriptPath: partial && body.scriptPath === undefined ? undefined : normalizeBrowserSpecPath(body.scriptPath),
    browserType: partial && body.browserType === undefined ? undefined : normalizeBrowserType(body.browserType),
    defaultEnvironmentCode:
      partial && body.defaultEnvironmentCode === undefined
        ? undefined
        : normalizeEnvironmentCode(body.defaultEnvironmentCode || 'LOCAL'),
    timeoutSeconds:
      partial && body.timeoutSeconds === undefined
        ? undefined
        : normalizeInteger(body.timeoutSeconds, 60, 'timeoutSeconds', 1, 3600),
    retryCount:
      partial && body.retryCount === undefined
        ? undefined
        : normalizeInteger(body.retryCount, 0, 'retryCount', 0, 3),
    grepPattern: partial && body.grepPattern === undefined ? undefined : normalizeOptionalText(body.grepPattern),
    permissionCode:
      partial && body.permissionCode === undefined
        ? undefined
        : normalizeOptionalText(body.permissionCode) || 'BROWSER_TEST_RUN',
    riskCode:
      partial && body.riskCode === undefined
        ? undefined
        : normalizeText(body.riskCode, 'low').toLowerCase(),
    requiresConfirmation:
      partial && body.requiresConfirmation === undefined
        ? undefined
        : normalizeBoolean(body.requiresConfirmation, false, 'requiresConfirmation'),
    confirmationText:
      partial && body.confirmationText === undefined
        ? undefined
        : normalizeOptionalText(body.confirmationText),
    displayOrder:
      partial && body.displayOrder === undefined
        ? undefined
        : normalizeInteger(body.displayOrder, 999, 'displayOrder', 0, 1000000),
    enabled:
      partial && body.enabled === undefined
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

  const requiresConfirmation = normalized.requiresConfirmation ?? body.requiresConfirmation;
  if (requiresConfirmation === true && normalized.confirmationText !== undefined && !normalized.confirmationText) {
    throw createHttpError(400, 'confirmationText is required when confirmation is enabled.');
  }

  return normalized;
}

async function createBrowserTest({ body = {}, actor = null }) {
  const definition = normalizeTestDefinition(body);
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
      `
        INSERT INTO core.browser_tests (
          category_id, test_code, name, label, description,
          script_repo_id, script_path, browser_type, default_environment_code,
          timeout_seconds, retry_count, grep_pattern, permission_code, risk_code,
          requires_confirmation, confirmation_text, display_order, enabled,
          managed_by_skycommand, registered_at, registered_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE,CURRENT_TIMESTAMP,$19
        )
        RETURNING test_id
      `,
      [
        definition.categoryId,
        definition.testCode,
        definition.name,
        definition.label,
        definition.description,
        definition.scriptRepoId,
        definition.scriptPath,
        definition.browserType,
        definition.defaultEnvironmentCode,
        definition.timeoutSeconds,
        definition.retryCount,
        definition.grepPattern,
        definition.permissionCode,
        definition.riskCode,
        definition.requiresConfirmation,
        definition.confirmationText,
        definition.displayOrder,
        definition.enabled,
        actor?.userId || actor?.user_id || null,
      ],
    );
    const testId = result.rows[0].test_id;
    await replaceEnvironmentsWithClient(client, testId, environments, definition.defaultEnvironmentCode);
    if (Array.isArray(body.parameters)) {
      await replaceParametersWithClient(client, testId, body.parameters);
    }
    await client.query('COMMIT');
    return getBrowserTestById(testId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      throw createHttpError(409, 'A Browser Test with that testCode already exists.', {
        code: 'BROWSER_TEST_CODE_EXISTS',
        testCode: definition.testCode,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateBrowserTest({ testId, body = {} }) {
  const id = normalizeUuid(testId, 'testId');
  const definition = normalizeTestDefinition(body, { partial: true });
  const fieldMap = {
    testCode: 'test_code',
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
    grepPattern: 'grep_pattern',
    permissionCode: 'permission_code',
    riskCode: 'risk_code',
    requiresConfirmation: 'requires_confirmation',
    confirmationText: 'confirmation_text',
    displayOrder: 'display_order',
    enabled: 'enabled',
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `
        SELECT requires_confirmation, confirmation_text, default_environment_code
        FROM core.browser_tests
        WHERE test_id = $1
        FOR UPDATE
      `,
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) throw createHttpError(404, 'Browser Test not found.');

    const effectiveRequiresConfirmation =
      definition.requiresConfirmation === undefined
        ? toBoolean(current.requires_confirmation)
        : definition.requiresConfirmation;
    const effectiveConfirmationText =
      definition.confirmationText === undefined
        ? normalizeOptionalText(current.confirmation_text)
        : definition.confirmationText;
    if (effectiveRequiresConfirmation && !effectiveConfirmationText) {
      throw createHttpError(400, 'confirmationText is required when confirmation is enabled.');
    }

    if (definition.defaultEnvironmentCode !== undefined) {
      const environmentResult = await client.query(
        `
          SELECT environment_code
          FROM core.browser_environments
          WHERE environment_code = $1
            AND enabled = TRUE
        `,
        [definition.defaultEnvironmentCode],
      );
      if (!environmentResult.rows[0]) {
        throw createHttpError(
          400,
          `Browser environment ${definition.defaultEnvironmentCode} is not registered or enabled.`,
        );
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
      await client.query(
        `UPDATE core.browser_tests SET ${assignments.join(', ')} WHERE test_id = $${values.length}`,
        values,
      );
    }

    if (definition.defaultEnvironmentCode !== undefined) {
      await client.query(
        `
          INSERT INTO core.browser_test_environments (test_id, environment_code)
          VALUES ($1, $2)
          ON CONFLICT (test_id, environment_code) DO NOTHING
        `,
        [id, definition.defaultEnvironmentCode],
      );
    }

    await client.query('COMMIT');
    return getBrowserTestById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      throw createHttpError(409, 'A Browser Test with that testCode already exists.');
    }
    throw error;
  } finally {
    client.release();
  }
}

function normalizeParameterDefinition(item = {}, index = 0) {
  const type = normalizeText(item.type || item.paramTypeCode, 'string').toLowerCase();
  if (!ALLOWED_PARAM_TYPES.has(type)) {
    throw createHttpError(400, `parameters[${index}].type is not supported.`);
  }
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
  if (parameter.type === 'json') {
    return typeof parameter.defaultValue === 'string'
      ? parameter.defaultValue
      : JSON.stringify(parameter.defaultValue);
  }
  if (parameter.type === 'boolean') {
    return normalizeBoolean(parameter.defaultValue, false, 'defaultValue') ? 'true' : 'false';
  }
  return String(parameter.defaultValue);
}

async function replaceParametersWithClient(client, testId, parameters) {
  if (!Array.isArray(parameters)) throw createHttpError(400, 'parameters must be an array.');
  const normalized = parameters.map(normalizeParameterDefinition);
  const names = normalized.map((parameter) => parameter.parameterName.toLowerCase());
  if (new Set(names).size !== names.length) throw createHttpError(400, 'Browser Test parameter names must be unique.');

  await client.query('DELETE FROM core.browser_test_parameters WHERE test_id = $1', [testId]);
  for (const parameter of normalized) {
    const result = await client.query(
      `
        INSERT INTO core.browser_test_parameters (
          test_id, parameter_name, label, param_type_code, prompt, required,
          default_value, option_source_code, display_order, enabled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING parameter_id
      `,
      [
        testId, parameter.parameterName, parameter.label, parameter.type, parameter.prompt,
        parameter.required, serializeDefaultValue(parameter), parameter.optionSourceCode,
        parameter.displayOrder, parameter.enabled,
      ],
    );
    const parameterId = result.rows[0].parameter_id;
    for (let index = 0; index < parameter.options.length; index += 1) {
      const option = parameter.options[index] || {};
      const label = normalizeText(option.label || option.optionLabel);
      const value = normalizeText(option.value ?? option.optionValue);
      if (!label || !value) throw createHttpError(400, `Option ${index + 1} for ${parameter.parameterName} requires label and value.`);
      await client.query(
        `INSERT INTO core.browser_test_parameter_options (parameter_id, option_label, option_value, display_order, enabled)
         VALUES ($1,$2,$3,$4,$5)`,
        [parameterId, label, value, normalizeInteger(option.displayOrder, index * 10 + 10, 'option.displayOrder', 0, 1000000), normalizeBoolean(option.enabled, true, 'option.enabled')],
      );
    }
  }
}

async function replaceBrowserTestParameters({ testId, parameters }) {
  const id = normalizeUuid(testId, 'testId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM core.browser_tests WHERE test_id = $1', [id]);
    if (!exists.rows[0]) throw createHttpError(404, 'Browser Test not found.');
    await replaceParametersWithClient(client, id, parameters);
    await client.query('COMMIT');
    return getBrowserTestById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function replaceEnvironmentsWithClient(client, testId, environmentCodes, defaultEnvironmentCode = null) {
  const normalized = normalizeStringArray(environmentCodes, 'environmentCodes', { uppercase: true }).map(normalizeEnvironmentCode);
  if (normalized.length === 0) throw createHttpError(400, 'At least one environmentCode is required.');
  if (defaultEnvironmentCode && !normalized.includes(defaultEnvironmentCode)) {
    throw createHttpError(400, 'The default Browser Test environment must remain in the allowed environment list.');
  }
  const environmentCheck = await client.query(
    'SELECT environment_code FROM core.browser_environments WHERE environment_code = ANY($1::text[]) AND enabled = TRUE',
    [normalized],
  );
  const found = new Set(environmentCheck.rows.map((row) => row.environment_code));
  const missing = normalized.filter((code) => !found.has(code));
  if (missing.length) throw createHttpError(400, `Unknown or disabled browser environment(s): ${missing.join(', ')}.`);
  await client.query('DELETE FROM core.browser_test_environments WHERE test_id = $1', [testId]);
  for (const environmentCode of normalized) {
    await client.query(
      'INSERT INTO core.browser_test_environments (test_id, environment_code) VALUES ($1,$2)',
      [testId, environmentCode],
    );
  }
}

async function replaceBrowserTestEnvironments({ testId, environmentCodes }) {
  const id = normalizeUuid(testId, 'testId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const testResult = await client.query('SELECT default_environment_code FROM core.browser_tests WHERE test_id = $1', [id]);
    if (!testResult.rows[0]) throw createHttpError(404, 'Browser Test not found.');
    await replaceEnvironmentsWithClient(client, id, environmentCodes, testResult.rows[0].default_environment_code);
    await client.query('COMMIT');
    return getBrowserTestById(id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateBrowserTestStatus({ testId, enabled }) {
  const id = normalizeUuid(testId, 'testId');
  const value = normalizeBoolean(enabled, true, 'enabled');
  const result = await query('UPDATE core.browser_tests SET enabled = $1 WHERE test_id = $2 RETURNING test_id', [value, id]);
  if (!result.rows[0]) throw createHttpError(404, 'Browser Test not found.');
  return getBrowserTestById(id);
}

async function validateRepositoryParameter(value) {
  const code = normalizeText(value);
  if (!code) return null;
  const result = await query(
    'SELECT repo_code FROM core.repositories WHERE active = TRUE AND (repo_code = $1 OR repo_id::text = $1) LIMIT 1',
    [code],
  );
  if (!result.rows[0]) throw createHttpError(400, `Repository parameter '${code}' is not registered or active.`);
  return result.rows[0].repo_code;
}

async function coerceParameter(parameter, rawValue) {
  const type = parameter.type;
  const label = parameter.label || parameter.parameterName;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    if (parameter.required && (parameter.defaultValue === null || parameter.defaultValue === undefined || parameter.defaultValue === '')) {
      throw createHttpError(400, `${label} is required.`, { parameterName: parameter.parameterName });
    }
    rawValue = parameter.defaultValue;
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  if (type === 'boolean') return normalizeBoolean(rawValue, false, label);
  if (type === 'number') {
    const number = Number(rawValue);
    if (!Number.isFinite(number)) throw createHttpError(400, `${label} must be numeric.`);
    return number;
  }
  if (type === 'json') {
    if (typeof rawValue === 'object') return rawValue;
    try { return JSON.parse(String(rawValue)); } catch (_error) {
      throw createHttpError(400, `${label} must contain valid JSON.`);
    }
  }
  if (type === 'repo') return validateRepositoryParameter(rawValue);

  const text = String(rawValue).trim();
  if (type === 'select' && parameter.options?.length) {
    const allowed = new Set(parameter.options.filter((option) => option.enabled).map((option) => option.value));
    if (!allowed.has(text)) throw createHttpError(400, `${label} must be one of the configured choices.`);
  }
  return text;
}

async function resolveBrowserTestParameters(test, supplied = {}) {
  if (supplied === undefined || supplied === null) supplied = {};
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw createHttpError(400, 'parameters must be a JSON object.');
  }
  const definitions = (test.parameters || []).filter((parameter) => parameter.enabled);
  const known = new Set(definitions.map((parameter) => parameter.parameterName));
  const unknown = Object.keys(supplied).filter((name) => !known.has(name));
  if (unknown.length) {
    throw createHttpError(400, `Unknown Browser Test parameter(s): ${unknown.join(', ')}.`, { unknownParameters: unknown });
  }
  const resolved = {};
  for (const parameter of definitions) {
    const value = await coerceParameter(parameter, supplied[parameter.parameterName]);
    if (value !== null) resolved[parameter.parameterName] = value;
  }
  return resolved;
}

async function resolveExecutionEnvironment(test, requestedEnvironmentCode) {
  const environmentCode = normalizeEnvironmentCode(requestedEnvironmentCode || test.defaultEnvironmentCode);
  const environment = (test.environments || []).find((item) => item.environmentCode === environmentCode && item.enabled);
  if (!environment) {
    throw createHttpError(400, `Browser Test '${test.testCode}' is not enabled for environment ${environmentCode}.`, {
      testCode: test.testCode,
      environmentCode,
    });
  }
  return environment;
}

function assertExecutionPermission(test, permissions) {
  if (!test.permissionCode) return;
  const codes = permissionCodeSet(permissions);
  if (!codes.has(test.permissionCode)) {
    throw createHttpError(403, 'Permission denied for this Browser Test.', {
      testCode: test.testCode,
      permissionCode: test.permissionCode,
    });
  }
}

function assertConfirmation(test, body = {}) {
  if (!test.requiresConfirmation) return;
  const confirmed = normalizeBoolean(body.confirmed ?? body.confirm, false, 'confirmed');
  if (!confirmed) {
    throw createHttpError(409, 'Browser Test confirmation is required.', {
      code: 'BROWSER_TEST_CONFIRMATION_REQUIRED',
      confirmationText: test.confirmationText,
    });
  }
}

function buildBrowserWorkflowId(testCode) {
  return `skycommand-browser-test-${testCode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function startRegisteredBrowserTest({ testCode, body = {}, permissions = [] }) {
  const test = await getBrowserTestByCode(testCode, { includeDisabled: false });
  if (!test) throw createHttpError(404, 'Browser Test not found.');
  if (test.scriptRepository.repoCode !== 'SkyCommand') {
    throw createHttpError(
      409,
      'The current Browser Worker can execute Browser Test source only from the SkyCommand repository.',
      {
        code: 'BROWSER_TEST_SOURCE_REPOSITORY_NOT_SUPPORTED',
        repository: test.scriptRepository.repoCode,
      },
    );
  }
  assertExecutionPermission(test, permissions);
  assertConfirmation(test, body);
  const environment = await resolveExecutionEnvironment(test, body.environmentCode);
  const parameters = await resolveBrowserTestParameters(test, body.parameters || {});
  const runtimeConfig = getBrowserRuntimeConfig();
  const connection = await Connection.connect({ address: runtimeConfig.temporalAddress });
  const client = new Client({ connection, namespace: runtimeConfig.temporalNamespace });
  const workflowId = buildBrowserWorkflowId(test.testCode);
  try {
    const handle = await client.workflow.start('browserExecutionWorkflow', {
      taskQueue: runtimeConfig.taskQueue,
      workflowId,
      args: [{
        executionType: 'TEST',
        testCode: test.testCode,
        testPath: test.scriptPath,
        grep: test.grepPattern,
        browserType: test.browserType,
        environmentCode: environment.environmentCode,
        baseUrl: environment.baseUrl,
        timeoutMs: test.timeoutSeconds * 1000,
        retryCount: test.retryCount,
        parameters,
      }],
    });
    return {
      test,
      execution: {
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId || null,
        status: 'STARTED',
        taskQueue: runtimeConfig.taskQueue,
        environmentCode: environment.environmentCode,
        parameters,
      },
    };
  } finally {
    await connection.close();
  }
}

function temporalStatusName(status) {
  if (!status) return 'UNKNOWN';
  if (typeof status === 'string') return status.toUpperCase();
  if (status.name) return String(status.name).toUpperCase();
  const map = { 1: 'RUNNING', 2: 'COMPLETED', 3: 'FAILED', 4: 'CANCELED', 5: 'TERMINATED', 6: 'CONTINUED_AS_NEW', 7: 'TIMED_OUT' };
  return map[status] || String(status).toUpperCase();
}

async function getBrowserTestRun(workflowId) {
  const id = normalizeText(workflowId);
  if (!id || !/^skycommand-browser-test-[A-Za-z0-9_-]+$/.test(id)) {
    throw createHttpError(400, 'Invalid Browser Test workflowId.');
  }
  const runtimeConfig = getBrowserRuntimeConfig();
  const connection = await Connection.connect({ address: runtimeConfig.temporalAddress });
  const client = new Client({ connection, namespace: runtimeConfig.temporalNamespace });
  try {
    const handle = client.workflow.getHandle(id);
    const description = await handle.describe();
    const status = temporalStatusName(description.status);
    let result = null;
    if (status === 'COMPLETED') result = await handle.result();
    return {
      workflowId: id,
      runId: description.runId || description.execution?.runId || null,
      status,
      startTime: description.startTime || null,
      closeTime: description.closeTime || null,
      result,
    };
  } catch (error) {
    if (/not found/i.test(error.message || '')) throw createHttpError(404, 'Browser Test run not found.');
    throw error;
  } finally {
    await connection.close();
  }
}

module.exports = {
  ALLOWED_BROWSER_TYPES,
  createBrowserTest,
  createHttpError,
  getAdminOptions,
  getBrowserTestByCode,
  getBrowserTestById,
  getBrowserTestRun,
  listBrowserTests,
  normalizeBrowserSpecPath,
  normalizeTestCode,
  replaceBrowserTestEnvironments,
  replaceBrowserTestParameters,
  resolveBrowserTestParameters,
  startRegisteredBrowserTest,
  updateBrowserTest,
  updateBrowserTestStatus,
};
