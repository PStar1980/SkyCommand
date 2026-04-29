const fs = require('fs');
const path = require('path');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const cleanupTempDir = (dir) => {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);

    if (fs.statSync(fullPath).isFile()) {
      fs.unlinkSync(fullPath);
    }
  }
};

const runPipeline = async ({ name, getIndicators, download, normalize, load, tempDir }) => {
  ensureDir(tempDir);

  const indicators = await getIndicators();

  console.log(`\n📊 [${name}] Active indicators: ${indicators.length}`);

  for (const code of indicators) {
    console.log(`🔥 [${name}] Processing ${code}`);

    try {
      const filePath = await download(code, tempDir);

      if (normalize) {
        normalize(filePath);
      }

      load(code, filePath);

      console.log(`✅ [${name}] Loaded ${code}\n`);
    } catch (err) {
      console.error(`❌ [${name}] Failed ${code}:`, err.message);
    }
  }

  cleanupTempDir(tempDir);

  console.log(`🧹 [${name}] Temp cleaned`);
  console.log(`🎯 [${name}] Complete\n`);
};

module.exports = { runPipeline };
