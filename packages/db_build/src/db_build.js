const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');
const DB_BUILD_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');

dotenv.config({
  path: ENV_PATH,
});

const BASE_DB = 'postgres';
const TARGET_DB = process.env.PGDATABASE;

const SQL_ROOTS = [path.join(DB_BUILD_ROOT, 'migrations'), path.join(DB_BUILD_ROOT, 'seeds')];

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }

  return value;
}

function getAllSqlFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  let results = [];

  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      results = results.concat(getAllSqlFiles(fullPath));
    } else if (entry.toLowerCase().endsWith('.sql')) {
      results.push(fullPath);
    }
  }

  return results;
}

function sortSqlFiles(a, b) {
  const fileA = path.basename(a);
  const fileB = path.basename(b);

  const filenameCompare = fileA.localeCompare(fileB);

  if (filenameCompare !== 0) {
    return filenameCompare;
  }

  return a.localeCompare(b);
}

function runSqlFile(file) {
  const filename = path.basename(file);
  const relativeFile = path.relative(DB_BUILD_ROOT, file);

  const isInit = filename.startsWith('00001');
  const db = isInit ? BASE_DB : TARGET_DB;

  console.log(`🔥 Running ${relativeFile} on ${db}`);

  execFileSync(
    'psql',
    [
      '-h',
      requireEnv('PGHOST'),
      '-p',
      process.env.PGPORT || '5432',
      '-U',
      requireEnv('PGUSER'),
      '-d',
      db,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      file,
    ],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
}

requireEnv('PGDATABASE');
requireEnv('PGPASSWORD');

const allFiles = SQL_ROOTS.flatMap(getAllSqlFiles).sort(sortSqlFiles);

if (allFiles.length === 0) {
  throw new Error(`❌ No SQL files found under ${SQL_ROOTS.join(', ')}`);
}

console.log(`[SkyServer DB Build] Env file: ${ENV_PATH}`);
console.log(`[SkyServer DB Build] SQL files found: ${allFiles.length}`);

for (const file of allFiles) {
  runSqlFile(file);
}

console.log('✅ DB build complete');
