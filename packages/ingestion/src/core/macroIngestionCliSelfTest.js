const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeToolProcess } = require('../../../tools/src/toolProcessExecutor');
const {
  runMacroIngestionCli,
  runMacroIngestionEntrypoint,
} = require('./macroIngestionCli');

function createSuccessfulBatch(source) {
  return {
    ok: true,
    source,
    mode: 'indicator_batch',
    selectedIndicators: true,
    concurrency: 2,
    batchCount: 1,
    startedAt: '2026-07-16T10:00:00.000Z',
    completedAt: '2026-07-16T10:00:02.000Z',
    results: [
      {
        ok: true,
        indicatorCode: `${source}_UPDATED`,
        rowsInserted: 3,
        newRowsDetected: 3,
        stagingRows: 10,
        stagingMaxDate: '2026-06-01',
        currentTargetMaxDate: '2026-06-01',
        durationMs: 750,
      },
      {
        ok: true,
        indicatorCode: `${source}_UNCHANGED`,
        rowsInserted: 0,
        newRowsDetected: 0,
        stagingRows: 8,
        stagingMaxDate: '2026-05-01',
        currentTargetMaxDate: '2026-05-01',
        durationMs: 500,
      },
    ],
  };
}

async function runSourceSuccessCase(sourceCode) {
  const emitted = [];
  const printed = [];
  const exitCodes = [];
  const batchResult = createSuccessfulBatch(sourceCode);
  const response = await runMacroIngestionCli({
    sourceCode,
    toolCode: `ingestion_${sourceCode.toLowerCase()}`,
    args: ['--indicators=TEST'],
    execute: async () => batchResult,
    printResult: (result) => printed.push(result),
    emitResult: (toolResult) => {
      emitted.push(toolResult);
      return { emitted: true };
    },
    setExitCode: (code) => exitCodes.push(code),
    logger: () => {},
  });

  assert.strictEqual(response.result, batchResult);
  assert.strictEqual(response.toolResult.outputType, 'macro_ingestion_summary.v1');
  assert.strictEqual(response.toolResult.output.sourceCode, sourceCode);
  assert.strictEqual(response.toolResult.output.outcome, 'UPDATED');
  assert.strictEqual(response.toolResult.output.totals.indicatorsRequested, 2);
  assert.strictEqual(response.toolResult.output.totals.indicatorsUpdated, 1);
  assert.strictEqual(response.toolResult.output.totals.indicatorsUnchanged, 1);
  assert.strictEqual(response.toolResult.output.totals.rowsInserted, 3);
  assert.strictEqual(emitted.length, 1);
  assert.strictEqual(printed.length, 1);
  assert.deepStrictEqual(exitCodes, []);
}

async function runFailureCase() {
  const emitted = [];
  const exitCodes = [];
  const response = await runMacroIngestionCli({
    sourceCode: 'STATCAN',
    toolCode: 'ingestion_statcan',
    args: [],
    execute: async () => {
      throw Object.assign(new Error('catalog unavailable'), { code: 'CATALOG_UNAVAILABLE' });
    },
    emitResult: (toolResult) => {
      emitted.push(toolResult);
      return { emitted: true };
    },
    setExitCode: (code) => exitCodes.push(code),
    logger: () => {},
  });

  assert.strictEqual(response.result, null);
  assert.strictEqual(response.toolResult.success, false);
  assert.strictEqual(response.toolResult.output.sourceCode, 'STATCAN');
  assert.strictEqual(response.toolResult.output.outcome, 'FAILED');
  assert.strictEqual(response.toolResult.error.code, 'CATALOG_UNAVAILABLE');
  assert.strictEqual(emitted.length, 1);
  assert.deepStrictEqual(exitCodes, [1]);
}

async function runPartialAllowFailuresCase() {
  const emitted = [];
  const exitCodes = [];
  const batchResult = createSuccessfulBatch('BOC');
  batchResult.ok = false;
  batchResult.results.push({
    ok: false,
    indicatorCode: 'BOC_FAILED',
    durationMs: 200,
    error: {
      code: 'DOWNLOAD_FAILED',
      message: 'download failed',
    },
  });

  const response = await runMacroIngestionCli({
    sourceCode: 'BOC',
    toolCode: 'ingestion_boc',
    args: ['--allow-failures'],
    execute: async () => batchResult,
    emitResult: (toolResult) => {
      emitted.push(toolResult);
      return { emitted: true };
    },
    setExitCode: (code) => exitCodes.push(code),
    logger: () => {},
  });

  assert.strictEqual(response.toolResult.success, false);
  assert.strictEqual(response.toolResult.output.outcome, 'PARTIAL');
  assert.strictEqual(response.toolResult.output.totals.indicatorsFailed, 1);
  assert.strictEqual(emitted.length, 1);
  assert.deepStrictEqual(exitCodes, []);
}



async function runUnrefedLifecycleTransportCase() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skycommand-macro-cli-lifecycle-'));
  const fixturePath = path.join(temporaryRoot, 'macro-lifecycle-fixture.js');
  const macroCliPath = require.resolve('./macroIngestionCli');
  const schemaPath = path.resolve(__dirname, '../../../tools/contracts/macro_ingestion_summary.v1.schema.json');
  const outputSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  try {
    fs.writeFileSync(
      fixturePath,
      [
        `const { runMacroIngestionCli, runMacroIngestionEntrypoint } = require(${JSON.stringify(macroCliPath)});`,
        'runMacroIngestionEntrypoint(() => runMacroIngestionCli({',
        "  sourceCode: 'FRED',",
        "  toolCode: 'ingestion_fred',",
        '  args: [],',
        '  execute: async () => {',
        '    await new Promise((resolve) => {',
        '      const timer = setTimeout(resolve, 75);',
        '      timer.unref();',
        '    });',
        '    return {',
        '      ok: true,',
        "      source: 'FRED',",
        "      mode: 'indicator_batch',",
        '      selectedIndicators: false,',
        '      concurrency: 1,',
        '      batchCount: 1,',
        "      startedAt: '2026-08-30T00:00:00.000Z',",
        "      completedAt: '2026-08-30T00:00:01.000Z',",
        "      recoveryLedgerReference: { persisted: true, ingestionRunId: 'lifecycle-self-test' },",
        '      results: [],',
        '    };',
        '  },',
        '  printResult: () => {},',
        '  logger: () => {},',
        '}));',
        '',
      ].join('\n'),
      'utf8',
    );

    const processResult = await executeToolProcess({
      command: process.execPath,
      commandArgs: [fixturePath],
      cwd: temporaryRoot,
      env: process.env,
      timeoutMs: 5000,
      executionId: 'macro-lifecycle-self-test',
      toolCode: 'ingestion_fred',
      toolResultExpectedOutputType: 'macro_ingestion_summary.v1',
      toolResultOutputSchema: outputSchema,
      rootDirectory: temporaryRoot,
    });

    assert.strictEqual(processResult.status, 'SUCCESS');
    assert.strictEqual(processResult.toolResultContract.status, 'VALID');
    assert.strictEqual(processResult.toolResult?.outputType, 'macro_ingestion_summary.v1');
    assert.strictEqual(processResult.toolResult?.output?.sourceCode, 'FRED');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function run() {
  await runSourceSuccessCase('FRED');
  await runSourceSuccessCase('BOC');
  await runSourceSuccessCase('STATCAN');
  await runFailureCase();
  await runPartialAllowFailuresCase();
  await runUnrefedLifecycleTransportCase();

  console.log('[SkyCommand] Macro ingestion CLI adapter self-test passed.');
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
