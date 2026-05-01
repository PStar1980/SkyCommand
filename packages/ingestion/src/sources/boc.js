const https = require('https');
const fs = require('fs');
const path = require('path');

const downloadBoCCSV = (code, outputDir) => {
  return new Promise((resolve, reject) => {
    const url = `https://www.bankofcanada.ca/valet/observations/${code}/csv`;
    const filePath = path.join(outputDir, `${code}.csv`);

    console.log(`🌐 Downloading BoC ${code}...`);

    const writer = fs.createWriteStream(filePath);

    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          writer.close();
          fs.unlink(filePath, () => {});
          reject(new Error(`Request failed with status code ${res.statusCode}`));
          return;
        }

        res.pipe(writer);

        writer.on('finish', () => {
          writer.close(() => {
            console.log(`💾 Saved ${filePath}`);
            resolve(filePath);
          });
        });
      })
      .on('error', (err) => {
        writer.close();
        fs.unlink(filePath, () => {});
        reject(err);
      });

    writer.on('error', reject);
  });
};

module.exports = { downloadBoCCSV };
