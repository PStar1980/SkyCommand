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
const { runMacroIngestionCli } = require('./core/macroIngestionCli');
const bocAdapter = require('./adapters/bocAdapter');

async function executeBoCIngestion(args = process.argv.slice(2)) {
  return runSourceAdapter(bocAdapter, {
    indicators: getRequestedIndicators(args),
    concurrency: getConcurrency(args, 'BOC_INGESTION_CONCURRENCY', 3),
    runId: getRunId(args, 'BOC_INGESTION_RUN_ID', 'boc-tool'),
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
  main();
}

module.exports = {
  executeBoCIngestion,
  main,
};
