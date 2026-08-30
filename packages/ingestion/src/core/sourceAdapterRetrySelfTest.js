const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { defineSourceAdapter, runSourceAdapter } = require('./sourceAdapter');
const { executeWithRetry, parseRetryAfterMs } = require('./retryExecutor');
const { fromAdapterBatchResult } = require('../ledger/ingestionRunResult');

async function testRetrySuccess() {
  let calls = 0;
  const waits = [];
  const policy = {
    maxAttempts: 4,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    maxElapsedMs: 60000,
    jitterRatio: 0,
    respectRetryAfter: true,
    retryableHttpStatuses: [503],
    retryableErrorCodes: ['ETIMEDOUT'],
  };

  const result = await executeWithRetry({
    policy,
    random: () => 0.5,
    sleepFn: async (ms) => waits.push(ms),
    operation: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('provider unavailable');
        error.response = { status: 503, headers: { 'retry-after': '0' } };
        throw error;
      }
      if (calls === 2) {
        const error = new Error('timed out');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      return 'ok';
    },
  });

  assert.strictEqual(result.value, 'ok');
  assert.strictEqual(result.attempts.length, 3);
  assert.strictEqual(result.attempts[0].errorCategoryCode, 'HTTP');
  assert.strictEqual(result.attempts[1].errorCategoryCode, 'TIMEOUT');
  assert.strictEqual(result.attempts[2].outcome, 'SUCCESS');
  assert.deepStrictEqual(waits, [100, 200]);
}

async function testTerminalFailure() {
  let calls = 0;
  try {
    await executeWithRetry({
      policy: {
        maxAttempts: 4,
        baseDelayMs: 10,
        maxDelayMs: 100,
        maxElapsedMs: 10000,
        jitterRatio: 0,
        respectRetryAfter: true,
        retryableHttpStatuses: [503],
        retryableErrorCodes: [],
      },
      sleepFn: async () => {},
      operation: async () => {
        calls += 1;
        const error = new Error('unauthorized');
        error.response = { status: 401, headers: {} };
        throw error;
      },
    });
    assert.fail('401 should have failed.');
  } catch (error) {
    assert.strictEqual(calls, 1);
    assert.strictEqual(error.retryAttempts.length, 1);
    assert.strictEqual(error.retryAttempts[0].retryable, false);
    assert.strictEqual(error.retryAttempts[0].errorCategoryCode, 'AUTH');
  }
}

async function testSyntheticAdapter() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-adapter-test-'));
  try {
    const adapter = defineSourceAdapter({
      domainCode: 'TEST_DOMAIN',
      sourceCode: 'TEST_SOURCE',
      adapterCode: 'TEST_ADAPTER',
      resultContractVersion: 'ingestion_run_summary.v1',
      name: 'TestSource',
      getAssets: async () => ['ASSET_A'],
      fetch: async (code, tempDir) => {
        const filePath = path.join(tempDir, `${code}.csv`);
        fs.writeFileSync(filePath, 'edate,value\n2026-01-01,1\n', 'utf8');
        return {
          filePath,
          requestAttempts: [{
            attemptNumber: 1,
            outcome: 'SUCCESS',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:00:00.010Z',
            durationMs: 10,
          }],
        };
      },
      normalize: null,
      load: async () => ({
        stagingRows: 1,
        stagingMinDate: '2026-01-01',
        stagingMaxDate: '2026-01-01',
        previousTargetMaxDate: null,
        newRowsDetected: 1,
        rowsInserted: 1,
        currentTargetMaxDate: '2026-01-01',
      }),
      tempDir: root,
      defaultConcurrency: 1,
      maxConcurrency: 1,
      capabilities: {
        incremental: false,
        selectedAssets: true,
        backfill: false,
        revisions: false,
        resume: false,
        dryRun: true,
      },
      requestPolicyRequired: false,
    });

    const result = await runSourceAdapter(adapter, { cleanupQuiet: true, runId: 'self-test' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.summary.total, 1);
    assert.strictEqual(result.results[0].outcome, 'UPDATED');
    assert.strictEqual(result.results[0].attempts.length, 1);
    assert.ok(result.performanceTelemetry.workloadBreakdown.instrumentedTotalMs >= 0);
    assert.strictEqual(result.performanceTelemetry.workloadBreakdown.concurrency, 1);
    assert.strictEqual(result.performanceTelemetry.workloadBreakdown.batchCount, 1);
    assert.strictEqual(result.performanceTelemetry.workloadBreakdown.phases[0].code, 'SOURCE_REQUEST_POLICY_RESOLUTION');
    assert.ok(result.performanceTelemetry.workloadBreakdown.cumulativeStageMs.fetchMs >= 0);
    assert.ok(result.performanceTelemetry.workloadBreakdown.cumulativeStageMs.loadMs >= 0);
    assert.strictEqual(result.performanceTelemetry.workloadBreakdown.slowestIndicators[0].indicatorCode, 'ASSET_A');

    const generic = fromAdapterBatchResult(result, {
      domainCode: 'TEST_DOMAIN',
      sourceCode: 'TEST_SOURCE',
    });
    assert.strictEqual(generic.totals.itemsRequested, 1);
    assert.strictEqual(generic.totals.attempts, 1);
    assert.strictEqual(generic.items[0].assetCode, 'ASSET_A');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}


function testRetryAttemptLedgerProjection() {
  const generic = fromAdapterBatchResult({
    source: 'FRED',
    selectedIndicators: true,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:03.000Z',
    results: [{
      indicatorCode: 'TEST_SERIES',
      outcome: 'UPDATED',
      rowsInserted: 1,
      stagingRows: 2,
      sourceMaxDate: '2026-01-01',
      currentTargetMaxDate: '2026-01-01',
      attempts: [
        { attemptNumber: 1, outcome: 'FAILED', retryable: true, httpStatus: 503, errorCategoryCode: 'HTTP', errorCode: 'ERR_BAD_RESPONSE', errorMessage: '503' },
        { attemptNumber: 2, outcome: 'FAILED', retryable: true, errorCategoryCode: 'TIMEOUT', errorCode: 'ETIMEDOUT', errorMessage: 'timeout' },
        { attemptNumber: 3, outcome: 'UPDATED', rowsStaged: 2, rowsInserted: 1, sourceMaxDate: '2026-01-01', currentTargetMaxDate: '2026-01-01' },
      ],
    }],
  }, { domainCode: 'MACRO', sourceCode: 'FRED' });

  assert.strictEqual(generic.totals.itemsRequested, 1);
  assert.strictEqual(generic.totals.itemsSucceeded, 1);
  assert.strictEqual(generic.totals.attempts, 3);
  assert.strictEqual(generic.totals.retries, 2);
  assert.strictEqual(generic.items[0].errorCategoryCode, 'HTTP');
  assert.strictEqual(generic.items[1].errorCategoryCode, 'TIMEOUT');
  assert.strictEqual(generic.items[2].outcome, 'UPDATED');
}

async function main() {
  assert.strictEqual(parseRetryAfterMs({ 'retry-after': '2' }, 0), 2000);
  testRetryAttemptLedgerProjection();
  await testRetrySuccess();
  await testTerminalFailure();
  await testSyntheticAdapter();
  console.log('✅ Phase 16.5 common adapter and retry framework self-test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
