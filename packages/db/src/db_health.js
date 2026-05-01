const path = require('path');
const dotenv = require('dotenv');

const ENV_PATH = path.resolve(__dirname, '../../../.env');

dotenv.config({
  path: ENV_PATH,
});

const requiredEnvVars = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`[SkyServer DB] Missing required environment variable: ${envVar}`);
  }
}

const { testConnection, pool } = require('./connection');

async function main() {
  try {
    console.log(`[SkyServer DB] Env file: ${ENV_PATH}`);
    console.log(
      `[SkyServer DB] Target: ${process.env.PGUSER}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
    );

    const result = await testConnection();

    console.log('[SkyServer DB] Connected successfully:', result);
    await pool.end();

    process.exit(0);
  } catch (error) {
    console.error('[SkyServer DB] Connection failed:', error);
    await pool.end().catch(() => {});

    process.exit(1);
  }
}

main();
