const assert = require('assert');

const { buildRevisionAwareCopySql } = require('../loaders/copyLoader');
const {
  buildMetadataQualityIssues,
  getCheckPolicy,
  normalizeQualityContext,
} = require('./qualityPolicy');

function run() {
  const context = normalizeQualityContext([
    {
      domain_code: 'CLIENT_SERVICES',
      source_code: 'CASE_SYSTEM',
      asset_code: 'SERVICE_EVENTS',
      asset_frequency_code: 'MONTHLY',
      source_frequency_code: 'DAILY',
      asset_unit_code: 'COUNT',
      binding_configuration: { unitCode: 'PERCENT' },
      check_code: 'FREQUENCY_INCOMPATIBLE',
      enabled: true,
      severity_code: 'ERROR',
      blocking: true,
      parameters: {},
      policy_origin_code: 'SOURCE',
    },
    {
      domain_code: 'CLIENT_SERVICES',
      source_code: 'CASE_SYSTEM',
      asset_code: 'SERVICE_EVENTS',
      asset_frequency_code: 'MONTHLY',
      source_frequency_code: 'DAILY',
      asset_unit_code: 'COUNT',
      binding_configuration: { unitCode: 'PERCENT' },
      check_code: 'UNIT_INCOMPATIBLE',
      enabled: false,
      severity_code: 'ERROR',
      blocking: true,
      parameters: {},
      policy_origin_code: 'CHECK_DEFAULT',
    },
    {
      domain_code: 'CLIENT_SERVICES',
      source_code: 'CASE_SYSTEM',
      asset_code: 'SERVICE_EVENTS',
      asset_frequency_code: 'MONTHLY',
      source_frequency_code: 'DAILY',
      asset_unit_code: 'COUNT',
      binding_configuration: { unitCode: 'PERCENT' },
      check_code: 'UNEXPECTED_GAP',
      enabled: true,
      severity_code: 'WARNING',
      blocking: false,
      parameters: { maxGapDays: 45 },
      policy_origin_code: 'ASSET',
    },
    {
      domain_code: 'CLIENT_SERVICES',
      source_code: 'CASE_SYSTEM',
      asset_code: 'SERVICE_EVENTS',
      asset_frequency_code: 'MONTHLY',
      source_frequency_code: 'DAILY',
      asset_unit_code: 'COUNT',
      binding_configuration: { unitCode: 'PERCENT' },
      check_code: 'ROW_COUNT_ANOMALY',
      enabled: true,
      severity_code: 'WARNING',
      blocking: false,
      parameters: { minRows: 4 },
      policy_origin_code: 'SOURCE',
    },
  ]);

  assert.strictEqual(context.assetCode, 'SERVICE_EVENTS');
  assert.strictEqual(getCheckPolicy(context, 'UNEXPECTED_GAP').originCode, 'ASSET');
  const metadataIssues = buildMetadataQualityIssues(context);
  assert.strictEqual(metadataIssues.length, 1);
  assert.strictEqual(metadataIssues[0].checkCode, 'FREQUENCY_INCOMPATIBLE');
  assert.strictEqual(metadataIssues[0].blocking, true);

  const sql = buildRevisionAwareCopySql({
    targetTable: '"proof"."events"',
    tempTable: 'stg_service_events',
    normalizedPath: 'C:/tmp/events.csv',
    qualityContext: context,
  });
  assert(sql.includes("'UNEXPECTED_GAP'"));
  assert(sql.includes("'ROW_COUNT_ANOMALY'"));
  assert(sql.includes("'FREQUENCY_INCOMPATIBLE'"));
  assert(sql.includes('stg_service_events_load_decision'));
  assert(sql.includes('stg_service_events_applied_new_rows'));
  assert(sql.includes('WHERE decision.allowed'));

  console.log('✅ Phase 16.6.2 portable quality-policy contract self-test passed.');
}

if (require.main === module) run();

module.exports = { run };
