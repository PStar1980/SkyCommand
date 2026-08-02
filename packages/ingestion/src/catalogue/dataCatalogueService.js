let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }

  return databaseQuery;
}

const CATALOGUE_CONTRACT_VERSION = 'data_catalogue.v1';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if ([true, 'true', 't', '1', 1].includes(value)) {
    return true;
  }

  if ([false, 'false', 'f', '0', 0].includes(value)) {
    return false;
  }

  const error = new Error(`Invalid boolean value: ${value}`);
  error.statusCode = 400;
  throw error;
}

function normalizePagination(filters = {}) {
  const requestedLimit = Number.parseInt(filters.limit, 10);
  const requestedOffset = Number.parseInt(filters.offset, 10);

  return {
    limit: Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : DEFAULT_LIMIT,
    offset: Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0,
  };
}

function toBoolean(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function sanitizeDomain(row) {
  return {
    domainId: row.domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    description: row.description || null,
    schemaName: row.schema_name || null,
    contractVersion: row.contract_version,
    active: toBoolean(row.active),
    configuration: row.configuration || {},
    counts: {
      assets: Number(row.asset_count || 0),
      activeAssets: Number(row.active_asset_count || 0),
      metrics: Number(row.metric_count || 0),
      activeMetrics: Number(row.active_metric_count || 0),
      sources: Number(row.source_count || 0),
    },
  };
}

function sanitizeAsset(row) {
  return {
    domainId: row.domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetDescription: row.asset_description || null,
    assetKindCode: row.asset_kind_code,
    frequencyCode: row.frequency_code || null,
    unitCode: row.unit_code || null,
    scaleCode: row.scale_code || null,
    geographyCode: row.geography_code || null,
    seasonalAdjustmentCode: row.seasonal_adjustment_code || null,
    transformCode: row.transform_code || null,
    releaseLagDays:
      row.release_lag_days === null || row.release_lag_days === undefined
        ? null
        : Number(row.release_lag_days),
    freshnessToleranceDays:
      row.freshness_tolerance_days === null || row.freshness_tolerance_days === undefined
        ? null
        : Number(row.freshness_tolerance_days),
    revisionsExpected:
      row.revisions_expected === null || row.revisions_expected === undefined
        ? null
        : toBoolean(row.revisions_expected),
    criticalityCode: row.criticality_code,
    storage: {
      schemaName: row.storage_schema_name || null,
      relationName: row.storage_relation_name || null,
      dateColumn: row.storage_date_column || null,
      valueColumn: row.storage_value_column || null,
    },
    contractVersion: row.contract_version,
    configuration: row.asset_configuration || {},
    active: toBoolean(row.asset_active),
    source: row.source_id
      ? {
          sourceId: row.source_id,
          sourceCode: row.source_code,
          sourceName: row.source_name,
          providerName: row.provider_name || null,
          providerType: row.provider_type || null,
          observabilityEnabled: toBoolean(row.observability_enabled),
          providerAssetCode: row.provider_asset_code,
          providerResourceCode: row.provider_resource_code || null,
          providerLocator: row.provider_locator || null,
          sourceFrequencyCode: row.source_frequency_code || null,
          transformCode: row.source_transform_code || null,
          configuration: row.binding_configuration || {},
          active: toBoolean(row.binding_active) && toBoolean(row.source_active),
        }
      : null,
    discoverable: toBoolean(row.discoverable),
  };
}

function sanitizeMetric(row) {
  return {
    domainId: row.domain_id,
    domainCode: row.domain_code,
    domainName: row.domain_name,
    metricId: row.metric_id,
    metricCode: row.metric_code,
    metricName: row.metric_name,
    metricDescription: row.metric_description || null,
    metricKindCode: row.metric_kind_code,
    frequencyCode: row.frequency_code || null,
    unitCode: row.unit_code || null,
    scaleCode: row.scale_code || null,
    definition: row.definition || {},
    dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
    contractVersion: row.contract_version,
    configuration: row.metric_configuration || {},
    active: toBoolean(row.metric_active),
    discoverable: toBoolean(row.discoverable),
  };
}

async function listDomains(filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const active = normalizeBoolean(filters.active);
  const values = [];
  const clauses = [];

  if (active !== null) {
    values.push(active);
    clauses.push(`domain.active = $${values.length}`);
  }

  const result = await query(
    `
      SELECT
        domain.domain_id,
        domain.domain_code,
        domain.name AS domain_name,
        domain.description,
        domain.schema_name,
        domain.contract_version,
        domain.active,
        domain.configuration,
        COUNT(DISTINCT asset.asset_id)::int AS asset_count,
        COUNT(DISTINCT asset.asset_id) FILTER (WHERE asset.active = TRUE)::int AS active_asset_count,
        COUNT(DISTINCT metric.metric_id)::int AS metric_count,
        COUNT(DISTINCT metric.metric_id) FILTER (WHERE metric.active = TRUE)::int AS active_metric_count,
        COUNT(DISTINCT source.source_id)::int AS source_count
      FROM data.domains domain
      LEFT JOIN data.assets asset ON asset.domain_id = domain.domain_id
      LEFT JOIN data.metrics metric ON metric.domain_id = domain.domain_id
      LEFT JOIN data.sources source ON source.domain_id = domain.domain_id
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY
        domain.domain_id,
        domain.domain_code,
        domain.name,
        domain.description,
        domain.schema_name,
        domain.contract_version,
        domain.active,
        domain.configuration
      ORDER BY domain.domain_code
    `,
    values,
  );

  return result.rows.map(sanitizeDomain);
}

async function listAssets(filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const values = [];
  const clauses = [];
  const domainCode = normalizeCode(filters.domainCode);
  const sourceCode = normalizeCode(filters.sourceCode || filters.source);
  const assetKindCode = normalizeCode(filters.assetKindCode || filters.assetKind);
  const frequencyCode = normalizeCode(filters.frequencyCode || filters.frequency);
  const active = normalizeBoolean(filters.active);
  const discoverable = normalizeBoolean(filters.discoverable);
  const search = normalizeOptionalString(filters.search);
  const { limit, offset } = normalizePagination(filters);

  if (domainCode) {
    values.push(domainCode);
    clauses.push(`domain_code = $${values.length}`);
  }

  if (sourceCode) {
    values.push(sourceCode);
    clauses.push(`source_code = $${values.length}`);
  }

  if (assetKindCode) {
    values.push(assetKindCode);
    clauses.push(`asset_kind_code = $${values.length}`);
  }

  if (frequencyCode) {
    values.push(frequencyCode);
    clauses.push(`frequency_code = $${values.length}`);
  }

  if (active !== null) {
    values.push(active);
    clauses.push(`asset_active = $${values.length}`);
  }

  if (discoverable !== null) {
    values.push(discoverable);
    clauses.push(`discoverable = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      asset_code ILIKE $${values.length}
      OR asset_name ILIKE $${values.length}
      OR COALESCE(asset_description, '') ILIKE $${values.length}
      OR COALESCE(provider_asset_code, '') ILIKE $${values.length}
    )`);
  }

  values.push(limit);
  const limitParameter = `$${values.length}`;
  values.push(offset);
  const offsetParameter = `$${values.length}`;

  const result = await query(
    `
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM data.vw_assets
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY domain_code, asset_code
      LIMIT ${limitParameter}
      OFFSET ${offsetParameter}
    `,
    values,
  );

  return {
    total: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
    items: result.rows.map(sanitizeAsset),
  };
}

async function getAsset(domainCode, assetCode, options = {}) {
  const query = options.query || getDatabaseQuery();
  const normalizedDomainCode = normalizeCode(domainCode);
  const normalizedAssetCode = normalizeCode(assetCode);

  if (!normalizedDomainCode || !normalizedAssetCode) {
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM data.vw_assets
      WHERE domain_code = $1
        AND asset_code = $2
      LIMIT 1
    `,
    [normalizedDomainCode, normalizedAssetCode],
  );

  return result.rows[0] ? sanitizeAsset(result.rows[0]) : null;
}

async function listMetrics(filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const values = [];
  const clauses = [];
  const domainCode = normalizeCode(filters.domainCode);
  const metricKindCode = normalizeCode(filters.metricKindCode || filters.metricKind);
  const active = normalizeBoolean(filters.active);
  const discoverable = normalizeBoolean(filters.discoverable);
  const search = normalizeOptionalString(filters.search);
  const { limit, offset } = normalizePagination(filters);

  if (domainCode) {
    values.push(domainCode);
    clauses.push(`domain_code = $${values.length}`);
  }

  if (metricKindCode) {
    values.push(metricKindCode);
    clauses.push(`metric_kind_code = $${values.length}`);
  }

  if (active !== null) {
    values.push(active);
    clauses.push(`metric_active = $${values.length}`);
  }

  if (discoverable !== null) {
    values.push(discoverable);
    clauses.push(`discoverable = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    clauses.push(`(
      metric_code ILIKE $${values.length}
      OR metric_name ILIKE $${values.length}
      OR COALESCE(metric_description, '') ILIKE $${values.length}
    )`);
  }

  values.push(limit);
  const limitParameter = `$${values.length}`;
  values.push(offset);
  const offsetParameter = `$${values.length}`;

  const result = await query(
    `
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM data.vw_metrics
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY domain_code, metric_code
      LIMIT ${limitParameter}
      OFFSET ${offsetParameter}
    `,
    values,
  );

  return {
    total: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
    items: result.rows.map(sanitizeMetric),
  };
}

async function getMetric(domainCode, metricCode, options = {}) {
  const query = options.query || getDatabaseQuery();
  const normalizedDomainCode = normalizeCode(domainCode);
  const normalizedMetricCode = normalizeCode(metricCode);

  if (!normalizedDomainCode || !normalizedMetricCode) {
    return null;
  }

  const result = await query(
    `
      SELECT *
      FROM data.vw_metrics
      WHERE domain_code = $1
        AND metric_code = $2
      LIMIT 1
    `,
    [normalizedDomainCode, normalizedMetricCode],
  );

  return result.rows[0] ? sanitizeMetric(result.rows[0]) : null;
}

module.exports = {
  CATALOGUE_CONTRACT_VERSION,
  normalizeBoolean,
  sanitizeDomain,
  sanitizeAsset,
  sanitizeMetric,
  listDomains,
  listAssets,
  getAsset,
  listMetrics,
  getMetric,
};
