require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { getIndicators } = require('./sources/indicators');
const { downloadFredCSV } = require('./sources/fred');
const { normalizeFredCSV } = require('./transform/csvNormalizer');
const { copyIntoTable } = require('./loaders/copyLoader');

const tempDir = path.join(__dirname, 'tmp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const indicators = getIndicators();
console.log(`📊 Active indicators: ${indicators.length}`);

(async () => {
  for (const code of indicators) {
    console.log(`🔥 Processing ${code}`);

    try {
      const csvPath = await downloadFredCSV(code, tempDir);

      normalizeFredCSV(csvPath);

      copyIntoTable(code, csvPath);

      console.log(`✅ Loaded ${code}\n`);
    } catch (err) {
      console.error(`❌ Failed ${code}:`, err.message);
    }
  }

  console.log('🎯 Full ingestion complete');
})();
