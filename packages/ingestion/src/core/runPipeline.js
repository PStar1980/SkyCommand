const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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

  console.log(`🔥 [${name}] Processing ${code}`);

  ensureDir(tempDir);

  try {
    const filePath = await download(code, tempDir, item);

    if (normalize) {
      normalize(filePath, code, item);
    }

    load(code, filePath, item);

    const finishedAt = new Date();

    console.log(`✅ [${name}] Loaded ${code}`);

    return {
      ok: true,
      source: name,
      indicatorCode: code,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    console.error(`❌ [${name}] Failed ${code}:`, error.message || String(error));

    return {
      ok: false,
      source: name,
      indicatorCode: code,
      error: error.message || String(error),
    };
  } finally {
    await cleanupTempDir(tempDir, { quiet: cleanupQuiet });
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
  runPipeline,
  summarizeResults,
};
