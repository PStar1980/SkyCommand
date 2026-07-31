const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../../tools/src/toolResultContract');

const MACRO_INGESTION_OUTPUT_TYPE = 'macro_ingestion_summary.v1';
const MACRO_INGESTION_OUTCOMES = new Set(['UPDATED', 'UNCHANGED', 'FAILED', 'PARTIAL']);

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}

function normalizeError(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return {
      code: 'MACRO_INGESTION_ERROR',
      message: value,
    };
  }

  return {
    code: String(value.code || 'MACRO_INGESTION_ERROR'),
    message: String(value.message || 'Macro ingestion failed.'),
  };
}

function determineIndicatorOutcome(result = {}) {
  const explicitOutcome = String(result.outcome || '').toUpperCase();

  if (MACRO_INGESTION_OUTCOMES.has(explicitOutcome)) {
    return explicitOutcome;
  }

  if (result.ok === false || result.error) {
    return 'FAILED';
  }

  return normalizeNumber(result.rowsInserted) > 0 ? 'UPDATED' : 'UNCHANGED';
}

function normalizeIndicatorResult(result = {}) {
  const outcome = determineIndicatorOutcome(result);

  return {
    indicatorCode: String(result.indicatorCode || result.code || 'UNKNOWN').toUpperCase(),
    outcome,
    stagingRows: normalizeNumber(result.stagingRows),
    stagingMinDate: normalizeNullableString(result.stagingMinDate),
    stagingMaxDate: normalizeNullableString(result.stagingMaxDate),
    newRowsDetected: normalizeNumber(result.newRowsDetected),
    rowsInserted: normalizeNumber(result.rowsInserted),
    previousTargetMaxDate: normalizeNullableString(result.previousTargetMaxDate),
    sourceMaxDate: normalizeNullableString(result.sourceMaxDate || result.stagingMaxDate),
    currentTargetMaxDate: normalizeNullableString(result.currentTargetMaxDate),
    startedAt: normalizeNullableString(result.startedAt),
    completedAt: normalizeNullableString(result.completedAt || result.finishedAt),
    durationMs: normalizeNumber(result.durationMs),
    error: outcome === 'FAILED' ? normalizeError(result.error) : null,
  };
}

function summarizeMacroIngestionResults(results = []) {
  const indicators = results.map(normalizeIndicatorResult);
  const totals = indicators.reduce((summary, indicator) => {
    summary.indicatorsRequested += 1;

    if (indicator.outcome === 'FAILED') {
      summary.indicatorsFailed += 1;
    } else {
      summary.indicatorsSucceeded += 1;
    }

    if (indicator.outcome === 'UPDATED') {
      summary.indicatorsUpdated += 1;
    }

    if (indicator.outcome === 'UNCHANGED') {
      summary.indicatorsUnchanged += 1;
    }

    summary.rowsStaged += indicator.stagingRows;
    summary.rowsDetectedAsNew += indicator.newRowsDetected;
    summary.rowsInserted += indicator.rowsInserted;

    return summary;
  }, {
    indicatorsRequested: 0,
    indicatorsSucceeded: 0,
    indicatorsFailed: 0,
    indicatorsUpdated: 0,
    indicatorsUnchanged: 0,
    rowsStaged: 0,
    rowsDetectedAsNew: 0,
    rowsInserted: 0,
  });

  return { indicators, totals };
}

function determineBatchOutcome(totals = {}) {
  if (totals.indicatorsFailed > 0 && totals.indicatorsSucceeded > 0) {
    return 'PARTIAL';
  }

  if (totals.indicatorsFailed > 0) {
    return 'FAILED';
  }

  if (totals.indicatorsUpdated > 0) {
    return 'UPDATED';
  }

  return 'UNCHANGED';
}

function getBatchDurationMs(startedAt, completedAt) {
  const start = startedAt ? new Date(startedAt) : null;
  const end = completedAt ? new Date(completedAt) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(0, end.getTime() - start.getTime());
}

function createMacroIngestionToolResult({ sourceCode, batchResult = {}, message } = {}) {
  const { indicators, totals } = summarizeMacroIngestionResults(batchResult.results || []);
  const outcome = determineBatchOutcome(totals);
  const failedIndicators = indicators
    .filter((indicator) => indicator.outcome === 'FAILED')
    .map((indicator) => indicator.indicatorCode);
  const success = totals.indicatorsFailed === 0;
  const completedAt = batchResult.completedAt || new Date().toISOString();
  const startedAt = batchResult.startedAt || completedAt;
  const normalizedSourceCode = String(sourceCode || batchResult.source || 'UNKNOWN').toUpperCase();
  const warnings = [];

  if (failedIndicators.length > 0) {
    warnings.push(`${failedIndicators.length} indicator(s) failed: ${failedIndicators.join(', ')}`);
  }

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: message || `${normalizedSourceCode} ingestion ${success ? 'completed successfully' : 'completed with failures'}.`,
    outputType: MACRO_INGESTION_OUTPUT_TYPE,
    output: {
      sourceCode: normalizedSourceCode,
      outcome,
      selectedIndicators: Boolean(batchResult.selectedIndicators),
      startedAt,
      completedAt,
      durationMs: getBatchDurationMs(startedAt, completedAt),
      totals,
      indicators,
    },
    warnings,
    error: success
      ? null
      : {
          code: outcome === 'PARTIAL' ? 'MACRO_INGESTION_PARTIAL_FAILURE' : 'MACRO_INGESTION_FAILED',
          message: `${totals.indicatorsFailed} indicator(s) failed during ${normalizedSourceCode} ingestion.`,
          failedIndicators,
        },
    metadata: {
      mode: batchResult.mode || 'indicator_batch',
      concurrency: normalizeNumber(batchResult.concurrency),
      batchCount: normalizeNumber(batchResult.batchCount),
      ingestionLedger: batchResult.ledger || null,
    },
  });
}

function createMacroIngestionFailureToolResult({ sourceCode, error, startedAt, completedAt } = {}) {
  const normalizedSourceCode = String(sourceCode || 'UNKNOWN').toUpperCase();
  const safeError = normalizeError(error);
  const finishedAt = completedAt || new Date().toISOString();
  const beganAt = startedAt || finishedAt;

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success: false,
    message: `${normalizedSourceCode} ingestion failed before a batch result was produced.`,
    outputType: MACRO_INGESTION_OUTPUT_TYPE,
    output: {
      sourceCode: normalizedSourceCode,
      outcome: 'FAILED',
      selectedIndicators: false,
      startedAt: beganAt,
      completedAt: finishedAt,
      durationMs: getBatchDurationMs(beganAt, finishedAt),
      totals: {
        indicatorsRequested: 0,
        indicatorsSucceeded: 0,
        indicatorsFailed: 0,
        indicatorsUpdated: 0,
        indicatorsUnchanged: 0,
        rowsStaged: 0,
        rowsDetectedAsNew: 0,
        rowsInserted: 0,
      },
      indicators: [],
    },
    warnings: [],
    error: safeError,
    metadata: {
      mode: 'fatal_error',
      concurrency: 0,
      batchCount: 0,
    },
  });
}

function toLegacyPipelineSummary(results = []) {
  const { totals } = summarizeMacroIngestionResults(results);

  return {
    total: totals.indicatorsRequested,
    succeeded: totals.indicatorsSucceeded,
    failed: totals.indicatorsFailed,
    updated: totals.indicatorsUpdated,
    unchanged: totals.indicatorsUnchanged,
    rowsStaged: totals.rowsStaged,
    rowsDetectedAsNew: totals.rowsDetectedAsNew,
    rowsInserted: totals.rowsInserted,
  };
}

module.exports = {
  MACRO_INGESTION_OUTPUT_TYPE,
  createMacroIngestionFailureToolResult,
  createMacroIngestionToolResult,
  determineBatchOutcome,
  determineIndicatorOutcome,
  normalizeIndicatorResult,
  summarizeMacroIngestionResults,
  toLegacyPipelineSummary,
};
