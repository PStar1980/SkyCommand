// Phase 16.5 compatibility facade.
// The dedicated FRED Temporal pilot still imports these functions, but the
// implementation now delegates to the same generic source-adapter runner used
// by the production ingestion tool.

const fredAdapter = require('../adapters/fredAdapter');
const {
  cleanupTempDir,
  normalizeCodes,
  parsePositiveInteger,
} = require('../core/runPipeline');
const {
  runSourceAdapter,
  runSourceAdapterItem,
} = require('../core/sourceAdapter');

const DEFAULT_FRED_CONCURRENCY = 3;
const MAX_FRED_CONCURRENCY = 10;
const MAX_FRED_INDICATORS_PER_RUN = 250;

function normalizeIndicatorCode(value) {
  const values = normalizeCodes([value], 'FRED indicator');
  const code = values[0] || null;

  if (code && !/^[A-Z0-9_]+$/.test(code)) {
    throw new Error(`Invalid FRED indicator code: ${value}`);
  }

  return code;
}

function normalizeIndicatorCodes(value = []) {
  return normalizeCodes(value, 'FRED indicator').map(normalizeIndicatorCode).filter(Boolean);
}

function getDefaultFredTempRoot() {
  return fredAdapter.tempDir;
}

async function listFredIndicators(input = {}) {
  const selectedIndicators = normalizeIndicatorCodes(input.indicators || []);

  if (selectedIndicators.length > 0) {
    return {
      ok: true,
      source: 'FRED',
      selected: true,
      count: selectedIndicators.length,
      indicators: selectedIndicators.slice(0, MAX_FRED_INDICATORS_PER_RUN),
    };
  }

  const indicators = normalizeIndicatorCodes(await fredAdapter.getAssets()).slice(
    0,
    MAX_FRED_INDICATORS_PER_RUN,
  );

  return {
    ok: true,
    source: 'FRED',
    selected: false,
    count: indicators.length,
    indicators,
  };
}

async function loadFredIndicator(input = {}) {
  const indicatorCode = normalizeIndicatorCode(input.indicatorCode);
  if (!indicatorCode) throw new Error('indicatorCode is required.');

  const result = await runSourceAdapterItem(fredAdapter, indicatorCode, {
    runId: input.runId || input.workflowId || 'manual',
    tempRoot: input.tempRoot || getDefaultFredTempRoot(),
    cleanupQuiet: input.cleanupQuiet,
    requestPolicy: input.requestPolicy,
    query: input.query,
  });

  if (!result.ok) {
    const error = new Error(result.error?.message || `FRED ingestion failed for ${indicatorCode}.`);
    error.code = result.error?.code || 'FRED_INDICATOR_FAILED';
    error.result = result;
    throw error;
  }

  return result;
}

async function runFredIndicatorBatch(input = {}) {
  return runSourceAdapter(fredAdapter, {
    indicators: input.indicators || [],
    concurrency: input.concurrency || input.batchSize || DEFAULT_FRED_CONCURRENCY,
    maxConcurrency: input.maxConcurrency || MAX_FRED_CONCURRENCY,
    runId: input.runId || input.workflowId,
    tempDir: input.tempRoot || getDefaultFredTempRoot(),
    cleanupQuiet: input.cleanupQuiet,
    onBatchComplete: input.onBatchComplete,
    requestPolicy: input.requestPolicy,
    query: input.query,
  });
}

module.exports = {
  DEFAULT_FRED_CONCURRENCY,
  MAX_FRED_CONCURRENCY,
  cleanupTempDir,
  getDefaultFredTempRoot,
  listFredIndicators,
  loadFredIndicator,
  normalizeIndicatorCode,
  normalizeIndicatorCodes,
  parsePositiveInteger,
  runFredIndicatorBatch,
  summarizeResults: require('../core/runPipeline').summarizeResults,
};
