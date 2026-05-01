require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const { getIndicators } = require('./sources/indicators');
const { downloadStatCanVectorCSV } = require('./sources/statcan');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp');

runPipeline({
  name: 'StatCan',
  getIndicators: () => getIndicators('STATCAN'),
  download: downloadStatCanVectorCSV,
  normalize: null,
  load: copyIntoTable,
  tempDir,
});
