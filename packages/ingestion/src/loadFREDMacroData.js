require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const { randomUUID } = require('crypto');
const {
  runFredIndicatorBatch,
  parsePositiveInteger,
  DEFAULT_FRED_CONCURRENCY,
  MAX_FRED_CONCURRENCY,
} = require('./fred/fredBatchRunner');
const {
  createMacroIngestionFailureToolResult,
  createMacroIngestionToolResult,
} = require('./core/macroIngestionResult');
const { writeToolResult } = require('../../tools/src/toolResultTransport');

function getCliArgs() {
  return process.argv.slice(2);
}

function getArgValue(args, name) {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));

  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getRepeatedArgValues(args, name) {
  const prefix = `--${name}=`;

  return args.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length));
}

function getPositionalArgs(args) {
  return args.filter((value) => !String(value || '').startsWith('--'));
}

function looksNumeric(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function getRequestedIndicators(args) {
  const values = [];

  values.push(...getRepeatedArgValues(args, 'indicator'));

  const indicatorsArg = getArgValue(args, 'indicators');

  if (indicatorsArg) {
    values.push(indicatorsArg);
  }

  const positionalArgs = getPositionalArgs(args);
  const firstPositional = positionalArgs[0];

  if (firstPositional && !looksNumeric(firstPositional)) {
    values.push(firstPositional);
  }

  return values;
}

function getConcurrency(args) {
  const explicitConcurrency = getArgValue(args, 'concurrency') || process.env.FRED_INGESTION_CONCURRENCY;

  if (explicitConcurrency) {
    return parsePositiveInteger(explicitConcurrency, DEFAULT_FRED_CONCURRENCY, MAX_FRED_CONCURRENCY);
  }

  const positionalArgs = getPositionalArgs(args);
  const numericPositional = positionalArgs.find((value) => looksNumeric(value));

  return parsePositiveInteger(numericPositional, DEFAULT_FRED_CONCURRENCY, MAX_FRED_CONCURRENCY);
}

function getRunId(args) {
  const explicitRunId = getArgValue(args, 'run-id') || process.env.FRED_INGESTION_RUN_ID;

  if (explicitRunId) {
    return explicitRunId;
  }

  return `fred-tool-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function printResult(result, args) {
  const summary = result.summary || {};

  console.log('');
  console.log('FRED ingestion summary');
  console.log('------------------------------------------------------------');
  console.log(`  mode: ${result.mode || 'indicator_batch'}`);
  console.log(`  selected indicators: ${result.selectedIndicators ? 'yes' : 'no'}`);
  console.log(`  concurrency: ${result.concurrency || 'unknown'}`);
  console.log(`  batches: ${result.batchCount ?? 'unknown'}`);
  console.log(`  total: ${summary.total ?? 0}`);
  console.log(`  succeeded: ${summary.succeeded ?? 0}`);
  console.log(`  failed: ${summary.failed ?? 0}`);
  console.log(`  updated: ${summary.updated ?? 0}`);
  console.log(`  unchanged: ${summary.unchanged ?? 0}`);
  console.log(`  rows inserted: ${summary.rowsInserted ?? 0}`);

  if (hasFlag(args, 'json')) {
    console.log('');
    console.log(JSON.stringify(result, null, 2));
  }
}

function emitToolResult(toolResult) {
  return writeToolResult(toolResult);
}

async function main(args = getCliArgs()) {
  const startedAt = new Date().toISOString();

  try {
    const result = await runFredIndicatorBatch({
      indicators: getRequestedIndicators(args),
      concurrency: getConcurrency(args),
      runId: getRunId(args),
      cleanupQuiet: true,
    });
    const toolResult = createMacroIngestionToolResult({
      sourceCode: 'FRED',
      batchResult: result,
    });

    printResult(result, args);
    emitToolResult(toolResult);

    if (!result.ok && !hasFlag(args, 'allow-failures')) {
      process.exitCode = 1;
    }

    return { result, toolResult };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const toolResult = createMacroIngestionFailureToolResult({
      sourceCode: 'FRED',
      error,
      startedAt,
      completedAt,
    });

    console.error('[FRED] Ingestion failed');
    console.error(error.stack || error.message || String(error));

    try {
      emitToolResult(toolResult);
    } catch (resultError) {
      console.error('[FRED] Structured ToolResult emission failed');
      console.error(resultError.stack || resultError.message || String(resultError));
    }

    process.exitCode = 1;
    return { result: null, toolResult, error };
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  emitToolResult,
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  main,
  printResult,
};
