#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const { getSupervisorConfig } = require('./config');

async function main() {
  const config = getSupervisorConfig(path.resolve(__dirname, '../../..'));
  const url = `http://127.0.0.1:${config.port}/health`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Supervisor health returned HTTP ${response.status}.`);
    }
    console.log('[SkyCommand Supervisor] Health check passed.');
    console.log(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('[SkyCommand Supervisor] Health check failed.');
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}

main();
