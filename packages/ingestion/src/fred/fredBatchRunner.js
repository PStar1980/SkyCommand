const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { getIndicators } = require('../sources/indicators');
const { downloadFredCSV } = require('../sources/fred');
const { normalizeFredCSV } = require('../transform/csvNormalizer');
const { copyIntoTable } = require('../loaders/copyLoader');

const DEFAULT_FRED_CONCURRENCY = 3;
const MAX_FRED_CONCURRENCY = 10;
const MAX_FRED_INDICATORS_PER_RUN = 250;
const DEFAULT_CLEANUP_RETRIES = 4;
const DEFAULT_CLEANUP_DELAY_MS = 125;

function parsePositiveInteger(value, fallback = DEFAULT_FRED_CONCURRENCY, max = MAX_FRED_CONCURRENCY) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function normalizeIndicatorCode(value) {
  const code = String(value || '').trim().toUpperCase();

  if (!code) {
    return null;
  }

  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new Error(`Invalid FRED indicator code: ${value}`);
  }

  return code;
}

function splitIndicatorText(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIndicatorCodes(value = []) {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => splitIndicatorText(item))
    : splitIndicatorText(value);
  const seen = new Set();
  const codes = [];

  for (const rawValue of rawValues) {
    const code = normalizeIndicatorCode(rawValue);

    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  return codes;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function cleanupTempDir(dir, options = {}) {
  if (!dir || !fs.existsSync(dir)) {
    return { ok: true, skipped: true };
  }

  const retries = parsePositiveInteger(options.retries, DEFAULT_CLEANUP_RETRIES, 25);
  const delayMs = parsePositiveInteger(options.delayMs, DEFAULT_CLEANUP_DELAY_MS, 5000);
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: delayMs,
      });

      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(delayMs * attempt);
      }
    }
  }

  const message = lastError?.message || String(lastError || 'unknown cleanup error');

  if (!options.quiet) {
    console.warn(`⚠️ [FRED] Temp cleanup skipped after ${retries} attempts: ${message}`);
  }

  return {
    ok: false,
    attempts: retries,
    error: message,
  };
}

function getSafeRunId(value) {
  return String(value || `fred-${new Date().toISOString()}-${randomUUID().slice(0, 8)}`)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 140);
}

function getSafeIndicatorPathPart(value) {
  return normalizeIndicatorCode(value) || 'UNKNOWN';
}

function getDefaultFredTempRoot() {
  return path.resolve(__dirname, '..', 'tmp', 'fred-batch');
}

function getIndicatorTempDir(tempRoot, runId, indicatorCode) {
  return path.join(tempRoot, getSafeRunId(runId), getSafeIndicatorPathPart(indicatorCode));
}

function chunkItems(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
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

  const indicators = normalizeIndicatorCodes(getIndicators('FRED')).slice(
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

  if (!indicatorCode) {
    throw new Error('indicatorCode is required.');
  }

  const startedAt = new Date();
  const runId = input.runId || input.workflowId || 'manual';
  const tempRoot = input.tempRoot || getDefaultFredTempRoot();
  const tempDir = input.tempDir || getIndicatorTempDir(tempRoot, runId, indicatorCode);

  console.log(`🔥 [FRED] Processing ${indicatorCode}`);

  ensureDir(tempDir);

  try {
    const filePath = await downloadFredCSV(indicatorCode, tempDir);

    normalizeFredCSV(filePath, indicatorCode);
    copyIntoTable(indicatorCode, filePath);

    const finishedAt = new Date();

    console.log(`✅ [FRED] Loaded ${indicatorCode}`);

    return {
      ok: true,
      source: 'FRED',
      indicatorCode,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } finally {
    if (input.cleanup !== false) {
      await cleanupTempDir(tempDir, {
        quiet: input.cleanupQuiet,
      });
    }
  }
}

async function runFredIndicatorSafely(input = {}) {
  const indicatorCode = normalizeIndicatorCode(input.indicatorCode);

  try {
    return await loadFredIndicator({
      ...input,
      indicatorCode,
    });
  } catch (error) {
    console.error(`❌ [FRED] Failed ${indicatorCode}: ${error.message || String(error)}`);

    return {
      ok: false,
      source: 'FRED',
      indicatorCode,
      error: error.message || String(error),
    };
  }
}

function summarizeResults(results = []) {
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
  };
}

async function runFredIndicatorBatch(input = {}) {
  const startedAt = new Date().toISOString();
  const indicatorList = await listFredIndicators({ indicators: input.indicators || [] });
  const indicators = normalizeIndicatorCodes(indicatorList.indicators);
  const concurrency = parsePositiveInteger(
    input.concurrency || input.batchSize,
    DEFAULT_FRED_CONCURRENCY,
    input.maxConcurrency || MAX_FRED_CONCURRENCY,
  );
  const runId = getSafeRunId(input.runId || input.workflowId || `fred-${Date.now()}`);
  const tempRoot = input.tempRoot || getDefaultFredTempRoot();
  const batches = chunkItems(indicators, concurrency);
  const results = [];

  ensureDir(path.join(tempRoot, runId));

  console.log(`\n📊 [FRED] Active indicators: ${indicators.length}`);
  console.log(`⚙️ [FRED] Concurrency: ${concurrency}`);
  console.log(`🧺 [FRED] Batches: ${batches.length}`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];

    console.log(`\n🚦 [FRED] Batch ${batchIndex + 1}/${batches.length}: ${batch.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map((indicatorCode) =>
        runFredIndicatorSafely({
          ...input,
          runId,
          tempRoot,
          indicatorCode,
        }),
      ),
    );

    results.push(...batchResults);

    if (typeof input.onBatchComplete === 'function') {
      await input.onBatchComplete({
        batchIndex,
        batch,
        results: batchResults,
      });
    }
  }

  if (input.cleanupRoot !== false) {
    await cleanupTempDir(path.join(tempRoot, runId), {
      quiet: input.cleanupQuiet,
    });
  }

  const summary = summarizeResults(results);
  const completedAt = new Date().toISOString();

  console.log('');
  console.log(`🎯 [FRED] Complete: ${summary.succeeded}/${summary.total} succeeded`);

  if (summary.failed > 0) {
    console.log(`⚠️ [FRED] Failed indicators: ${summary.failed}`);
  }

  return {
    ok: summary.failed === 0,
    source: 'FRED',
    mode: 'indicator_batch',
    selectedIndicators: indicatorList.selected,
    concurrency,
    batchCount: batches.length,
    startedAt,
    completedAt,
    summary,
    results,
  };
}

module.exports = {
  DEFAULT_FRED_CONCURRENCY,
  MAX_FRED_CONCURRENCY,
  cleanupTempDir,
  chunkItems,
  getDefaultFredTempRoot,
  getIndicatorTempDir,
  listFredIndicators,
  loadFredIndicator,
  normalizeIndicatorCode,
  normalizeIndicatorCodes,
  parsePositiveInteger,
  runFredIndicatorBatch,
  summarizeResults,
};
