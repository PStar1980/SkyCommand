const fs = require('fs');
const path = require('path');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const cleanupTempDir = (dir) => {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    fs.rmSync(fullPath, {
      recursive: true,
      force: true,
    });
  }
};

const getItemCode = (item, getCode) => {
  if (getCode) {
    return getCode(item);
  }

  if (typeof item === 'string') {
    return item;
  }

  return item.code || item.name || item.table || 'UNKNOWN';
};

const runPipeline = async ({
  name,
  getIndicators,
  download,
  normalize,
  load,
  tempDir,
  getCode,
}) => {
  ensureDir(tempDir);

  const items = await getIndicators();

  console.log(`\n📊 [${name}] Active indicators: ${items.length}`);

  for (const item of items) {
    const code = getItemCode(item, getCode);

    console.log(`🔥 [${name}] Processing ${code}`);

    try {
      const filePath = await download(code, tempDir, item);

      if (normalize) {
        normalize(filePath, code, item);
      }

      load(code, filePath, item);

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
