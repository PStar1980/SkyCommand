require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const manualAdapter = require('./adapters/manualAdapter');
const { runSourceAdapter } = require('./core/sourceAdapter');
const { persistManualBatchResultSafely } = require('./ledger/ingestionLedgerIntegration');

async function executeManualIngestion() {
  const result = await runSourceAdapter(manualAdapter, {
    concurrency: 1,
    cleanupQuiet: true,
  });

  const ledger = await persistManualBatchResultSafely({
    batchResult: result,
    toolCode: 'ingestion_manual',
  });
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

  if (!result.ok) process.exitCode = 1;
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
