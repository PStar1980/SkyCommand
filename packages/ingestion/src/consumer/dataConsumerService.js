const dataCatalogueService = require('../catalogue/dataCatalogueService');

let databaseQuery = null;

function getDatabaseQuery() {
  if (!databaseQuery) {
    ({ query: databaseQuery } = require('../../../db/src/connection'));
  }

  return databaseQuery;
}

const TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION = 'time_series_observations.v1';
const METRIC_OBSERVATIONS_CONTRACT_VERSION = 'metric_observations.v1';
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 5000;
const SUPPORTED_METRIC_OPERATORS = new Set(['IDENTITY', 'PCT_CHANGE']);

function serviceError(message, statusCode, code, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = { code, ...details };
  return error;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCode(value) {
  const text = normalizeOptionalString(value);
  return text ? text.toUpperCase() : null;
}

function normalizeDate(value, fieldName) {
  const text = normalizeOptionalString(value);
  if (!text) return null;

  if (!DATE_PATTERN.test(text)) {
    throw serviceError(
      `${fieldName} must use YYYY-MM-DD format.`,
      400,
      'INVALID_DATE_FILTER',
      { fieldName, value: text },
    );
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw serviceError(
      `${fieldName} is not a valid calendar date.`,
      400,
      'INVALID_DATE_FILTER',
      { fieldName, value: text },
    );
  }

  return text;
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

function normalizeSortDirection(value) {
  const direction = normalizeCode(value) || 'ASC';
  if (!['ASC', 'DESC'].includes(direction)) {
    throw serviceError(
      'sortDirection must be ASC or DESC.',
      400,
      'INVALID_SORT_DIRECTION',
      { value },
    );
  }
  return direction;
}

function quoteIdentifier(identifier) {
  if (!IDENTIFIER_PATTERN.test(identifier || '')) {
    throw serviceError(
      `Unsafe storage identifier: ${identifier || '(blank)'}.`,
      409,
      'UNSAFE_STORAGE_IDENTIFIER',
      { identifier: identifier || null },
    );
  }
  return `"${identifier}"`;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeObservationValue(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
}

function validateStorage(asset) {
  if (!asset) {
    throw serviceError('Data asset not found.', 404, 'ASSET_NOT_FOUND');
  }

  if (normalizeCode(asset.assetKindCode) !== 'TIME_SERIES') {
    throw serviceError(
      `Asset ${asset.domainCode}/${asset.assetCode} is not a queryable time series.`,
      409,
      'ASSET_KIND_NOT_QUERYABLE',
      { assetKindCode: asset.assetKindCode },
    );
  }

  const storage = asset.storage || {};
  const required = ['schemaName', 'relationName', 'dateColumn', 'valueColumn'];
  const missing = required.filter((field) => !normalizeOptionalString(storage[field]));
  if (missing.length > 0) {
    throw serviceError(
      `Asset ${asset.domainCode}/${asset.assetCode} has incomplete storage metadata.`,
      409,
      'ASSET_STORAGE_INCOMPLETE',
      { missing },
    );
  }

  return {
    schemaName: storage.schemaName,
    relationName: storage.relationName,
    dateColumn: storage.dateColumn,
    valueColumn: storage.valueColumn,
  };
}

async function assertRelationExists(query, storage) {
  const result = await query(
    `
      SELECT to_regclass(format('%I.%I', $1, $2)) IS NOT NULL AS relation_exists
    `,
    [storage.schemaName, storage.relationName],
  );

  if (result.rows[0]?.relation_exists !== true) {
    throw serviceError(
      `Configured asset storage relation does not exist: ${storage.schemaName}.${storage.relationName}.`,
      409,
      'ASSET_STORAGE_RELATION_MISSING',
      {
        schemaName: storage.schemaName,
        relationName: storage.relationName,
      },
    );
  }
}

function normalizeSeriesFilters(filters = {}) {
  const dateFrom = normalizeDate(filters.dateFrom, 'dateFrom');
  const dateTo = normalizeDate(filters.dateTo, 'dateTo');
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw serviceError(
      'dateFrom cannot be later than dateTo.',
      400,
      'INVALID_DATE_RANGE',
      { dateFrom, dateTo },
    );
  }

  return {
    ...normalizePagination(filters),
    dateFrom,
    dateTo,
    sortDirection: normalizeSortDirection(filters.sortDirection || filters.sort),
  };
}

function buildProjectionSql(asset, projection = {}) {
  const storage = validateStorage(asset);
  const schema = quoteIdentifier(storage.schemaName);
  const relation = quoteIdentifier(storage.relationName);
  const dateColumn = quoteIdentifier(storage.dateColumn);
  const valueColumn = quoteIdentifier(storage.valueColumn);
  const operator = normalizeCode(projection.operator) || 'IDENTITY';

  if (!SUPPORTED_METRIC_OPERATORS.has(operator)) {
    throw serviceError(
      `Metric operator ${operator} is not supported by the portable consumer contract.`,
      422,
      'METRIC_OPERATOR_UNSUPPORTED',
      { operator, supportedOperators: [...SUPPORTED_METRIC_OPERATORS] },
    );
  }

  if (operator === 'IDENTITY') {
    return {
      storage,
      operator,
      sql: `
        WITH projected_series AS (
          SELECT
            ${dateColumn}::date AS observation_date,
            ${valueColumn}::numeric AS observation_value
          FROM ${schema}.${relation}
        )
      `,
    };
  }

  const periods = Number.parseInt(projection.periods, 10);
  const multiplier = projection.multiplier === undefined
    ? 100
    : Number(projection.multiplier);

  if (!Number.isInteger(periods) || periods < 1 || periods > 1000) {
    throw serviceError(
      'PCT_CHANGE requires an integer periods value between 1 and 1000.',
      422,
      'METRIC_DEFINITION_INVALID',
      { operator, periods: projection.periods },
    );
  }
  if (!Number.isFinite(multiplier)) {
    throw serviceError(
      'PCT_CHANGE multiplier must be numeric.',
      422,
      'METRIC_DEFINITION_INVALID',
      { operator, multiplier: projection.multiplier },
    );
  }

  return {
    storage,
    operator,
    periods,
    multiplier,
    sql: `
      WITH source_series AS (
        SELECT
          ${dateColumn}::date AS observation_date,
          ${valueColumn}::numeric AS source_value
        FROM ${schema}.${relation}
      ),
      lagged_series AS (
        SELECT
          observation_date,
          source_value,
          LAG(source_value, ${periods}) OVER (ORDER BY observation_date) AS previous_value
        FROM source_series
      ),
      projected_series AS (
        SELECT
          observation_date,
          CASE
            WHEN previous_value IS NULL OR previous_value = 0 THEN NULL
            ELSE ((source_value - previous_value) / previous_value) * ${multiplier}
          END AS observation_value
        FROM lagged_series
      )
    `,
  };
}

async function queryProjectedSeries(asset, filters = {}, projection = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const normalizedFilters = normalizeSeriesFilters(filters);
  const projectionSql = buildProjectionSql(asset, projection);
  await assertRelationExists(query, projectionSql.storage);

  const values = [];
  const clauses = ['observation_value IS NOT NULL'];

  if (normalizedFilters.dateFrom) {
    values.push(normalizedFilters.dateFrom);
    clauses.push(`observation_date >= $${values.length}::date`);
  }
  if (normalizedFilters.dateTo) {
    values.push(normalizedFilters.dateTo);
    clauses.push(`observation_date <= $${values.length}::date`);
  }

  const filterSql = `WHERE ${clauses.join(' AND ')}`;
  const countValues = [...values];
  values.push(normalizedFilters.limit);
  const limitParameter = `$${values.length}`;
  values.push(normalizedFilters.offset);
  const offsetParameter = `$${values.length}`;

  const countResult = await query(
    `${projectionSql.sql}
     SELECT COUNT(*)::int AS total
     FROM projected_series
     ${filterSql}`,
    countValues,
  );
  const rowsResult = await query(
    `${projectionSql.sql}
     SELECT observation_date, observation_value
     FROM projected_series
     ${filterSql}
     ORDER BY observation_date ${normalizedFilters.sortDirection}
     LIMIT ${limitParameter}
     OFFSET ${offsetParameter}`,
    values,
  );

  return {
    total: Number(countResult.rows[0]?.total || 0),
    limit: normalizedFilters.limit,
    offset: normalizedFilters.offset,
    sortDirection: normalizedFilters.sortDirection,
    dateFrom: normalizedFilters.dateFrom,
    dateTo: normalizedFilters.dateTo,
    operator: projectionSql.operator,
    items: rowsResult.rows.map((row) => ({
      observationDate: dateOnly(row.observation_date),
      value: normalizeObservationValue(row.observation_value),
    })),
  };
}

function summarizeAsset(asset) {
  return {
    domainCode: asset.domainCode,
    domainName: asset.domainName,
    assetCode: asset.assetCode,
    assetName: asset.assetName,
    assetKindCode: asset.assetKindCode,
    frequencyCode: asset.frequencyCode || null,
    unitCode: asset.unitCode || null,
    scaleCode: asset.scaleCode || null,
    geographyCode: asset.geographyCode || null,
    source: asset.source || null,
    contractVersion: asset.contractVersion,
  };
}

async function listAssetObservations(domainCode, assetCode, filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const asset = await dataCatalogueService.getAsset(domainCode, assetCode, { query });
  if (!asset) {
    throw serviceError(
      `Data asset not found: ${normalizeCode(domainCode)}/${normalizeCode(assetCode)}.`,
      404,
      'ASSET_NOT_FOUND',
    );
  }

  const series = await queryProjectedSeries(asset, filters, { operator: 'IDENTITY' }, { query });
  return {
    contractVersion: TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION,
    asset: summarizeAsset(asset),
    ...series,
  };
}

function resolveMetricAssetDependency(metric) {
  const dependencies = Array.isArray(metric?.dependencies) ? metric.dependencies : [];
  const assetDependencies = dependencies.filter((dependency) => dependency.assetCode);
  const metricDependencies = dependencies.filter((dependency) => dependency.metricCode);

  if (assetDependencies.length !== 1 || metricDependencies.length > 0) {
    throw serviceError(
      `Metric ${metric.domainCode}/${metric.metricCode} requires exactly one direct asset dependency for observation queries.`,
      422,
      'METRIC_DEPENDENCY_UNSUPPORTED',
      {
        assetDependencyCount: assetDependencies.length,
        metricDependencyCount: metricDependencies.length,
      },
    );
  }

  return assetDependencies[0];
}

async function listMetricObservations(domainCode, metricCode, filters = {}, options = {}) {
  const query = options.query || getDatabaseQuery();
  const metric = await dataCatalogueService.getMetric(domainCode, metricCode, { query });
  if (!metric) {
    throw serviceError(
      `Data metric not found: ${normalizeCode(domainCode)}/${normalizeCode(metricCode)}.`,
      404,
      'METRIC_NOT_FOUND',
    );
  }

  const dependency = resolveMetricAssetDependency(metric);
  const asset = await dataCatalogueService.getAsset(metric.domainCode, dependency.assetCode, { query });
  if (!asset) {
    throw serviceError(
      `Metric dependency asset not found: ${metric.domainCode}/${dependency.assetCode}.`,
      409,
      'METRIC_DEPENDENCY_ASSET_MISSING',
    );
  }

  const definition = metric.definition && typeof metric.definition === 'object'
    ? metric.definition
    : {};
  const operator = normalizeCode(definition.operator) || 'IDENTITY';
  const series = await queryProjectedSeries(
    asset,
    filters,
    {
      operator,
      periods: definition.periods,
      multiplier: definition.multiplier,
    },
    { query },
  );

  return {
    contractVersion: METRIC_OBSERVATIONS_CONTRACT_VERSION,
    metric,
    dependencyAsset: summarizeAsset(asset),
    calculation: {
      operator,
      definition,
    },
    ...series,
  };
}

module.exports = {
  METRIC_OBSERVATIONS_CONTRACT_VERSION,
  SUPPORTED_METRIC_OPERATORS,
  TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION,
  buildProjectionSql,
  listAssetObservations,
  listMetricObservations,
  normalizeDate,
  normalizePagination,
  normalizeSeriesFilters,
  normalizeSortDirection,
  quoteIdentifier,
  queryProjectedSeries,
  resolveMetricAssetDependency,
  summarizeAsset,
};
