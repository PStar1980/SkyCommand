const { getAssetQualityContext } = require('../quality/qualityPolicy');
const { copyIntoTable } = require('./copyLoader');

function createQualityAwareTimeSeriesLoader({ domainCode, sourceCode, query } = {}) {
  const domain = String(domainCode || '').trim().toUpperCase();
  const source = String(sourceCode || '').trim().toUpperCase();
  if (!domain || !source) throw new Error('domainCode and sourceCode are required.');

  return async function qualityAwareTimeSeriesLoad(assetCode, filePath) {
    const qualityContext = await getAssetQualityContext(domain, source, assetCode, { query });
    return copyIntoTable(assetCode, filePath, { qualityContext });
  };
}

module.exports = { createQualityAwareTimeSeriesLoader };
