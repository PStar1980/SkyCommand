const {
  deriveRecoverySelection,
  normalizeAssetCodes,
} = require('./ingestionRecoveryService');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert(error.code === code, `Expected ${code}, received ${error.code || error.message}.`);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

function main() {
  const latestItems = [
    { assetCode: 'ASSET_A', outcomeCode: 'UPDATED', successLike: true },
    { assetCode: 'ASSET_B', outcomeCode: 'FAILED', successLike: false },
    { assetCode: 'ASSET_C', outcomeCode: 'UNCHANGED', successLike: true },
    { assetCode: 'ASSET_D', outcomeCode: 'REJECTED', successLike: false },
    { assetCode: 'ASSET_E', outcomeCode: 'SKIPPED', successLike: false },
  ];

  const failedOnly = deriveRecoverySelection({ latestItems, failedOnly: true });
  assert(failedOnly.selectionCode === 'FAILED_ONLY', 'Expected FAILED_ONLY selection.');
  assert(
    JSON.stringify(failedOnly.requestedAssets) === JSON.stringify(['ASSET_B', 'ASSET_D']),
    'Failed-only recovery must exclude successful and intentionally skipped assets.',
  );

  const subset = deriveRecoverySelection({
    latestItems,
    failedOnly: true,
    assets: ['asset_d', 'ASSET_D'],
  });
  assert(JSON.stringify(subset.requestedAssets) === JSON.stringify(['ASSET_D']), 'Explicit failed subset failed.');

  const explicit = deriveRecoverySelection({
    latestItems,
    failedOnly: false,
    assets: 'asset_a, asset_b asset_a',
  });
  assert(explicit.selectionCode === 'EXPLICIT_ASSETS', 'Expected explicit selection.');
  assert(
    JSON.stringify(explicit.requestedAssets) === JSON.stringify(['ASSET_A', 'ASSET_B']),
    'Explicit asset normalization failed.',
  );

  expectError(
    () => deriveRecoverySelection({ latestItems, failedOnly: true, assets: ['ASSET_A'] }),
    'INGESTION_RECOVERY_ASSET_NOT_FAILED',
  );
  expectError(
    () => deriveRecoverySelection({ latestItems: [], failedOnly: true }),
    'INGESTION_RECOVERY_NOT_REQUIRED',
  );
  expectError(
    () => deriveRecoverySelection({ latestItems, failedOnly: false, assets: [] }),
    'INGESTION_RECOVERY_ASSETS_REQUIRED',
  );

  assert(
    JSON.stringify(normalizeAssetCodes([' a ', 'B,c', 'a'])) === JSON.stringify(['A', 'B', 'C']),
    'Asset normalization should be stable and unique.',
  );

  console.log('✅ Phase 16.7.1 ingestion recovery contract self-test passed.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
