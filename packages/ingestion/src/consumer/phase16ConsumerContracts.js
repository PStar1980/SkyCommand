#!/usr/bin/env node

require('dotenv').config();

const assert = require('node:assert/strict');
const dataConsumerService = require('./dataConsumerService');
const ingestionLedgerService = require('../ledger/ingestionLedgerService');
const { pool } = require('../../../db/src/connection');

function displaySeries(label, payload) {
  const latest = payload.items?.[0] || null;
  return {
    contract: payload.contractVersion,
    series: label,
    operator: payload.operator || payload.calculation?.operator || 'IDENTITY',
    total: payload.total,
    latestDate: latest?.observationDate || null,
    latestValue: latest?.value ?? null,
  };
}

async function verify() {
  const client = await pool.connect();
  const query = client.query.bind(client);

  try {
    const dff = await dataConsumerService.listAssetObservations(
      'MACRO',
      'DFF',
      { limit: 3, sortDirection: 'DESC' },
      { query },
    );
    const unemployment = await dataConsumerService.listMetricObservations(
      'MACRO',
      'US_UNEMPLOYMENT_RATE',
      { limit: 3, sortDirection: 'DESC' },
      { query },
    );
    const inflation = await dataConsumerService.listMetricObservations(
      'MACRO',
      'US_CPI_INFLATION_YOY',
      { limit: 3, sortDirection: 'DESC' },
      { query },
    );
    const search = await ingestionLedgerService.listRuns(
      { q: 'DFF', limit: 10 },
      { query },
    );

    assert.strictEqual(dff.contractVersion, 'time_series_observations.v1');
    assert.strictEqual(dff.asset.assetCode, 'DFF');
    assert.ok(dff.total > 0, 'Expected DFF observations through the generic asset contract.');
    assert.ok(dff.items.length > 0, 'Expected at least one DFF observation.');

    assert.strictEqual(unemployment.contractVersion, 'metric_observations.v1');
    assert.strictEqual(unemployment.metric.metricCode, 'US_UNEMPLOYMENT_RATE');
    assert.strictEqual(unemployment.calculation.operator, 'IDENTITY');
    assert.ok(unemployment.total > 0, 'Expected direct metric observations.');

    assert.strictEqual(inflation.contractVersion, 'metric_observations.v1');
    assert.strictEqual(inflation.metric.metricCode, 'US_CPI_INFLATION_YOY');
    assert.strictEqual(inflation.calculation.operator, 'PCT_CHANGE');
    assert.ok(inflation.total > 0, 'Expected derived percentage-change observations.');

    assert.ok(search.total > 0, 'Expected asset-aware run search to find retained DFF evidence.');
    assert.ok(
      search.items.some((run) =>
        (run.selectedAssets || []).includes('DFF') ||
        String(run.summary || '').toUpperCase().includes('DFF'),
      ),
      'Expected at least one returned ingestion run to contain DFF evidence.',
    );

    console.log('\nSkyCommand Phase 16.8.2 generic observation and metric consumer contracts');
    console.log('-----------------------------------------------------------------------');
    console.table([
      displaySeries('MACRO/DFF', dff),
      displaySeries('MACRO/US_UNEMPLOYMENT_RATE', unemployment),
      displaySeries('MACRO/US_CPI_INFLATION_YOY', inflation),
    ]);
    console.log(`Asset-aware ingestion-run search matches for DFF: ${search.total}`);
    console.log('✅ A portable time-series asset is queryable through time_series_observations.v1.');
    console.log('✅ Direct and derived metric observations resolve from catalogue dependencies and definitions.');
    console.log('✅ Metric calculation supports IDENTITY and bounded PCT_CHANGE without a formula-authoring engine.');
    console.log('✅ Ingestion-run free-text search includes selected assets and item-level asset evidence.');
  } finally {
    client.release();
  }
}

async function main() {
  const command = String(process.argv[2] || 'verify').toLowerCase();
  if (command !== 'verify') {
    throw new Error(`Unknown command: ${command}. Expected verify.`);
  }
  await verify();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`❌ ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

module.exports = { verify };
