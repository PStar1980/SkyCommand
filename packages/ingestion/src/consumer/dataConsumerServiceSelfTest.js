#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  METRIC_OBSERVATIONS_CONTRACT_VERSION,
  TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION,
  buildProjectionSql,
  listAssetObservations,
  listMetricObservations,
  normalizeDate,
  normalizeSeriesFilters,
  quoteIdentifier,
  resolveMetricAssetDependency,
} = require('./dataConsumerService');

function assetRow() {
  return {
    domain_id: 'domain-1',
    domain_code: 'MACRO',
    domain_name: 'Macroeconomic Data',
    asset_id: 'asset-1',
    asset_code: 'CPIAUCSL',
    asset_name: 'Consumer Price Index',
    asset_description: 'U.S. all-items CPI.',
    asset_kind_code: 'TIME_SERIES',
    frequency_code: 'MONTHLY',
    unit_code: 'INDEX',
    scale_code: null,
    geography_code: 'US',
    seasonal_adjustment_code: 'SA',
    transform_code: 'IDENTITY',
    release_lag_days: null,
    freshness_tolerance_days: null,
    revisions_expected: true,
    criticality_code: 'STANDARD',
    storage_schema_name: 'macro',
    storage_relation_name: 'CPIAUCSL',
    storage_date_column: 'edate',
    storage_value_column: 'value',
    contract_version: 'data_asset.v1',
    asset_configuration: {},
    asset_active: true,
    source_id: 'source-1',
    source_code: 'FRED',
    source_name: 'Federal Reserve Economic Data',
    provider_name: 'Federal Reserve Bank of St. Louis',
    provider_type: 'HTTP_API',
    observability_enabled: true,
    provider_asset_code: 'CPIAUCSL',
    provider_resource_code: null,
    provider_locator: null,
    source_frequency_code: 'MONTHLY',
    source_transform_code: 'IDENTITY',
    binding_configuration: {},
    binding_active: true,
    source_active: true,
    discoverable: true,
  };
}

function metricRow() {
  return {
    domain_id: 'domain-1',
    domain_code: 'MACRO',
    domain_name: 'Macroeconomic Data',
    metric_id: 'metric-1',
    metric_code: 'US_CPI_INFLATION_YOY',
    metric_name: 'U.S. CPI inflation, year over year',
    metric_description: 'Twelve-month percentage change.',
    metric_kind_code: 'DERIVED',
    frequency_code: 'MONTHLY',
    unit_code: 'PERCENT',
    scale_code: null,
    definition: { operator: 'PCT_CHANGE', periods: 12, multiplier: 100 },
    dependencies: [
      {
        dependencyId: 'dependency-1',
        roleCode: 'INPUT',
        order: 1,
        assetId: 'asset-1',
        assetCode: 'CPIAUCSL',
        metricId: null,
        metricCode: null,
        configuration: {},
      },
    ],
    contract_version: 'data_metric.v1',
    metric_configuration: {},
    metric_active: true,
    discoverable: true,
  };
}

function createQueryMock() {
  return async (sql, values = []) => {
    if (/FROM data\.vw_metrics/.test(sql)) {
      assert.deepStrictEqual(values, ['MACRO', 'US_CPI_INFLATION_YOY']);
      return { rows: [metricRow()] };
    }
    if (/FROM data\.vw_assets/.test(sql)) {
      assert.deepStrictEqual(values, ['MACRO', 'CPIAUCSL']);
      return { rows: [assetRow()] };
    }
    if (/to_regclass/.test(sql)) {
      assert.deepStrictEqual(values, ['macro', 'CPIAUCSL']);
      assert.match(
        sql,
        /format\('%I\.%I', \$1::text, \$2::text\)/,
        'Relation lookup parameters must be explicitly typed for PostgreSQL.',
      );
      return { rows: [{ relation_exists: true }] };
    }
    if (/COUNT\(\*\)::int AS total/.test(sql)) {
      assert.match(sql, /projected_series/);
      return { rows: [{ total: 2 }] };
    }
    if (/SELECT observation_date, observation_value/.test(sql)) {
      return {
        rows: [
          { observation_date: '2026-05-01', observation_value: '2.75' },
          { observation_date: '2026-06-01', observation_value: '2.80' },
        ],
      };
    }
    throw new Error(`Unexpected query in self-test: ${sql}`);
  };
}

async function run() {
  assert.strictEqual(TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION, 'time_series_observations.v1');
  assert.strictEqual(METRIC_OBSERVATIONS_CONTRACT_VERSION, 'metric_observations.v1');
  assert.strictEqual(quoteIdentifier('safe_name'), '"safe_name"');
  assert.throws(() => quoteIdentifier('unsafe.name'), /Unsafe storage identifier/);
  assert.strictEqual(normalizeDate('2026-08-01', 'dateFrom'), '2026-08-01');
  assert.throws(() => normalizeDate('2026-02-30', 'dateFrom'), /valid calendar date/);
  assert.deepStrictEqual(normalizeSeriesFilters({ sort: 'desc', limit: 10 }), {
    limit: 10,
    offset: 0,
    dateFrom: null,
    dateTo: null,
    sortDirection: 'DESC',
  });

  const projection = buildProjectionSql(
    {
      domainCode: 'MACRO',
      assetCode: 'CPIAUCSL',
      assetKindCode: 'TIME_SERIES',
      storage: {
        schemaName: 'macro',
        relationName: 'CPIAUCSL',
        dateColumn: 'edate',
        valueColumn: 'value',
      },
    },
    { operator: 'PCT_CHANGE', periods: 12, multiplier: 100 },
  );
  assert.strictEqual(projection.operator, 'PCT_CHANGE');
  assert.match(projection.sql, /LAG\(source_value, 12\)/);
  assert.match(projection.sql, /\* 100/);

  assert.strictEqual(
    resolveMetricAssetDependency({
      domainCode: 'MACRO',
      metricCode: 'DIRECT',
      dependencies: [{ assetCode: 'DFF' }],
    }).assetCode,
    'DFF',
  );
  assert.throws(
    () => resolveMetricAssetDependency({
      domainCode: 'MACRO',
      metricCode: 'MULTI',
      dependencies: [{ assetCode: 'DFF' }, { assetCode: 'CPIAUCSL' }],
    }),
    /exactly one direct asset dependency/,
  );

  const assetPayload = await listAssetObservations(
    'MACRO',
    'CPIAUCSL',
    { limit: 2, sortDirection: 'ASC' },
    { query: createQueryMock() },
  );
  assert.strictEqual(assetPayload.contractVersion, TIME_SERIES_OBSERVATIONS_CONTRACT_VERSION);
  assert.strictEqual(assetPayload.asset.assetCode, 'CPIAUCSL');
  assert.strictEqual(assetPayload.items[0].value, 2.75);

  const metricPayload = await listMetricObservations(
    'MACRO',
    'US_CPI_INFLATION_YOY',
    { limit: 2 },
    { query: createQueryMock() },
  );
  assert.strictEqual(metricPayload.contractVersion, METRIC_OBSERVATIONS_CONTRACT_VERSION);
  assert.strictEqual(metricPayload.metric.metricCode, 'US_CPI_INFLATION_YOY');
  assert.strictEqual(metricPayload.dependencyAsset.assetCode, 'CPIAUCSL');
  assert.strictEqual(metricPayload.calculation.operator, 'PCT_CHANGE');
  assert.strictEqual(metricPayload.items.length, 2);

  const root = path.resolve(__dirname, '../../../..');
  const routeSource = fs.readFileSync(
    path.join(root, 'apps/api/src/routes/ingestion.routes.js'),
    'utf8',
  );
  const controllerSource = fs.readFileSync(
    path.join(root, 'apps/api/src/controllers/ingestionController.js'),
    'utf8',
  );
  const webServiceSource = fs.readFileSync(
    path.join(root, 'apps/admin-web/src/services/ingestionService.js'),
    'utf8',
  );
  const ledgerSource = fs.readFileSync(
    path.join(root, 'packages/ingestion/src/ledger/ingestionLedgerService.js'),
    'utf8',
  );

  assert.match(routeSource, /assets\/:domainCode\/:assetCode\/observations/);
  assert.match(routeSource, /metrics\/:domainCode\/:metricCode\/observations/);
  assert.match(controllerSource, /dataConsumerService\.listAssetObservations/);
  assert.match(controllerSource, /dataConsumerService\.listMetricObservations/);
  assert.match(webServiceSource, /listAssetObservations/);
  assert.match(webServiceSource, /listMetricObservations/);
  assert.match(ledgerSource, /FROM data\.vw_ingestion_run_items item/);
  assert.match(ledgerSource, /item\.asset_code ILIKE/);

  console.log('✅ Phase 16.8.2 generic observation and metric consumer contract self-test passed.');
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
