const path = require('path');

const { defineSourceAdapter } = require('../core/sourceAdapter');
const { getManualJobs, buildManualCSV } = require('../sources/manual');
const { copyManualIntoTable } = require('../loaders/manualCopyLoader');

module.exports = defineSourceAdapter({
  domainCode: 'MACRO',
  sourceCode: 'MANUAL',
  adapterCode: 'MANUAL_FILE',
  name: 'Manual',
  getAssets: getManualJobs,
  fetch: buildManualCSV,
  normalize: null,
  load: copyManualIntoTable,
  getCode: (job) => job.name || `${job.schema || 'public'}.${job.table}`,
  tempDir: path.join(__dirname, '..', 'tmp'),
  defaultConcurrency: 1,
  maxConcurrency: 1,
  requestPolicyRequired: false,
});
