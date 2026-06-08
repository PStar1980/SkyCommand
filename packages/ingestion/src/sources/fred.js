const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FRED_DOWNLOAD_TIMEOUT_MS = 30000;

const downloadFredCSV = async (seriesId, outputDir) => {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const filePath = path.join(outputDir, `${seriesId}.csv`);

  console.log(`🌐 Downloading ${seriesId}...`);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: FRED_DOWNLOAD_TIMEOUT_MS,
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log(`💾 Saved ${filePath}`);
      resolve(filePath);
    });
    writer.on('error', reject);
  });
};

module.exports = { downloadFredCSV };
