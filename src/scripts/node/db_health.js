require('../../core/bootstrap');

const { testConnection } = require('../../db/connection');

async function main() {
  try {
    const result = await testConnection();
    console.log('[SkyServer DB] Connected successfully:', result);
    process.exit(0);
  } catch (error) {
    console.error('[SkyServer DB] Connection failed:', error);
    process.exit(1);
  }
}

main();
