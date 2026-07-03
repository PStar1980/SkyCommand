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
const { downloadStatCanVectorCSV } = require('./sources/statcan');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp', 'statcan-batch');
const cliArgs = process.argv.slice(2);

async function main() {
  const result = await runPipeline({
    name: 'StatCan',
    getIndicators: () => getIndicators('STATCAN'),
    download: downloadStatCanVectorCSV,
    normalize: null,
    load: copyIntoTable,
    tempDir,
    indicators: getRequestedIndicators(cliArgs),
    concurrency: getConcurrency(cliArgs, 'STATCAN_INGESTION_CONCURRENCY', 3),
    runId: getRunId(cliArgs, 'STATCAN_INGESTION_RUN_ID', 'statcan-tool'),
    cleanupQuiet: true,
  });

  printPipelineResult(result, cliArgs);

  if (!result.ok && !hasFlag(cliArgs, 'allow-failures')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[StatCan] Ingestion failed');
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
