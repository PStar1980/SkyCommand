#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const migration = read(
    'packages/db_build/src/migrations/00074__portable_ingestion_identity.sql',
  );
  const seed = read('packages/db_build/src/seeds/00075__portable_ingestion_identity_seed.sql');
  const statusService = read('apps/api/src/services/ingestionStatusService.js');
  const packageJson = JSON.parse(read('package.json'));

  for (const requiredToken of [
    'core.tool_category_kinds',
    'category_kind_code',
    'data.ingestion_tool_profiles',
    'data.vw_ingestion_tools',
    'data.vw_ingestion_sources',
  ]) {
    assert(migration.includes(requiredToken), `Migration is missing ${requiredToken}.`);
  }

  for (const toolCode of [
    'ingestion_fred',
    'ingestion_boc',
    'ingestion_statcan',
    'ingestion_manual',
  ]) {
    assert(seed.includes(toolCode), `Seed is missing ${toolCode}.`);
  }

  assert(
    statusService.includes('ingestionCatalogueService'),
    'Ingestion status service does not use the catalogue service.',
  );

  for (const forbiddenToken of [
    'INGESTION_SOURCE_REGISTRY',
    'INGESTION_SCRIPT_FILE_NAMES',
    "scriptFiles: ['loadFREDMacroData.js']",
    "scriptFiles: ['loadBoCMacroData.js']",
    "scriptFiles: ['loadStatCanMacroData.js']",
  ]) {
    assert(
      !statusService.includes(forbiddenToken),
      `Ingestion status service still contains hard-coded discovery token: ${forbiddenToken}`,
    );
  }

  assert(
    packageJson.scripts['phase16:identity:setup'],
    'package.json is missing phase16:identity:setup.',
  );
  assert(
    packageJson.scripts['phase16:identity:verify'],
    'package.json is missing phase16:identity:verify.',
  );

  console.log('✅ Phase 16.1 semantic ingestion identity self-test passed.');
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run };
