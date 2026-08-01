#!/usr/bin/env node

const assert = require('assert/strict');
const { normalizeQualityPolicyPayload } = require('./qualityPolicyAdminService');

const gap = normalizeQualityPolicyPayload('unexpected_gap', {
  severityCode: 'warning',
  blocking: false,
  parameters: { maxGapDays: 45 },
});
assert.equal(gap.checkCode, 'UNEXPECTED_GAP');
assert.equal(gap.parameters.maxGapDays, 45);
assert.equal(gap.blocking, false);

const rowCount = normalizeQualityPolicyPayload('ROW_COUNT_ANOMALY', {
  severityCode: 'ERROR',
  blocking: true,
  parameters: { minRows: 10, maxRows: 100 },
});
assert.equal(rowCount.parameters.minRows, 10);
assert.equal(rowCount.parameters.maxRows, 100);
assert.equal(rowCount.blocking, true);

const disabled = normalizeQualityPolicyPayload('UNEXPECTED_GAP', {
  enabled: false,
  parameters: {},
  active: false,
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.active, false);

assert.throws(
  () => normalizeQualityPolicyPayload('UNEXPECTED_GAP', { enabled: true, parameters: {} }),
  /maxGapDays/,
);
assert.throws(
  () => normalizeQualityPolicyPayload('ROW_COUNT_ANOMALY', {
    parameters: { minRows: 100, maxRows: 10 },
  }),
  /cannot be greater/,
);

console.log('✅ Phase 16.6.3 quality-policy administration contract self-test passed.');
