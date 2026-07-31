#!/usr/bin/env node

const assert = require('assert/strict');
const {
  computeExpectedLatestDate,
  evaluateFreshness,
  extractAssetEvidenceFromExecution,
} = require('./freshnessService');

const monthlyPolicy = {
  frequencyCode: 'MONTHLY',
  periodUnitCode: 'MONTH',
  periodLength: 1,
  releaseLagDays: 30,
  freshnessToleranceDays: 15,
  policyOriginCode: 'FREQUENCY_DEFAULT',
};

const quarterlyPolicy = {
  frequencyCode: 'QUARTERLY',
  periodUnitCode: 'QUARTER',
  periodLength: 1,
  releaseLagDays: 75,
  freshnessToleranceDays: 25,
  policyOriginCode: 'FREQUENCY_DEFAULT',
};

assert.equal(
  computeExpectedLatestDate('2026-07-30T12:00:00Z', monthlyPolicy).toISOString().slice(0, 10),
  '2026-05-01',
);
assert.equal(
  computeExpectedLatestDate('2026-07-30T12:00:00Z', quarterlyPolicy).toISOString().slice(0, 10),
  '2026-01-01',
);

const baseAsset = {
  active: true,
  frequencyCode: 'MONTHLY',
  configuration: {},
};

const expectedLag = evaluateFreshness({
  asset: baseAsset,
  policy: monthlyPolicy,
  stats: { relationExists: true, rowCount: 100, maxDate: '2026-05-01' },
  sourceEvidence: {
    sourceLatestDate: '2026-05-01',
    lastAttemptAt: '2026-07-30T10:00:00Z',
    lastAttemptStatus: 'SUCCESS',
    lastSuccessAt: '2026-07-30T10:00:10Z',
  },
  asOf: '2026-07-30T12:00:00Z',
});
assert.equal(expectedLag.freshnessStatusCode, 'CURRENT');
assert.equal(expectedLag.freshnessReasonCode, 'EXPECTED_PROVIDER_LAG');

const sourceBehind = evaluateFreshness({
  asset: baseAsset,
  policy: monthlyPolicy,
  stats: { relationExists: true, rowCount: 100, maxDate: '2026-04-01' },
  sourceEvidence: {
    sourceLatestDate: '2026-04-01',
    lastAttemptAt: '2026-07-30T10:00:00Z',
    lastAttemptStatus: 'SUCCESS',
    lastSuccessAt: '2026-07-30T10:00:10Z',
  },
  asOf: '2026-07-30T12:00:00Z',
});
assert.equal(sourceBehind.freshnessStatusCode, 'WARNING');
assert.equal(sourceBehind.freshnessReasonCode, 'SOURCE_NOT_UPDATED');

const loadBehind = evaluateFreshness({
  asset: baseAsset,
  policy: monthlyPolicy,
  stats: { relationExists: true, rowCount: 100, maxDate: '2026-04-01' },
  sourceEvidence: {
    sourceLatestDate: '2026-05-01',
    lastAttemptAt: '2026-07-30T10:00:00Z',
    lastAttemptStatus: 'SUCCESS',
    lastSuccessAt: '2026-07-30T10:00:10Z',
  },
  asOf: '2026-07-30T12:00:00Z',
});
assert.equal(loadBehind.freshnessStatusCode, 'ERROR');
assert.equal(loadBehind.freshnessReasonCode, 'LOAD_BEHIND_SOURCE');

const failed = evaluateFreshness({
  asset: baseAsset,
  policy: monthlyPolicy,
  stats: { relationExists: true, rowCount: 100, maxDate: '2026-04-01' },
  sourceEvidence: {
    sourceLatestDate: '2026-04-01',
    lastAttemptAt: '2026-07-30T10:00:00Z',
    lastAttemptStatus: 'FAILED',
    lastSuccessAt: '2026-07-29T10:00:00Z',
  },
  asOf: '2026-07-30T12:00:00Z',
});
assert.equal(failed.freshnessStatusCode, 'ERROR');
assert.equal(failed.freshnessReasonCode, 'INGESTION_FAILED');

const extracted = extractAssetEvidenceFromExecution({
  metadata: {
    toolResult: {
      output: {
        indicators: [
          {
            indicatorCode: 'CPIAUCSL',
            sourceMaxDate: '2026-06-01',
            currentTargetMaxDate: '2026-06-01',
          },
        ],
      },
    },
  },
});
assert.deepEqual(extracted, [
  {
    assetCode: 'CPIAUCSL',
    sourceLatestDate: '2026-06-01',
    targetLatestDate: '2026-06-01',
  },
]);

console.log('✅ Explainable freshness policy and reason-code self-test passed.');
