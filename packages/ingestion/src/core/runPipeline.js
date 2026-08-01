const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { toLegacyPipelineSummary } = require('./macroIngestionResult');

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 10;
const DEFAULT_CLEANUP_RETRIES = 4;
const DEFAULT_CLEANUP_DELAY_MS = 125;
const MAX_ITEMS_PER_RUN = 500;

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

function parsePositiveInteger(value, fallback = DEFAULT_CONCURRENCY, max = MAX_CONCURRENCY) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
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
    console.warn(`⚠️ Temp cleanup skipped after ${retries} attempts: ${message}`);
  }

  return {
    ok: false,
    attempts: retries,
    error: message,
  };
}

function normalizeCode(value, sourceName = 'indicator') {
  const code = String(value || '').trim().toUpperCase();

  if (!code) {
    return null;
  }

  if (!/^[A-Z0-9_.-]+$/.test(code)) {
    throw new Error(`Invalid ${sourceName} code: ${value}`);
  }

  return code;
}

function splitIndicatorText(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCodes(value = [], sourceName = 'indicator') {
  const rawValues = Array.isArray(value)
    ? value.flatMap((item) => splitIndicatorText(item))
    : splitIndicatorText(value);
  const seen = new Set();
  const codes = [];

  for (const rawValue of rawValues) {
    const code = normalizeCode(rawValue, sourceName);

    if (code && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  return codes;
}

function getItemCode(item, getCode) {
  if (getCode) {
    return getCode(item);
  }

  if (typeof item === 'string') {
    return item;
  }

  return item.code || item.name || item.table || 'UNKNOWN';
}

function getSafePathPart(value) {
  return String(value || 'UNKNOWN')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 100);
}

function getSafeRunId(value, prefix = 'pipeline') {
  return String(value || `${prefix}-${new Date().toISOString()}-${randomUUID().slice(0, 8)}`)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 140);
}

function chunkItems(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function resolveItems({ items, indicators, name, getCode }) {
  const selectedCodes = normalizeCodes(indicators || [], name);

  if (selectedCodes.length > 0) {
    return {
      selected: true,
      items: selectedCodes.slice(0, MAX_ITEMS_PER_RUN),
    };
  }

  return {
    selected: false,
    items: items.slice(0, MAX_ITEMS_PER_RUN).map((item) => {
      if (typeof item === 'string') {
        return normalizeCode(item, name);
      }

      return item;
    }),
  };
}

function normalizeDownloadResult(value) {
  if (typeof value === 'string') {
    return { filePath: value, requestAttempts: [] };
  }

  if (!value || typeof value !== 'object' || !value.filePath) {
    throw new Error('Source download must return a file path or { filePath, requestAttempts }.');
  }

  return {
    filePath: value.filePath,
    requestAttempts: Array.isArray(value.requestAttempts) ? value.requestAttempts : [],
  };
}

function materializeItemAttempts(requestAttempts = [], finalResult = {}) {
  const attempts = Array.isArray(requestAttempts) ? requestAttempts.map((item) => ({ ...item })) : [];
  const finalAttemptNumber = Math.max(1, attempts.at(-1)?.attemptNumber || 1);
  const finalAttempt = {
    attemptNumber: finalAttemptNumber,
    outcome: finalResult.outcome || 'FAILED',
    retryable: finalResult.retryable ?? attempts.at(-1)?.retryable ?? null,
    httpStatus: finalResult.httpStatus ?? attempts.at(-1)?.httpStatus ?? null,
    sourceMinDate: finalResult.stagingMinDate || null,
    sourceMaxDate: finalResult.sourceMaxDate || finalResult.stagingMaxDate || null,
    previousTargetMaxDate: finalResult.previousTargetMaxDate || null,
    currentTargetMaxDate: finalResult.currentTargetMaxDate || null,
    rowsStaged: finalResult.stagingRows || 0,
    rowsDetectedAsNew: finalResult.newRowsDetected || 0,
    rowsInserted: finalResult.rowsInserted || 0,
    rowsUpdated: finalResult.rowsUpdated || 0,
    rowsUnchanged: finalResult.rowsUnchanged || 0,
    rowsRejected: finalResult.rowsRejected || 0,
    startedAt: attempts.at(-1)?.startedAt || finalResult.startedAt || null,
    completedAt: finalResult.completedAt || finalResult.finishedAt || attempts.at(-1)?.completedAt || null,
    durationMs: finalResult.durationMs || attempts.at(-1)?.durationMs || 0,
    errorCategoryCode: finalResult.errorCategoryCode || attempts.at(-1)?.errorCategoryCode || null,
    errorCode: finalResult.error?.code || finalResult.errorCode || attempts.at(-1)?.errorCode || null,
    errorMessage: finalResult.error?.message || finalResult.errorMessage || attempts.at(-1)?.errorMessage || null,
    diagnostics: {
      requestWaitBeforeNextMs: attempts.at(-1)?.waitBeforeNextMs || 0,
    },
  };

  if (attempts.length === 0) return [finalAttempt];

  const earlierAttempts = attempts.slice(0, -1).map((attempt) => ({
    ...attempt,
    outcome: 'FAILED',
  }));

  return [...earlierAttempts, finalAttempt];
}

async function runPipelineItem({
  item,
  name,
  download,
  normalize,
  load,
  tempRoot,
  runId,
  getCode,
  cleanupQuiet,
}) {
  const startedAt = new Date();
  const code = normalizeCode(getItemCode(item, getCode), name);
  const tempDir = path.join(tempRoot, runId, getSafePathPart(code));
  let requestAttempts = [];

  console.log(`🔥 [${name}] Processing ${code}`);

  ensureDir(tempDir);

  try {
    const downloadResult = normalizeDownloadResult(await download(code, tempDir, item));
    const filePath = downloadResult.filePath;
    requestAttempts = downloadResult.requestAttempts;

    if (normalize) {
      await normalize(filePath, code, item);
    }

    const loadResult = await load(code, filePath, item);
    const finishedAt = new Date();
    const result = {
      ok: true,
      source: name,
      indicatorCode: code,
      outcome: loadResult?.rowsInserted > 0 || loadResult?.rowsUpdated > 0 ? 'UPDATED' : 'UNCHANGED',
      stagingRows: loadResult?.stagingRows || 0,
      stagingMinDate: loadResult?.stagingMinDate || null,
      stagingMaxDate: loadResult?.stagingMaxDate || null,
      sourceMaxDate: loadResult?.stagingMaxDate || null,
      previousTargetMaxDate: loadResult?.previousTargetMaxDate || null,
      newRowsDetected: loadResult?.newRowsDetected || 0,
      rowsInserted: loadResult?.rowsInserted || 0,
      rowsUpdated: loadResult?.rowsUpdated || 0,
      rowsUnchanged: loadResult?.rowsUnchanged || 0,
      rowsRejected: loadResult?.rowsRejected || 0,
      currentTargetMaxDate: loadResult?.currentTargetMaxDate || null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      completedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
    result.attempts = materializeItemAttempts(requestAttempts, result);

    console.log(`✅ [${name}] Loaded ${code}`);
    return result;
  } catch (error) {
    const completedAt = new Date();
    const message = error.message || String(error);
    requestAttempts = Array.isArray(error.retryAttempts) ? error.retryAttempts : requestAttempts;

    console.error(`❌ [${name}] Failed ${code}:`, message);

    const result = {
      ok: false,
      source: name,
      indicatorCode: code,
      outcome: 'FAILED',
      startedAt: startedAt.toISOString(),
      finishedAt: completedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      errorCategoryCode: requestAttempts.at(-1)?.errorCategoryCode || null,
      retryable: requestAttempts.at(-1)?.retryable ?? null,
      httpStatus: requestAttempts.at(-1)?.httpStatus ?? null,
      error: {
        code: error.code || `${String(name || 'INGESTION').toUpperCase()}_INDICATOR_FAILED`,
        message,
      },
    };
    result.attempts = materializeItemAttempts(requestAttempts, result);
    return result;
  } finally {
    await cleanupTempDir(tempDir, { quiet: cleanupQuiet });
  }
}

function summarizeResults(results = []) {
  return toLegacyPipelineSummary(results);
}

const runPipeline = async ({
  name,
  getIndicators,
  download,
  normalize,
  load,
  tempDir,
  getCode,
  indicators = [],
  concurrency = DEFAULT_CONCURRENCY,
  maxConcurrency = MAX_CONCURRENCY,
  runId,
  cleanupQuiet = false,
  onBatchComplete,
}) => {
  ensureDir(tempDir);

  const startedAt = new Date().toISOString();
  const configuredItems = await getIndicators();
  const resolved = resolveItems({
    items: configuredItems,
    indicators,
    name,
    getCode,
  });
  const items = resolved.items;
  const safeConcurrency = parsePositiveInteger(concurrency, DEFAULT_CONCURRENCY, maxConcurrency);
  const safeRunId = getSafeRunId(runId, `${String(name || 'pipeline').toLowerCase()}-tool`);
  const batches = chunkItems(items, safeConcurrency);
  const results = [];

  ensureDir(path.join(tempDir, safeRunId));

  console.log(`\n📊 [${name}] Active indicators: ${items.length}`);
  console.log(`⚙️ [${name}] Concurrency: ${safeConcurrency}`);
  console.log(`🧺 [${name}] Batches: ${batches.length}`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const batchCodes = batch.map((item) => normalizeCode(getItemCode(item, getCode), name));

    console.log(`\n🚦 [${name}] Batch ${batchIndex + 1}/${batches.length}: ${batchCodes.join(', ')}`);

    const batchResults = await Promise.all(
      batch.map((item) => runPipelineItem({
        item,
        name,
        download,
        normalize,
        load,
        tempRoot: tempDir,
        runId: safeRunId,
        getCode,
        cleanupQuiet,
      })),
    );

    results.push(...batchResults);

    if (typeof onBatchComplete === 'function') {
      await onBatchComplete({
        batchIndex,
        batch,
        results: batchResults,
      });
    }
  }

  await cleanupTempDir(path.join(tempDir, safeRunId), { quiet: cleanupQuiet });

  const summary = summarizeResults(results);
  const completedAt = new Date().toISOString();

  console.log('');
  console.log(`🎯 [${name}] Complete: ${summary.succeeded}/${summary.total} succeeded`);

  if (summary.failed > 0) {
    console.log(`⚠️ [${name}] Failed indicators: ${summary.failed}`);
  }

  return {
    ok: summary.failed === 0,
    source: name,
    mode: 'indicator_batch',
    selectedIndicators: resolved.selected,
    concurrency: safeConcurrency,
    batchCount: batches.length,
    startedAt,
    completedAt,
    summary,
    results,
  };
};

module.exports = {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  cleanupTempDir,
  chunkItems,
  normalizeCodes,
  parsePositiveInteger,
  materializeItemAttempts,
  normalizeDownloadResult,
  runPipeline,
  runPipelineItem,
  summarizeResults,
};
