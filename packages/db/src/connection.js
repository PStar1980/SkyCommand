const { Pool } = require('pg');

function requireEnv(name) {
  const value = process.env[name];

  if (value === undefined || value === null || value === '') {
    throw new Error(`[SkyServer DB] Missing required environment variable: ${name}`);
  }

  return value;
}

const pool = new Pool({
  host: requireEnv('PGHOST'),
  port: Number(process.env.PGPORT || 5432),
  database: requireEnv('PGDATABASE'),
  user: requireEnv('PGUSER'),
  password: requireEnv('PGPASSWORD'),
});

pool.on('error', (err) => {
  console.error('[SkyServer DB] Unexpected idle client error:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await pool.query('SELECT NOW() AS now, current_database() AS database');
  return result.rows[0];
}

module.exports = {
  pool,
  query,
  testConnection,
};
