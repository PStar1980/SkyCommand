const path = require('path');

const { defineSourceAdapter } = require('../core/sourceAdapter');
const { getIndicators } = require('../sources/indicators');
const { downloadFredCSV } = require('../sources/fred');
const { normalizeFredCSV } = require('../transform/csvNormalizer');
const { copyIntoTable } = require('../loaders/copyLoader');

module.exports = defineSourceAdapter({
  domainCode: 'MACRO',
  sourceCode: 'FRED',
  adapterCode: 'FRED',
  name: 'FRED',
  getAssets: () => getIndicators('FRED'),
  fetch: (code, tempDir, item, context = {}) => downloadFredCSV(code, tempDir, {
    requestPolicy: context.requestPolicy,
  }),
  normalize: normalizeFredCSV,
  load: copyIntoTable,
  tempDir: path.join(__dirname, '..', 'tmp', 'fred-batch'),
  defaultConcurrency: 3,
  maxConcurrency: 10,
  requestPolicyRequired: true,
});
