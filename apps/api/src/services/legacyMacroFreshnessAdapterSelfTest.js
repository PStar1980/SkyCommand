const assert = require('assert');
const { mapSnapshotStatus } = require('./legacyMacroFreshnessAdapter');

assert.strictEqual(
  mapSnapshotStatus({ active: true, refreshed_at: new Date(), freshness_status_code: 'CURRENT', freshness_reason_code: 'EXPECTED_PROVIDER_LAG', message: 'healthy lag' }).status,
  'CURRENT',
);
assert.strictEqual(
  mapSnapshotStatus({ active: true, refreshed_at: new Date(), freshness_status_code: 'WARNING', freshness_reason_code: 'SOURCE_NOT_UPDATED', message: 'provider behind' }).status,
  'STALE',
);
assert.strictEqual(
  mapSnapshotStatus({ active: true, refreshed_at: new Date(), freshness_status_code: 'ERROR', freshness_reason_code: 'LOAD_BEHIND_SOURCE', message: 'load behind' }).status,
  'ERROR',
);
assert.strictEqual(
  mapSnapshotStatus({ active: true, refreshed_at: new Date(), freshness_status_code: 'WARNING', freshness_reason_code: 'NO_DATA', message: 'no data' }).status,
  'NO_DATA',
);
assert.strictEqual(
  mapSnapshotStatus({ active: false }).status,
  'INACTIVE',
);

console.log('✅ Legacy macro status compatibility now maps explainable freshness reasons correctly.');
