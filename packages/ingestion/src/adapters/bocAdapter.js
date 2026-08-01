const path = require('path');

const { defineSourceAdapter } = require('../core/sourceAdapter');
const { getIndicators } = require('../sources/indicators');
const { downloadBoCCSV } = require('../sources/boc');
const { normalizeBoCCSV } = require('../transform/csvNormalizer');
const { copyIntoTable } = require('../loaders/copyLoader');

module.exports = defineSourceAdapter({
  domainCode: 'MACRO',
  sourceCode: 'BOC',
  adapterCode: 'BOC',
  resultContractVersion: 'macro_ingestion_summary.v1',
  name: 'BoC',
  getAssets: () => getIndicators('BOC'),
  fetch: (code, tempDir, item, context = {}) => downloadBoCCSV(code, tempDir, {
    requestPolicy: context.requestPolicy,
  }),
  normalize: normalizeBoCCSV,
  load: copyIntoTable,
  tempDir: path.join(__dirname, '..', 'tmp', 'boc-batch'),
  defaultConcurrency: 3,
  maxConcurrency: 10,
  capabilities: {
    incremental: true,
    selectedAssets: true,
    backfill: false,
    revisions: true,
    resume: false,
    dryRun: false,
  },
  requestPolicyRequired: true,
});
