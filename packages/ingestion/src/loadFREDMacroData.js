require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const fredAdapter = require('./adapters/fredAdapter');
const { runSourceAdapter } = require('./core/sourceAdapter');
const {
  getConcurrency: getCommonConcurrency,
  getRequestedIndicators,
  getRunId: getCommonRunId,
  printPipelineResult,
} = require('./core/cliOptions');
const { runMacroIngestionCli } = require('./core/macroIngestionCli');
const { executeProductionRecovery } = require('./recovery/productionRecovery');

const DEFAULT_FRED_CONCURRENCY = 3;
const MAX_FRED_CONCURRENCY = 10;

function getConcurrency(args = process.argv.slice(2)) {
  return getCommonConcurrency(args, 'FRED_INGESTION_CONCURRENCY', DEFAULT_FRED_CONCURRENCY);
}

function getRunId(args = process.argv.slice(2)) {
  return getCommonRunId(args, 'FRED_INGESTION_RUN_ID', 'fred-tool');
}

async function executeFredIngestion(args = process.argv.slice(2), runtime = {}) {
  const concurrency = getConcurrency(args);
  const runId = getRunId(args);
  const recovery = await (runtime.executeRecovery || executeProductionRecovery)({
    adapter: fredAdapter,
    toolCode: 'ingestion_fred',
    args,
    concurrency,
    runId,
    client: runtime.client,
    execute: runtime.executeRecoveryAdapter,
    executionContext: runtime.executionContext,
  });
  if (recovery) return recovery;

  return runSourceAdapter(fredAdapter, {
    indicators: getRequestedIndicators(args),
    concurrency,
    maxConcurrency: MAX_FRED_CONCURRENCY,
    runId,
    cleanupQuiet: true,
  });
}

function main(args = process.argv.slice(2), options = {}) {
  return runMacroIngestionCli({
    sourceCode: 'FRED',
    toolCode: 'ingestion_fred',
    args,
    execute: options.execute || executeFredIngestion,
    printResult: options.printResult || printPipelineResult,
    emitResult: options.emitResult,
    setExitCode: options.setExitCode,
    logger: options.logger,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_FRED_CONCURRENCY,
  MAX_FRED_CONCURRENCY,
  executeFredIngestion,
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  main,
  printResult: printPipelineResult,
};
