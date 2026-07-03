require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const {
  getConcurrency,
  getRequestedIndicators,
  getRunId,
  hasFlag,
  printPipelineResult,
} = require('./core/cliOptions');
const { getIndicators } = require('./sources/indicators');
const { downloadBoCCSV } = require('./sources/boc');
const { normalizeBoCCSV } = require('./transform/csvNormalizer');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp', 'boc-batch');
const cliArgs = process.argv.slice(2);

async function main() {
  const result = await runPipeline({
    name: 'BoC',
    getIndicators: () => getIndicators('BOC'),
    download: downloadBoCCSV,
    normalize: normalizeBoCCSV,
    load: copyIntoTable,
    tempDir,
    indicators: getRequestedIndicators(cliArgs),
    concurrency: getConcurrency(cliArgs, 'BOC_INGESTION_CONCURRENCY', 3),
    runId: getRunId(cliArgs, 'BOC_INGESTION_RUN_ID', 'boc-tool'),
    cleanupQuiet: true,
  });

  printPipelineResult(result, cliArgs);

  if (!result.ok && !hasFlag(cliArgs, 'allow-failures')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[BoC] Ingestion failed');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
