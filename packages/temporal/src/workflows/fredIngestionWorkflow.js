const { proxyActivities } = require('@temporalio/workflow');

const { listFredIndicatorsActivity } = proxyActivities({
  startToCloseTimeout: '2 minutes',
  retry: {
    initialInterval: '10 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 3,
  },
});

const { loadFredIndicatorActivity } = proxyActivities({
  startToCloseTimeout: '5 minutes',
  retry: {
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 3,
  },
});

function normalizeConcurrency(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }

  return Math.min(parsed, 10);
}

function normalizeIndicators(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const indicators = [];

  for (const value of values) {
    const code = String(value || '').trim().toUpperCase();

    if (code && !seen.has(code)) {
      seen.add(code);
      indicators.push(code);
    }
  }

  return indicators;
}

function chunkItems(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function summarizeResults(results) {
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
  };
}

async function runIndicatorActivity(input, indicatorCode) {
  try {
    const result = await loadFredIndicatorActivity({
      workflowId: input.workflowId,
      runSource: input.runSource || 'manual_temporal_pilot',
      indicatorCode,
    });

    return {
      ok: true,
      indicatorCode,
      ...result,
    };
  } catch (error) {
    return {
      ok: false,
      source: 'FRED',
      indicatorCode,
      error: error.message || String(error),
    };
  }
}

async function fredIngestionWorkflow(input = {}) {
  const startedAt = new Date().toISOString();
  const requestedIndicators = normalizeIndicators(input.indicators);
  const indicatorList = await listFredIndicatorsActivity({
    indicators: requestedIndicators,
  });
  const indicators = normalizeIndicators(indicatorList.indicators);
  const concurrency = normalizeConcurrency(input.concurrency || input.batchSize);
  const batches = chunkItems(indicators, concurrency);
  const results = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const batchResults = await Promise.all(
      batch.map((indicatorCode) => runIndicatorActivity(input, indicatorCode)),
    );

    results.push(...batchResults);
  }

  const summary = summarizeResults(results);

  return {
    ok: summary.failed === 0,
    workflow: 'fredIngestionWorkflow',
    mode: 'indicator_batch',
    startedAt,
    completedAt: new Date().toISOString(),
    source: 'FRED',
    selectedIndicators: requestedIndicators.length > 0,
    concurrency,
    batchCount: batches.length,
    summary,
    results,
  };
}

module.exports = {
  fredIngestionWorkflow,
};
