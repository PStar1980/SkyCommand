-- Migration: 00077__portable_asset_metric_catalogue.sql
-- Phase 16.2.1: Adds generic data assets, source bindings, metrics,
-- and metric dependencies beside the legacy macro registry.

BEGIN;

CREATE TABLE IF NOT EXISTS data.asset_kinds (
  asset_kind_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_asset_kinds_code_check
    CHECK (asset_kind_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.asset_kinds OWNER TO postgres;

COMMENT ON TABLE data.asset_kinds IS
  'Portable classifications for source data assets, independent of business domain or physical storage implementation.';

CREATE TABLE IF NOT EXISTS data.metric_kinds (
  metric_kind_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_metric_kinds_code_check
    CHECK (metric_kind_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.metric_kinds OWNER TO postgres;

COMMENT ON TABLE data.metric_kinds IS
  'Portable metric/KPI classifications. Formula execution is intentionally outside this catalogue foundation.';

CREATE TABLE IF NOT EXISTS data.assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES data.domains(domain_id) ON DELETE CASCADE,
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  asset_kind_code TEXT NOT NULL REFERENCES data.asset_kinds(asset_kind_code),
  frequency_code TEXT,
  unit_code TEXT,
  scale_code TEXT,
  geography_code TEXT,
  seasonal_adjustment_code TEXT,
  transform_code TEXT,
  release_lag_days INTEGER,
  freshness_tolerance_days INTEGER,
  revisions_expected BOOLEAN,
  criticality_code TEXT NOT NULL DEFAULT 'STANDARD',
  storage_schema_name TEXT,
  storage_relation_name TEXT,
  storage_date_column TEXT,
  storage_value_column TEXT,
  contract_version TEXT NOT NULL DEFAULT 'data_asset.v1',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_id, asset_code),
  CONSTRAINT data_assets_code_check
    CHECK (asset_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_frequency_code_check
    CHECK (frequency_code IS NULL OR frequency_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_unit_code_check
    CHECK (unit_code IS NULL OR unit_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_scale_code_check
    CHECK (scale_code IS NULL OR scale_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_geography_code_check
    CHECK (geography_code IS NULL OR geography_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_seasonal_adjustment_code_check
    CHECK (
      seasonal_adjustment_code IS NULL
      OR seasonal_adjustment_code ~ '^[A-Z][A-Z0-9_]*$'
    ),
  CONSTRAINT data_assets_transform_code_check
    CHECK (transform_code IS NULL OR transform_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_release_lag_days_check
    CHECK (release_lag_days IS NULL OR release_lag_days >= 0),
  CONSTRAINT data_assets_freshness_tolerance_days_check
    CHECK (freshness_tolerance_days IS NULL OR freshness_tolerance_days >= 0),
  CONSTRAINT data_assets_criticality_code_check
    CHECK (criticality_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_assets_contract_version_check
    CHECK (contract_version ~ '^[a-z][a-z0-9_]*([.]v[1-9][0-9]*)?$'),
  CONSTRAINT data_assets_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.assets OWNER TO postgres;

COMMENT ON TABLE data.assets IS
  'Domain-neutral data assets such as time series, record sets, files, and event streams. Macro indicators are projected here without replacing macro.indicators.';
COMMENT ON COLUMN data.assets.storage_relation_name IS
  'Compatibility storage pointer only. Future domains may use shared observation storage or external relations.';
COMMENT ON COLUMN data.assets.revisions_expected IS
  'Nullable by design: TRUE/FALSE when known, NULL while revision behaviour is not yet classified.';

CREATE INDEX IF NOT EXISTS idx_data_assets_domain_active
  ON data.assets (domain_id, active, asset_code);
CREATE INDEX IF NOT EXISTS idx_data_assets_kind_frequency
  ON data.assets (asset_kind_code, frequency_code, active);

CREATE TABLE IF NOT EXISTS data.asset_source_bindings (
  binding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES data.sources(source_id) ON DELETE CASCADE,
  provider_asset_code TEXT NOT NULL,
  provider_resource_code TEXT,
  provider_locator TEXT,
  source_frequency_code TEXT,
  transform_code TEXT,
  primary_binding BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, source_id),
  CONSTRAINT data_asset_source_bindings_source_frequency_check
    CHECK (
      source_frequency_code IS NULL
      OR source_frequency_code ~ '^[A-Z][A-Z0-9_]*$'
    ),
  CONSTRAINT data_asset_source_bindings_transform_check
    CHECK (transform_code IS NULL OR transform_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_asset_source_bindings_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.asset_source_bindings OWNER TO postgres;

COMMENT ON TABLE data.asset_source_bindings IS
  'Provider/source identifiers and extraction metadata bound to a portable asset.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_asset_primary_source_binding
  ON data.asset_source_bindings (asset_id)
  WHERE primary_binding = TRUE AND active = TRUE;
CREATE INDEX IF NOT EXISTS idx_data_asset_source_bindings_source
  ON data.asset_source_bindings (source_id, active, provider_asset_code);

CREATE TABLE IF NOT EXISTS data.metrics (
  metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id UUID NOT NULL REFERENCES data.domains(domain_id) ON DELETE CASCADE,
  metric_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  metric_kind_code TEXT NOT NULL REFERENCES data.metric_kinds(metric_kind_code),
  frequency_code TEXT,
  unit_code TEXT,
  scale_code TEXT,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  contract_version TEXT NOT NULL DEFAULT 'data_metric.v1',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_id, metric_code),
  CONSTRAINT data_metrics_code_check
    CHECK (metric_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_metrics_frequency_code_check
    CHECK (frequency_code IS NULL OR frequency_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_metrics_unit_code_check
    CHECK (unit_code IS NULL OR unit_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_metrics_scale_code_check
    CHECK (scale_code IS NULL OR scale_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_metrics_contract_version_check
    CHECK (contract_version ~ '^[a-z][a-z0-9_]*([.]v[1-9][0-9]*)?$'),
  CONSTRAINT data_metrics_definition_object_check
    CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT data_metrics_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.metrics OWNER TO postgres;

COMMENT ON TABLE data.metrics IS
  'Portable KPI/metric metadata. Definitions describe intent and dependencies without introducing a formula-authoring engine.';

CREATE INDEX IF NOT EXISTS idx_data_metrics_domain_active
  ON data.metrics (domain_id, active, metric_code);

CREATE TABLE IF NOT EXISTS data.metric_dependencies (
  metric_dependency_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID NOT NULL REFERENCES data.metrics(metric_id) ON DELETE CASCADE,
  asset_id UUID REFERENCES data.assets(asset_id) ON DELETE CASCADE,
  depends_on_metric_id UUID REFERENCES data.metrics(metric_id) ON DELETE CASCADE,
  dependency_role_code TEXT NOT NULL DEFAULT 'INPUT',
  dependency_order INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_metric_dependencies_target_check
    CHECK (
      (asset_id IS NOT NULL AND depends_on_metric_id IS NULL)
      OR (asset_id IS NULL AND depends_on_metric_id IS NOT NULL)
    ),
  CONSTRAINT data_metric_dependencies_role_check
    CHECK (dependency_role_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_metric_dependencies_order_check
    CHECK (dependency_order >= 1),
  CONSTRAINT data_metric_dependencies_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.metric_dependencies OWNER TO postgres;

COMMENT ON TABLE data.metric_dependencies IS
  'Ordered asset or metric inputs for a portable metric definition.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_metric_dependency_asset
  ON data.metric_dependencies (metric_id, asset_id, dependency_role_code)
  WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_metric_dependency_metric
  ON data.metric_dependencies (metric_id, depends_on_metric_id, dependency_role_code)
  WHERE depends_on_metric_id IS NOT NULL;

CREATE OR REPLACE FUNCTION data.validate_asset_source_binding_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  asset_domain_id UUID;
  source_domain_id UUID;
BEGIN
  SELECT domain_id INTO asset_domain_id
  FROM data.assets
  WHERE asset_id = NEW.asset_id;

  SELECT domain_id INTO source_domain_id
  FROM data.sources
  WHERE source_id = NEW.source_id;

  IF asset_domain_id IS NULL OR source_domain_id IS NULL THEN
    RAISE EXCEPTION 'Asset/source binding references missing catalogue metadata.';
  END IF;

  IF asset_domain_id <> source_domain_id THEN
    RAISE EXCEPTION 'Asset and source must belong to the same data domain.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_asset_source_binding_domain() OWNER TO postgres;

CREATE OR REPLACE FUNCTION data.validate_metric_dependency_domain()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owner_domain_id UUID;
  dependency_domain_id UUID;
BEGIN
  SELECT domain_id INTO owner_domain_id
  FROM data.metrics
  WHERE metric_id = NEW.metric_id;

  IF NEW.asset_id IS NOT NULL THEN
    SELECT domain_id INTO dependency_domain_id
    FROM data.assets
    WHERE asset_id = NEW.asset_id;
  ELSE
    SELECT domain_id INTO dependency_domain_id
    FROM data.metrics
    WHERE metric_id = NEW.depends_on_metric_id;
  END IF;

  IF owner_domain_id IS NULL OR dependency_domain_id IS NULL THEN
    RAISE EXCEPTION 'Metric dependency references missing catalogue metadata.';
  END IF;

  IF owner_domain_id <> dependency_domain_id THEN
    RAISE EXCEPTION 'Metric dependencies must remain within the metric data domain.';
  END IF;

  IF NEW.depends_on_metric_id = NEW.metric_id THEN
    RAISE EXCEPTION 'A metric cannot depend on itself.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION data.validate_metric_dependency_domain() OWNER TO postgres;

DROP TRIGGER IF EXISTS data_asset_kinds_set_updated_at ON data.asset_kinds;
CREATE TRIGGER data_asset_kinds_set_updated_at
BEFORE UPDATE ON data.asset_kinds
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_metric_kinds_set_updated_at ON data.metric_kinds;
CREATE TRIGGER data_metric_kinds_set_updated_at
BEFORE UPDATE ON data.metric_kinds
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_assets_set_updated_at ON data.assets;
CREATE TRIGGER data_assets_set_updated_at
BEFORE UPDATE ON data.assets
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_asset_source_bindings_set_updated_at ON data.asset_source_bindings;
CREATE TRIGGER data_asset_source_bindings_set_updated_at
BEFORE UPDATE ON data.asset_source_bindings
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_metrics_set_updated_at ON data.metrics;
CREATE TRIGGER data_metrics_set_updated_at
BEFORE UPDATE ON data.metrics
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_metric_dependencies_set_updated_at ON data.metric_dependencies;
CREATE TRIGGER data_metric_dependencies_set_updated_at
BEFORE UPDATE ON data.metric_dependencies
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS data_asset_source_bindings_validate_domain
  ON data.asset_source_bindings;
CREATE TRIGGER data_asset_source_bindings_validate_domain
BEFORE INSERT OR UPDATE OF asset_id, source_id
ON data.asset_source_bindings
FOR EACH ROW
EXECUTE FUNCTION data.validate_asset_source_binding_domain();

DROP TRIGGER IF EXISTS data_metric_dependencies_validate_domain
  ON data.metric_dependencies;
CREATE TRIGGER data_metric_dependencies_validate_domain
BEFORE INSERT OR UPDATE OF metric_id, asset_id, depends_on_metric_id
ON data.metric_dependencies
FOR EACH ROW
EXECUTE FUNCTION data.validate_metric_dependency_domain();

CREATE OR REPLACE VIEW data.vw_assets AS
SELECT
  domain.domain_id,
  domain.domain_code,
  domain.name AS domain_name,
  asset.asset_id,
  asset.asset_code,
  asset.name AS asset_name,
  asset.description AS asset_description,
  asset.asset_kind_code,
  asset.frequency_code,
  asset.unit_code,
  asset.scale_code,
  asset.geography_code,
  asset.seasonal_adjustment_code,
  asset.transform_code,
  asset.release_lag_days,
  asset.freshness_tolerance_days,
  asset.revisions_expected,
  asset.criticality_code,
  asset.storage_schema_name,
  asset.storage_relation_name,
  asset.storage_date_column,
  asset.storage_value_column,
  asset.contract_version,
  asset.configuration AS asset_configuration,
  asset.active AS asset_active,
  binding.binding_id,
  binding.provider_asset_code,
  binding.provider_resource_code,
  binding.provider_locator,
  binding.source_frequency_code,
  binding.transform_code AS source_transform_code,
  binding.configuration AS binding_configuration,
  binding.active AS binding_active,
  source.source_id,
  source.source_code,
  source.name AS source_name,
  source.provider_name,
  source.provider_type,
  source.observability_enabled,
  source.active AS source_active,
  (
    domain.active
    AND asset.active
    AND COALESCE(binding.active, FALSE)
    AND COALESCE(source.active, FALSE)
  ) AS discoverable
FROM data.assets asset
JOIN data.domains domain ON domain.domain_id = asset.domain_id
LEFT JOIN data.asset_source_bindings binding
  ON binding.asset_id = asset.asset_id
 AND binding.primary_binding = TRUE
LEFT JOIN data.sources source ON source.source_id = binding.source_id;

ALTER VIEW data.vw_assets OWNER TO postgres;

COMMENT ON VIEW data.vw_assets IS
  'Portable asset discovery view with the active primary source binding and compatibility storage metadata.';

CREATE OR REPLACE VIEW data.vw_metrics AS
SELECT
  domain.domain_id,
  domain.domain_code,
  domain.name AS domain_name,
  metric.metric_id,
  metric.metric_code,
  metric.name AS metric_name,
  metric.description AS metric_description,
  metric.metric_kind_code,
  metric.frequency_code,
  metric.unit_code,
  metric.scale_code,
  metric.definition,
  metric.contract_version,
  metric.configuration AS metric_configuration,
  metric.active AS metric_active,
  domain.active AS domain_active,
  (
    domain.active
    AND metric.active
  ) AS discoverable,
  COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'dependencyId', dependency.metric_dependency_id,
        'roleCode', dependency.dependency_role_code,
        'order', dependency.dependency_order,
        'assetId', dependency.asset_id,
        'assetCode', dependency_asset.asset_code,
        'metricId', dependency.depends_on_metric_id,
        'metricCode', dependency_metric.metric_code,
        'configuration', dependency.configuration
      )
      ORDER BY dependency.dependency_order, dependency.metric_dependency_id
    ) FILTER (WHERE dependency.metric_dependency_id IS NOT NULL),
    '[]'::jsonb
  ) AS dependencies
FROM data.metrics metric
JOIN data.domains domain ON domain.domain_id = metric.domain_id
LEFT JOIN data.metric_dependencies dependency
  ON dependency.metric_id = metric.metric_id
 AND dependency.active = TRUE
LEFT JOIN data.assets dependency_asset ON dependency_asset.asset_id = dependency.asset_id
LEFT JOIN data.metrics dependency_metric
  ON dependency_metric.metric_id = dependency.depends_on_metric_id
GROUP BY
  domain.domain_id,
  domain.domain_code,
  domain.name,
  domain.active,
  metric.metric_id,
  metric.metric_code,
  metric.name,
  metric.description,
  metric.metric_kind_code,
  metric.frequency_code,
  metric.unit_code,
  metric.scale_code,
  metric.definition,
  metric.contract_version,
  metric.configuration,
  metric.active;

ALTER VIEW data.vw_metrics OWNER TO postgres;

COMMENT ON VIEW data.vw_metrics IS
  'Portable metric/KPI discovery view with ordered asset and metric dependencies.';

CREATE OR REPLACE VIEW data.vw_macro_indicator_assets AS
SELECT
  indicator.indicator_code,
  indicator.source AS legacy_source_code,
  indicator.description AS legacy_description,
  indicator.frequency AS legacy_frequency,
  indicator.active AS legacy_active,
  asset.asset_id,
  asset.domain_code,
  asset.asset_code,
  asset.asset_name,
  asset.asset_kind_code,
  asset.frequency_code,
  asset.source_id,
  asset.source_code,
  asset.provider_asset_code,
  asset.storage_schema_name,
  asset.storage_relation_name,
  asset.discoverable
FROM macro.indicators indicator
JOIN data.vw_assets asset
  ON asset.domain_code = 'MACRO'
 AND asset.asset_code = indicator.indicator_code;

ALTER VIEW data.vw_macro_indicator_assets OWNER TO postgres;

COMMENT ON VIEW data.vw_macro_indicator_assets IS
  'Compatibility projection proving that legacy macro.indicators remain intact while generic asset metadata is introduced beside them.';

COMMIT;
