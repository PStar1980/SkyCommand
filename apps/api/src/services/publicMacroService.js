const macroReadService = require('./macroReadService');

const PUBLIC_VIEW_ROW_DEFAULT_LIMIT = 50;
const PUBLIC_VIEW_ROW_MAX_LIMIT = 250;
const PUBLIC_INDICATOR_DEFAULT_LIMIT = 250;
const PUBLIC_INDICATOR_MAX_LIMIT = 500;
const PUBLIC_SERIES_DEFAULT_LIMIT = 250;
const PUBLIC_SERIES_MAX_LIMIT = 1000;

function toPositiveInteger(value, fallback, max) {
  const numberValue = Number.parseInt(value, 10);

  if (Number.isNaN(numberValue) || numberValue < 0) {
    return fallback;
  }

  return Math.min(numberValue, max);
}

function normalizeQuery(filters = {}, defaults = {}) {
  return Object.fromEntries(
    Object.entries({ ...defaults, ...filters }).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    ),
  );
}

function publicizeView(view) {
  if (!view) {
    return null;
  }

  return {
    viewKey: view.viewKey,
    label: view.label,
    region: view.region,
    category: view.category,
    description: view.description,
    defaultOrder: view.defaultOrder,
    ...(view.stats ? { stats: view.stats } : {}),
  };
}

function publicizeColumn(column) {
  return {
    columnName: column.columnName,
    fieldName: column.fieldName,
    ordinalPosition: column.ordinalPosition,
    dataType: column.dataType,
    numericPrecision: column.numericPrecision,
    numericScale: column.numericScale,
    isNullable: column.isNullable,
  };
}

function publicizeIndicator(indicator) {
  return {
    indicatorCode: indicator.indicatorCode,
    source: indicator.source,
    description: indicator.description,
    frequency: indicator.frequency,
    active: indicator.active,
  };
}

function publicizeIndicatorStats(stats) {
  if (!stats) {
    return null;
  }

  return {
    totalRows: stats.totalRows,
    minDate: stats.minDate,
    maxDate: stats.maxDate,
  };
}

function publicizeSummary(payload) {
  return {
    viewCount: payload.viewCount,
    views: (payload.views || []).map(publicizeView),
    indicatorCounts: payload.indicatorCounts || [],
  };
}

async function getPublicMacroSummary() {
  const payload = await macroReadService.getMacroSummary();
  return publicizeSummary(payload);
}

async function listPublicMacroViews(filters = {}) {
  const payload = await macroReadService.listMacroViews(filters);

  return {
    items: (payload.items || []).map(publicizeView),
  };
}

async function getPublicMacroViewColumns(viewKey) {
  const payload = await macroReadService.getMacroViewColumns(viewKey);

  return {
    view: publicizeView(payload.view),
    columns: (payload.columns || []).map(publicizeColumn),
  };
}

async function listPublicMacroViewRows(viewKey, filters = {}) {
  const limit = toPositiveInteger(
    filters.limit,
    PUBLIC_VIEW_ROW_DEFAULT_LIMIT,
    PUBLIC_VIEW_ROW_MAX_LIMIT,
  );
  const payload = await macroReadService.listMacroViewRows(
    viewKey,
    normalizeQuery(filters, { limit }),
  );

  return {
    view: publicizeView(payload.view),
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items || [],
  };
}

async function getLatestPublicMacroViewRow(viewKey) {
  const payload = await macroReadService.getLatestMacroViewRow(viewKey);

  return {
    view: publicizeView(payload.view),
    item: payload.item,
  };
}

async function listPublicMacroIndicators(filters = {}) {
  const limit = toPositiveInteger(
    filters.limit,
    PUBLIC_INDICATOR_DEFAULT_LIMIT,
    PUBLIC_INDICATOR_MAX_LIMIT,
  );
  const payload = await macroReadService.listMacroIndicators(
    normalizeQuery(filters, { limit, active: true }),
  );

  return {
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: (payload.items || []).map(publicizeIndicator),
  };
}

async function getPublicMacroIndicator(indicatorCode) {
  const payload = await macroReadService.getMacroIndicator(indicatorCode);

  return {
    indicator: publicizeIndicator(payload.indicator),
    stats: publicizeIndicatorStats(payload.stats),
  };
}

async function listPublicMacroIndicatorSeries(indicatorCode, filters = {}) {
  const limit = toPositiveInteger(
    filters.limit,
    PUBLIC_SERIES_DEFAULT_LIMIT,
    PUBLIC_SERIES_MAX_LIMIT,
  );
  const payload = await macroReadService.listMacroIndicatorSeries(
    indicatorCode,
    normalizeQuery(filters, { limit }),
  );

  return {
    indicator: publicizeIndicator(payload.indicator),
    stats: publicizeIndicatorStats(payload.stats),
    total: payload.total,
    limit: payload.limit,
    offset: payload.offset,
    items: payload.items || [],
  };
}

module.exports = {
  getPublicMacroSummary,
  listPublicMacroViews,
  getPublicMacroViewColumns,
  listPublicMacroViewRows,
  getLatestPublicMacroViewRow,
  listPublicMacroIndicators,
  getPublicMacroIndicator,
  listPublicMacroIndicatorSeries,
};
