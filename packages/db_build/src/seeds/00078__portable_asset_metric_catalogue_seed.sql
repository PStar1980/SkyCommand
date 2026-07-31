-- Seed: 00078__portable_asset_metric_catalogue_seed.sql
-- Phase 16.2.1: Projects the current macro registry into the generic
-- data asset catalogue and registers initial metric/KPI examples.

BEGIN;

INSERT INTO data.asset_kinds (
  asset_kind_code,
  name,
  description,
  active
)
VALUES
  ('TIME_SERIES', 'Time series', 'Dated observations ordered through time.', TRUE),
  ('RECORD_SET', 'Record set', 'Tabular business or operational records.', TRUE),
  ('EVENT_STREAM', 'Event stream', 'Ordered operational or domain events.', TRUE),
  ('FILE', 'File', 'A file-backed source asset such as CSV, spreadsheet, or document.', TRUE)
ON CONFLICT (asset_kind_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.metric_kinds (
  metric_kind_code,
  name,
  description,
  active
)
VALUES
  ('DIRECT', 'Direct metric', 'A metric that exposes an asset value without an additional calculation.', TRUE),
  ('DERIVED', 'Derived metric', 'A metric calculated from one or more assets or metrics.', TRUE),
  ('AGGREGATE', 'Aggregate metric', 'A grouped or summarized metric over records or observations.', TRUE),
  ('COMPOSITE', 'Composite metric', 'A metric combining multiple weighted or logically related inputs.', TRUE)
ON CONFLICT (metric_kind_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

WITH macro_domain AS (
  SELECT domain_id
  FROM data.domains
  WHERE domain_code = 'MACRO'
)
INSERT INTO data.assets (
  domain_id,
  asset_code,
  name,
  description,
  asset_kind_code,
  frequency_code,
  geography_code,
  seasonal_adjustment_code,
  transform_code,
  criticality_code,
  storage_schema_name,
  storage_relation_name,
  storage_date_column,
  storage_value_column,
  contract_version,
  active,
  configuration
)
SELECT
  macro_domain.domain_id,
  indicator.indicator_code,
  COALESCE(NULLIF(indicator.description, ''), indicator.indicator_code),
  indicator.description,
  'TIME_SERIES',
  UPPER(NULLIF(indicator.frequency, '')),
  CASE
    WHEN UPPER(indicator.source) = 'FRED' THEN 'US'
    WHEN UPPER(indicator.source) IN ('BOC', 'STATCAN') THEN 'CA'
    ELSE NULL
  END,
  CASE
    WHEN LOWER(COALESCE(indicator.description, '')) LIKE '%not seasonally adjusted%' THEN 'NSA'
    WHEN LOWER(COALESCE(indicator.description, '')) LIKE '%seasonally adjusted%' THEN 'SA'
    ELSE NULL
  END,
  'IDENTITY',
  'STANDARD',
  'macro',
  indicator.indicator_code,
  'edate',
  'value',
  'data_asset.v1',
  COALESCE(indicator.active, TRUE),
  JSONB_BUILD_OBJECT(
    'legacyRegistry', 'macro.indicators',
    'legacyIndicatorCode', indicator.indicator_code,
    'legacySourceCode', UPPER(indicator.source)
  )
FROM macro.indicators indicator
CROSS JOIN macro_domain
ON CONFLICT (domain_id, asset_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    asset_kind_code = EXCLUDED.asset_kind_code,
    frequency_code = EXCLUDED.frequency_code,
    geography_code = EXCLUDED.geography_code,
    seasonal_adjustment_code = EXCLUDED.seasonal_adjustment_code,
    storage_schema_name = EXCLUDED.storage_schema_name,
    storage_relation_name = EXCLUDED.storage_relation_name,
    storage_date_column = EXCLUDED.storage_date_column,
    storage_value_column = EXCLUDED.storage_value_column,
    contract_version = EXCLUDED.contract_version,
    active = EXCLUDED.active,
    configuration = data.assets.configuration || EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.asset_source_bindings (
  asset_id,
  source_id,
  provider_asset_code,
  source_frequency_code,
  transform_code,
  primary_binding,
  active,
  configuration
)
SELECT
  asset.asset_id,
  source.source_id,
  indicator.indicator_code,
  UPPER(NULLIF(indicator.frequency, '')),
  'IDENTITY',
  TRUE,
  COALESCE(indicator.active, TRUE),
  JSONB_BUILD_OBJECT(
    'legacyIndicatorCode', indicator.indicator_code,
    'legacySourceCode', UPPER(indicator.source)
  )
FROM macro.indicators indicator
JOIN data.domains domain ON domain.domain_code = 'MACRO'
JOIN data.assets asset
  ON asset.domain_id = domain.domain_id
 AND asset.asset_code = indicator.indicator_code
JOIN data.sources source
  ON source.domain_id = domain.domain_id
 AND source.source_code = UPPER(indicator.source)
ON CONFLICT (asset_id, source_id) DO UPDATE
SET provider_asset_code = EXCLUDED.provider_asset_code,
    source_frequency_code = EXCLUDED.source_frequency_code,
    transform_code = EXCLUDED.transform_code,
    primary_binding = EXCLUDED.primary_binding,
    active = EXCLUDED.active,
    configuration = data.asset_source_bindings.configuration || EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

-- StatCan vector/product metadata currently lives in source configuration files.
-- Project it into PostgreSQL so generic consumers do not need JavaScript source knowledge.
WITH statcan_metadata (
  asset_code,
  vector_id,
  product_id,
  coordinate,
  transform_code
) AS (
  VALUES
    ('CAD_CPI_YOY', '41690973', '18100004', '2.2.0.0.0.0.0.0.0.0', 'YOY_PCT'),
    ('CAD_GDP_MOM_GROWTH', '65201210', '36100434', '1.1.1.1.0.0.0.0.0.0', 'MOM_PCT'),
    ('CAD_REAL_GDP_MONTHLY', '65201210', '36100434', '1.1.1.1.0.0.0.0.0.0', 'IDENTITY'),
    ('CAD_CPI_ALL_ITEMS', '41690973', '18100004', '2.2.0.0.0.0.0.0.0.0', 'IDENTITY'),
    ('CAD_BUILDING_PERMITS', '1675119645', '34100292', '1.1.1.1.2.0.0.0.0.0', 'IDENTITY'),
    ('CAD_RETAIL_SALES', '1446870151', '20100067', '1.1.1.0.0.0.0.0.0.0', 'IDENTITY'),
    ('CAD_NHPI_MOM', '111955442', '18100205', '1.1.0.0.0.0.0.0.0.0', 'MOM_PCT'),
    ('CAD_NEW_HOUSING_PRICE_INDEX', '111955442', '18100205', '1.1.0.0.0.0.0.0.0.0', 'IDENTITY'),
    ('CAD_POPULATION', '1', '17100009', '1.0.0.0.0.0.0.0.0.0', 'IDENTITY'),
    ('CAD_EMPLOYMENT', '2062811', '14100287', '1.3.1.1.1.1.0.0.0.0', 'IDENTITY'),
    ('CAD_PARTICIPATION_RATE', '2062816', '14100287', '1.8.1.1.1.1.0.0.0.0', 'IDENTITY'),
    ('CAD_UNEMPLOYMENT_RATE', '2062815', '14100287', '1.7.1.1.1.1.0.0.0.0', 'IDENTITY'),
    ('CAD_IMPORTS', '1645187724', '12100178', '1.1.1.1.1.0.0.0.0.0', 'IDENTITY'),
    ('CAD_TRADE_BY_INDUSTRY', '1592742953', '12100176', '1.2.1.1.0.0.0.0.0.0', 'IDENTITY')
)
UPDATE data.asset_source_bindings binding
SET provider_asset_code = statcan_metadata.vector_id,
    provider_resource_code = statcan_metadata.product_id,
    provider_locator = statcan_metadata.coordinate,
    transform_code = statcan_metadata.transform_code,
    configuration = binding.configuration || JSONB_BUILD_OBJECT(
      'logicalIndicatorCode', statcan_metadata.asset_code,
      'providerIdentifierType', 'STATCAN_VECTOR',
      'catalogueMetadataSource', 'statcanVectors.js'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM statcan_metadata
JOIN data.domains domain ON domain.domain_code = 'MACRO'
JOIN data.assets asset
  ON asset.domain_id = domain.domain_id
 AND asset.asset_code = statcan_metadata.asset_code
JOIN data.sources source
  ON source.domain_id = domain.domain_id
 AND source.source_code = 'STATCAN'
WHERE binding.asset_id = asset.asset_id
  AND binding.source_id = source.source_id;

WITH statcan_transforms (asset_code, transform_code) AS (
  VALUES
    ('CAD_CPI_YOY', 'YOY_PCT'),
    ('CAD_GDP_MOM_GROWTH', 'MOM_PCT'),
    ('CAD_NHPI_MOM', 'MOM_PCT')
)
UPDATE data.assets asset
SET transform_code = statcan_transforms.transform_code,
    updated_at = CURRENT_TIMESTAMP
FROM statcan_transforms
JOIN data.domains domain ON domain.domain_code = 'MACRO'
WHERE asset.domain_id = domain.domain_id
  AND asset.asset_code = statcan_transforms.asset_code;

WITH macro_domain AS (
  SELECT domain_id
  FROM data.domains
  WHERE domain_code = 'MACRO'
), metric_seed (
  metric_code,
  name,
  description,
  metric_kind_code,
  frequency_code,
  unit_code,
  definition,
  dependency_asset_code
) AS (
  VALUES
    (
      'US_CPI_INFLATION_YOY',
      'U.S. CPI inflation, year over year',
      'Twelve-month percentage change in the U.S. all-items Consumer Price Index.',
      'DERIVED',
      'MONTHLY',
      'PERCENT',
      '{"operator":"PCT_CHANGE","periods":12,"multiplier":100}'::jsonb,
      'CPIAUCSL'
    ),
    (
      'US_UNEMPLOYMENT_RATE',
      'U.S. unemployment rate',
      'Headline U.S. unemployment rate.',
      'DIRECT',
      'MONTHLY',
      'PERCENT',
      '{"operator":"IDENTITY"}'::jsonb,
      'UNRATE'
    ),
    (
      'US_REAL_GDP',
      'U.S. real gross domestic product',
      'Real U.S. gross domestic product.',
      'DIRECT',
      'QUARTERLY',
      NULL,
      '{"operator":"IDENTITY"}'::jsonb,
      'GDPC1'
    ),
    (
      'CAD_CPI_INFLATION_YOY',
      'Canadian CPI inflation, year over year',
      'Statistics Canada all-items CPI year-over-year inflation measure.',
      'DIRECT',
      'MONTHLY',
      'PERCENT',
      '{"operator":"IDENTITY"}'::jsonb,
      'CAD_CPI_YOY'
    ),
    (
      'CAD_UNEMPLOYMENT_RATE',
      'Canadian unemployment rate',
      'Headline Canadian unemployment rate.',
      'DIRECT',
      'MONTHLY',
      'PERCENT',
      '{"operator":"IDENTITY"}'::jsonb,
      'CAD_UNEMPLOYMENT_RATE'
    )
)
INSERT INTO data.metrics (
  domain_id,
  metric_code,
  name,
  description,
  metric_kind_code,
  frequency_code,
  unit_code,
  definition,
  contract_version,
  active,
  configuration
)
SELECT
  macro_domain.domain_id,
  metric_seed.metric_code,
  metric_seed.name,
  metric_seed.description,
  metric_seed.metric_kind_code,
  metric_seed.frequency_code,
  metric_seed.unit_code,
  metric_seed.definition,
  'data_metric.v1',
  TRUE,
  JSONB_BUILD_OBJECT(
    'seededExample', TRUE,
    'dependencyAssetCode', metric_seed.dependency_asset_code
  )
FROM macro_domain
CROSS JOIN metric_seed
ON CONFLICT (domain_id, metric_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    metric_kind_code = EXCLUDED.metric_kind_code,
    frequency_code = EXCLUDED.frequency_code,
    unit_code = EXCLUDED.unit_code,
    definition = EXCLUDED.definition,
    contract_version = EXCLUDED.contract_version,
    active = EXCLUDED.active,
    configuration = data.metrics.configuration || EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

WITH dependency_seed (metric_code, asset_code) AS (
  VALUES
    ('US_CPI_INFLATION_YOY', 'CPIAUCSL'),
    ('US_UNEMPLOYMENT_RATE', 'UNRATE'),
    ('US_REAL_GDP', 'GDPC1'),
    ('CAD_CPI_INFLATION_YOY', 'CAD_CPI_YOY'),
    ('CAD_UNEMPLOYMENT_RATE', 'CAD_UNEMPLOYMENT_RATE')
)
INSERT INTO data.metric_dependencies (
  metric_id,
  asset_id,
  dependency_role_code,
  dependency_order,
  active,
  configuration
)
SELECT
  metric.metric_id,
  asset.asset_id,
  'INPUT',
  1,
  TRUE,
  JSONB_BUILD_OBJECT('seededExample', TRUE)
FROM dependency_seed
JOIN data.domains domain ON domain.domain_code = 'MACRO'
JOIN data.metrics metric
  ON metric.domain_id = domain.domain_id
 AND metric.metric_code = dependency_seed.metric_code
JOIN data.assets asset
  ON asset.domain_id = domain.domain_id
 AND asset.asset_code = dependency_seed.asset_code
ON CONFLICT (metric_id, asset_id, dependency_role_code) WHERE asset_id IS NOT NULL
DO UPDATE
SET dependency_order = EXCLUDED.dependency_order,
    active = EXCLUDED.active,
    configuration = data.metric_dependencies.configuration || EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
