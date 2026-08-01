const path = require('path');

const { downloadToFileWithSourcePolicy } = require('../core/httpSourceClient');

const downloadFredCSV = async (seriesId, outputDir, options = {}) => {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;

  console.log(`🌐 Downloading FRED ${seriesId}...`);

  return downloadToFileWithSourcePolicy({
    sourceCode: 'FRED',
    domainCode: 'MACRO',
    assetCode: seriesId,
    url,
    outputDir,
    fileName: `${path.basename(seriesId)}.csv`,
    policy: options.requestPolicy,
    query: options.query,
    axiosInstance: options.axiosInstance,
    retryOptions: options.retryOptions,
  });
};

module.exports = { downloadFredCSV };
