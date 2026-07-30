const { query } = require('../../../../packages/db/src/connection');
const ingestionCatalogueService = require('../../../../packages/ingestion/src/catalogue/ingestionCatalogueService');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_RECENT_LIMIT = 25;
const MAX_RECENT_LIMIT = 200;

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

function normalizeSource(source) {
  const normalized = normalizeOptionalString(source);
  return normalized ? normalized.toUpperCase() : null;
}

async function loadIngestionCatalogueContext() {
  const [tools, sources] = await Promise.all([
    ingestionCatalogueService.listIngestionTools(),
    ingestionCatalogueService.listIngestionSources(),
  ]);

  return { tools, sources };
}

async function getSourceDefinition(source, catalogueContext = null) {
  const normalizedSource = normalizeSource(source);

  if (!normalizedSource) {
    throw createHttpError(400, 'source is required.');
  }

  const sourceDefinition = catalogueContext
    ? catalogueContext.sources.find(
        (candidate) =>
          candidate.sourceCode === normalizedSource ||
          candidate.aliases.some((alias) => normalizeSource(alias) === normalizedSource),
      )
    : await ingestionCatalogueService.getIngestionSource(normalizedSource);

  if (!sourceDefinition) {
    throw createHttpError(404, 'Ingestion source not found.', {
      source: normalizedSource,
    });
  }

  return sourceDefinition;
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

function getPagination(filters = {}, options = {}) {
  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || MAX_LIMIT;

  return {
    limit: toPositiveInteger(filters.limit, defaultLimit, maxLimit),
    offset: toPositiveInteger(filters.offset, 0),
  };
}

function buildWhereClause(clauses) {
  if (!clauses || clauses.length === 0) {
    return '';
  }

  return `WHERE ${clauses.join(' AND ')}`;
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

function addTimestampRangeFilters({ clauses, values, columnName, from, to }) {
  const normalizedFrom = normalizeOptionalString(from);
  const normalizedTo = normalizeOptionalString(to);

  if (normalizedFrom !== null) {
    values.push(normalizedFrom);
    clauses.push(`${columnName} >= $${values.length}::timestamptz`);
  }

  if (normalizedTo !== null) {
    values.push(normalizedTo);
    clauses.push(`${columnName} < $${values.length}::timestamptz`);
  }
}

function addIngestionExecutionFilter({ clauses, values, tools }) {
  const toolIds = tools.map((tool) => String(tool.toolId));
  const toolCodes = tools.map((tool) => tool.toolCode);
  const scriptPaths = tools.map((tool) => tool.scriptPath);

  if (toolIds.length === 0) {
    clauses.push('FALSE');
    return;
  }

  values.push(toolIds);
  const toolIdsPlaceholder = `$${values.length}`;
  values.push(toolCodes);
  const toolCodesPlaceholder = `$${values.length}`;
  values.push(scriptPaths);
  const scriptPathsPlaceholder = `$${values.length}`;

  clauses.push(`(
    COALESCE(metadata->>'toolId', '') = ANY(${toolIdsPlaceholder}::text[])
    OR script_name = ANY(${toolCodesPlaceholder}::text[])
    OR EXISTS (
      SELECT 1
      FROM unnest(${scriptPathsPlaceholder}::text[]) AS configured_path
      WHERE COALESCE(script_file, '') ILIKE '%' || configured_path
    )
  )`);
}

function addExecutionSourceFilter({ clauses, values, sourceDefinition }) {
  if (!sourceDefinition) {
    return;
  }

  values.push(sourceDefinition.toolIds.map(String));
  const toolIdsPlaceholder = `$${values.length}`;
  values.push(sourceDefinition.toolCodes);
  const toolCodesPlaceholder = `$${values.length}`;
  values.push(sourceDefinition.scriptPaths);
  const scriptPathsPlaceholder = `$${values.length}`;
  values.push(sourceDefinition.sourceCode);
  const sourceCodePlaceholder = `$${values.length}`;

  clauses.push(`(
    COALESCE(metadata->>'toolId', '') = ANY(${toolIdsPlaceholder}::text[])
    OR script_name = ANY(${toolCodesPlaceholder}::text[])
    OR EXISTS (
      SELECT 1
      FROM unnest(${scriptPathsPlaceholder}::text[]) AS configured_path
      WHERE COALESCE(script_file, '') ILIKE '%' || configured_path
    )
    OR UPPER(COALESCE(metadata->>'source', '')) = ${sourceCodePlaceholder}
  )`);
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

function getIndicatorRelationSql(indicatorCode) {
  return `${quoteIdentifier('macro')}.${quoteIdentifier(indicatorCode)}`;
}

function toCamelCase(value) {
  return String(value).replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [toCamelCase(key), value]),
  );
}

function sanitizeSourceDefinition(sourceDefinition) {
  return {
    source: sourceDefinition.sourceCode,
    label: sourceDefinition.sourceName,
    provider: sourceDefinition.providerName,
    category: String(sourceDefinition.domainCode || '').toLowerCase(),
    description: sourceDefinition.description,
    domainCode: sourceDefinition.domainCode,
    sourceId: sourceDefinition.sourceId,
    toolCodes: sourceDefinition.toolCodes,
    adapterCodes: sourceDefinition.adapterCodes,
    scriptFiles: sourceDefinition.scriptPaths.map((scriptPath) =>
      String(scriptPath || '').split('/').pop(),
    ),
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

function sanitizeExecution(row, sourceDefinitions = []) {
  const execution = camelizeRow(row);

  return {
    executionId: execution.executionId,
    userId: execution.userId || null,
    email: execution.email || null,
    username: execution.username || null,
    displayName: execution.displayName || null,
    sessionId: execution.sessionId || null,
    source: inferExecutionSource(row, sourceDefinitions),
    scriptName: execution.scriptName,
    scriptFile: execution.scriptFile,
    category: execution.category,
    parameters: execution.parameters || {},
    status: execution.status,
    exitCode: execution.exitCode,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: execution.durationMs,
    durationSeconds: execution.durationSeconds,
    summary: execution.summary,
    metadata: execution.metadata || {},
  };
}

function inferExecutionSource(row = {}, sourceDefinitions = []) {
  const metadata = row.metadata || {};
  const metadataToolId = String(metadata.toolId || '');
  const scriptName = String(row.script_name || '');
  const scriptFile = String(row.script_file || '');

  for (const sourceDefinition of sourceDefinitions) {
    if (sourceDefinition.toolIds.map(String).includes(metadataToolId)) {
      return sourceDefinition.sourceCode;
    }

    if (sourceDefinition.toolCodes.includes(scriptName)) {
      return sourceDefinition.sourceCode;
    }

    if (
      sourceDefinition.scriptPaths.some((configuredPath) =>
        scriptFile.replace(/\\/g, '/').endsWith(String(configuredPath || '').replace(/\\/g, '/')),
      )
    ) {
      return sourceDefinition.sourceCode;
    }
  }

  return normalizeSource(metadata.source) || null;
}

function getFreshnessThresholdDays(frequency) {
  const normalizedFrequency = String(frequency || '')
    .trim()
    .toLowerCase();

  if (normalizedFrequency.includes('daily')) {
    return 7;
  }

  if (normalizedFrequency.includes('weekly')) {
    return 21;
  }

  if (normalizedFrequency.includes('monthly')) {
    return 75;
  }

  if (normalizedFrequency.includes('quarterly')) {
    return 190;
  }

  if (normalizedFrequency.includes('annual') || normalizedFrequency.includes('yearly')) {
    return 550;
  }

  return 120;
}

function getDaysSince(dateValue) {
  if (!dateValue) {
    return null;
  }

  const date = new Date(dateValue);
  const time = date.getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return Math.floor((Date.now() - time) / 86400000);
}

function getLatestDate(dateValues) {
  const validDates = dateValues
    .filter(Boolean)
    .map((dateValue) => new Date(dateValue))
    .filter((dateValue) => !Number.isNaN(dateValue.getTime()));

  if (validDates.length === 0) {
    return null;
  }

  return new Date(Math.max(...validDates.map((dateValue) => dateValue.getTime())));
}

function getEarliestDate(dateValues) {
  const validDates = dateValues
    .filter(Boolean)
    .map((dateValue) => new Date(dateValue))
    .filter((dateValue) => !Number.isNaN(dateValue.getTime()));

  if (validDates.length === 0) {
    return null;
  }

  return new Date(Math.min(...validDates.map((dateValue) => dateValue.getTime())));
}

function evaluateIndicatorStatus(indicator, stats) {
  if (!indicator.active) {
    return {
      status: 'INACTIVE',
      severity: 'info',
      message: 'Indicator is inactive.',
    };
  }

  if (stats.error) {
    return {
      status: 'ERROR',
      severity: 'error',
      message: stats.error,
    };
  }

  if (!stats.tableExists) {
    return {
      status: 'MISSING_TABLE',
      severity: 'error',
      message: 'Indicator table does not exist.',
    };
  }

  if (!stats.totalRows || !stats.maxDate) {
    return {
      status: 'NO_DATA',
      severity: 'warning',
      message: 'Indicator table exists but has no loaded data.',
    };
  }

  const thresholdDays = getFreshnessThresholdDays(indicator.frequency);
  const daysSinceLatest = getDaysSince(stats.maxDate);

  if (daysSinceLatest !== null && daysSinceLatest > thresholdDays) {
    return {
      status: 'STALE',
      severity: 'warning',
      message: `Latest data is ${daysSinceLatest} day(s) old; threshold is ${thresholdDays} day(s).`,
    };
  }

  return {
    status: 'CURRENT',
    severity: 'ok',
    message: 'Indicator data is current based on its frequency threshold.',
  };
}

function countIndicatorStatuses(indicators) {
  const counts = {
    total: indicators.length,
    active: 0,
    inactive: 0,
    current: 0,
    stale: 0,
    noData: 0,
    missingTable: 0,
    error: 0,
  };

  for (const indicator of indicators) {
    if (indicator.active) {
      counts.active += 1;
    } else {
      counts.inactive += 1;
    }

    switch (indicator.status) {
      case 'CURRENT':
        counts.current += 1;
        break;
      case 'STALE':
        counts.stale += 1;
        break;
      case 'NO_DATA':
        counts.noData += 1;
        break;
      case 'MISSING_TABLE':
        counts.missingTable += 1;
        break;
      case 'ERROR':
        counts.error += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function getAggregateHealthStatus(counts) {
  if (!counts.active) {
    return 'INACTIVE';
  }

  if (counts.error > 0 || counts.missingTable > 0) {
    return 'ERROR';
  }

  if (counts.noData > 0 || counts.stale > 0) {
    return 'WARNING';
  }

  return 'CURRENT';
}

function buildSourceStatus({ sourceDefinition, indicators, latestExecution = null }) {
  const counts = countIndicatorStatuses(indicators);
  const latestDataDate = getLatestDate(indicators.map((indicator) => indicator.stats.maxDate));
  const earliestDataDate = getEarliestDate(indicators.map((indicator) => indicator.stats.minDate));

  return {
    ...sanitizeSourceDefinition(sourceDefinition),
    status: getAggregateHealthStatus(counts),
    counts,
    earliestDataDate,
    latestDataDate,
    daysSinceLatestData: getDaysSince(latestDataDate),
    latestExecution,
  };
}

async function loadIndicatorRows(filters = {}) {
  const clauses = [];
  const values = [];
  const source = normalizeSource(filters.source);

  if (source) {
    addEqualsFilter({
      clauses,
      values,
      columnName: 'source',
      value: source,
    });
  }

  addBooleanFilter({
    clauses,
    values,
    columnName: 'active',
    value: filters.active,
  });

  addSearchFilter({
    clauses,
    values,
    columns: ['indicator_code', 'source', 'description', 'frequency'],
    searchText: filters.q,
  });

  const whereClause = buildWhereClause(clauses);
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
      ${whereClause}
      ORDER BY source, indicator_code
    `,
    values,
  );

  return result.rows.map(sanitizeIndicator);
}

async function loadSingleIndicatorRow(indicatorCode) {
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
    throw createHttpError(404, 'Indicator not found.', {
      indicatorCode: normalizedIndicatorCode,
    });
  }

  return sanitizeIndicator(result.rows[0]);
}

async function checkIndicatorTableExists(indicatorCode) {
  const relationSql = getIndicatorRelationSql(indicatorCode);
  const result = await query('SELECT to_regclass($1) AS relation_name', [relationSql]);

  return Boolean(result.rows[0]?.relation_name);
}

async function getIndicatorTableStats(indicatorCode) {
  try {
    const tableExists = await checkIndicatorTableExists(indicatorCode);

    if (!tableExists) {
      return {
        tableExists: false,
        totalRows: 0,
        minDate: null,
        maxDate: null,
      };
    }

    const relationSql = getIndicatorRelationSql(indicatorCode);
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
      tableExists: true,
      totalRows: row.total_rows || 0,
      minDate: row.min_date || null,
      maxDate: row.max_date || null,
    };
  } catch (error) {
    return {
      tableExists: false,
      totalRows: 0,
      minDate: null,
      maxDate: null,
      error: error.message || 'Failed to read indicator table stats.',
    };
  }
}

async function buildIndicatorStatus(indicator) {
  const stats = await getIndicatorTableStats(indicator.indicatorCode);
  const evaluation = evaluateIndicatorStatus(indicator, stats);

  return {
    ...indicator,
    status: evaluation.status,
    severity: evaluation.severity,
    message: evaluation.message,
    freshnessThresholdDays: getFreshnessThresholdDays(indicator.frequency),
    daysSinceLatestData: getDaysSince(stats.maxDate),
    stats,
  };
}

async function buildIndicatorStatuses(indicators) {
  return Promise.all(indicators.map((indicator) => buildIndicatorStatus(indicator)));
}

async function getRecentIngestionExecutions(filters = {}, catalogueContext = null) {
  const context = catalogueContext || (await loadIngestionCatalogueContext());
  const { limit, offset } = getPagination(filters, {
    defaultLimit: DEFAULT_RECENT_LIMIT,
    maxLimit: MAX_RECENT_LIMIT,
  });
  const clauses = [];
  const values = [];
  const sourceDefinition = filters.source
    ? await getSourceDefinition(filters.source, context)
    : null;

  addIngestionExecutionFilter({ clauses, values, tools: context.tools });
  addExecutionSourceFilter({ clauses, values, sourceDefinition });

  const normalizedStatus = normalizeOptionalString(filters.status);

  if (normalizedStatus) {
    values.push(normalizedStatus.toUpperCase());
    clauses.push(`status = $${values.length}`);
  }

  addTimestampRangeFilters({
    clauses,
    values,
    columnName: 'started_at',
    from: filters.from || filters.startedFrom,
    to: filters.to || filters.startedTo,
  });

  addSearchFilter({
    clauses,
    values,
    columns: ['script_name', 'script_file', 'category', 'summary'],
    searchText: filters.q,
  });

  const whereClause = buildWhereClause(clauses);
  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM auth.vw_script_execution_recent ${whereClause}`,
    values,
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const dataResult = await query(
    `
      SELECT
        execution_id,
        user_id,
        email,
        username,
        display_name,
        session_id,
        script_name,
        script_file,
        category,
        parameters,
        status,
        exit_code,
        started_at,
        finished_at,
        duration_ms,
        duration_seconds,
        summary,
        metadata
      FROM auth.vw_script_execution_recent
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, limit, offset],
  );

  return {
    total,
    limit,
    offset,
    items: dataResult.rows.map((row) => sanitizeExecution(row, context.sources)),
  };
}

async function getLatestExecutionsBySource(catalogueContext) {
  const recentPayload = await getRecentIngestionExecutions(
    {
      limit: 100,
      offset: 0,
    },
    catalogueContext,
  );
  const latestBySource = new Map();

  for (const execution of recentPayload.items) {
    if (!execution.source || latestBySource.has(execution.source)) {
      continue;
    }

    latestBySource.set(execution.source, execution);
  }

  return latestBySource;
}

async function listIngestionTools(filters = {}) {
  return {
    items: await ingestionCatalogueService.listIngestionTools({
      domainCode: filters.domainCode,
      sourceCode: filters.source,
      channelCode: filters.channelCode,
    }),
  };
}

async function listIngestionSources() {
  const catalogueContext = await loadIngestionCatalogueContext();
  const observableSources = catalogueContext.sources.filter(
    (sourceDefinition) =>
      sourceDefinition.observabilityEnabled && sourceDefinition.legacyIndicatorSourceCode,
  );
  const [allIndicators, latestExecutionsBySource] = await Promise.all([
    buildIndicatorStatuses(await loadIndicatorRows({})),
    getLatestExecutionsBySource(catalogueContext),
  ]);

  return {
    items: observableSources.map((sourceDefinition) => {
      const indicatorSource = sourceDefinition.legacyIndicatorSourceCode;
      const sourceIndicators = allIndicators.filter(
        (indicator) => indicator.source === indicatorSource,
      );

      return buildSourceStatus({
        sourceDefinition,
        indicators: sourceIndicators,
        latestExecution: latestExecutionsBySource.get(sourceDefinition.sourceCode) || null,
      });
    }),
  };
}

async function getIngestionSource(source) {
  const catalogueContext = await loadIngestionCatalogueContext();
  const sourceDefinition = await getSourceDefinition(source, catalogueContext);
  const indicatorSource =
    sourceDefinition.legacyIndicatorSourceCode || sourceDefinition.sourceCode;
  const [sourceIndicators, recentPayload] = await Promise.all([
    buildIndicatorStatuses(await loadIndicatorRows({ source: indicatorSource })),
    getRecentIngestionExecutions(
      { source: sourceDefinition.sourceCode, limit: 10 },
      catalogueContext,
    ),
  ]);

  return {
    source: buildSourceStatus({
      sourceDefinition,
      indicators: sourceIndicators,
      latestExecution: recentPayload.items[0] || null,
    }),
    indicators: sourceIndicators,
    recentExecutions: recentPayload.items,
  };
}

async function listIngestionIndicatorStatuses(filters = {}) {
  const { limit, offset } = getPagination(filters);
  const source = normalizeSource(filters.source);
  const baseIndicators = await loadIndicatorRows({
    source,
    active: filters.active,
    q: filters.q,
  });
  const indicatorsWithStatus = await buildIndicatorStatuses(baseIndicators);
  const requestedStatus = normalizeOptionalString(filters.status);
  const filteredItems = requestedStatus
    ? indicatorsWithStatus.filter((indicator) => indicator.status === requestedStatus.toUpperCase())
    : indicatorsWithStatus;
  const pagedItems = filteredItems.slice(offset, offset + limit);

  return {
    total: filteredItems.length,
    limit,
    offset,
    items: pagedItems,
  };
}

async function getIngestionIndicatorStatus(indicatorCode) {
  const indicator = await loadSingleIndicatorRow(indicatorCode);

  return {
    indicator: await buildIndicatorStatus(indicator),
  };
}

async function getIngestionStatusSummary(filters = {}) {
  const [sourcesPayload, recentPayload] = await Promise.all([
    listIngestionSources(),
    getRecentIngestionExecutions({
      limit: toPositiveInteger(filters.recentLimit, 10, 50),
      offset: 0,
    }),
  ]);

  const counts = sourcesPayload.items.reduce(
    (accumulator, source) => {
      accumulator.totalIndicators += source.counts.total;
      accumulator.activeIndicators += source.counts.active;
      accumulator.inactiveIndicators += source.counts.inactive;
      accumulator.currentIndicators += source.counts.current;
      accumulator.staleIndicators += source.counts.stale;
      accumulator.noDataIndicators += source.counts.noData;
      accumulator.missingTableIndicators += source.counts.missingTable;
      accumulator.errorIndicators += source.counts.error;
      return accumulator;
    },
    {
      totalIndicators: 0,
      activeIndicators: 0,
      inactiveIndicators: 0,
      currentIndicators: 0,
      staleIndicators: 0,
      noDataIndicators: 0,
      missingTableIndicators: 0,
      errorIndicators: 0,
    },
  );

  const overallStatus =
    counts.errorIndicators > 0 || counts.missingTableIndicators > 0
      ? 'ERROR'
      : counts.staleIndicators > 0 || counts.noDataIndicators > 0
        ? 'WARNING'
        : 'CURRENT';

  return {
    generatedAt: new Date().toISOString(),
    overallStatus,
    sourceCount: sourcesPayload.items.length,
    ...counts,
    sources: sourcesPayload.items,
    recentExecutions: recentPayload.items,
  };
}

module.exports = {
  listIngestionTools,
  listIngestionSources,
  getIngestionSource,
  getRecentIngestionExecutions,
  listIngestionIndicatorStatuses,
  getIngestionIndicatorStatus,
  getIngestionStatusSummary,
};
