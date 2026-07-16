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
const { downloadBoCCSV } = require('./sources/boc');
const { normalizeBoCCSV } = require('./transform/csvNormalizer');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp', 'boc-batch');

async function executeBoCIngestion(args = process.argv.slice(2)) {
  return runPipeline({
    name: 'BoC',
    getIndicators: () => getIndicators('BOC'),
    download: downloadBoCCSV,
    normalize: normalizeBoCCSV,
    load: copyIntoTable,
    tempDir,
    indicators: getRequestedIndicators(args),
    concurrency: getConcurrency(args, 'BOC_INGESTION_CONCURRENCY', 3),
    runId: getRunId(args, 'BOC_INGESTION_RUN_ID', 'boc-tool'),
    cleanupQuiet: true,
  });
}

function main(args = process.argv.slice(2), options = {}) {
  return runMacroIngestionCli({
    sourceCode: 'BOC',
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
