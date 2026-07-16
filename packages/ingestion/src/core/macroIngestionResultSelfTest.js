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
    stagingMinDate: '1913-01-01',
    stagingMaxDate: '2026-06-01',
    previousTargetMaxDate: '2026-04-01',
    newRowsDetected: 2,
    rowsInserted: 2,
    currentTargetMaxDate: '2026-06-01',
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
  assert.strictEqual(totals.indicatorsUpdated, 1);
  assert.strictEqual(totals.indicatorsUnchanged, 1);
  assert.strictEqual(totals.rowsInserted, 2);

  const toolResult = createMacroIngestionToolResult({
    sourceCode: 'FRED',
    batchResult: {
      startedAt: '2026-07-16T10:00:00.000Z',
      completedAt: '2026-07-16T10:00:03.000Z',
      selectedIndicators: true,
      concurrency: 3,
      batchCount: 1,
      results,
    },
  });

  assert.strictEqual(toolResult.outputType, MACRO_INGESTION_OUTPUT_TYPE);
  assert.strictEqual(toolResult.success, false);
  assert.strictEqual(toolResult.output.outcome, 'PARTIAL');
  assert.strictEqual(toolResult.output.durationMs, 3000);
  assert.strictEqual(toolResult.output.indicators[0].outcome, 'UPDATED');
  assert.strictEqual(toolResult.output.indicators[1].outcome, 'UNCHANGED');
  assert.strictEqual(toolResult.output.indicators[2].outcome, 'FAILED');
  assert.ok(!Object.prototype.hasOwnProperty.call(toolResult, 'stdoutPreview'));

  console.log('[SkyCommand] Macro ingestion result self-test passed.');
}

run();
