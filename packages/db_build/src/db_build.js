#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runToolCli } = require('../../tools/src');
const {
  DATABASE_BUILD_OUTPUT_TYPE,
  createDatabaseBuildFailureToolResult,
  createDatabaseBuildToolResult,
} = require('./databaseBuildResult');

const TOOL_CODE = 'db_build';
const SKY_SERVER_ROOT = path.resolve(__dirname, '../../..');
const DB_BUILD_SRC_ROOT = __dirname;
const ENV_PATH = path.join(SKY_SERVER_ROOT, '.env');

// Migrations and seeds share one global numeric ordering sequence.
const SQL_ROOTS = [
  path.join(DB_BUILD_SRC_ROOT, 'migrations'),
  path.join(DB_BUILD_SRC_ROOT, 'seeds'),
];
const SQL_ROOT_LABELS = SQL_ROOTS.map((root) =>
  path.relative(SKY_SERVER_ROOT, root).split(path.sep).join('/'),
);

const BASE_DB = 'postgres';
const DEFAULT_ENCODING = process.env.DB_BUILD_ENCODING || 'UTF8';
const DEFAULT_LC_COLLATE = process.env.DB_BUILD_LC_COLLATE || 'English_Canada.1252';
const DEFAULT_LC_CTYPE = process.env.DB_BUILD_LC_CTYPE || 'English_Canada.1252';
const DEFAULT_LOCALE_PROVIDER = process.env.DB_BUILD_LOCALE_PROVIDER || 'libc';
const DEFAULT_TABLESPACE = process.env.DB_BUILD_TABLESPACE || 'pg_default';
const DEFAULT_CONNECTION_LIMIT = process.env.DB_BUILD_CONNECTION_LIMIT || '-1';

// Environment values are loaded once, but domain validation remains inside executeDatabaseBuild
// so managed execution can emit a structured failure result instead of crashing during import.
dotenv.config({ path: ENV_PATH });

function createBuildError(code, message, buildResult, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.buildResult = buildResult;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function requireEnv(name, buildResult = null) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    throw createBuildError(
      'DATABASE_ENVIRONMENT_MISSING',
      `Missing required environment variable: ${name}`,
      buildResult,
    );
  }

  return value;
}

function printUsage() {
  console.log(`
SkyCommand DB Build

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
  - Managed SkyCommand runs emit database_build_summary.v1 for workflows.
`);
}

function getArgValue(args = [], flagNames = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');

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

function getTargetDatabaseName(args = []) {
  const normalizedArgs = Array.isArray(args) ? args.map((arg) => String(arg || '')) : [];
  const flaggedValue = getArgValue(normalizedArgs, [
    '--databaseName',
    '--database',
    '--db',
    '--target-db',
  ]);

  if (flaggedValue) {
    return normalizeDatabaseName(flaggedValue);
  }

  const positionalValue = normalizedArgs.find((arg) => arg && !arg.startsWith('-'));

  if (positionalValue) {
    return normalizeDatabaseName(positionalValue);
  }

  const error = new Error(
    'Missing required databaseName parameter. Example: node packages/db_build/src/db_build.js skyserver_dev',
  );
  error.code = 'DATABASE_NAME_REQUIRED';
  throw error;
}

function normalizeDatabaseName(value) {
  const databaseName = String(value || '').trim();

  if (!databaseName) {
    const error = new Error('databaseName cannot be empty.');
    error.code = 'DATABASE_NAME_REQUIRED';
    throw error;
  }

  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
    const error = new Error(
      'databaseName must start with a letter and contain only letters, numbers, and underscores, with a maximum length of 63 characters.',
    );
    error.code = 'DATABASE_NAME_INVALID';
    throw error;
  }

  const blockedDatabaseNames = new Set(['postgres', 'template0', 'template1']);

  if (blockedDatabaseNames.has(databaseName.toLowerCase())) {
    const error = new Error(`Refusing to rebuild protected database: ${databaseName}`);
    error.code = 'DATABASE_NAME_PROTECTED';
    throw error;
  }

  return databaseName;
}

function normalizeIdentifier(value, label) {
  const identifier = String(value || '').trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(identifier)) {
    const error = new Error(`${label} must be a safe SQL identifier.`);
    error.code = 'DATABASE_IDENTIFIER_INVALID';
    throw error;
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

function getPsqlBaseArgs(databaseName, buildResult) {
  return [
    '-h',
    requireEnv('PGHOST', buildResult),
    '-p',
    process.env.PGPORT || '5432',
    '-U',
    requireEnv('PGUSER', buildResult),
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
  ];
}

function runPsql(databaseName, args, { code, message, buildResult }) {
  try {
    execFileSync('psql', [...getPsqlBaseArgs(databaseName, buildResult), ...args], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (cause) {
    throw createBuildError(code, message, buildResult, cause);
  }
}

function dropAndCreateDatabase(databaseName, buildResult) {
  const owner = process.env.DB_BUILD_OWNER || process.env.PGUSER || 'postgres';

  normalizeIdentifier(owner, 'database owner');
  normalizeIdentifier(DEFAULT_TABLESPACE, 'tablespace');
  normalizeIdentifier(DEFAULT_LOCALE_PROVIDER, 'locale provider');

  const quotedDatabaseName = quoteSqlIdentifier(databaseName);
  const connectionLimit = Number.parseInt(DEFAULT_CONNECTION_LIMIT, 10);

  if (!Number.isInteger(connectionLimit)) {
    throw createBuildError(
      'DATABASE_CONNECTION_LIMIT_INVALID',
      'DB_BUILD_CONNECTION_LIMIT must be an integer.',
      buildResult,
    );
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

  buildResult.phase = 'DROP_DATABASE';
  console.log(`🔥 Dropping database ${databaseName} from ${BASE_DB} if it exists`);
  runPsql(BASE_DB, ['-c', dropSql], {
    code: 'DATABASE_DROP_FAILED',
    message: `Failed to drop database ${databaseName}.`,
    buildResult,
  });
  buildResult.databaseDropped = true;

  buildResult.phase = 'CREATE_DATABASE';
  console.log(`🔥 Creating database ${databaseName} from ${BASE_DB}`);
  runPsql(BASE_DB, ['-c', createSql], {
    code: 'DATABASE_CREATE_FAILED',
    message: `Failed to create database ${databaseName}.`,
    buildResult,
  });
  buildResult.databaseCreated = true;
}

function shouldSkipSqlPath(filePath) {
  const relativePath = path.relative(DB_BUILD_SRC_ROOT, filePath);
  const pathSegments = relativePath.split(path.sep).map((segment) => segment.toLowerCase());

  // Database creation is handled dynamically, so legacy init SQL is excluded if it remains locally.
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

function getSqlOrdinal(filePath) {
  const filename = path.basename(filePath);
  const match = filename.match(/^(\d+)/);

  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function getSqlRootRank(filePath) {
  const relativePath = path.relative(DB_BUILD_SRC_ROOT, filePath);
  const firstSegment = relativePath.split(path.sep)[0];

  if (firstSegment === 'migrations') {
    return 0;
  }

  if (firstSegment === 'seeds') {
    return 1;
  }

  return 2;
}

function sortSqlFiles(a, b) {
  const ordinalCompare = getSqlOrdinal(a) - getSqlOrdinal(b);

  if (ordinalCompare !== 0) {
    return ordinalCompare;
  }

  const filenameCompare = path.basename(a).localeCompare(path.basename(b));

  if (filenameCompare !== 0) {
    return filenameCompare;
  }

  const rootRankCompare = getSqlRootRank(a) - getSqlRootRank(b);

  return rootRankCompare !== 0 ? rootRankCompare : a.localeCompare(b);
}

function getSqlFileKind(filePath) {
  const firstSegment = path.relative(DB_BUILD_SRC_ROOT, filePath).split(path.sep)[0];

  if (firstSegment === 'migrations') {
    return 'MIGRATION';
  }

  if (firstSegment === 'seeds') {
    return 'SEED';
  }

  return 'OTHER';
}

function getSqlFileRelativePath(filePath) {
  return path.relative(SKY_SERVER_ROOT, filePath).split(path.sep).join('/');
}

function createSqlFileState(filePath) {
  return {
    absolutePath: filePath,
    relativePath: getSqlFileRelativePath(filePath),
    kind: getSqlFileKind(filePath),
    ordinal: getSqlOrdinal(filePath),
    status: 'PENDING',
    durationMs: null,
  };
}

function runSqlFile(fileState, databaseName, buildResult) {
  const startedAt = Date.now();
  buildResult.phase = 'APPLY_SQL';
  fileState.status = 'RUNNING';

  console.log(`🔥 Running ${fileState.relativePath} on ${databaseName}`);

  try {
    runPsql(databaseName, ['-f', fileState.absolutePath], {
      code: 'DATABASE_SQL_FILE_FAILED',
      message: `Failed while applying ${fileState.relativePath} to ${databaseName}.`,
      buildResult,
    });
    fileState.status = 'COMPLETED';
    fileState.durationMs = Date.now() - startedAt;
    buildResult.sqlFilesExecuted += 1;
    buildResult.lastCompletedSqlFile = fileState.relativePath;

    if (fileState.kind === 'MIGRATION') {
      buildResult.migrationFilesExecuted += 1;
    } else if (fileState.kind === 'SEED') {
      buildResult.seedFilesExecuted += 1;
    }
  } catch (error) {
    fileState.status = 'FAILED';
    fileState.durationMs = Date.now() - startedAt;
    buildResult.failedSqlFile = fileState.relativePath;
    error.buildResult = buildResult;
    throw error;
  }
}

function createInitialBuildResult(startedAtMs) {
  return {
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(startedAtMs).toISOString(),
    durationMs: 0,
    targetDatabase: '',
    status: 'FAILED',
    phase: 'VALIDATION',
    buildCompleted: false,
    databaseDropped: false,
    databaseCreated: false,
    sqlRoots: [...SQL_ROOT_LABELS],
    sqlFilesDiscovered: 0,
    sqlFilesExecuted: 0,
    migrationFilesDiscovered: 0,
    migrationFilesExecuted: 0,
    seedFilesDiscovered: 0,
    seedFilesExecuted: 0,
    firstSqlFile: null,
    lastSqlFile: null,
    lastCompletedSqlFile: null,
    failedSqlFile: null,
    files: [],
  };
}

function finalizeBuildResult(buildResult, overrides = {}) {
  const completedAtMs = Date.now();
  buildResult.completedAt = new Date(completedAtMs).toISOString();
  buildResult.durationMs = Math.max(0, completedAtMs - buildResult.startedAtMs);
  Object.assign(buildResult, overrides);

  return buildResult;
}

async function executeDatabaseBuild(args = []) {
  const startedAtMs = Date.now();
  const buildResult = createInitialBuildResult(startedAtMs);

  try {
    buildResult.targetDatabase = getTargetDatabaseName(args);
    requireEnv('PGPASSWORD', buildResult);
    requireEnv('PGHOST', buildResult);
    requireEnv('PGUSER', buildResult);

    buildResult.phase = 'DISCOVERY';
    const allFiles = SQL_ROOTS.flatMap(getAllSqlFiles).sort(sortSqlFiles);

    if (allFiles.length === 0) {
      throw createBuildError(
        'DATABASE_SQL_FILES_NOT_FOUND',
        `No SQL files found under ${SQL_ROOT_LABELS.join(', ')}`,
        buildResult,
      );
    }

    buildResult.files = allFiles.map(createSqlFileState);
    buildResult.sqlFilesDiscovered = buildResult.files.length;
    buildResult.migrationFilesDiscovered = buildResult.files.filter(
      (file) => file.kind === 'MIGRATION',
    ).length;
    buildResult.seedFilesDiscovered = buildResult.files.filter(
      (file) => file.kind === 'SEED',
    ).length;
    buildResult.firstSqlFile = buildResult.files[0]?.relativePath || null;
    buildResult.lastSqlFile = buildResult.files.at(-1)?.relativePath || null;

    console.log(`[SkyServer DB Build] Env file: ${ENV_PATH}`);
    console.log(`[SkyServer DB Build] Target database: ${buildResult.targetDatabase}`);
    console.log(`[SkyServer DB Build] SQL roots: ${SQL_ROOT_LABELS.join(', ')}`);
    console.log(`[SkyServer DB Build] SQL files found: ${buildResult.sqlFilesDiscovered}`);

    dropAndCreateDatabase(buildResult.targetDatabase, buildResult);

    for (const fileState of buildResult.files) {
      runSqlFile(fileState, buildResult.targetDatabase, buildResult);
    }

    return finalizeBuildResult(buildResult, {
      status: 'BUILT',
      phase: 'COMPLETE',
      buildCompleted: true,
    });
  } catch (error) {
    finalizeBuildResult(buildResult, {
      status: 'FAILED',
      buildCompleted: false,
    });
    error.buildResult = buildResult;
    throw error;
  }
}

function renderDatabaseBuild(result) {
  console.log(
    `✅ DB build complete for ${result.targetDatabase}: ${result.sqlFilesExecuted} SQL file(s) applied in ${result.durationMs} ms`,
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return { mode: 'help' };
  }

  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: DATABASE_BUILD_OUTPUT_TYPE,
    args,
    execute: executeDatabaseBuild,
    createToolResult: createDatabaseBuildToolResult,
    createFailureToolResult: createDatabaseBuildFailureToolResult,
    renderConsole: renderDatabaseBuild,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  SQL_ROOTS,
  createInitialBuildResult,
  createSqlFileState,
  executeDatabaseBuild,
  finalizeBuildResult,
  getAllSqlFiles,
  getArgValue,
  getSqlFileKind,
  getSqlFileRelativePath,
  getSqlOrdinal,
  getTargetDatabaseName,
  main,
  normalizeDatabaseName,
  normalizeIdentifier,
  printUsage,
  quoteSqlIdentifier,
  quoteSqlLiteral,
  renderDatabaseBuild,
  sortSqlFiles,
};
