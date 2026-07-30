const { query } = require('../../../db/src/connection');

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeCode(value) {
  const text = normalizeOptionalString(value);
  return text ? text.toUpperCase() : null;
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function sanitizeIngestionTool(row) {
  return {
    appCode: row.app_code,
    categoryId: row.category_id,
    categoryCode: row.category_code,
    categoryLabel: row.category_label,
    categoryKindCode: row.category_kind_code,
    toolId: row.tool_id,
    toolCode: row.tool_code,
    toolName: row.tool_name,
    toolLabel: row.tool_label,
    toolDescription: row.tool_description,
    scriptPath: row.script_path,
    runtimeCode: row.runtime_code,
    permissionCode: row.permission_code,
    outputType: row.output_type || null,
    adapterCode: row.adapter_code,
    contractVersion: row.contract_version,
    domainId: row.domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    sourceId: row.source_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    providerName: row.provider_name,
    providerType: row.provider_type,
    sourceDescription: row.source_description,
    observabilityEnabled: toBoolean(row.observability_enabled),
    visibility: row.visibility_channels || [],
    capabilities: {
      incremental: toBoolean(row.supports_incremental),
      selectedAssets: toBoolean(row.supports_selected_assets),
      backfill: toBoolean(row.supports_backfill),
      revisions: toBoolean(row.supports_revisions),
      resume: toBoolean(row.supports_resume),
      dryRun: toBoolean(row.supports_dry_run),
    },
    configuration: row.profile_configuration || {},
    sourceConfiguration: row.source_configuration || {},
    discoverable: toBoolean(row.discoverable),
  };
}

function sanitizeIngestionSource(row) {
  const sourceConfiguration = row.source_configuration || {};

  return {
    domainId: row.domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    sourceId: row.source_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    providerName: row.provider_name,
    providerType: row.provider_type,
    description: row.source_description,
    observabilityEnabled: toBoolean(row.observability_enabled),
    sourceConfiguration,
    legacyIndicatorSourceCode: sourceConfiguration.legacyMacroIndicatorSource || null,
    aliases: Array.isArray(sourceConfiguration.aliases) ? sourceConfiguration.aliases : [],
    toolIds: row.tool_ids || [],
    toolCodes: row.tool_codes || [],
    scriptPaths: row.script_paths || [],
    adapterCodes: row.adapter_codes || [],
    discoverable: toBoolean(row.discoverable),
  };
}

async function listIngestionTools(filters = {}) {
  const clauses = [];
  const values = [];
  const domainCode = normalizeCode(filters.domainCode);
  const sourceCode = normalizeCode(filters.sourceCode || filters.source);
  const channelCode = normalizeOptionalString(filters.channelCode);

  if (filters.discoverableOnly !== false) {
    clauses.push('discoverable = TRUE');
  }

  if (domainCode) {
    values.push(domainCode);
    clauses.push(`domain_code = $${values.length}`);
  }

  if (sourceCode) {
    values.push(sourceCode);
    clauses.push(`source_code = $${values.length}`);
  }

  if (channelCode) {
    values.push(channelCode);
    clauses.push(`$${values.length} = ANY(visibility_channels)`);
  }

  const result = await query(
    `
      SELECT *
      FROM data.vw_ingestion_tools
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY domain_code, source_code, tool_code
    `,
    values,
  );

  return result.rows.map(sanitizeIngestionTool);
}

async function listIngestionSources(filters = {}) {
  const clauses = [];
  const values = [];
  const domainCode = normalizeCode(filters.domainCode);

  if (filters.discoverableOnly !== false) {
    clauses.push('discoverable = TRUE');
  }

  if (filters.observabilityOnly === true) {
    clauses.push('observability_enabled = TRUE');
  }

  if (domainCode) {
    values.push(domainCode);
    clauses.push(`domain_code = $${values.length}`);
  }

  const result = await query(
    `
      SELECT *
      FROM data.vw_ingestion_sources
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY domain_code, source_code
    `,
    values,
  );

  return result.rows.map(sanitizeIngestionSource);
}

async function getIngestionSource(sourceCode, filters = {}) {
  const normalizedSourceCode = normalizeCode(sourceCode);

  if (!normalizedSourceCode) {
    return null;
  }

  const sources = await listIngestionSources(filters);

  return (
    sources.find((source) => source.sourceCode === normalizedSourceCode) ||
    sources.find((source) =>
      source.aliases.some((alias) => normalizeCode(alias) === normalizedSourceCode),
    ) ||
    null
  );
}

module.exports = {
  listIngestionTools,
  listIngestionSources,
  getIngestionSource,
};
