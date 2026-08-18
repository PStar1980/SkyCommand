#!/usr/bin/env node

const path = require('node:path');
const net = require('node:net');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const repositoryRoot = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(repositoryRoot, '.env'), override: true });

function fail(message) {
  throw new Error(`[SkyCommand PostgreSQL cutover] ${message}`);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`Missing required environment variable: ${name}`);
  return value;
}

function numericPort(name, fallback) {
  const raw = String(process.env[name] || fallback || '').trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) fail(`Invalid ${name}: ${raw}`);
  return value;
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) fail(`${url} returned HTTP ${response.status}.`);
    return body;
  } catch (error) {
    fail(`Could not reach ${url}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const runtimeHost = String(process.env.SKYCOMMAND_DATABASE_HOST || '').trim();
  const runtimePort = numericPort('SKYCOMMAND_DATABASE_PORT', '5432');
  const publishedPort = numericPort('SKYCOMMAND_POSTGRES_HOST_PORT', '55432');
  const hostPgHost = required('PGHOST');
  const hostPgPort = numericPort('PGPORT', String(publishedPort));

  if (runtimeHost !== 'postgres' || runtimePort !== 5432) {
    fail(
      `Docker services are not configured for the PostgreSQL Compose service (SKYCOMMAND_DATABASE_HOST=${runtimeHost || '<blank>'}, SKYCOMMAND_DATABASE_PORT=${runtimePort}).`,
    );
  }
  if (!['127.0.0.1', 'localhost'].includes(hostPgHost.toLowerCase()) || hostPgPort !== publishedPort) {
    fail(
      `Host tools are not configured for the published Docker PostgreSQL endpoint. Expected PGHOST=127.0.0.1/localhost and PGPORT=${publishedPort}; received ${hostPgHost}:${hostPgPort}.`,
    );
  }

  const pool = new Pool({
    host: hostPgHost,
    port: hostPgPort,
    database: required('PGDATABASE'),
    user: required('PGUSER'),
    password: required('PGPASSWORD'),
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });

  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_setting('server_version') AS version,
        current_setting('TimeZone') AS time_zone,
        inet_server_port() AS server_port
    `);
    const database = result.rows[0];
    console.log(`[SkyCommand PostgreSQL cutover] hostDatabase=${database.database}`);
    console.log(`[SkyCommand PostgreSQL cutover] hostPostgreSQL=${database.version}`);
    console.log(`[SkyCommand PostgreSQL cutover] hostTimeZone=${database.time_zone}`);
    console.log(`[SkyCommand PostgreSQL cutover] hostPublishedPort=${hostPgPort}->${database.server_port}`);

    const [apiHealth, dbHealth, temporalReachable] = await Promise.all([
      fetchJson('http://127.0.0.1:7171/_health'),
      fetchJson('http://127.0.0.1:7171/_db/health'),
      canConnect('127.0.0.1', 7233),
    ]);

    if (apiHealth.ok !== true) fail('Docker API health contract is not healthy.');
    if (dbHealth.ok !== true || dbHealth.database !== database.database) {
      fail('Docker API database health does not match the active Docker PostgreSQL database.');
    }
    if (dbHealth.version && dbHealth.version !== database.version) {
      fail(
        `Docker API reports PostgreSQL ${dbHealth.version}, but the host-published candidate reports ${database.version}.`,
      );
    }
    if (!temporalReachable) fail('Temporal published port localhost:7233 is not reachable.');

    console.log(`[SkyCommand PostgreSQL cutover] api=healthy database=${dbHealth.database} PostgreSQL=${dbHealth.version || 'version-not-reported'}`);
    console.log('[SkyCommand PostgreSQL cutover] temporalPublishedPort=reachable');
    console.log('[SkyCommand PostgreSQL cutover] Runtime cutover verification passed.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
