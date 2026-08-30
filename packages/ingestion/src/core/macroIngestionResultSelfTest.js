const assert = require('assert');
const { parseCopyOutput } = require('../loaders/copyLoader');
const {
  MACRO_INGESTION_OUTPUT_TYPE,
  createMacroIngestionToolResult,
  summarizeMacroIngestionResults,
} = require('./macroIngestionResult');

function run() {
  const copyResult = parseCopyOutput([
    'staging_rows=1337',
    'staging_min=1913-01-01',
    'staging_max=2026-06-01',
    'previous_target_max=2026-04-01',
    'new_rows=2',
    'inserted_rows=2',
    'target_max=2026-06-01',
  ].join('\n'));

  assert.deepStrictEqual(copyResult, {
    stagingRows: 1337,
    acceptedRows: 0,
    stagingMinDate: '1913-01-01',
    stagingMaxDate: '2026-06-01',
    previousTargetMaxDate: '2026-04-01',
    newRowsDetected: 2,
    rowsInserted: 2,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsRejected: 0,
    revisionsDetected: 0,
    qualityIssueCount: 0,
    qualityStatusCode: 'PASS',
    currentTargetMaxDate: '2026-06-01',
    revisionEvents: [],
    rejectionEvents: [],
    qualityIssues: [],
  });

  const results = [
    {
      ok: true,
      indicatorCode: 'CPIAUCSL',
      rowsInserted: 2,
      newRowsDetected: 2,
      stagingRows: 100,
      previousTargetMaxDate: '2026-04-01',
      stagingMaxDate: '2026-06-01',
      currentTargetMaxDate: '2026-06-01',
      durationMs: 1200,
    },
    {
      ok: true,
      indicatorCode: 'UNRATE',
      rowsInserted: 0,
      rowsUpdated: 1,
      newRowsDetected: 0,
      stagingRows: 90,
      currentTargetMaxDate: '2026-06-01',
      durationMs: 800,
    },
    {
      ok: false,
      indicatorCode: 'GDP',
      error: 'download failed',
      durationMs: 500,
    },
  ];

  const { totals } = summarizeMacroIngestionResults(results);
  assert.strictEqual(totals.indicatorsRequested, 3);
  assert.strictEqual(totals.indicatorsSucceeded, 2);
  assert.strictEqual(totals.indicatorsFailed, 1);
  assert.strictEqual(totals.indicatorsUpdated, 2);
  assert.strictEqual(totals.indicatorsUnchanged, 0);
  assert.strictEqual(totals.rowsInserted, 2);
  assert.strictEqual(totals.rowsUpdated, 1);

  const toolResult = createMacroIngestionToolResult({
    sourceCode: 'FRED',
    batchResult: {
      startedAt: '2026-07-16T10:00:00.000Z',
      completedAt: '2026-07-16T10:00:03.000Z',
      selectedIndicators: true,
      concurrency: 3,
      batchCount: 1,
      performanceTelemetry: {
        instrumentedTotalMs: 3000,
        phases: [
          { code: 'SOURCE_INGESTION_EXECUTION', label: 'Source ingestion execution', durationMs: 2800 },
          { code: 'LEDGER_FRESHNESS_PERSISTENCE', label: 'Ingestion ledger / freshness persistence', durationMs: 200 },
        ],
        workloadBreakdown: {
          instrumentedTotalMs: 2750,
          concurrency: 3,
          batchCount: 1,
          phases: [
            { code: 'SOURCE_REQUEST_POLICY_RESOLUTION', label: 'Source request policy resolution', durationMs: 25 },
            { code: 'BATCH_EXECUTION', label: 'Concurrent indicator batch execution', durationMs: 2700 },
          ],
          cumulativeStageMs: { fetchMs: 1500, normalizeMs: 250, loadMs: 1000, cleanupMs: 50 },
          slowestIndicators: [
            { indicatorCode: 'CPIAUCSL', durationMs: 1200, fetchMs: 600, normalizeMs: 100, loadMs: 480, cleanupMs: 20 },
          ],
        },
      },
      results,
    },
  });

  assert.strictEqual(toolResult.outputType, MACRO_INGESTION_OUTPUT_TYPE);
  assert.strictEqual(toolResult.success, false);
  assert.strictEqual(toolResult.output.outcome, 'PARTIAL');
  assert.strictEqual(toolResult.output.durationMs, 3000);
  assert.strictEqual(toolResult.output.indicators[0].outcome, 'UPDATED');
  assert.strictEqual(toolResult.output.indicators[1].outcome, 'UPDATED');
  assert.strictEqual(toolResult.output.indicators[1].rowsUpdated, 1);
  assert.strictEqual(toolResult.output.totals.rowsUpdated, 1);
  assert.strictEqual(toolResult.output.indicators[2].outcome, 'FAILED');
  assert.strictEqual(toolResult.output.performanceTelemetry.instrumentedTotalMs, 3000);
  assert.strictEqual(toolResult.output.performanceTelemetry.phases.length, 2);
  assert.strictEqual(toolResult.output.performanceTelemetry.workloadBreakdown.concurrency, 3);
  assert.strictEqual(toolResult.output.performanceTelemetry.workloadBreakdown.slowestIndicators[0].indicatorCode, 'CPIAUCSL');
  assert.ok(!Object.prototype.hasOwnProperty.call(toolResult, 'stdoutPreview'));

  console.log('[SkyCommand] Macro ingestion result self-test passed.');
}

run();
