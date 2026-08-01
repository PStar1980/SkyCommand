const path = require('path');

const { defineSourceAdapter } = require('../core/sourceAdapter');
const { getIndicators } = require('../sources/indicators');
const { downloadStatCanVectorCSV } = require('../sources/statcan');
const { copyIntoTable } = require('../loaders/copyLoader');

module.exports = defineSourceAdapter({
  domainCode: 'MACRO',
  sourceCode: 'STATCAN',
  adapterCode: 'STATCAN',
  resultContractVersion: 'macro_ingestion_summary.v1',
  name: 'StatCan',
  getAssets: () => getIndicators('STATCAN'),
  fetch: (code, tempDir, item, context = {}) => downloadStatCanVectorCSV(code, tempDir, {
    requestPolicy: context.requestPolicy,
  }),
  normalize: null,
  load: copyIntoTable,
  tempDir: path.join(__dirname, '..', 'tmp', 'statcan-batch'),
  defaultConcurrency: 2,
  maxConcurrency: 3,
  capabilities: {
    incremental: true,
    selectedAssets: true,
    backfill: false,
    revisions: false,
    resume: false,
    dryRun: false,
  },
  requestPolicyRequired: true,
});
