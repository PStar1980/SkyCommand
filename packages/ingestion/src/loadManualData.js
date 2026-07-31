require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const { persistManualBatchResultSafely } = require('./ledger/ingestionLedgerIntegration');
const { getManualJobs, buildManualCSV } = require('./sources/manual');
const { copyManualIntoTable } = require('./loaders/manualCopyLoader');

const tempDir = path.join(__dirname, 'tmp');

async function executeManualIngestion() {
  const result = await runPipeline({
    name: 'Manual',
    getIndicators: getManualJobs,
    download: buildManualCSV,
    normalize: null,
    load: copyManualIntoTable,
    tempDir,
    getCode: (job) => job.name || `${job.schema || 'public'}.${job.table}`,
    concurrency: 1,
  });

  const ledger = await persistManualBatchResultSafely({ batchResult: result });
  return {
    ...result,
    ledger,
  };
}

async function main() {
  const result = await executeManualIngestion();

  if (result.ledger?.persisted) {
    console.log(`🧾 [Manual] Ledger run: ${result.ledger.ingestionRunId}`);
  } else if (result.ledger?.warning) {
    console.warn(`⚠️ [Manual] Ledger warning: ${result.ledger.warning.message}`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }

  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  executeManualIngestion,
  main,
};
