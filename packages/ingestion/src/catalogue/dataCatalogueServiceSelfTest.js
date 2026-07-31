#!/usr/bin/env node

const assert = require('assert');
const {
  CATALOGUE_CONTRACT_VERSION,
  normalizeBoolean,
  sanitizeAsset,
  sanitizeMetric,
} = require('./dataCatalogueService');

function run() {
  assert.strictEqual(CATALOGUE_CONTRACT_VERSION, 'data_catalogue.v1');
  assert.strictEqual(normalizeBoolean('true'), true);
  assert.strictEqual(normalizeBoolean('false'), false);
  assert.strictEqual(normalizeBoolean(''), null);

  const asset = sanitizeAsset({
    domain_id: 'domain-1',
    domain_code: 'CLIENT_SERVICES',
    domain_name: 'Client Services',
    asset_id: 'asset-1',
    asset_code: 'SERVICE_EPISODES',
    asset_name: 'Service episodes',
    asset_description: 'Portable non-macro record set.',
    asset_kind_code: 'RECORD_SET',
    frequency_code: 'DAILY',
    criticality_code: 'STANDARD',
    contract_version: 'data_asset.v1',
    asset_configuration: {},
    asset_active: true,
    source_id: 'source-1',
    source_code: 'CASE_SYSTEM',
    source_name: 'Case System',
    provider_name: 'Case System',
    provider_type: 'DATABASE',
    observability_enabled: true,
    provider_asset_code: 'service_episode',
    binding_configuration: {},
    binding_active: true,
    source_active: true,
    discoverable: true,
  });

  assert.strictEqual(asset.domainCode, 'CLIENT_SERVICES');
  assert.strictEqual(asset.assetCode, 'SERVICE_EPISODES');
  assert.strictEqual(asset.source.sourceCode, 'CASE_SYSTEM');
  assert.strictEqual(asset.discoverable, true);

  const metric = sanitizeMetric({
    domain_id: 'domain-1',
    domain_code: 'CLIENT_SERVICES',
    domain_name: 'Client Services',
    metric_id: 'metric-1',
    metric_code: 'SAME_DAY_ACCESS_RATE',
    metric_name: 'Same-day access rate',
    metric_kind_code: 'AGGREGATE',
    definition: { operator: 'RATIO' },
    dependencies: [{ assetCode: 'SERVICE_EPISODES' }],
    contract_version: 'data_metric.v1',
    metric_configuration: {},
    metric_active: true,
    discoverable: true,
  });

  assert.strictEqual(metric.metricCode, 'SAME_DAY_ACCESS_RATE');
  assert.strictEqual(metric.dependencies.length, 1);
  assert.strictEqual(metric.discoverable, true);

  console.log('✅ Portable data catalogue service self-test passed.');
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
