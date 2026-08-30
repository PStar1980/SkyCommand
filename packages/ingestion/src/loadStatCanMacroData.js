require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});


const { runSourceAdapter } = require('./core/sourceAdapter');
const {
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  printPipelineResult,
} = require('./core/cliOptions');
const {
  runMacroIngestionCli,
  runMacroIngestionEntrypoint,
} = require('./core/macroIngestionCli');
const { executeProductionRecovery } = require('./recovery/productionRecovery');
const statcanAdapter = require('./adapters/statcanAdapter');
const STATCAN_DEFAULT_CONCURRENCY = 2;
const STATCAN_MAX_CONCURRENCY = 3;

async function executeStatCanIngestion(args = process.argv.slice(2), runtime = {}) {
  const concurrency = getConcurrency(
    args,
    'STATCAN_INGESTION_CONCURRENCY',
    STATCAN_DEFAULT_CONCURRENCY,
  );
  const runId = getRunId(args, 'STATCAN_INGESTION_RUN_ID', 'statcan-tool');
  const recovery = await (runtime.executeRecovery || executeProductionRecovery)({
    adapter: statcanAdapter,
    toolCode: 'ingestion_statcan',
    args,
    concurrency,
    runId,
    client: runtime.client,
    execute: runtime.executeRecoveryAdapter,
    executionContext: runtime.executionContext,
  });
  if (recovery) return recovery;

  return runSourceAdapter(statcanAdapter, {
    indicators: getRequestedIndicators(args),
    concurrency,
    maxConcurrency:
      Number.parseInt(
        process.env.STATCAN_INGESTION_MAX_CONCURRENCY || STATCAN_MAX_CONCURRENCY,
        10,
      ) || STATCAN_MAX_CONCURRENCY,
    runId,
    cleanupQuiet: true,
  });
}

function main(args = process.argv.slice(2), options = {}) {
  return runMacroIngestionCli({
    sourceCode: 'STATCAN',
    toolCode: 'ingestion_statcan',
    args,
    execute: options.execute || executeStatCanIngestion,
    printResult: options.printResult || printPipelineResult,
    emitResult: options.emitResult,
    setExitCode: options.setExitCode,
    logger: options.logger,
  });
}

if (require.main === module) {
  runMacroIngestionEntrypoint(() => main());
}

module.exports = {
  executeStatCanIngestion,
  main,
};
