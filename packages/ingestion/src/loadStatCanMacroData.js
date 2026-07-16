require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const {
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  printPipelineResult,
} = require('./core/cliOptions');
const { runMacroIngestionCli } = require('./core/macroIngestionCli');
const { getIndicators } = require('./sources/indicators');
const { downloadStatCanVectorCSV } = require('./sources/statcan');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp', 'statcan-batch');
const STATCAN_DEFAULT_CONCURRENCY = 2;
const STATCAN_MAX_CONCURRENCY = 3;

async function executeStatCanIngestion(args = process.argv.slice(2)) {
  return runPipeline({
    name: 'StatCan',
    getIndicators: () => getIndicators('STATCAN'),
    download: downloadStatCanVectorCSV,
    normalize: null,
    load: copyIntoTable,
    tempDir,
    indicators: getRequestedIndicators(args),
    concurrency: getConcurrency(
      args,
      'STATCAN_INGESTION_CONCURRENCY',
      STATCAN_DEFAULT_CONCURRENCY,
    ),
    maxConcurrency:
      Number.parseInt(
        process.env.STATCAN_INGESTION_MAX_CONCURRENCY || STATCAN_MAX_CONCURRENCY,
        10,
      ) || STATCAN_MAX_CONCURRENCY,
    runId: getRunId(args, 'STATCAN_INGESTION_RUN_ID', 'statcan-tool'),
    cleanupQuiet: true,
  });
}

function main(args = process.argv.slice(2), options = {}) {
  return runMacroIngestionCli({
    sourceCode: 'STATCAN',
    args,
    execute: options.execute || executeStatCanIngestion,
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
  executeStatCanIngestion,
  main,
};
