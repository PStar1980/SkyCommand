const { query } = require('../../../../packages/db/src/connection');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_SERIES_LIMIT = 500;
const MAX_SERIES_LIMIT = 5000;

const MACRO_VIEW_REGISTRY = [
  {
    viewKey: 'inflation',
    schemaName: 'macro',
    viewName: 'vw_inflation',
    label: 'U.S. Inflation',
    region: 'US',
    category: 'inflation',
    description: 'U.S. CPI, Core CPI, PCE, Core PCE, and calculated inflation spreads.',
  },
  {
    viewKey: 'rates-curve',
    schemaName: 'macro',
    viewName: 'vw_rates_curve',
    label: 'U.S. Rates Curve',
    region: 'US',
    category: 'rates',
    description: 'U.S. Treasury curve, corporate yields, Fed Funds, and curve spreads.',
  },
  {
    viewKey: 'growth',
    schemaName: 'macro',
    viewName: 'vw_growth',
    label: 'U.S. Growth',
    region: 'US',
    category: 'growth',
    description: 'U.S. nominal GDP, real GDP, industrial production, and growth momentum.',
  },
  {
    viewKey: 'labor',
    schemaName: 'macro',
    viewName: 'vw_labor',
    label: 'U.S. Labor',
    region: 'US',
    category: 'labor',
    description: 'U.S. payrolls, unemployment, underemployment, labor slack, and Sahm signal.',
  },
  {
    viewKey: 'credit-conditions',
    schemaName: 'macro',
    viewName: 'vw_credit_conditions',
    label: 'U.S. Credit Conditions',
    region: 'US',
    category: 'credit',
    description: 'Chicago Fed financial conditions, leverage, risk stress, and z-score signals.',
  },
  {
    viewKey: 'housing',
    schemaName: 'macro',
    viewName: 'vw_housing',
    label: 'U.S. Housing',
    region: 'US',
    category: 'housing',
    description: 'U.S. housing starts, building permits, and housing momentum proxies.',
  },
  {
    viewKey: 'liquidity',
    schemaName: 'macro',
    viewName: 'vw_liquidity',
    label: 'U.S. Liquidity',
    region: 'US',
    category: 'liquidity',
    description: 'U.S. M1/M2 money supply, liquidity gap, YoY change, and liquidity regime.',
  },
  {
    viewKey: 'macro-regime',
    schemaName: 'macro',
    viewName: 'vw_macro_regime',
    label: 'U.S. Macro Regime',
    region: 'US',
    category: 'regime',
    description: 'Composite U.S. inflation, growth, labor, liquidity, curve, and regime signals.',
  },
  {
    viewKey: 'ca-inflation',
    schemaName: 'macro',
    viewName: 'vw_ca_inflation',
    label: 'Canada Inflation',
    region: 'CA',
    category: 'inflation',
    description:
      'Canadian CPI, CPI momentum, housing price inflation, and inflation spread signals.',
  },
  {
    viewKey: 'ca-growth',
    schemaName: 'macro',
    viewName: 'vw_ca_growth',
    label: 'Canada Growth',
    region: 'CA',
    category: 'growth',
    description: 'Canadian GDP, retail sales, imports, trade by industry, and growth momentum.',
  },
  {
    viewKey: 'ca-labor',
    schemaName: 'macro',
    viewName: 'vw_ca_labor',
    label: 'Canada Labor',
    region: 'CA',
    category: 'labor',
    description: 'Canadian employment, unemployment, participation, and Sahm-style stress signal.',
  },
  {
    viewKey: 'ca-housing',
    schemaName: 'macro',
    viewName: 'vw_ca_housing',
    label: 'Canada Housing',
    region: 'CA',
    category: 'housing',
    description:
      'Canadian new housing price index, building permits, and housing momentum signals.',
  },
  {
    viewKey: 'ca-trade',
    schemaName: 'macro',
    viewName: 'vw_ca_trade',
    label: 'Canada Trade',
    region: 'CA',
    category: 'trade',
    description: 'Canadian imports, exports proxy, net trade proxy, and total trade activity.',
  },
  {
    viewKey: 'ca-rates-fx',
    schemaName: 'macro',
    viewName: 'vw_ca_rates_fx',
    label: 'Canada Rates and FX',
    region: 'CA',
    category: 'rates_fx',
    description: 'Bank of Canada overnight rate, USD/CAD, CAD proxy, and FX momentum.',
  },
  {
    viewKey: 'ca-macro-regime',
    schemaName: 'macro',
    viewName: 'vw_ca_macro_regime',
    label: 'Canada Macro Regime',
    region: 'CA',
    category: 'regime',
    description:
      'Composite Canadian inflation, growth, labor, housing, trade, policy, FX, and regime signals.',
  },
  {
    viewKey: 'us-ca-policy-fx',
    schemaName: 'macro',
    viewName: 'vw_us_ca_policy_fx',
    label: 'U.S. / Canada Policy and FX',
    region: 'US_CA',
    category: 'comparison',
    description: 'Cross-border Fed/BoC policy spread, USD/CAD, CAD proxy, and divergence regimes.',
  },
  {
    viewKey: 'us-ca-inflation-compare',
    schemaName: 'macro',
    viewName: 'vw_us_ca_inflation_compare',
    label: 'U.S. / Canada Inflation Compare',
    region: 'US_CA',
    category: 'comparison',
    description: 'U.S. versus Canadian inflation, spreads, and inflation divergence regime.',
  },
  {
    viewKey: 'us-ca-labor-compare',
    schemaName: 'macro',
    viewName: 'vw_us_ca_labor_compare',
    label: 'U.S. / Canada Labor Compare',
    region: 'US_CA',
    category: 'comparison',
    description:
      'U.S. versus Canadian labor-market stress, unemployment, participation, and divergence regime.',
  },
];

const MACRO_VIEW_BY_KEY = new Map(MACRO_VIEW_REGISTRY.map((view) => [view.viewKey, view]));

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function toPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const numberValue = Number.parseInt(value, 10);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return fallback;
  }

  return Math.min(numberValue, max);
}

function isAllRowsRequest(filters = {}) {
  const allValue = String(filters.all || '')
    .trim()
    .toLowerCase();
  const limitValue = String(filters.limit || '')
    .trim()
    .toLowerCase();

  return (
    ['1', 'true', 'yes', 'all', 'max'].includes(allValue) || ['all', 'max'].includes(limitValue)
  );
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeBooleanFilter(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }

  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }

  return null;
}

function getPagination(filters = {}, options = {}) {
  if (options.allowAll === true && isAllRowsRequest(filters)) {
    return {
      all: true,
      limit: null,
      offset: 0,
    };
  }

  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || MAX_LIMIT;

  return {
    all: false,
    limit: toPositiveInteger(filters.limit, defaultLimit, maxLimit),
    offset: toPositiveInteger(filters.offset, 0),
  };
}

function normalizeViewKey(viewKey) {
  const normalized = normalizeOptionalString(viewKey);

  if (!normalized) {
    return null;
  }

  return normalized
    .replace(/^macro\.vw_/i, '')
    .replace(/^vw_/i, '')
    .replace(/_/g, '-')
    .toLowerCase();
}

function getMacroViewDefinition(viewKey) {
  const normalizedViewKey = normalizeViewKey(viewKey);
  const view = MACRO_VIEW_BY_KEY.get(normalizedViewKey);

  if (!view) {
    throw createHttpError(404, 'Macro view not found.', { viewKey });
  }

  return view;
}

function assertSafeIdentifier(identifier, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw createHttpError(400, `${label} contains invalid characters.`);
  }
}

function quoteIdentifier(identifier) {
  assertSafeIdentifier(identifier, 'SQL identifier');
  return `"${identifier.replace(/"/g, '""')}"`;
}

function getRelationSql({ schemaName, viewName }) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(viewName)}`;
}

function normalizeIndicatorCode(indicatorCode) {
  const normalized = normalizeOptionalString(indicatorCode);

  if (!normalized) {
    throw createHttpError(400, 'indicatorCode is required.');
  }

  const upperIndicatorCode = normalized.toUpperCase();

  if (!/^[A-Z0-9_]+$/.test(upperIndicatorCode)) {
    throw createHttpError(400, 'indicatorCode contains invalid characters.');
  }

  return upperIndicatorCode;
}

function buildWhereClause(clauses) {
  if (!clauses || clauses.length === 0) {
    return '';
  }

  return `WHERE ${clauses.join(' AND ')}`;
}

function addDateRangeFilters({ clauses, values, columnName, from, to }) {
  const normalizedFrom = normalizeOptionalString(from);
  const normalizedTo = normalizeOptionalString(to);

  if (normalizedFrom !== null) {
    values.push(normalizedFrom);
    clauses.push(`${columnName} >= $${values.length}::date`);
  }

  if (normalizedTo !== null) {
    values.push(normalizedTo);
    clauses.push(`${columnName} < $${values.length}::date`);
  }
}

function addEqualsFilter({ clauses, values, columnName, value }) {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === null) {
    return;
  }

  values.push(normalizedValue);
  clauses.push(`${columnName} = $${values.length}`);
}

function addBooleanFilter({ clauses, values, columnName, value }) {
  const normalizedValue = normalizeBooleanFilter(value);

  if (normalizedValue === null) {
    return;
  }

  values.push(normalizedValue);
  clauses.push(`${columnName} = $${values.length}`);
}

function addSearchFilter({ clauses, values, columns, searchText }) {
  const normalizedSearchText = normalizeOptionalString(searchText);

  if (normalizedSearchText === null) {
    return;
  }

  values.push(`%${normalizedSearchText}%`);
  const placeholder = `$${values.length}`;
  const searchClause = columns
    .map((columnName) => `${columnName} ILIKE ${placeholder}`)
    .join(' OR ');

  clauses.push(`(${searchClause})`);
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function sanitizeMacroView(view, stats = null) {
  return {
    viewKey: view.viewKey,
    schemaName: view.schemaName,
    viewName: view.viewName,
    databaseObject: `${view.schemaName}.${view.viewName}`,
    label: view.label,
    region: view.region,
    category: view.category,
    description: view.description,
    defaultOrder: 'date_desc',
    ...(stats ? { stats } : {}),
  };
}

function sanitizeColumn(row) {
  return {
    columnName: row.column_name,
    fieldName: toCamelCase(row.column_name),
    ordinalPosition: row.ordinal_position,
    dataType: row.data_type,
    numericPrecision: row.numeric_precision,
    numericScale: row.numeric_scale,
    isNullable: row.is_nullable === 'YES',
  };
}

function sanitizeIndicator(row) {
  return {
    indicatorCode: row.indicator_code,
    source: row.source,
    description: row.description,
    frequency: row.frequency,
    createdAt: row.created_at,
    active: row.active,
  };
}

function sanitizeIndicatorSeriesRow(row) {
  return {
    date: row.edate,
    value: row.value,
  };
}

async function getViewStats(view) {
  const relationSql = getRelationSql(view);
  const result = await query(
    `
      SELECT
        COUNT(*)::int AS total_rows,
        MIN(date) AS min_date,
        MAX(date) AS max_date
      FROM ${relationSql}
    `,
  );

  const row = result.rows[0] || {};

  return {
    totalRows: row.total_rows || 0,
    minDate: row.min_date || null,
    maxDate: row.max_date || null,
  };
}

async function listMacroViews(filters = {}) {
  const includeStats = normalizeBooleanFilter(filters.includeStats || filters.stats) === true;

  if (!includeStats) {
    return {
      items: MACRO_VIEW_REGISTRY.map((view) => sanitizeMacroView(view)),
    };
  }

  const statsEntries = await Promise.all(
    MACRO_VIEW_REGISTRY.map(async (view) => [view.viewKey, await getViewStats(view)]),
  );
  const statsByViewKey = new Map(statsEntries);

  return {
    items: MACRO_VIEW_REGISTRY.map((view) =>
      sanitizeMacroView(view, statsByViewKey.get(view.viewKey)),
    ),
  };
}

async function getMacroViewColumns(viewKey) {
  const view = getMacroViewDefinition(viewKey);
  const result = await query(
    `
      SELECT
        column_name,
        ordinal_position,
        data_type,
        numeric_precision,
        numeric_scale,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
    `,
    [view.schemaName, view.viewName],
  );

  return {
    view: sanitizeMacroView(view),
    columns: result.rows.map(sanitizeColumn),
  };
}

async function listMacroViewRows(viewKey, filters = {}) {
  const view = getMacroViewDefinition(viewKey);
  const { limit, offset } = getPagination(filters, { allowAll: true });
  const clauses = [];
  const values = [];

  addDateRangeFilters({
    clauses,
    values,
    columnName: 'date',
    from: filters.from,
    to: filters.to,
  });

  const whereClause = buildWhereClause(clauses);
  const relationSql = getRelationSql(view);
  const sortDirection =
    String(filters.sort || filters.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM ${relationSql} ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const paginationSql =
    limit === null ? '' : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const paginationValues = limit === null ? values : [...values, limit, offset];

  const dataResult = await query(
    `
      SELECT *
      FROM ${relationSql}
      ${whereClause}
      ORDER BY date ${sortDirection}
      ${paginationSql}
    `,
    paginationValues,
  );

  return {
    view: sanitizeMacroView(view),
    total,
    limit: limit === null ? total : limit,
    offset,
    items: dataResult.rows.map(camelizeRow),
  };
}

async function getLatestMacroViewRow(viewKey) {
  const view = getMacroViewDefinition(viewKey);
  const relationSql = getRelationSql(view);
  const result = await query(
    `
      SELECT *
      FROM ${relationSql}
      WHERE date IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    `,
  );

  return {
    view: sanitizeMacroView(view),
    item: result.rows[0] ? camelizeRow(result.rows[0]) : null,
  };
}

async function listMacroIndicators(filters = {}) {
  const { limit, offset } = getPagination(filters, {
    defaultLimit: DEFAULT_SERIES_LIMIT,
    maxLimit: MAX_SERIES_LIMIT,
  });
  const clauses = [];
  const values = [];

  if (filters.source !== undefined && filters.source !== null && filters.source !== '') {
    addEqualsFilter({
      clauses,
      values,
      columnName: 'source',
      value: String(filters.source).trim().toUpperCase(),
    });
  }

  addBooleanFilter({ clauses, values, columnName: 'active', value: filters.active });
  addSearchFilter({
    clauses,
    values,
    columns: ['indicator_code', 'source', 'description', 'frequency'],
    searchText: filters.q,
  });

  const whereClause = buildWhereClause(clauses);
  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM macro.indicators ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const dataResult = await query(
    `
      SELECT
        indicator_code,
        source,
        description,
        frequency,
        created_at,
        active
      FROM macro.indicators
      ${whereClause}
      ORDER BY source, indicator_code
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, limit, offset],
  );

  return {
    total,
    limit,
    offset,
    items: dataResult.rows.map(sanitizeIndicator),
  };
}

async function getMacroIndicator(indicatorCode) {
  const normalizedIndicatorCode = normalizeIndicatorCode(indicatorCode);
  const result = await query(
    `
      SELECT
        indicator_code,
        source,
        description,
        frequency,
        created_at,
        active
      FROM macro.indicators
      WHERE indicator_code = $1
      LIMIT 1
    `,
    [normalizedIndicatorCode],
  );

  if (result.rowCount === 0) {
    throw createHttpError(404, 'Indicator not found.', { indicatorCode: normalizedIndicatorCode });
  }

  const indicator = sanitizeIndicator(result.rows[0]);
  const stats = await getIndicatorSeriesStats(normalizedIndicatorCode);

  return {
    indicator,
    stats,
  };
}

async function ensureIndicatorTableExists(indicatorCode) {
  const relationName = `${quoteIdentifier('macro')}.${quoteIdentifier(indicatorCode)}`;
  const result = await query('SELECT to_regclass($1) AS relation_name', [relationName]);

  if (!result.rows[0]?.relation_name) {
    throw createHttpError(404, 'Indicator table not found.', { indicatorCode });
  }

  return relationName;
}

async function getIndicatorSeriesStats(indicatorCode) {
  const relationSql = await ensureIndicatorTableExists(indicatorCode);
  const result = await query(
    `
      SELECT
        COUNT(*)::int AS total_rows,
        MIN(edate) AS min_date,
        MAX(edate) AS max_date
      FROM ${relationSql}
    `,
  );

  const row = result.rows[0] || {};

  return {
    totalRows: row.total_rows || 0,
    minDate: row.min_date || null,
    maxDate: row.max_date || null,
  };
}

async function listMacroIndicatorSeries(indicatorCode, filters = {}) {
  const normalizedIndicatorCode = normalizeIndicatorCode(indicatorCode);
  const indicatorPayload = await getMacroIndicator(normalizedIndicatorCode);
  const relationSql = await ensureIndicatorTableExists(normalizedIndicatorCode);
  const { limit, offset } = getPagination(filters, {
    allowAll: true,
    defaultLimit: DEFAULT_SERIES_LIMIT,
    maxLimit: MAX_SERIES_LIMIT,
  });
  const clauses = [];
  const values = [];

  addDateRangeFilters({
    clauses,
    values,
    columnName: 'edate',
    from: filters.from,
    to: filters.to,
  });

  const whereClause = buildWhereClause(clauses);
  const sortDirection =
    String(filters.sort || filters.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM ${relationSql} ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const paginationSql =
    limit === null ? '' : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const paginationValues = limit === null ? values : [...values, limit, offset];

  const dataResult = await query(
    `
      SELECT edate, value
      FROM ${relationSql}
      ${whereClause}
      ORDER BY edate ${sortDirection}
      ${paginationSql}
    `,
    paginationValues,
  );

  return {
    indicator: indicatorPayload.indicator,
    stats: indicatorPayload.stats,
    total,
    limit: limit === null ? total : limit,
    offset,
    items: dataResult.rows.map(sanitizeIndicatorSeriesRow),
  };
}

async function getIndicatorSourceCounts() {
  const result = await query(
    `
      SELECT
        source,
        active,
        COUNT(*)::int AS total
      FROM macro.indicators
      GROUP BY source, active
      ORDER BY source, active DESC
    `,
  );

  return result.rows.map((row) => ({
    source: row.source,
    active: row.active,
    total: row.total,
  }));
}

async function getMacroSummary() {
  const [viewsPayload, indicatorCounts] = await Promise.all([
    listMacroViews({ includeStats: true }),
    getIndicatorSourceCounts(),
  ]);

  return {
    viewCount: MACRO_VIEW_REGISTRY.length,
    views: viewsPayload.items,
    indicatorCounts,
  };
}

module.exports = {
  listMacroViews,
  getMacroViewColumns,
  listMacroViewRows,
  getLatestMacroViewRow,
  listMacroIndicators,
  getMacroIndicator,
  listMacroIndicatorSeries,
  getMacroSummary,
};
