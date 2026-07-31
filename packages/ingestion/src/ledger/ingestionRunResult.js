const {
  TOOL_RESULT_SCHEMA_VERSION,
  validateToolResult,
} = require('../../../tools/src/toolResultContract');

const INGESTION_RUN_OUTPUT_TYPE = 'ingestion_run_summary.v1';
const RUN_OUTCOMES = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED']);
const ITEM_OUTCOMES = new Set(['UPDATED', 'UNCHANGED', 'FAILED', 'SKIPPED', 'REJECTED', 'CANCELLED']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function code(value, fallback = 'UNKNOWN') {
  const text = nullable(value);
  return String(text || fallback).trim().toUpperCase();
}

function classifyError(error = {}) {
  const errorCode = code(error.code, 'UNKNOWN');
  const message = String(error.message || '').toLowerCase();
  const combined = `${errorCode} ${message}`.toLowerCase();

  if (/timeout|timed out|etimedout/.test(combined)) return 'TIMEOUT';
  if (/econn|enotfound|network|socket|dns|fetch failed/.test(combined)) return 'NETWORK';
  if (/401|403|unauth|forbidden|credential|token|api key/.test(combined)) return 'AUTH';
  if (/http|429|5\d\d|4\d\d/.test(combined)) return 'HTTP';
  if (/config|mapping|catalog|profile|unknown indicator|unknown asset/.test(combined)) return 'CONFIGURATION';
  if (/normaliz|transform|parse|csv/.test(combined)) return 'NORMALIZATION';
  if (/validat|quality|schema/.test(combined)) return 'VALIDATION';
  if (/load|insert|update|copy|postgres|database|sql/.test(combined)) return 'LOAD';
  if (/source|provider|payload|response/.test(combined)) return 'SOURCE_DATA';
  return 'UNKNOWN';
}

function normalizeItem(item = {}) {
  const rawOutcome = code(item.outcome || item.outcomeCode, item.error ? 'FAILED' : 'UNCHANGED');
  const outcome = ITEM_OUTCOMES.has(rawOutcome) ? rawOutcome : (item.error ? 'FAILED' : 'UNCHANGED');
  const error = item.error || null;

  return {
    assetCode: code(item.assetCode || item.indicatorCode || item.code),
    attemptNumber: Math.max(1, number(item.attemptNumber, 1)),
    outcome,
    retryable: item.retryable === undefined || item.retryable === null ? null : Boolean(item.retryable),
    httpStatus: item.httpStatus === undefined || item.httpStatus === null ? null : number(item.httpStatus),
    sourceMinDate: nullable(item.sourceMinDate || item.stagingMinDate),
    sourceMaxDate: nullable(item.sourceMaxDate || item.stagingMaxDate),
    previousTargetMaxDate: nullable(item.previousTargetMaxDate),
    currentTargetMaxDate: nullable(item.currentTargetMaxDate),
    rowsStaged: number(item.rowsStaged || item.stagingRows),
    rowsDetectedAsNew: number(item.rowsDetectedAsNew || item.newRowsDetected),
    rowsInserted: number(item.rowsInserted),
    rowsUpdated: number(item.rowsUpdated),
    rowsUnchanged: number(item.rowsUnchanged),
    rowsRejected: number(item.rowsRejected),
    startedAt: nullable(item.startedAt),
    completedAt: nullable(item.completedAt || item.finishedAt),
    durationMs: number(item.durationMs),
    errorCategoryCode: outcome === 'FAILED'
      ? code(item.errorCategoryCode || classifyError(error || item), 'UNKNOWN')
      : null,
    errorCode: outcome === 'FAILED' ? nullable(error?.code || item.errorCode) : null,
    errorMessage: outcome === 'FAILED' ? nullable(error?.message || item.errorMessage) : null,
    diagnostics: item.diagnostics && typeof item.diagnostics === 'object' ? item.diagnostics : {},
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
  };
}

function summarizeItems(items = []) {
  const totals = {
    itemsRequested: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    itemsUpdated: 0,
    itemsUnchanged: 0,
    rowsStaged: 0,
    rowsDetectedAsNew: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsRejected: 0,
    attempts: items.length,
    retries: items.filter((item) => item.attemptNumber > 1).length,
  };
  const latestByAsset = new Map();

  for (const item of items) {
    totals.rowsStaged += item.rowsStaged;
    totals.rowsDetectedAsNew += item.rowsDetectedAsNew;
    totals.rowsInserted += item.rowsInserted;
    totals.rowsUpdated += item.rowsUpdated;
    totals.rowsUnchanged += item.rowsUnchanged;
    totals.rowsRejected += item.rowsRejected;

    const existing = latestByAsset.get(item.assetCode);
    if (!existing || item.attemptNumber >= existing.attemptNumber) {
      latestByAsset.set(item.assetCode, item);
    }
  }

  totals.itemsRequested = latestByAsset.size;
  for (const item of latestByAsset.values()) {
    if (['UPDATED', 'UNCHANGED'].includes(item.outcome)) totals.itemsSucceeded += 1;
    if (item.outcome === 'FAILED') totals.itemsFailed += 1;
    if (item.outcome === 'UPDATED') totals.itemsUpdated += 1;
    if (item.outcome === 'UNCHANGED') totals.itemsUnchanged += 1;
  }

  return totals;
}

function determineRunOutcome(totals = {}, explicit) {
  const requested = code(explicit, '');
  if (RUN_OUTCOMES.has(requested)) return requested;
  if (totals.itemsFailed > 0 && totals.itemsSucceeded > 0) return 'PARTIAL';
  if (totals.itemsFailed > 0) return 'FAILED';
  return 'SUCCESS';
}

function normalizeRunSummary(summary = {}) {
  const items = (summary.items || summary.indicators || []).map(normalizeItem);
  const totals = summarizeItems(items);
  const startedAt = nullable(summary.startedAt) || new Date().toISOString();
  const completedAt = nullable(summary.completedAt) || startedAt;
  const outcome = determineRunOutcome(totals, summary.outcome || summary.statusCode);

  return {
    ingestionRunId: nullable(summary.ingestionRunId || summary.runId),
    domainCode: code(summary.domainCode, 'UNKNOWN'),
    sourceCode: code(summary.sourceCode || summary.source, 'UNKNOWN'),
    modeCode: code(summary.modeCode || summary.mode, 'INCREMENTAL'),
    triggerCode: code(summary.triggerCode || summary.trigger, 'UNKNOWN'),
    outcome,
    selectedAssets: Array.isArray(summary.selectedAssets)
      ? summary.selectedAssets.map((item) => code(item)).filter(Boolean)
      : [],
    startedAt,
    completedAt,
    durationMs: number(summary.durationMs),
    totals,
    items,
    error: summary.error || null,
    metadata: summary.metadata && typeof summary.metadata === 'object' ? summary.metadata : {},
  };
}

function fromMacroToolResult(toolResult = {}, options = {}) {
  const output = toolResult.output || {};
  const indicators = Array.isArray(output.indicators) ? output.indicators : [];

  return normalizeRunSummary({
    domainCode: options.domainCode || 'MACRO',
    sourceCode: options.sourceCode || output.sourceCode,
    modeCode: output.selectedIndicators ? 'SELECTED' : 'INCREMENTAL',
    triggerCode: options.triggerCode || toolResult.metadata?.launchChannel || 'UNKNOWN',
    outcome: output.outcome === 'PARTIAL'
      ? 'PARTIAL'
      : output.outcome === 'FAILED'
        ? 'FAILED'
        : 'SUCCESS',
    selectedAssets: output.selectedIndicators
      ? indicators.map((item) => item.indicatorCode).filter(Boolean)
      : [],
    startedAt: output.startedAt,
    completedAt: output.completedAt,
    durationMs: output.durationMs,
    items: indicators.map((item) => ({
      ...item,
      assetCode: item.indicatorCode,
      attemptNumber: 1,
    })),
    error: toolResult.error || null,
    metadata: {
      legacyOutputType: toolResult.outputType || null,
      legacySchemaVersion: toolResult.schemaVersion || null,
      ...(options.metadata || {}),
    },
  });
}

function createIngestionRunToolResult(summary = {}, message) {
  const output = normalizeRunSummary(summary);
  const success = output.outcome === 'SUCCESS';
  const warnings = output.outcome === 'PARTIAL'
    ? [`${output.totals.itemsFailed} asset attempt(s) failed.`]
    : [];

  return validateToolResult({
    schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
    success,
    message: message || `Ingestion run ${output.outcome.toLowerCase()}.`,
    outputType: INGESTION_RUN_OUTPUT_TYPE,
    output,
    warnings,
    error: success
      ? null
      : (output.error || {
          code: output.outcome === 'PARTIAL' ? 'INGESTION_PARTIAL_FAILURE' : 'INGESTION_FAILED',
          message: `${output.totals.itemsFailed} asset attempt(s) failed.`,
        }),
    metadata: {
      domainCode: output.domainCode,
      sourceCode: output.sourceCode,
      modeCode: output.modeCode,
    },
  });
}

module.exports = {
  INGESTION_RUN_OUTPUT_TYPE,
  classifyError,
  createIngestionRunToolResult,
  determineRunOutcome,
  fromMacroToolResult,
  normalizeItem,
  normalizeRunSummary,
  summarizeItems,
};
