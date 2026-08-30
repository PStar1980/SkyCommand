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
const bocAdapter = require('./adapters/bocAdapter');

async function executeBoCIngestion(args = process.argv.slice(2), runtime = {}) {
  const concurrency = getConcurrency(args, 'BOC_INGESTION_CONCURRENCY', 3);
  const runId = getRunId(args, 'BOC_INGESTION_RUN_ID', 'boc-tool');
  const recovery = await (runtime.executeRecovery || executeProductionRecovery)({
    adapter: bocAdapter,
    toolCode: 'ingestion_boc',
    args,
    concurrency,
    runId,
    client: runtime.client,
    execute: runtime.executeRecoveryAdapter,
    executionContext: runtime.executionContext,
  });
  if (recovery) return recovery;

  return runSourceAdapter(bocAdapter, {
    indicators: getRequestedIndicators(args),
    concurrency,
    runId,
    cleanupQuiet: true,
  });
}

function main(args = process.argv.slice(2), options = {}) {
  return runMacroIngestionCli({
    sourceCode: 'BOC',
    toolCode: 'ingestion_boc',
    args,
    execute: options.execute || executeBoCIngestion,
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
  executeBoCIngestion,
  main,
};
