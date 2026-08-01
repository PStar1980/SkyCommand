const path = require('path');

const { downloadToFileWithSourcePolicy } = require('../core/httpSourceClient');

const downloadBoCCSV = async (code, outputDir, options = {}) => {
  const url = `https://www.bankofcanada.ca/valet/observations/${code}/csv`;

  console.log(`🌐 Downloading BoC ${code}...`);

  return downloadToFileWithSourcePolicy({
    sourceCode: 'BOC',
    domainCode: 'MACRO',
    assetCode: code,
    url,
    outputDir,
    fileName: `${path.basename(code)}.csv`,
    policy: options.requestPolicy,
    query: options.query,
    axiosInstance: options.axiosInstance,
    retryOptions: options.retryOptions,
  });
};

module.exports = { downloadBoCCSV };
