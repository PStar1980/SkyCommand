#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { runToolCli } = require('../../tools/src');

const ENV_PATH = path.resolve(__dirname, '../../../.env');
const TOOL_CODE = 'db_health';
const OUTPUT_TYPE = 'database_health_summary.v1';
const DATABASE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

dotenv.config({
  path: ENV_PATH,
});

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    const error = new Error(
      `[SkyCommand DB Health] Missing required environment variable: ${name}`,
    );
    error.code = 'DATABASE_ENVIRONMENT_MISSING';
    throw error;
  }

  return value;
}

function normalizeDatabaseName(value, label = 'database name') {
  const databaseName = String(value || '').trim();

  if (!databaseName) {
    const error = new Error(`${label} cannot be blank.`);
    error.code = 'DATABASE_NAME_REQUIRED';
    throw error;
  }

  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    const error = new Error(
      `${label} must start with a letter and contain only letters, numbers, and underscores, with a maximum length of 63 characters.`,
    );
    error.code = 'DATABASE_NAME_INVALID';
    throw error;
  }

  return databaseName;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  const error = new Error(`Invalid boolean value: ${value}`);
  error.code = 'BOOLEAN_PARAMETER_INVALID';
  throw error;
}

function parseDatabaseNames(args = [], fallbackDatabase = process.env.PGDATABASE) {
  const rawArgs = Array.isArray(args) ? args.map((value) => String(value || '').trim()) : [];
  const explicitFail = rawArgs.includes('--fail-when-offline');
  const explicitNoFail = rawArgs.includes('--no-fail-when-offline');
  const positionalArgs = rawArgs.filter((value) => value && !value.startsWith('--'));
  const suppliedNames = positionalArgs
    .slice(0, 2)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const candidateNames =
    suppliedNames.length > 0
      ? suppliedNames
      : [normalizeDatabaseName(fallbackDatabase, 'PGDATABASE')];
  const seen = new Set();
  const databaseNames = [];

  candidateNames.forEach((name, index) => {
    const normalized = normalizeDatabaseName(name, `databaseName${index + 1}`);
    const key = normalized.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      databaseNames.push(normalized);
    }
  });

  let failWhenOffline;

  if (explicitFail && explicitNoFail) {
    const error = new Error('Use only one of --fail-when-offline or --no-fail-when-offline.');
    error.code = 'DATABASE_HEALTH_FLAG_CONFLICT';
    throw error;
  }

  if (explicitFail) {
    failWhenOffline = true;
  } else if (explicitNoFail) {
    failWhenOffline = false;
  } else if (process.env.DB_HEALTH_FAIL_WHEN_OFFLINE !== undefined) {
    failWhenOffline = parseBoolean(process.env.DB_HEALTH_FAIL_WHEN_OFFLINE, true);
  } else {
    // Preserve strict direct-CLI behavior while keeping SkyCommand workflow execution
    // condition-friendly. The wrapper-owned result path is present only in managed runs.
    failWhenOffline = !process.env.SKYCOMMAND_TOOL_RESULT_PATH;
  }

  return {
    databaseNames,
    failWhenOffline,
  };
}

function createPool(databaseName) {
  return new Pool({
    host: requireEnv('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: databaseName,
    user: requireEnv('PGUSER'),
    password: requireEnv('PGPASSWORD'),
    application_name: 'skycommand_db_health',
    connectionTimeoutMillis: Number(process.env.DB_HEALTH_CONNECTION_TIMEOUT_MS || 10000),
    statement_timeout: Number(process.env.DB_HEALTH_STATEMENT_TIMEOUT_MS || 15000),
    max: 1,
  });
}

function safeConnectionError(error) {
  return {
    code: error?.code || 'DATABASE_CONNECTION_FAILED',
    message: error?.message || 'Database connection failed.',
  };
}

async function inspectDatabase(databaseName) {
  const pool = createPool(databaseName);
  const startedAt = Date.now();

  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_user AS current_user,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port,
        current_setting('server_version') AS server_version,
        NOW() AS checked_at
    `);
    const row = result.rows[0] || {};

    return {
      databaseName: row.database_name || databaseName,
      online: true,
      latencyMs: Date.now() - startedAt,
      currentUser: row.current_user || null,
      serverAddress: row.server_address || null,
      serverPort:
        row.server_port === null || row.server_port === undefined ? null : Number(row.server_port),
      serverVersion: row.server_version || null,
      checkedAt:
        row.checked_at instanceof Date
          ? row.checked_at.toISOString()
          : new Date(row.checked_at || Date.now()).toISOString(),
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    const safeError = safeConnectionError(error);

    return {
      databaseName,
      online: false,
      latencyMs: Date.now() - startedAt,
      currentUser: null,
      serverAddress: null,
      serverPort: null,
      serverVersion: null,
      checkedAt: new Date().toISOString(),
      errorCode: safeError.code,
      errorMessage: safeError.message,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function executeDatabaseHealth(args = []) {
  const startedAt = Date.now();
  const { databaseNames, failWhenOffline } = parseDatabaseNames(args);

  console.log(`[SkyCommand DB Health] Env file: ${ENV_PATH}`);
  console.log(
    `[SkyCommand DB Health] Server: ${requireEnv('PGUSER')}@${requireEnv('PGHOST')}:${process.env.PGPORT || 5432}`,
  );
  console.log(`[SkyCommand DB Health] Databases: ${databaseNames.join(', ')}`);

  const databases = await Promise.all(databaseNames.map(inspectDatabase));
  const onlineCount = databases.filter((database) => database.online).length;
  const offlineCount = databases.length - onlineCount;

  return {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    failWhenOffline,
    allOnline: offlineCount === 0,
    requestedCount: databases.length,
    onlineCount,
    offlineCount,
    databases,
  };
}

function createDatabaseHealthToolResult(result) {
  const warnings = result.databases
    .filter((database) => !database.online)
    .map((database) => ({
      code: database.errorCode || 'DATABASE_OFFLINE',
      message: `${database.databaseName}: ${database.errorMessage || 'Database is offline.'}`,
    }));

  return {
    schemaVersion: '1.0',
    success: true,
    message: result.allOnline
      ? `All ${result.onlineCount} PostgreSQL database(s) are online.`
      : `${result.offlineCount} of ${result.requestedCount} PostgreSQL database(s) are offline.`,
    outputType: OUTPUT_TYPE,
    output: result,
    warnings,
    error: null,
    metadata: {},
  };
}

function createDatabaseHealthFailureToolResult(error) {
  return {
    schemaVersion: '1.0',
    success: false,
    message: error?.message || 'Database health check could not start.',
    outputType: OUTPUT_TYPE,
    output: {
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      failWhenOffline: true,
      allOnline: false,
      requestedCount: 0,
      onlineCount: 0,
      offlineCount: 0,
      databases: [],
    },
    warnings: [],
    error: {
      code: error?.code || 'DATABASE_HEALTH_CHECK_FAILED',
      message: error?.message || 'Database health check could not start.',
    },
    metadata: {},
  };
}

function renderDatabaseHealth(result) {
  result.databases.forEach((database) => {
    if (database.online) {
      console.log(
        `[SkyCommand DB Health] ONLINE  ${database.databaseName} (${database.latencyMs} ms, PostgreSQL ${database.serverVersion})`,
      );
    } else {
      console.error(
        `[SkyCommand DB Health] OFFLINE ${database.databaseName} (${database.errorCode}: ${database.errorMessage})`,
      );
    }
  });

  console.log(
    `[SkyCommand DB Health] Summary: ${result.onlineCount} online, ${result.offlineCount} offline, ${result.durationMs} ms`,
  );
}

async function main() {
  return runToolCli({
    toolCode: TOOL_CODE,
    outputType: OUTPUT_TYPE,
    execute: executeDatabaseHealth,
    createToolResult: createDatabaseHealthToolResult,
    createFailureToolResult: createDatabaseHealthFailureToolResult,
    renderConsole: renderDatabaseHealth,
    shouldFailProcess: ({ result }) => Boolean(result.failWhenOffline && !result.allOnline),
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createDatabaseHealthFailureToolResult,
  createDatabaseHealthToolResult,
  executeDatabaseHealth,
  inspectDatabase,
  main,
  normalizeDatabaseName,
  parseBoolean,
  parseDatabaseNames,
  renderDatabaseHealth,
};
