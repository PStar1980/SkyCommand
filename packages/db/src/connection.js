const { Pool } = require('pg');

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    throw new Error(`[SkyCommand DB] Missing required environment variable: ${name}`);
  }

  return value;
}

const pool = new Pool({
  host: requireEnv('PGHOST'),
  port: Number(process.env.PGPORT || 5432),
  database: requireEnv('PGDATABASE'),
  user: requireEnv('PGUSER'),
  password: requireEnv('PGPASSWORD'),
  // Short-lived CLI/tool processes should not be held open solely by an idle
  // PostgreSQL socket. Long-running API/worker processes remain alive because
  // their servers and workflow runtimes keep the Node.js event loop active.
  allowExitOnIdle: true,
});

pool.on('error', (err) => {
  console.error('[SkyCommand DB] Unexpected idle client error:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await pool.query("SELECT NOW() AS now, current_database() AS database, current_setting('server_version') AS version, inet_server_port() AS server_port");
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  testConnection,
};
