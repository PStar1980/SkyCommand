const path = require('path');
const { pool, query } = require('../../../../packages/db/src/connection');

const CORE_APP_CODE = String(process.env.SKYCOMMAND_CORE_APP_CODE || process.env.SKYSERVER_CORE_APP_CODE || 'SKYSERVER_CORE')
  .trim()
  .toUpperCase();
const TOOL_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTPUT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.v[1-9][0-9]*)?$/;
const ADAPTER_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CONTRACT_VERSION_PATTERN = /^[a-z][a-z0-9_]*(?:\.v[1-9][0-9]*)?$/;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeRequiredString(value, label) {
  const text = String(value ?? '').trim();

  if (!text) {
    throw createHttpError(400, `${label} is required.`);
  }

  return text;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeBoolean(value, fallback, label) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }

  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }

  throw createHttpError(400, `${label} must be true or false.`);
}

function normalizeInteger(value, fallback, label, { minimum = 0, maximum = 1000000 } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const numberValue = Number.parseInt(value, 10);

  if (!Number.isInteger(numberValue) || numberValue < minimum || numberValue > maximum) {
    throw createHttpError(400, `${label} must be an integer between ${minimum} and ${maximum}.`);
  }

  return numberValue;
}

function normalizeUuid(value, label) {
  const uuid = normalizeRequiredString(value, label);

  if (!UUID_PATTERN.test(uuid)) {
    throw createHttpError(400, `${label} must be a valid UUID.`);
  }

  return uuid;
}

function normalizeToolCode(value) {
  const toolCode = normalizeRequiredString(value, 'toolCode').toLowerCase();

  if (!TOOL_CODE_PATTERN.test(toolCode)) {
    throw createHttpError(
      400,
      'toolCode must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.',
    );
  }

  return toolCode;
}

function normalizeParameterName(value) {
  const parameterName = normalizeRequiredString(value, 'parameterName');

  if (!PARAMETER_NAME_PATTERN.test(parameterName)) {
    throw createHttpError(
      400,
      'parameterName must start with a letter and contain only letters, numbers, and underscores.',
    );
  }

  return parameterName;
}

function normalizeCode(value, label, { uppercase = false } = {}) {
  const text = normalizeRequiredString(value, label);
  return uppercase ? text.toUpperCase() : text.toLowerCase();
}

function normalizeRepoRelativePath(value, label) {
  const rawPath = normalizeRequiredString(value, label).replace(/\\/g, '/');

  if (path.posix.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath)) {
    throw createHttpError(400, `${label} must be repository-relative.`);
  }

  const normalizedPath = path.posix.normalize(rawPath);
  const segments = normalizedPath.split('/');

  if (
    normalizedPath === '.' ||
    normalizedPath.startsWith('../') ||
    segments.includes('..') ||
    rawPath.includes('\0')
  ) {
    throw createHttpError(400, `${label} contains an unsafe repository-relative path.`);
  }

  return normalizedPath.replace(/^\.\//, '');
}

function normalizeOptionalRepoRelativePath(value, label) {
  const text = normalizeOptionalString(value);
  return text ? normalizeRepoRelativePath(text, label) : null;
}

function normalizeOutputType(value) {
  const outputType = normalizeOptionalString(value);

  if (!outputType) {
    return null;
  }

  if (!OUTPUT_TYPE_PATTERN.test(outputType)) {
    throw createHttpError(
      400,
      'outputType must use a lowercase contract identifier such as example_summary.v1.',
    );
  }

  return outputType;
}

function normalizeSha256(value, label = 'fileHash') {
  const hash = normalizeOptionalString(value);

  if (!hash) {
    return null;
  }

  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw createHttpError(400, `${label} must be a SHA-256 hex digest.`);
  }

  return hash.toLowerCase();
}

function normalizeStringArray(value, label, { uppercase = false, lowercase = false } = {}) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createHttpError(400, `${label} must be an array.`);
  }

  const normalized = value.map((item) => {
    const text = normalizeRequiredString(item, label);

    if (uppercase) {
      return text.toUpperCase();
    }

    if (lowercase) {
      return text.toLowerCase();
    }

    return text;
  });

  return [...new Set(normalized)];
}

function normalizeJsonObject(value, label) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  let parsed = value;

  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_error) {
      throw createHttpError(400, `${label} must contain valid JSON.`);
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createHttpError(400, `${label} must be a JSON object.`);
  }

  return parsed;
}

function normalizeIngestionProfile(value) {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'ingestionProfile must be an object or null.');
  }

  const adapterCode = normalizeRequiredString(value.adapterCode, 'ingestionProfile.adapterCode')
    .toUpperCase();
  const contractVersion = normalizeRequiredString(
    value.contractVersion || 'ingestion_run_summary.v1',
    'ingestionProfile.contractVersion',
  ).toLowerCase();

  if (!ADAPTER_CODE_PATTERN.test(adapterCode)) {
    throw createHttpError(
      400,
      'ingestionProfile.adapterCode must start with an uppercase letter and contain only uppercase letters, numbers, and underscores.',
    );
  }

  if (!CONTRACT_VERSION_PATTERN.test(contractVersion)) {
    throw createHttpError(
      400,
      'ingestionProfile.contractVersion must use a lowercase contract identifier such as ingestion_run_summary.v1.',
    );
  }

  return {
    dataDomainId: normalizeUuid(
      value.dataDomainId || value.domainId,
      'ingestionProfile.dataDomainId',
    ),
    sourceId: normalizeUuid(value.sourceId, 'ingestionProfile.sourceId'),
    adapterCode,
    contractVersion,
    supportsIncremental: normalizeBoolean(
      value.supportsIncremental,
      false,
      'ingestionProfile.supportsIncremental',
    ),
    supportsSelectedAssets: normalizeBoolean(
      value.supportsSelectedAssets,
      false,
      'ingestionProfile.supportsSelectedAssets',
    ),
    supportsBackfill: normalizeBoolean(
      value.supportsBackfill,
      false,
      'ingestionProfile.supportsBackfill',
    ),
    supportsRevisions: normalizeBoolean(
      value.supportsRevisions,
      false,
      'ingestionProfile.supportsRevisions',
    ),
    supportsResume: normalizeBoolean(
      value.supportsResume,
      false,
      'ingestionProfile.supportsResume',
    ),
    supportsDryRun: normalizeBoolean(
      value.supportsDryRun,
      false,
      'ingestionProfile.supportsDryRun',
    ),
    configuration: normalizeJsonObject(
      value.configuration,
      'ingestionProfile.configuration',
    ),
    active: normalizeBoolean(value.active, true, 'ingestionProfile.active'),
  };
}

function getActorUserId(actor) {
  return actor?.userId || actor?.user_id || actor?.id || null;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function sanitizeToolListRow(row) {
  return {
    toolId: row.tool_id,
    toolCode: row.tool_code,
    name: row.name,
    label: row.label,
    description: row.description,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    categoryKindCode: row.category_kind_code || 'GENERAL',
    scriptRepoId: row.script_repo_id,
    scriptRepoCode: row.script_repo_code,
    scriptRepoName: row.script_repo_name,
    scriptPath: row.script_path,
    runtimeCode: row.runtime_code,
    runtimeName: row.runtime_name,
    permissionCode: row.permission_code,
    riskCode: row.risk_code,
    riskName: row.risk_name,
    riskRank: Number(row.risk_rank || 0),
    requiresConfirmation: toBoolean(row.requires_confirmation),
    capturesOutput: toBoolean(row.captures_output),
    allowParams: toBoolean(row.allow_params),
    displayOrder: Number(row.display_order || 0),
    enabled: toBoolean(row.enabled),
    outputType: row.output_type || null,
    outputSchemaPath: row.output_schema_path || null,
    managedBySkyCommand: toBoolean(row.managed_by_skycommand),
    ingestionProfileConfigured: toBoolean(row.ingestion_profile_configured),
    ingestionProfileActive:
      row.ingestion_profile_active === null || row.ingestion_profile_active === undefined
        ? null
        : toBoolean(row.ingestion_profile_active),
    ingestionDomainCode: row.ingestion_domain_code || null,
    ingestionSourceCode: row.ingestion_source_code || null,
    ingestionAdapterCode: row.ingestion_adapter_code || null,
    ingestionContractVersion: row.ingestion_contract_version || null,
    parameterCount: Number(row.parameter_count || 0),
    visibility: row.visibility_channels || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeIngestionProfile(row) {
  if (!row) {
    return null;
  }

  return {
    dataDomainId: row.data_domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    sourceId: row.source_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    adapterCode: row.adapter_code,
    contractVersion: row.contract_version,
    supportsIncremental: toBoolean(row.supports_incremental),
    supportsSelectedAssets: toBoolean(row.supports_selected_assets),
    supportsBackfill: toBoolean(row.supports_backfill),
    supportsRevisions: toBoolean(row.supports_revisions),
    supportsResume: toBoolean(row.supports_resume),
    supportsDryRun: toBoolean(row.supports_dry_run),
    configuration: row.configuration || {},
    active: toBoolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sanitizeParameter(row, options = []) {
  return {
    parameterId: row.parameter_id,
    parameterName: row.parameter_name,
    label: row.label,
    paramTypeCode: row.param_type_code,
    prompt: row.prompt,
    required: toBoolean(row.required),
    defaultValue: row.default_value,
    optionSourceCode: row.option_source_code,
    displayOrder: Number(row.display_order || 0),
    enabled: toBoolean(row.enabled),
    options,
  };
}

function sanitizeToolDetail(row, visibility, parameters, ingestionProfile = null) {
  return {
    ...sanitizeToolListRow(row),
    confirmationText: row.confirmation_text || null,
    originalFilename: row.original_filename || null,
    descriptorPath: row.descriptor_path || null,
    registeredAt: row.registered_at || null,
    registeredBy: row.registered_by || null,
    registeredByLabel: row.registered_by_label || null,
    fileHash: row.file_hash || null,
    visibility,
    parameters,
    ingestionProfile,
  };
}

function getPagination(filters = {}) {
  return {
    limit: normalizeInteger(filters.limit, 100, 'limit', { minimum: 1, maximum: 500 }),
    offset: normalizeInteger(filters.offset, 0, 'offset', { minimum: 0, maximum: 1000000 }),
  };
}

function buildWhereClause(filters = {}) {
  const clauses = ['application.app_code = $1'];
  const values = [CORE_APP_CODE];

  function addEquals(columnName, value, transform = (item) => item) {
    if (value === undefined || value === null || value === '') {
      return;
    }

    values.push(transform(value));
    clauses.push(`${columnName} = $${values.length}`);
  }

  const searchText = String(filters.q || '').trim();

  if (searchText) {
    values.push(`%${searchText}%`);
    clauses.push(`(
      tool.tool_code ILIKE $${values.length}
      OR tool.name ILIKE $${values.length}
      OR tool.label ILIKE $${values.length}
      OR COALESCE(tool.description, '') ILIKE $${values.length}
      OR category.label ILIKE $${values.length}
      OR repository.repo_name ILIKE $${values.length}
    )`);
  }

  addEquals('category.category_code', filters.categoryCode, (value) => String(value).trim());
  addEquals('category.category_kind_code', filters.categoryKindCode, (value) =>
    String(value).trim().toUpperCase(),
  );
  addEquals('tool.runtime_code', filters.runtimeCode, (value) =>
    String(value).trim().toLowerCase(),
  );
  addEquals('tool.permission_code', filters.permissionCode, (value) =>
    String(value).trim().toUpperCase(),
  );
  addEquals('tool.risk_code', filters.riskCode, (value) => String(value).trim().toLowerCase());

  if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
    values.push(normalizeBoolean(filters.enabled, true, 'enabled'));
    clauses.push(`tool.enabled = $${values.length}`);
  }

  return {
    clause: `WHERE ${clauses.join(' AND ')}`,
    values,
  };
}

async function listTools(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const where = buildWhereClause(filters);
  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM core.tools tool
      JOIN core.tool_categories category ON category.category_id = tool.category_id
      JOIN core.applications application ON application.app_id = category.app_id
      JOIN core.repositories repository ON repository.repo_id = tool.script_repo_id
      ${where.clause}
    `,
    where.values,
  );

  const values = [...where.values, limit, offset];
  const rowsResult = await query(
    `
      SELECT
        tool.tool_id,
        tool.tool_code,
        tool.name,
        tool.label,
        tool.description,
        tool.category_id,
        category.category_code,
        category.label AS category_label,
        category.category_kind_code,
        tool.script_repo_id,
        repository.repo_code AS script_repo_code,
        repository.repo_name AS script_repo_name,
        tool.script_path,
        tool.runtime_code,
        runtime.runtime_name,
        tool.permission_code,
        tool.risk_code,
        risk.risk_name,
        risk.risk_rank,
        tool.requires_confirmation,
        tool.captures_output,
        tool.allow_params,
        tool.display_order,
        tool.enabled,
        tool.output_type,
        tool.output_schema_path,
        tool.managed_by_skycommand,
        (ingestion_profile.tool_id IS NOT NULL) AS ingestion_profile_configured,
        ingestion_profile.active AS ingestion_profile_active,
        ingestion_domain.domain_code AS ingestion_domain_code,
        ingestion_source.source_code AS ingestion_source_code,
        ingestion_profile.adapter_code AS ingestion_adapter_code,
        ingestion_profile.contract_version AS ingestion_contract_version,
        tool.created_at,
        tool.updated_at,
        COALESCE(parameter_counts.parameter_count, 0)::int AS parameter_count,
        COALESCE(visibility.visibility_channels, ARRAY[]::text[]) AS visibility_channels
      FROM core.tools tool
      JOIN core.tool_categories category ON category.category_id = tool.category_id
      JOIN core.applications application ON application.app_id = category.app_id
      JOIN core.repositories repository ON repository.repo_id = tool.script_repo_id
      JOIN core.runtimes runtime ON runtime.runtime_code = tool.runtime_code
      JOIN core.risk_levels risk ON risk.risk_code = tool.risk_code
      LEFT JOIN data.ingestion_tool_profiles ingestion_profile
        ON ingestion_profile.tool_id = tool.tool_id
      LEFT JOIN data.domains ingestion_domain
        ON ingestion_domain.domain_id = ingestion_profile.data_domain_id
      LEFT JOIN data.sources ingestion_source
        ON ingestion_source.source_id = ingestion_profile.source_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS parameter_count
        FROM core.tool_parameters parameter
        WHERE parameter.tool_id = tool.tool_id
          AND parameter.enabled = TRUE
      ) parameter_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(tool_visibility.channel_code ORDER BY tool_visibility.channel_code) AS visibility_channels
        FROM core.tool_visibility tool_visibility
        WHERE tool_visibility.tool_id = tool.tool_id
      ) visibility ON TRUE
      ${where.clause}
      ORDER BY category.display_order, tool.display_order, tool.label, tool.tool_code
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values,
  );

  return {
    total: Number(countResult.rows[0]?.total || 0),
    limit,
    offset,
    items: rowsResult.rows.map(sanitizeToolListRow),
  };
}

async function getToolRow(client, toolId, { forUpdate = false } = {}) {
  const normalizedToolId = normalizeUuid(toolId, 'toolId');
  const result = await client.query(
    `
      SELECT
        tool.tool_id,
        tool.tool_code,
        tool.name,
        tool.label,
        tool.description,
        tool.category_id,
        category.category_code,
        category.label AS category_label,
        category.category_kind_code,
        tool.script_repo_id,
        repository.repo_code AS script_repo_code,
        repository.repo_name AS script_repo_name,
        tool.script_path,
        tool.runtime_code,
        runtime.runtime_name,
        tool.permission_code,
        tool.risk_code,
        risk.risk_name,
        risk.risk_rank,
        tool.requires_confirmation,
        tool.confirmation_text,
        tool.captures_output,
        tool.allow_params,
        tool.display_order,
        tool.enabled,
        tool.output_type,
        tool.output_schema_path,
        tool.managed_by_skycommand,
        (ingestion_profile.tool_id IS NOT NULL) AS ingestion_profile_configured,
        ingestion_profile.active AS ingestion_profile_active,
        ingestion_domain.domain_code AS ingestion_domain_code,
        ingestion_source.source_code AS ingestion_source_code,
        ingestion_profile.adapter_code AS ingestion_adapter_code,
        ingestion_profile.contract_version AS ingestion_contract_version,
        tool.original_filename,
        tool.descriptor_path,
        tool.registered_at,
        tool.registered_by,
        tool.file_hash,
        tool.created_at,
        tool.updated_at,
        CASE
          WHEN registered_user.user_id IS NULL THEN NULL
          ELSE COALESCE(registered_user.display_name, registered_user.username, registered_user.email)
        END AS registered_by_label,
        (
          SELECT COUNT(*)::int
          FROM core.tool_parameters parameter
          WHERE parameter.tool_id = tool.tool_id
            AND parameter.enabled = TRUE
        ) AS parameter_count,
        ARRAY[]::text[] AS visibility_channels
      FROM core.tools tool
      JOIN core.tool_categories category ON category.category_id = tool.category_id
      JOIN core.applications application ON application.app_id = category.app_id
      JOIN core.repositories repository ON repository.repo_id = tool.script_repo_id
      JOIN core.runtimes runtime ON runtime.runtime_code = tool.runtime_code
      JOIN core.risk_levels risk ON risk.risk_code = tool.risk_code
      LEFT JOIN auth.users registered_user ON registered_user.user_id = tool.registered_by
      LEFT JOIN data.ingestion_tool_profiles ingestion_profile
        ON ingestion_profile.tool_id = tool.tool_id
      LEFT JOIN data.domains ingestion_domain
        ON ingestion_domain.domain_id = ingestion_profile.data_domain_id
      LEFT JOIN data.sources ingestion_source
        ON ingestion_source.source_id = ingestion_profile.source_id
      WHERE application.app_code = $1
        AND tool.tool_id = $2
      ${forUpdate ? 'FOR UPDATE OF tool' : ''}
    `,
    [CORE_APP_CODE, normalizedToolId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Tool not found.');
  }

  return result.rows[0];
}

async function getToolVisibility(client, toolId) {
  const result = await client.query(
    `
      SELECT channel_code
      FROM core.tool_visibility
      WHERE tool_id = $1
      ORDER BY channel_code
    `,
    [toolId],
  );

  return result.rows.map((row) => row.channel_code);
}

async function getToolParameters(client, toolId) {
  const parameterResult = await client.query(
    `
      SELECT
        parameter_id,
        parameter_name,
        label,
        param_type_code,
        prompt,
        required,
        default_value,
        option_source_code,
        display_order,
        enabled
      FROM core.tool_parameters
      WHERE tool_id = $1
      ORDER BY display_order, parameter_name
    `,
    [toolId],
  );

  if (parameterResult.rowCount === 0) {
    return [];
  }

  const parameterIds = parameterResult.rows.map((row) => row.parameter_id);
  const optionResult = await client.query(
    `
      SELECT
        option_id,
        parameter_id,
        option_label,
        option_value,
        display_order,
        enabled
      FROM core.tool_parameter_options
      WHERE parameter_id = ANY($1::uuid[])
      ORDER BY parameter_id, display_order, option_label
    `,
    [parameterIds],
  );
  const optionsByParameterId = new Map();

  for (const option of optionResult.rows) {
    if (!optionsByParameterId.has(option.parameter_id)) {
      optionsByParameterId.set(option.parameter_id, []);
    }

    optionsByParameterId.get(option.parameter_id).push({
      optionId: option.option_id,
      label: option.option_label,
      value: option.option_value,
      displayOrder: Number(option.display_order || 0),
      enabled: toBoolean(option.enabled),
    });
  }

  return parameterResult.rows.map((row) =>
    sanitizeParameter(row, optionsByParameterId.get(row.parameter_id) || []),
  );
}

async function getToolIngestionProfile(client, toolId) {
  const result = await client.query(
    `
      SELECT
        profile.data_domain_id,
        domain.domain_code,
        domain.name AS domain_name,
        profile.source_id,
        source.source_code,
        source.name AS source_name,
        profile.adapter_code,
        profile.contract_version,
        profile.supports_incremental,
        profile.supports_selected_assets,
        profile.supports_backfill,
        profile.supports_revisions,
        profile.supports_resume,
        profile.supports_dry_run,
        profile.configuration,
        profile.active,
        profile.created_at,
        profile.updated_at
      FROM data.ingestion_tool_profiles profile
      JOIN data.domains domain ON domain.domain_id = profile.data_domain_id
      JOIN data.sources source ON source.source_id = profile.source_id
      WHERE profile.tool_id = $1
    `,
    [toolId],
  );

  return result.rowCount > 0 ? sanitizeIngestionProfile(result.rows[0]) : null;
}

async function getTool(toolId) {
  const client = await pool.connect();

  try {
    const row = await getToolRow(client, toolId);
    const [visibility, parameters, ingestionProfile] = await Promise.all([
      getToolVisibility(client, row.tool_id),
      getToolParameters(client, row.tool_id),
      getToolIngestionProfile(client, row.tool_id),
    ]);

    return {
      tool: sanitizeToolDetail(row, visibility, parameters, ingestionProfile),
    };
  } finally {
    client.release();
  }
}

async function getOptions() {
  const [
    categories,
    repositories,
    runtimes,
    permissions,
    risks,
    paramTypes,
    optionSources,
    channels,
    dataDomains,
    dataSources,
  ] = await Promise.all([
    query(
      `
          SELECT
            category.category_id,
            category.category_code,
            category.label,
            category.description,
            category.category_kind_code,
            category.display_order
          FROM core.tool_categories category
          JOIN core.applications application ON application.app_id = category.app_id
          WHERE application.app_code = $1
            AND category.enabled = TRUE
          ORDER BY category.display_order, category.label
        `,
      [CORE_APP_CODE],
    ),
    query(
      `
          SELECT repo_id, repo_code, repo_name, display_order
          FROM core.repositories
          WHERE active = TRUE
          ORDER BY display_order, repo_name, repo_code
        `,
    ),
    query(
      `
          SELECT runtime_code, runtime_name, executable, description
          FROM core.runtimes
          WHERE active = TRUE
          ORDER BY runtime_name, runtime_code
        `,
    ),
    query(
      `
          SELECT permission_code, resource, action, description
          FROM auth.permissions
          WHERE active = TRUE
          ORDER BY permission_code
        `,
    ),
    query(
      `
          SELECT risk_code, risk_name, risk_rank, description
          FROM core.risk_levels
          WHERE active = TRUE
          ORDER BY risk_rank, risk_code
        `,
    ),
    query(
      `
          SELECT param_type_code, param_type_name, description
          FROM core.param_types
          WHERE active = TRUE
          ORDER BY param_type_name, param_type_code
        `,
    ),
    query(
      `
          SELECT option_source_code, option_source_name, description
          FROM core.option_sources
          WHERE active = TRUE
          ORDER BY option_source_name, option_source_code
        `,
    ),
    query(
      `
          SELECT channel_code, channel_name, description
          FROM core.visibility_channels
          WHERE active = TRUE
          ORDER BY channel_name, channel_code
        `,
    ),
    query(
      `
          SELECT domain_id, domain_code, name, description, active
          FROM data.domains
          WHERE active = TRUE
          ORDER BY name, domain_code
        `,
    ),
    query(
      `
          SELECT
            source.source_id,
            source.source_code,
            source.name,
            source.provider_name,
            source.provider_type,
            source.description,
            source.domain_id,
            domain.domain_code
          FROM data.sources source
          JOIN data.domains domain ON domain.domain_id = source.domain_id
          WHERE source.active = TRUE
            AND domain.active = TRUE
          ORDER BY domain.name, source.name, source.source_code
        `,
    ),
  ]);

  return {
    appCode: CORE_APP_CODE,
    categories: categories.rows.map((row) => ({
      categoryId: row.category_id,
      categoryCode: row.category_code,
      categoryKindCode: row.category_kind_code || 'GENERAL',
      label: row.label,
      description: row.description,
      displayOrder: Number(row.display_order || 0),
    })),
    repositories: repositories.rows.map((row) => ({
      repoId: row.repo_id,
      repoCode: row.repo_code,
      repoName: row.repo_name,
      displayOrder: Number(row.display_order || 0),
    })),
    runtimes: runtimes.rows.map((row) => ({
      runtimeCode: row.runtime_code,
      runtimeName: row.runtime_name,
      executable: row.executable,
      description: row.description,
    })),
    permissions: permissions.rows.map((row) => ({
      permissionCode: row.permission_code,
      resource: row.resource,
      action: row.action,
      description: row.description,
    })),
    risks: risks.rows.map((row) => ({
      riskCode: row.risk_code,
      riskName: row.risk_name,
      riskRank: Number(row.risk_rank || 0),
      description: row.description,
    })),
    paramTypes: paramTypes.rows.map((row) => ({
      paramTypeCode: row.param_type_code,
      paramTypeName: row.param_type_name,
      description: row.description,
    })),
    optionSources: optionSources.rows.map((row) => ({
      optionSourceCode: row.option_source_code,
      optionSourceName: row.option_source_name,
      description: row.description,
    })),
    visibilityChannels: channels.rows.map((row) => ({
      channelCode: row.channel_code,
      channelName: row.channel_name,
      description: row.description,
    })),
    dataDomains: dataDomains.rows.map((row) => ({
      domainId: row.domain_id,
      domainCode: row.domain_code,
      name: row.name,
      description: row.description,
      active: toBoolean(row.active),
    })),
    dataSources: dataSources.rows.map((row) => ({
      sourceId: row.source_id,
      sourceCode: row.source_code,
      name: row.name,
      providerName: row.provider_name,
      providerType: row.provider_type,
      description: row.description,
      domainId: row.domain_id,
      domainCode: row.domain_code,
    })),
  };
}

function normalizeToolPayload(body = {}, { patch = false } = {}) {
  const payload = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

  if (!patch || has('toolCode')) {
    payload.toolCode = normalizeToolCode(body.toolCode);
  }

  if (!patch || has('name')) {
    payload.name = normalizeRequiredString(body.name, 'name');
  }

  if (!patch || has('label')) {
    payload.label = normalizeRequiredString(body.label, 'label');
  }

  if (!patch || has('description')) {
    payload.description = normalizeOptionalString(body.description);
  }

  if (!patch || has('categoryId')) {
    payload.categoryId = normalizeUuid(body.categoryId, 'categoryId');
  }

  if (!patch || has('scriptRepoId')) {
    payload.scriptRepoId = normalizeUuid(body.scriptRepoId, 'scriptRepoId');
  }

  if (!patch || has('scriptPath')) {
    payload.scriptPath = normalizeRepoRelativePath(body.scriptPath, 'scriptPath');
  }

  if (!patch || has('runtimeCode')) {
    payload.runtimeCode = normalizeCode(body.runtimeCode, 'runtimeCode');
  }

  if (!patch || has('permissionCode')) {
    payload.permissionCode = normalizeOptionalString(body.permissionCode)?.toUpperCase() || null;
  }

  if (!patch || has('riskCode')) {
    payload.riskCode = normalizeCode(body.riskCode, 'riskCode');
  }

  if (!patch || has('requiresConfirmation')) {
    payload.requiresConfirmation = normalizeBoolean(
      body.requiresConfirmation,
      false,
      'requiresConfirmation',
    );
  }

  if (!patch || has('confirmationText')) {
    payload.confirmationText = normalizeOptionalString(body.confirmationText);
  }

  if (!patch || has('capturesOutput')) {
    payload.capturesOutput = normalizeBoolean(body.capturesOutput, true, 'capturesOutput');
  }

  if (!patch || has('allowParams')) {
    payload.allowParams = normalizeBoolean(body.allowParams, false, 'allowParams');
  }

  if (!patch || has('displayOrder')) {
    payload.displayOrder = normalizeInteger(body.displayOrder, 999, 'displayOrder');
  }

  if (!patch || has('enabled')) {
    payload.enabled = normalizeBoolean(body.enabled, false, 'enabled');
  }

  if (!patch || has('outputType')) {
    payload.outputType = normalizeOutputType(body.outputType);
  }

  if (!patch || has('outputSchemaPath')) {
    payload.outputSchemaPath = normalizeOptionalRepoRelativePath(
      body.outputSchemaPath,
      'outputSchemaPath',
    );
  }

  if (!patch || has('visibility')) {
    payload.visibility = normalizeStringArray(body.visibility, 'visibility', { lowercase: true });
  }

  if (has('ingestionProfile')) {
    payload.ingestionProfile = normalizeIngestionProfile(body.ingestionProfile);
  }

  if (has('parameters')) {
    payload.parameters = normalizeParameters(body.parameters);
  }

  if (payload.requiresConfirmation === false) {
    payload.confirmationText = null;
  }

  if (!patch && payload.outputSchemaPath && !payload.outputType) {
    throw createHttpError(400, 'outputType is required when outputSchemaPath is configured.');
  }

  return payload;
}

function normalizeParameters(parameters) {
  if (!Array.isArray(parameters)) {
    throw createHttpError(400, 'parameters must be an array.');
  }

  const names = new Set();
  const displayOrders = new Set();

  return parameters.map((parameter, index) => {
    const parameterName = normalizeParameterName(parameter.parameterName || parameter.name);
    const displayOrder = normalizeInteger(
      parameter.displayOrder ?? index + 1,
      index + 1,
      'parameter.displayOrder',
      { minimum: 1, maximum: 100000 },
    );

    if (names.has(parameterName.toLowerCase())) {
      throw createHttpError(400, `Duplicate parameter name: ${parameterName}`);
    }

    if (displayOrders.has(displayOrder)) {
      throw createHttpError(400, `Duplicate parameter displayOrder: ${displayOrder}`);
    }

    names.add(parameterName.toLowerCase());
    displayOrders.add(displayOrder);

    const optionSourceCode =
      normalizeOptionalString(parameter.optionSourceCode)?.toLowerCase() || null;
    const options = normalizeParameterOptions(parameter.options || []);

    if (optionSourceCode && options.length > 0) {
      throw createHttpError(
        400,
        `${parameterName} cannot use both a dynamic option source and static choices.`,
      );
    }

    return {
      parameterName,
      label: normalizeRequiredString(parameter.label || parameterName, 'parameter.label'),
      paramTypeCode: normalizeCode(
        parameter.paramTypeCode || parameter.type || 'string',
        'parameter.paramTypeCode',
      ),
      prompt: normalizeOptionalString(parameter.prompt),
      required: normalizeBoolean(parameter.required, false, 'parameter.required'),
      defaultValue: normalizeOptionalString(parameter.defaultValue),
      optionSourceCode,
      displayOrder,
      enabled: normalizeBoolean(parameter.enabled, true, 'parameter.enabled'),
      options,
    };
  });
}

function normalizeParameterOptions(options) {
  if (!Array.isArray(options)) {
    throw createHttpError(400, 'parameter.options must be an array.');
  }

  const values = new Set();

  return options.map((option, index) => {
    const value = normalizeRequiredString(option.value ?? option.optionValue, 'option.value');

    if (values.has(value)) {
      throw createHttpError(400, `Duplicate static option value: ${value}`);
    }

    values.add(value);

    return {
      label: normalizeRequiredString(option.label ?? option.optionLabel ?? value, 'option.label'),
      value,
      displayOrder: normalizeInteger(
        option.displayOrder ?? index + 1,
        index + 1,
        'option.displayOrder',
        { minimum: 1, maximum: 100000 },
      ),
      enabled: normalizeBoolean(option.enabled, true, 'option.enabled'),
    };
  });
}

async function getCategoryMetadata(client, categoryId) {
  const result = await client.query(
    `
      SELECT
        category.category_id,
        category.category_code,
        category.label,
        category.category_kind_code
      FROM core.tool_categories category
      JOIN core.applications application ON application.app_id = category.app_id
      WHERE category.category_id = $1
        AND category.enabled = TRUE
        AND application.app_code = $2
    `,
    [categoryId, CORE_APP_CODE],
  );

  if (result.rowCount === 0) {
    throw createHttpError(400, 'categoryId is not an active SkyCommand Core category.');
  }

  return {
    categoryId: result.rows[0].category_id,
    categoryCode: result.rows[0].category_code,
    label: result.rows[0].label,
    categoryKindCode: result.rows[0].category_kind_code || 'GENERAL',
  };
}

async function getRawIngestionProfile(client, toolId) {
  const result = await client.query(
    `
      SELECT
        tool_id,
        data_domain_id,
        source_id,
        adapter_code,
        contract_version,
        supports_incremental,
        supports_selected_assets,
        supports_backfill,
        supports_revisions,
        supports_resume,
        supports_dry_run,
        configuration,
        active
      FROM data.ingestion_tool_profiles
      WHERE tool_id = $1
    `,
    [toolId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    dataDomainId: row.data_domain_id,
    sourceId: row.source_id,
    adapterCode: row.adapter_code,
    contractVersion: row.contract_version,
    supportsIncremental: toBoolean(row.supports_incremental),
    supportsSelectedAssets: toBoolean(row.supports_selected_assets),
    supportsBackfill: toBoolean(row.supports_backfill),
    supportsRevisions: toBoolean(row.supports_revisions),
    supportsResume: toBoolean(row.supports_resume),
    supportsDryRun: toBoolean(row.supports_dry_run),
    configuration: row.configuration || {},
    active: toBoolean(row.active),
  };
}

async function assertIngestionProfileReferences(client, profile) {
  if (!profile) {
    return;
  }

  const result = await client.query(
    `
      SELECT
        domain.domain_id,
        source.source_id
      FROM data.domains domain
      JOIN data.sources source ON source.domain_id = domain.domain_id
      WHERE domain.domain_id = $1
        AND source.source_id = $2
        AND domain.active = TRUE
        AND source.active = TRUE
    `,
    [profile.dataDomainId, profile.sourceId],
  );

  if (result.rowCount === 0) {
    throw createHttpError(
      400,
      'ingestionProfile source must be active and belong to the selected active data domain.',
      { code: 'INGESTION_PROFILE_SOURCE_DOMAIN_MISMATCH' },
    );
  }
}

function assertIngestionAssignment({ category, profile, enabled }) {
  const isIngestionCategory = category.categoryKindCode === 'INGESTION';

  if (isIngestionCategory && !profile) {
    throw createHttpError(
      400,
      'Tools assigned to an INGESTION category require a portable ingestion profile.',
      { code: 'INGESTION_PROFILE_REQUIRED' },
    );
  }

  if (!isIngestionCategory && profile) {
    throw createHttpError(
      400,
      'An ingestion profile may only be assigned to a tool in an INGESTION category.',
      { code: 'INGESTION_PROFILE_CATEGORY_KIND_REQUIRED' },
    );
  }

  if (isIngestionCategory && enabled && !profile.active) {
    throw createHttpError(
      400,
      'An enabled ingestion tool requires an active ingestion profile.',
      { code: 'INGESTION_PROFILE_ACTIVE_REQUIRED' },
    );
  }
}

async function assertReferences(client, payload) {
  const checks = [];

  if (payload.categoryId) {
    checks.push(
      client
        .query(
          `
            SELECT category.category_id
            FROM core.tool_categories category
            JOIN core.applications application ON application.app_id = category.app_id
            WHERE category.category_id = $1
              AND category.enabled = TRUE
              AND application.app_code = $2
          `,
          [payload.categoryId, CORE_APP_CODE],
        )
        .then((result) => {
          if (result.rowCount === 0) {
            throw createHttpError(400, 'categoryId is not an active SkyCommand Core category.');
          }
        }),
    );
  }

  if (payload.scriptRepoId) {
    checks.push(
      client
        .query('SELECT repo_id FROM core.repositories WHERE repo_id = $1 AND active = TRUE', [
          payload.scriptRepoId,
        ])
        .then((result) => {
          if (result.rowCount === 0) {
            throw createHttpError(400, 'scriptRepoId is not an active repository.');
          }
        }),
    );
  }

  if (payload.runtimeCode) {
    checks.push(
      client
        .query('SELECT runtime_code FROM core.runtimes WHERE runtime_code = $1 AND active = TRUE', [
          payload.runtimeCode,
        ])
        .then((result) => {
          if (result.rowCount === 0) {
            throw createHttpError(400, 'runtimeCode is not supported.');
          }
        }),
    );
  }

  if (payload.permissionCode) {
    checks.push(
      client
        .query(
          'SELECT permission_code FROM auth.permissions WHERE permission_code = $1 AND active = TRUE',
          [payload.permissionCode],
        )
        .then((result) => {
          if (result.rowCount === 0) {
            throw createHttpError(400, 'permissionCode is not active.');
          }
        }),
    );
  }

  if (payload.riskCode) {
    checks.push(
      client
        .query('SELECT risk_code FROM core.risk_levels WHERE risk_code = $1 AND active = TRUE', [
          payload.riskCode,
        ])
        .then((result) => {
          if (result.rowCount === 0) {
            throw createHttpError(400, 'riskCode is not active.');
          }
        }),
    );
  }

  if (payload.visibility) {
    checks.push(
      client
        .query(
          'SELECT channel_code FROM core.visibility_channels WHERE channel_code = ANY($1::text[]) AND active = TRUE',
          [payload.visibility],
        )
        .then((result) => {
          if (result.rowCount !== payload.visibility.length) {
            throw createHttpError(400, 'One or more visibility channels are invalid.');
          }
        }),
    );
  }

  if (payload.parameters) {
    const paramTypes = [...new Set(payload.parameters.map((parameter) => parameter.paramTypeCode))];
    const optionSources = [
      ...new Set(payload.parameters.map((parameter) => parameter.optionSourceCode).filter(Boolean)),
    ];

    checks.push(
      client
        .query(
          'SELECT param_type_code FROM core.param_types WHERE param_type_code = ANY($1::text[]) AND active = TRUE',
          [paramTypes],
        )
        .then((result) => {
          if (result.rowCount !== paramTypes.length) {
            throw createHttpError(400, 'One or more parameter types are invalid.');
          }
        }),
    );

    if (optionSources.length > 0) {
      checks.push(
        client
          .query(
            'SELECT option_source_code FROM core.option_sources WHERE option_source_code = ANY($1::text[]) AND active = TRUE',
            [optionSources],
          )
          .then((result) => {
            if (result.rowCount !== optionSources.length) {
              throw createHttpError(400, 'One or more option sources are invalid.');
            }
          }),
      );
    }
  }

  await Promise.all(checks);
  await assertIngestionProfileReferences(client, payload.ingestionProfile);
}

async function replaceVisibility(client, toolId, visibility) {
  await client.query('DELETE FROM core.tool_visibility WHERE tool_id = $1', [toolId]);

  for (const channelCode of visibility) {
    await client.query('INSERT INTO core.tool_visibility (tool_id, channel_code) VALUES ($1, $2)', [
      toolId,
      channelCode,
    ]);
  }
}

async function replaceParameters(client, toolId, parameters) {
  await client.query('DELETE FROM core.tool_parameters WHERE tool_id = $1', [toolId]);

  for (const parameter of parameters) {
    const parameterResult = await client.query(
      `
        INSERT INTO core.tool_parameters (
          tool_id,
          parameter_name,
          label,
          param_type_code,
          prompt,
          required,
          default_value,
          option_source_code,
          display_order,
          enabled
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING parameter_id
      `,
      [
        toolId,
        parameter.parameterName,
        parameter.label,
        parameter.paramTypeCode,
        parameter.prompt,
        parameter.required,
        parameter.defaultValue,
        parameter.optionSourceCode,
        parameter.displayOrder,
        parameter.enabled,
      ],
    );

    for (const option of parameter.options) {
      await client.query(
        `
          INSERT INTO core.tool_parameter_options (
            parameter_id,
            option_label,
            option_value,
            display_order,
            enabled
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          parameterResult.rows[0].parameter_id,
          option.label,
          option.value,
          option.displayOrder,
          option.enabled,
        ],
      );
    }
  }

  await client.query(
    `
      UPDATE core.tools
      SET allow_params = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE tool_id = $1
    `,
    [toolId, parameters.some((parameter) => parameter.enabled)],
  );
}

async function replaceIngestionProfile(client, toolId, profile) {
  if (!profile) {
    await client.query('DELETE FROM data.ingestion_tool_profiles WHERE tool_id = $1', [toolId]);
    return;
  }

  await client.query(
    `
      INSERT INTO data.ingestion_tool_profiles (
        tool_id,
        data_domain_id,
        source_id,
        adapter_code,
        contract_version,
        supports_incremental,
        supports_selected_assets,
        supports_backfill,
        supports_revisions,
        supports_resume,
        supports_dry_run,
        configuration,
        active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      ON CONFLICT (tool_id) DO UPDATE
      SET data_domain_id = EXCLUDED.data_domain_id,
          source_id = EXCLUDED.source_id,
          adapter_code = EXCLUDED.adapter_code,
          contract_version = EXCLUDED.contract_version,
          supports_incremental = EXCLUDED.supports_incremental,
          supports_selected_assets = EXCLUDED.supports_selected_assets,
          supports_backfill = EXCLUDED.supports_backfill,
          supports_revisions = EXCLUDED.supports_revisions,
          supports_resume = EXCLUDED.supports_resume,
          supports_dry_run = EXCLUDED.supports_dry_run,
          configuration = EXCLUDED.configuration,
          active = EXCLUDED.active,
          updated_at = CURRENT_TIMESTAMP
    `,
    [
      toolId,
      profile.dataDomainId,
      profile.sourceId,
      profile.adapterCode,
      profile.contractVersion,
      profile.supportsIncremental,
      profile.supportsSelectedAssets,
      profile.supportsBackfill,
      profile.supportsRevisions,
      profile.supportsResume,
      profile.supportsDryRun,
      JSON.stringify(profile.configuration || {}),
      profile.active,
    ],
  );
}

async function insertAuditEvent(
  client,
  { actor, context = {}, eventType, resourceId, action, message, metadata = {} },
) {
  await client.query(
    `
      INSERT INTO auth.audit_events (
        user_id,
        event_type,
        resource_type,
        resource_id,
        action,
        success,
        message,
        metadata,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, 'core.tools', $3, $4, TRUE, $5, $6::jsonb, $7, $8)
    `,
    [
      getActorUserId(actor),
      eventType,
      String(resourceId),
      action,
      message,
      JSON.stringify({ privilegeCode: 'ADMIN_TOOL_WRITE', ...metadata }),
      context.ipAddress || null,
      context.userAgent || null,
    ],
  );
}

async function createTool({ body = {}, actor, context = {} }) {
  const payload = normalizeToolPayload(body);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await assertReferences(client, payload);
    const category = await getCategoryMetadata(client, payload.categoryId);
    assertIngestionAssignment({
      category,
      profile: payload.ingestionProfile || null,
      enabled: payload.enabled,
    });

    const result = await client.query(
      `
        INSERT INTO core.tools (
          category_id,
          tool_code,
          name,
          label,
          description,
          script_repo_id,
          script_path,
          runtime_code,
          permission_code,
          risk_code,
          requires_confirmation,
          confirmation_text,
          captures_output,
          allow_params,
          display_order,
          enabled,
          output_type,
          output_schema_path
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        RETURNING tool_id, tool_code
      `,
      [
        payload.categoryId,
        payload.toolCode,
        payload.name,
        payload.label,
        payload.description,
        payload.scriptRepoId,
        payload.scriptPath,
        payload.runtimeCode,
        payload.permissionCode,
        payload.riskCode,
        payload.requiresConfirmation,
        payload.confirmationText,
        payload.capturesOutput,
        payload.allowParams,
        payload.displayOrder,
        payload.enabled,
        payload.outputType,
        payload.outputSchemaPath,
      ],
    );
    const toolId = result.rows[0].tool_id;

    await replaceVisibility(client, toolId, payload.visibility || []);

    if (payload.parameters) {
      await replaceParameters(client, toolId, payload.parameters);
    }

    await replaceIngestionProfile(client, toolId, payload.ingestionProfile || null);

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_TOOL_CREATE',
      resourceId: payload.toolCode,
      action: 'create_tool',
      message: 'Tool catalogue record was created through SkyCommand Admin.',
      metadata: {
        toolId,
        categoryId: payload.categoryId,
        runtimeCode: payload.runtimeCode,
        permissionCode: payload.permissionCode,
        riskCode: payload.riskCode,
        enabled: payload.enabled,
        parameterCount: payload.parameters?.length || 0,
        visibility: payload.visibility || [],
        categoryKindCode: category.categoryKindCode,
        ingestionProfile: payload.ingestionProfile
          ? {
              dataDomainId: payload.ingestionProfile.dataDomainId,
              sourceId: payload.ingestionProfile.sourceId,
              adapterCode: payload.ingestionProfile.adapterCode,
              contractVersion: payload.ingestionProfile.contractVersion,
              active: payload.ingestionProfile.active,
            }
          : null,
      },
    });

    await client.query('COMMIT');
    return getTool(toolId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'A tool with this code already exists.', {
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function validateToolConfiguration(body = {}) {
  const payload = normalizeToolPayload({ ...body, enabled: false });
  const client = await pool.connect();

  try {
    await assertReferences(client, payload);
    const category = await getCategoryMetadata(client, payload.categoryId);
    assertIngestionAssignment({
      category,
      profile: payload.ingestionProfile || null,
      enabled: false,
    });
    const collision = await client.query(
      'SELECT tool_id FROM core.tools WHERE tool_code = $1 LIMIT 1',
      [payload.toolCode],
    );

    if (collision.rowCount > 0) {
      throw createHttpError(409, 'A tool with this code already exists.', {
        code: 'TOOL_CODE_ALREADY_REGISTERED',
        toolCode: payload.toolCode,
      });
    }

    return payload;
  } finally {
    client.release();
  }
}

async function createManagedTool({ body = {}, actor, context = {}, registration = {} }) {
  const payload = normalizeToolPayload({ ...body, enabled: false });
  const originalFilename = normalizeRequiredString(
    registration.originalFilename,
    'registration.originalFilename',
  );
  const descriptorPath = normalizeOptionalRepoRelativePath(
    registration.descriptorPath,
    'registration.descriptorPath',
  );
  const fileHash = normalizeSha256(registration.fileHash, 'registration.fileHash');
  const sessionId = normalizeOptionalString(registration.sessionId);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await assertReferences(client, payload);
    const category = await getCategoryMetadata(client, payload.categoryId);
    assertIngestionAssignment({
      category,
      profile: payload.ingestionProfile || null,
      enabled: false,
    });

    const result = await client.query(
      `
        INSERT INTO core.tools (
          category_id,
          tool_code,
          name,
          label,
          description,
          script_repo_id,
          script_path,
          runtime_code,
          permission_code,
          risk_code,
          requires_confirmation,
          confirmation_text,
          captures_output,
          allow_params,
          display_order,
          enabled,
          output_type,
          output_schema_path,
          managed_by_skycommand,
          original_filename,
          descriptor_path,
          registered_at,
          registered_by,
          file_hash
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, FALSE, $16, $17,
          TRUE, $18, $19, NULL, $20, $21
        )
        RETURNING tool_id, tool_code
      `,
      [
        payload.categoryId,
        payload.toolCode,
        payload.name,
        payload.label,
        payload.description,
        payload.scriptRepoId,
        payload.scriptPath,
        payload.runtimeCode,
        payload.permissionCode,
        payload.riskCode,
        payload.requiresConfirmation,
        payload.confirmationText,
        payload.capturesOutput,
        payload.allowParams,
        payload.displayOrder,
        payload.outputType,
        payload.outputSchemaPath,
        originalFilename,
        descriptorPath,
        getActorUserId(actor),
        fileHash,
      ],
    );
    const toolId = result.rows[0].tool_id;

    await replaceVisibility(client, toolId, payload.visibility || []);
    await replaceParameters(client, toolId, payload.parameters || []);
    await replaceIngestionProfile(client, toolId, payload.ingestionProfile || null);

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'TOOL_ONBOARDING_CATALOGUE_STAGED',
      resourceId: payload.toolCode,
      action: 'stage_managed_tool_catalogue',
      message: 'A disabled managed tool catalogue record was staged before file promotion.',
      metadata: {
        toolId,
        sessionId,
        scriptPath: payload.scriptPath,
        descriptorPath,
        outputSchemaPath: payload.outputSchemaPath,
        parameterCount: payload.parameters?.length || 0,
        visibility: payload.visibility || [],
        fileHash,
        enabled: false,
        categoryKindCode: category.categoryKindCode,
        ingestionProfile: payload.ingestionProfile
          ? {
              dataDomainId: payload.ingestionProfile.dataDomainId,
              sourceId: payload.ingestionProfile.sourceId,
              adapterCode: payload.ingestionProfile.adapterCode,
              contractVersion: payload.ingestionProfile.contractVersion,
              active: payload.ingestionProfile.active,
            }
          : null,
      },
    });

    await client.query('COMMIT');
    return getTool(toolId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      throw createHttpError(409, 'A tool with this code already exists.', {
        code: 'TOOL_CODE_ALREADY_REGISTERED',
        constraint: error.constraint,
      });
    }

    throw error;
  } finally {
    client.release();
  }
}

async function markManagedToolRegistered({ toolId, actor, context = {}, registration = {} }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await getToolRow(client, toolId, { forUpdate: true });

    if (!toBoolean(current.managed_by_skycommand)) {
      throw createHttpError(400, 'Only SkyCommand-managed tools may be finalized here.');
    }

    if (toBoolean(current.enabled)) {
      throw createHttpError(
        409,
        'Managed registration must remain disabled until explicit enablement.',
      );
    }

    await client.query(
      `
        UPDATE core.tools
        SET registered_at = CURRENT_TIMESTAMP,
            registered_by = COALESCE(registered_by, $2),
            updated_at = CURRENT_TIMESTAMP
        WHERE tool_id = $1
      `,
      [current.tool_id, getActorUserId(actor)],
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'TOOL_ONBOARDING_REGISTERED',
      resourceId: current.tool_code,
      action: 'register_managed_tool',
      message: 'Managed tool files were promoted and the disabled catalogue record was verified.',
      metadata: {
        toolId: current.tool_id,
        sessionId: registration.sessionId || null,
        packagePath: registration.packagePath || null,
        files: registration.files || [],
        enabled: false,
      },
    });

    await client.query('COMMIT');
    return getTool(current.tool_id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateTool({ toolId, body = {}, actor, context = {} }) {
  const payload = normalizeToolPayload(body, { patch: true });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await getToolRow(client, toolId, { forUpdate: true });
    const currentProfile = await getRawIngestionProfile(client, current.tool_id);

    if (payload.toolCode && payload.toolCode !== current.tool_code) {
      throw createHttpError(
        400,
        'toolCode is immutable after creation because workflows and historical execution references use it.',
      );
    }

    const resolvedOutputType = Object.prototype.hasOwnProperty.call(payload, 'outputType')
      ? payload.outputType
      : current.output_type;
    const resolvedOutputSchemaPath = Object.prototype.hasOwnProperty.call(
      payload,
      'outputSchemaPath',
    )
      ? payload.outputSchemaPath
      : current.output_schema_path;

    if (resolvedOutputSchemaPath && !resolvedOutputType) {
      throw createHttpError(400, 'outputType is required when outputSchemaPath is configured.');
    }

    await assertReferences(client, payload);
    const resolvedCategory = await getCategoryMetadata(
      client,
      payload.categoryId || current.category_id,
    );
    const profileSupplied = Object.prototype.hasOwnProperty.call(payload, 'ingestionProfile');
    const resolvedProfile = profileSupplied ? payload.ingestionProfile : currentProfile;
    const resolvedEnabled = Object.prototype.hasOwnProperty.call(payload, 'enabled')
      ? payload.enabled
      : toBoolean(current.enabled);

    assertIngestionAssignment({
      category: resolvedCategory,
      profile: resolvedProfile,
      enabled: resolvedEnabled,
    });

    await assertIngestionProfileReferences(client, resolvedProfile);

    const fieldMap = {
      name: 'name',
      label: 'label',
      description: 'description',
      categoryId: 'category_id',
      scriptRepoId: 'script_repo_id',
      scriptPath: 'script_path',
      runtimeCode: 'runtime_code',
      permissionCode: 'permission_code',
      riskCode: 'risk_code',
      requiresConfirmation: 'requires_confirmation',
      confirmationText: 'confirmation_text',
      capturesOutput: 'captures_output',
      allowParams: 'allow_params',
      displayOrder: 'display_order',
      enabled: 'enabled',
      outputType: 'output_type',
      outputSchemaPath: 'output_schema_path',
    };
    const assignments = [];
    const values = [];

    for (const [payloadKey, columnName] of Object.entries(fieldMap)) {
      if (!Object.prototype.hasOwnProperty.call(payload, payloadKey)) {
        continue;
      }

      values.push(payload[payloadKey]);
      assignments.push(`${columnName} = $${values.length}`);
    }

    if (assignments.length > 0) {
      values.push(current.tool_id);
      await client.query(
        `
          UPDATE core.tools
          SET ${assignments.join(', ')},
              updated_at = CURRENT_TIMESTAMP
          WHERE tool_id = $${values.length}
        `,
        values,
      );
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'visibility')) {
      await replaceVisibility(client, current.tool_id, payload.visibility);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'parameters')) {
      await replaceParameters(client, current.tool_id, payload.parameters);
    }

    if (resolvedCategory.categoryKindCode === 'INGESTION') {
      if (profileSupplied) {
        await replaceIngestionProfile(client, current.tool_id, resolvedProfile);
      }
    } else if (currentProfile) {
      await replaceIngestionProfile(client, current.tool_id, null);
    }

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_TOOL_UPDATE',
      resourceId: current.tool_code,
      action: 'update_tool',
      message: 'Tool catalogue configuration was updated through SkyCommand Admin.',
      metadata: {
        toolId: current.tool_id,
        changedFields: Object.keys(payload).filter((key) => key !== 'parameters'),
        parameterCount: payload.parameters?.length,
        categoryKindCode: resolvedCategory.categoryKindCode,
        ingestionProfileChanged: profileSupplied || Boolean(currentProfile),
      },
    });

    await client.query('COMMIT');
    return getTool(current.tool_id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateToolStatus({ toolId, body = {}, actor, context = {} }) {
  if (!Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    throw createHttpError(400, 'enabled is required.');
  }

  const enabled = normalizeBoolean(body.enabled, false, 'enabled');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await getToolRow(client, toolId, { forUpdate: true });
    const [category, ingestionProfile] = await Promise.all([
      getCategoryMetadata(client, current.category_id),
      getRawIngestionProfile(client, current.tool_id),
    ]);

    assertIngestionAssignment({ category, profile: ingestionProfile, enabled });
    await assertIngestionProfileReferences(client, ingestionProfile);

    await client.query(
      `
        UPDATE core.tools
        SET enabled = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE tool_id = $1
      `,
      [current.tool_id, enabled],
    );

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: enabled ? 'ADMIN_TOOL_ENABLE' : 'ADMIN_TOOL_DISABLE',
      resourceId: current.tool_code,
      action: enabled ? 'enable_tool' : 'disable_tool',
      message: `Tool catalogue record was ${enabled ? 'enabled' : 'disabled'} through SkyCommand Admin.`,
      metadata: {
        toolId: current.tool_id,
        enabled,
      },
    });

    await client.query('COMMIT');
    return getTool(current.tool_id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function replaceToolParameters({ toolId, body = {}, actor, context = {} }) {
  const parameters = normalizeParameters(body.parameters || []);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const current = await getToolRow(client, toolId, { forUpdate: true });
    await assertReferences(client, { parameters });
    await replaceParameters(client, current.tool_id, parameters);

    await insertAuditEvent(client, {
      actor,
      context,
      eventType: 'ADMIN_TOOL_PARAMETERS_UPDATE',
      resourceId: current.tool_code,
      action: 'update_tool_parameters',
      message: 'Tool positional parameter configuration was replaced through SkyCommand Admin.',
      metadata: {
        toolId: current.tool_id,
        parameterCount: parameters.length,
        parameterNames: parameters.map((parameter) => parameter.parameterName),
      },
    });

    await client.query('COMMIT');
    return getTool(current.tool_id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listTools,
  getTool,
  getOptions,
  createTool,
  validateToolConfiguration,
  createManagedTool,
  markManagedToolRegistered,
  updateTool,
  updateToolStatus,
  replaceToolParameters,
};
