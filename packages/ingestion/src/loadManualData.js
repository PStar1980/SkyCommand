require('dotenv').config({
  path: require('path').join(__dirname, '../../../.env'),
});

const path = require('path');

const { runPipeline } = require('./core/runPipeline');
const { getManualJobs, buildManualCSV } = require('./sources/manual');
const { copyManualIntoTable } = require('./loaders/manualCopyLoader');

const tempDir = path.join(__dirname, 'tmp');

runPipeline({
  name: 'Manual',
  getIndicators: getManualJobs,
  download: buildManualCSV,
  normalize: null,
  load: copyManualIntoTable,
  tempDir,
  getCode: (job) => job.name || `${job.schema || 'public'}.${job.table}`,
  concurrency: 1,
});
