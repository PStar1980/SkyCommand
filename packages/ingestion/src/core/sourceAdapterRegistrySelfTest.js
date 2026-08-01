const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { defineSourceAdapter } = require('./sourceAdapter');
const {
  discoverSourceAdapters,
  validateAdapterProfileAlignment,
} = require('./sourceAdapterRegistry');

function createAdapter(overrides = {}) {
  return defineSourceAdapter({
    domainCode: 'TEST_DOMAIN',
    sourceCode: 'TEST_SOURCE',
    adapterCode: 'TEST_ADAPTER',
    resultContractVersion: 'ingestion_run_summary.v1',
    name: 'Test adapter',
    getAssets: async () => ['ASSET_A'],
    fetch: async () => '/tmp/test.csv',
    load: async () => ({ stagingRows: 1, rowsInserted: 1 }),
    defaultConcurrency: 1,
    maxConcurrency: 1,
    requestPolicyRequired: false,
    capabilities: {
      incremental: true,
      selectedAssets: true,
      backfill: false,
      revisions: false,
      resume: false,
      dryRun: true,
    },
    ...overrides,
  });
}

function createProfile(overrides = {}) {
  return {
    toolCode: 'test_ingestion',
    domainCode: 'TEST_DOMAIN',
    sourceCode: 'TEST_SOURCE',
    adapterCode: 'TEST_ADAPTER',
    contractVersion: 'ingestion_run_summary.v1',
    supportsIncremental: true,
    supportsSelectedAssets: true,
    supportsBackfill: false,
    supportsRevisions: false,
    supportsResume: false,
    supportsDryRun: true,
    active: true,
    ...overrides,
  };
}

function run() {
  const adapter = createAdapter();
  const aligned = validateAdapterProfileAlignment(adapter, createProfile());
  assert.strictEqual(aligned.ok, true);

  assert.throws(
    () => validateAdapterProfileAlignment(adapter, createProfile({ sourceCode: 'OTHER_SOURCE' })),
    /source TEST_SOURCE != OTHER_SOURCE/,
  );
  assert.throws(
    () => validateAdapterProfileAlignment(adapter, createProfile({ supportsDryRun: false })),
    /capability dryRun=true != profile false/,
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-adapter-registry-self-test-'));
  try {
    const adapterModule = path.join(tempDir, 'syntheticAdapter.js');
    const sourceAdapterPath = path.resolve(__dirname, 'sourceAdapter.js');
    fs.writeFileSync(
      adapterModule,
      `const { defineSourceAdapter } = require(${JSON.stringify(sourceAdapterPath)});\n`
        + `module.exports = defineSourceAdapter(${JSON.stringify({
          domainCode: 'DISCOVERY_TEST',
          sourceCode: 'DISCOVERY_SOURCE',
          adapterCode: 'DISCOVERY_ADAPTER',
          resultContractVersion: 'ingestion_run_summary.v1',
          name: 'Discovered adapter',
          defaultConcurrency: 1,
          maxConcurrency: 1,
          requestPolicyRequired: false,
          capabilities: {
            incremental: false,
            selectedAssets: true,
            backfill: false,
            revisions: false,
            resume: false,
            dryRun: true,
          },
        }).slice(0, -1)},\n`
        + `  getAssets: async () => ['ASSET_A'],\n`
        + `  fetch: async () => '/tmp/discovery.csv',\n`
        + `  load: async () => ({ stagingRows: 1, rowsInserted: 1 }),\n`
        + `});\n`,
      'utf8',
    );

    const registry = discoverSourceAdapters({ directories: [tempDir], fresh: true });
    assert.strictEqual(registry.size, 1);
    assert.strictEqual(registry.get('DISCOVERY_ADAPTER').sourceCode, 'DISCOVERY_SOURCE');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('✅ Phase 16.5 source-adapter registry contract self-test passed.');
}

try {
  run();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}
