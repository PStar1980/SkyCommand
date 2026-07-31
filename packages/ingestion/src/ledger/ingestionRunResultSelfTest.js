const assert = require('assert');
const {
  INGESTION_RUN_OUTPUT_TYPE,
  classifyError,
  createIngestionRunToolResult,
  fromMacroToolResult,
} = require('./ingestionRunResult');

const macro = {
  schemaVersion: '1.0',
  outputType: 'macro_ingestion_summary.v1',
  output: {
    sourceCode: 'FRED',
    outcome: 'PARTIAL',
    selectedIndicators: true,
    startedAt: '2026-07-31T10:00:00.000Z',
    completedAt: '2026-07-31T10:00:01.000Z',
    durationMs: 1000,
    indicators: [
      { indicatorCode: 'A', outcome: 'UPDATED', stagingRows: 5, rowsInserted: 1 },
      { indicatorCode: 'B', outcome: 'FAILED', error: { code: 'ETIMEDOUT', message: 'timed out' } },
    ],
  },
};

const generic = fromMacroToolResult(macro);
assert.strictEqual(generic.domainCode, 'MACRO');
assert.strictEqual(generic.sourceCode, 'FRED');
assert.strictEqual(generic.outcome, 'PARTIAL');
assert.strictEqual(generic.totals.itemsRequested, 2);
assert.strictEqual(generic.totals.itemsFailed, 1);
assert.strictEqual(generic.items[1].errorCategoryCode, 'TIMEOUT');
assert.deepStrictEqual(generic.selectedAssets, ['A', 'B']);

const toolResult = createIngestionRunToolResult(generic);
assert.strictEqual(toolResult.outputType, INGESTION_RUN_OUTPUT_TYPE);
assert.strictEqual(toolResult.output.outcome, 'PARTIAL');
assert.strictEqual(toolResult.success, false);
assert.strictEqual(classifyError({ code: 'ECONNRESET' }), 'NETWORK');

console.log('✅ Generic ingestion run summary and macro compatibility adapter passed.');
