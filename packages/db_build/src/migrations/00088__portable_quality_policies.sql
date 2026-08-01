-- Migration: 00088__portable_quality_policies.sql
-- Phase 16.6.2: Adds source/asset quality-policy overrides and resolved policy discovery.

BEGIN;

ALTER TABLE data.ingestion_quality_check_codes
  ADD COLUMN IF NOT EXISTS enabled_default BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS data.source_quality_policies (
  source_quality_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES data.sources(source_id) ON DELETE CASCADE,
  check_code TEXT NOT NULL REFERENCES data.ingestion_quality_check_codes(check_code),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_code TEXT NOT NULL REFERENCES data.ingestion_quality_severity_codes(severity_code),
  blocking BOOLEAN NOT NULL DEFAULT FALSE,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, check_code),
  CONSTRAINT data_source_quality_policies_parameters_check
    CHECK (jsonb_typeof(parameters) = 'object')
);

ALTER TABLE data.source_quality_policies OWNER TO postgres;

COMMENT ON TABLE data.source_quality_policies IS
  'Portable source-level ingestion quality-policy overrides. Asset-level policy takes precedence.';

CREATE INDEX IF NOT EXISTS idx_data_source_quality_policies_source_active
  ON data.source_quality_policies (source_id, active, check_code);

CREATE TABLE IF NOT EXISTS data.asset_quality_policies (
  asset_quality_policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES data.assets(asset_id) ON DELETE CASCADE,
  check_code TEXT NOT NULL REFERENCES data.ingestion_quality_check_codes(check_code),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity_code TEXT NOT NULL REFERENCES data.ingestion_quality_severity_codes(severity_code),
  blocking BOOLEAN NOT NULL DEFAULT FALSE,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, check_code),
  CONSTRAINT data_asset_quality_policies_parameters_check
    CHECK (jsonb_typeof(parameters) = 'object')
);

ALTER TABLE data.asset_quality_policies OWNER TO postgres;

COMMENT ON TABLE data.asset_quality_policies IS
  'Portable asset-specific ingestion quality-policy overrides with precedence over source defaults.';

CREATE INDEX IF NOT EXISTS idx_data_asset_quality_policies_asset_active
  ON data.asset_quality_policies (asset_id, active, check_code);

DROP TRIGGER IF EXISTS source_quality_policies_set_updated_at
  ON data.source_quality_policies;
CREATE TRIGGER source_quality_policies_set_updated_at
BEFORE UPDATE ON data.source_quality_policies
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS asset_quality_policies_set_updated_at
  ON data.asset_quality_policies;
CREATE TRIGGER asset_quality_policies_set_updated_at
BEFORE UPDATE ON data.asset_quality_policies
FOR EACH ROW EXECUTE FUNCTION data.set_updated_at();

CREATE OR REPLACE VIEW data.vw_asset_quality_policies AS
SELECT
  domain.domain_id,
  domain.domain_code,
  source.source_id,
  source.source_code,
  asset.asset_id,
  asset.asset_code,
  asset.frequency_code AS asset_frequency_code,
  asset.unit_code AS asset_unit_code,
  asset.transform_code AS asset_transform_code,
  binding.source_frequency_code,
  binding.transform_code AS source_transform_code,
  binding.configuration AS binding_configuration,
  quality_check.check_code,
  quality_check.name AS check_name,
  COALESCE(asset_policy.enabled, source_policy.enabled, quality_check.enabled_default) AS enabled,
  COALESCE(asset_policy.severity_code, source_policy.severity_code,
    quality_check.default_severity_code) AS severity_code,
  COALESCE(asset_policy.blocking, source_policy.blocking,
    quality_check.blocking_default) AS blocking,
  COALESCE(asset_policy.parameters, source_policy.parameters, '{}'::jsonb) AS parameters,
  CASE
    WHEN asset_policy.asset_quality_policy_id IS NOT NULL THEN 'ASSET'
    WHEN source_policy.source_quality_policy_id IS NOT NULL THEN 'SOURCE'
    ELSE 'CHECK_DEFAULT'
  END AS policy_origin_code
FROM data.assets asset
JOIN data.domains domain
  ON domain.domain_id = asset.domain_id
JOIN data.asset_source_bindings binding
  ON binding.asset_id = asset.asset_id
 AND binding.primary_binding = TRUE
 AND binding.active = TRUE
JOIN data.sources source
  ON source.source_id = binding.source_id
CROSS JOIN data.ingestion_quality_check_codes quality_check
LEFT JOIN data.source_quality_policies source_policy
  ON source_policy.source_id = source.source_id
 AND source_policy.check_code = quality_check.check_code
 AND source_policy.active = TRUE
LEFT JOIN data.asset_quality_policies asset_policy
  ON asset_policy.asset_id = asset.asset_id
 AND asset_policy.check_code = quality_check.check_code
 AND asset_policy.active = TRUE
WHERE domain.active = TRUE
  AND source.active = TRUE
  AND asset.active = TRUE
  AND quality_check.active = TRUE;

ALTER VIEW data.vw_asset_quality_policies OWNER TO postgres;

COMMENT ON VIEW data.vw_asset_quality_policies IS
  'Resolved quality policy per asset/check using asset > source > check-default precedence.';

COMMIT;
