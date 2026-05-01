require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const { getIndicators } = require('./sources/indicators');
const { downloadFredCSV } = require('./sources/fred');
const { normalizeFredCSV } = require('./transform/csvNormalizer');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp');

runPipeline({
  name: 'FRED',
  getIndicators: () => getIndicators('FRED'),
  download: downloadFredCSV,
  normalize: normalizeFredCSV,
  load: copyIntoTable,
  tempDir,
});
