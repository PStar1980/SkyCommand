const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');
const DB_BUILD_SRC_ROOT = __dirname;
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');

// Migrations and seeds now live under packages/db_build/src/.
const SQL_ROOTS = [
  path.join(DB_BUILD_SRC_ROOT, 'migrations'),
  path.join(DB_BUILD_SRC_ROOT, 'seeds'),
];

dotenv.config({
  path: ENV_PATH,
});

const BASE_DB = 'postgres';
const DEFAULT_ENCODING = process.env.DB_BUILD_ENCODING || 'UTF8';
const DEFAULT_LC_COLLATE = process.env.DB_BUILD_LC_COLLATE || 'English_Canada.1252';
const DEFAULT_LC_CTYPE = process.env.DB_BUILD_LC_CTYPE || 'English_Canada.1252';
const DEFAULT_LOCALE_PROVIDER = process.env.DB_BUILD_LOCALE_PROVIDER || 'libc';
const DEFAULT_TABLESPACE = process.env.DB_BUILD_TABLESPACE || 'pg_default';
const DEFAULT_CONNECTION_LIMIT = process.env.DB_BUILD_CONNECTION_LIMIT || '-1';

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    throw new Error(`❌ Missing required environment variable: ${name}`);
  }

  return value;
}

function printUsage() {
  console.log(`
SkyServer DB Build

Usage:
  node packages/db_build/src/db_build.js <databaseName>
  node packages/db_build/src/db_build.js --databaseName skyserver_dev
  npm run db:build -- skyserver_dev

Notes:
  - databaseName is required.
  - PGDATABASE is intentionally not used by this build script.
  - The script drops and recreates the target database, then runs SQL from:
      packages/db_build/src/migrations
      packages/db_build/src/seeds
`);
}

function getArgValue(flagNames) {
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    for (const flagName of flagNames) {
      if (arg === flagName) {
        return args[index + 1];
      }

      if (arg.startsWith(`${flagName}=`)) {
        return arg.slice(flagName.length + 1);
      }
    }
  }

  return null;
}

function getTargetDatabaseName() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const flaggedValue = getArgValue(['--databaseName', '--database', '--db', '--target-db']);

  if (flaggedValue) {
    return normalizeDatabaseName(flaggedValue);
  }

  const positionalValue = args.find((arg) => !arg.startsWith('-'));

  if (positionalValue) {
    return normalizeDatabaseName(positionalValue);
  }

  throw new Error(
    '❌ Missing required databaseName parameter. Example: node packages/db_build/src/db_build.js skyserver_dev',
  );
}

function normalizeDatabaseName(value) {
  const databaseName = String(value || '').trim();

  if (!databaseName) {
    throw new Error('❌ databaseName cannot be empty.');
  }

  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error(
      '❌ databaseName must start with a letter and contain only letters, numbers, and underscores, with a maximum length of 63 characters.',
    );
  }

  const blockedDatabaseNames = new Set(['postgres', 'template0', 'template1']);

  if (blockedDatabaseNames.has(databaseName.toLowerCase())) {
    throw new Error(`❌ Refusing to rebuild protected database: ${databaseName}`);
  }

  return databaseName;
}

function normalizeIdentifier(value, label) {
  const identifier = String(value || '').trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error(`❌ ${label} must be a safe SQL identifier.`);
  }

  return identifier;
}

function quoteSqlIdentifier(identifier) {
  const safeIdentifier = normalizeIdentifier(identifier, 'SQL identifier');
  return `"${safeIdentifier.replace(/"/g, '""')}"`;
}

function quoteSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getPsqlBaseArgs(databaseName) {
  return [
    '-h',
    requireEnv('PGHOST'),
    '-p',
    process.env.PGPORT || '5432',
    '-U',
    requireEnv('PGUSER'),
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
  ];
}

function runPsql(databaseName, args) {
  execFileSync('psql', [...getPsqlBaseArgs(databaseName), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
}

function dropAndCreateDatabase(databaseName) {
  const owner = process.env.DB_BUILD_OWNER || process.env.PGUSER || 'postgres';

  normalizeIdentifier(owner, 'database owner');
  normalizeIdentifier(DEFAULT_TABLESPACE, 'tablespace');
  normalizeIdentifier(DEFAULT_LOCALE_PROVIDER, 'locale provider');

  const quotedDatabaseName = quoteSqlIdentifier(databaseName);
  const connectionLimit = Number.parseInt(DEFAULT_CONNECTION_LIMIT, 10);

  if (!Number.isInteger(connectionLimit)) {
    throw new Error('❌ DB_BUILD_CONNECTION_LIMIT must be an integer.');
  }

  const dropSql = `DROP DATABASE IF EXISTS ${quotedDatabaseName};`;

  const createSql = `
CREATE DATABASE ${quotedDatabaseName}
  WITH
  OWNER = ${quoteSqlIdentifier(owner)}
  ENCODING = ${quoteSqlLiteral(DEFAULT_ENCODING)}
  LC_COLLATE = ${quoteSqlLiteral(DEFAULT_LC_COLLATE)}
  LC_CTYPE = ${quoteSqlLiteral(DEFAULT_LC_CTYPE)}
  LOCALE_PROVIDER = ${DEFAULT_LOCALE_PROVIDER}
  TABLESPACE = ${quoteSqlIdentifier(DEFAULT_TABLESPACE)}
  CONNECTION LIMIT = ${connectionLimit}
  IS_TEMPLATE = False;
`;

  console.log(`🔥 Dropping database ${databaseName} from ${BASE_DB} if it exists`);
  runPsql(BASE_DB, ['-c', dropSql]);

  console.log(`🔥 Creating database ${databaseName} from ${BASE_DB}`);
  runPsql(BASE_DB, ['-c', createSql]);
}

function shouldSkipSqlPath(filePath) {
  const relativePath = path.relative(DB_BUILD_SRC_ROOT, filePath);
  const pathSegments = relativePath.split(path.sep).map((segment) => segment.toLowerCase());

  // Database creation is now handled dynamically by this script, so legacy init SQL is skipped
  // if the folder/file still exists locally during the transition.
  return pathSegments.includes('init');
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
    } else if (entry.toLowerCase().endsWith('.sql') && !shouldSkipSqlPath(fullPath)) {
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

function runSqlFile(file, databaseName) {
  const relativeFile = path.relative(DB_BUILD_SRC_ROOT, file);

  console.log(`🔥 Running ${relativeFile} on ${databaseName}`);
  runPsql(databaseName, ['-f', file]);
}

requireEnv('PGPASSWORD');

const targetDatabaseName = getTargetDatabaseName();
const migrationRoot = path.join(DB_BUILD_SRC_ROOT, 'migrations');
const seedRoot = path.join(DB_BUILD_SRC_ROOT, 'seeds');
const migrationFiles = getAllSqlFiles(migrationRoot).sort(sortSqlFiles);
const seedFiles = getAllSqlFiles(seedRoot).sort(sortSqlFiles);
const allFiles = [...migrationFiles, ...seedFiles];

if (migrationFiles.length === 0) {
  throw new Error(`❌ No migration SQL files found under ${migrationRoot}`);
}

if (allFiles.length === 0) {
  throw new Error(`❌ No SQL files found under ${SQL_ROOTS.join(', ')}`);
}

console.log(`[SkyServer DB Build] Env file: ${ENV_PATH}`);
console.log(`[SkyServer DB Build] Target database: ${targetDatabaseName}`);
console.log(`[SkyServer DB Build] Migration root: ${migrationRoot}`);
console.log(`[SkyServer DB Build] Seed root: ${seedRoot}`);
console.log(`[SkyServer DB Build] Migration files found: ${migrationFiles.length}`);
console.log(`[SkyServer DB Build] Seed files found: ${seedFiles.length}`);
console.log(`[SkyServer DB Build] SQL files found: ${allFiles.length}`);

dropAndCreateDatabase(targetDatabaseName);

console.log(`🔥 Running ${migrationFiles.length} migration file(s) before seed files`);
for (const file of migrationFiles) {
  runSqlFile(file, targetDatabaseName);
}

console.log(`🌱 Running ${seedFiles.length} seed file(s) after migrations`);
for (const file of seedFiles) {
  runSqlFile(file, targetDatabaseName);
}

console.log(`✅ DB build complete for ${targetDatabaseName}`);
