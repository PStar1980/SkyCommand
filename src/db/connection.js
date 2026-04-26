const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
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
