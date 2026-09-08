#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { getBrowserRuntimeConfig } = require('../../../packages/browser/src/config');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const config = getBrowserRuntimeConfig(repositoryRoot);

try {
  const payload = JSON.parse(fs.readFileSync(config.healthFile, 'utf8'));
  const ageMs = Date.now() - new Date(payload.lastSeenAt).getTime();
  const healthy = payload.status === 'ONLINE' && Number.isFinite(ageMs) && ageMs <= config.healthFreshnessMs;

  if (!healthy) {
    console.error(
      `[Browser Worker Health] unhealthy status=${payload.status || 'UNKNOWN'} ageMs=${Number.isFinite(ageMs) ? ageMs : 'invalid'}`,
    );
    process.exit(1);
  }

  console.log(
    `[Browser Worker Health] ONLINE taskQueue=${payload.taskQueue || config.taskQueue} ageMs=${ageMs}`,
  );
} catch (error) {
  console.error(`[Browser Worker Health] unavailable: ${error.message || error}`);
  process.exit(1);
}
