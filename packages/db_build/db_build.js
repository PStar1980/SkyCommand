const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '../../../.env'),
});

const BASE_DB = 'postgres';
const TARGET_DB = process.env.PGDATABASE;

if (!TARGET_DB) {
  throw new Error('❌ PGDATABASE not set in .env');
}

const base = __dirname;

// 🔥 Recursively collect SQL files
const getAllSqlFiles = (dir) => {
  let results = [];

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat && stat.isDirectory()) {
      results = results.concat(getAllSqlFiles(fullPath));
    } else if (file.endsWith('.sql')) {
      results.push(fullPath);
    }
  }

  return results;
};

// 🔥 Sort globally by filename
const allFiles = getAllSqlFiles(base).sort((a, b) =>
  path.basename(a).localeCompare(path.basename(b)),
);

// 🚀 Execute scripts
for (const file of allFiles) {
  const filename = path.basename(file);

  // Only init script runs on base DB
  const isInit = filename.startsWith('00001');
  const db = isInit ? BASE_DB : TARGET_DB;

  console.log(`🔥 Running ${filename} on ${db}`);

  execSync(
    `psql -h ${process.env.PGHOST} -p ${process.env.PGPORT} -U ${process.env.PGUSER} -d ${db} -f "${file}"`,
    {
      stdio: 'inherit',
      env: process.env, // 👈 passes PGPASSWORD automatically
    },
  );
}

console.log('✅ DB build complete');
