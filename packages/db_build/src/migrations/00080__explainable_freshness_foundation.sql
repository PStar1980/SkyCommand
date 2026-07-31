-- Migration: 00080__explainable_freshness_foundation.sql
-- Phase 16.3.1: Adds generic freshness policies, reason codes, and a persisted
-- asset-status snapshot seam beside the working macro implementation.

BEGIN;

CREATE TABLE IF NOT EXISTS data.freshness_status_codes (
  freshness_status_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  severity_code TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_freshness_status_codes_code_check
    CHECK (freshness_status_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_freshness_status_codes_severity_check
    CHECK (severity_code IN ('OK', 'INFO', 'WARNING', 'ERROR', 'UNKNOWN'))
);

ALTER TABLE data.freshness_status_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS data.freshness_reason_codes (
  freshness_reason_code TEXT PRIMARY KEY,
  freshness_status_code TEXT NOT NULL
    REFERENCES data.freshness_status_codes(freshness_status_code),
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_freshness_reason_codes_code_check
    CHECK (freshness_reason_code ~ '^[A-Z][A-Z0-9_]*$')
);

ALTER TABLE data.freshness_reason_codes OWNER TO postgres;

COMMENT ON TABLE data.freshness_reason_codes IS
  'Domain-neutral reason codes explaining why a data asset is current, delayed, unavailable, or unhealthy.';

CREATE TABLE IF NOT EXISTS data.freshness_frequency_policies (
  frequency_code TEXT PRIMARY KEY,
  period_unit_code TEXT NOT NULL,
  period_length INTEGER NOT NULL,
  release_lag_days INTEGER NOT NULL DEFAULT 0,
  freshness_tolerance_days INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_freshness_frequency_policies_frequency_check
    CHECK (frequency_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_freshness_frequency_policies_unit_check
    CHECK (period_unit_code IN ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'EVENT')),
  CONSTRAINT data_freshness_frequency_policies_length_check
    CHECK (period_length >= 1),
  CONSTRAINT data_freshness_frequency_policies_release_lag_check
    CHECK (release_lag_days >= 0),
  CONSTRAINT data_freshness_frequency_policies_tolerance_check
    CHECK (freshness_tolerance_days >= 0),
  CONSTRAINT data_freshness_frequency_policies_configuration_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.freshness_frequency_policies OWNER TO postgres;

COMMENT ON TABLE data.freshness_frequency_policies IS
  'Portable fallback cadence policies. Release lag is measured after the represented period completes, not from the stored period-start date.';

CREATE TABLE IF NOT EXISTS data.source_freshness_policies (
  source_id UUID NOT NULL REFERENCES data.sources(source_id) ON DELETE CASCADE,
  frequency_code TEXT NOT NULL,
  release_lag_days INTEGER,
  freshness_tolerance_days INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, frequency_code),
  CONSTRAINT data_source_freshness_policies_frequency_check
    CHECK (frequency_code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT data_source_freshness_policies_release_lag_check
    CHECK (release_lag_days IS NULL OR release_lag_days >= 0),
  CONSTRAINT data_source_freshness_policies_tolerance_check
    CHECK (freshness_tolerance_days IS NULL OR freshness_tolerance_days >= 0),
  CONSTRAINT data_source_freshness_policies_configuration_check
    CHECK (jsonb_typeof(configuration) = 'object')
);

ALTER TABLE data.source_freshness_policies OWNER TO postgres;

COMMENT ON TABLE data.source_freshness_policies IS
  'Optional source-specific freshness policy overrides. Asset-level release/freshness values retain highest precedence.';

CREATE TABLE IF NOT EXISTS data.asset_freshness_snapshots (
  asset_id UUID PRIMARY KEY REFERENCES data.assets(asset_id) ON DELETE CASCADE,
  source_id UUID REFERENCES data.sources(source_id) ON DELETE SET NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  policy_frequency_code TEXT,
  policy_origin_code TEXT NOT NULL DEFAULT 'UNKNOWN',
  release_lag_days INTEGER,
  freshness_tolerance_days INTEGER,
  expected_latest_date DATE,
  source_latest_date DATE,
  target_relation_exists BOOLEAN,
  target_row_count BIGINT,
  target_min_date DATE,
  target_latest_date DATE,
  source_target_gap_days INTEGER,
  last_attempt_at TIMESTAMPTZ,
  last_attempt_status TEXT,
  last_success_at TIMESTAMPTZ,
  freshness_status_code TEXT NOT NULL
    REFERENCES data.freshness_status_codes(freshness_status_code),
  freshness_reason_code TEXT NOT NULL
    REFERENCES data.freshness_reason_codes(freshness_reason_code),
  message TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT data_asset_freshness_snapshots_policy_origin_check
    CHECK (policy_origin_code IN ('ASSET', 'SOURCE', 'FREQUENCY_DEFAULT', 'NONE', 'UNKNOWN')),
  CONSTRAINT data_asset_freshness_snapshots_release_lag_check
    CHECK (release_lag_days IS NULL OR release_lag_days >= 0),
  CONSTRAINT data_asset_freshness_snapshots_tolerance_check
    CHECK (freshness_tolerance_days IS NULL OR freshness_tolerance_days >= 0),
  CONSTRAINT data_asset_freshness_snapshots_row_count_check
    CHECK (target_row_count IS NULL OR target_row_count >= 0),
  CONSTRAINT data_asset_freshness_snapshots_evidence_check
    CHECK (jsonb_typeof(evidence) = 'object')
);

ALTER TABLE data.asset_freshness_snapshots OWNER TO postgres;

COMMENT ON TABLE data.asset_freshness_snapshots IS
  'Persisted explainable freshness seam. It is refreshed from catalogue, storage, and execution evidence without becoming the durable ingestion-run ledger introduced in Phase 16.4.';

CREATE INDEX IF NOT EXISTS idx_data_asset_freshness_reason
  ON data.asset_freshness_snapshots (freshness_reason_code, refreshed_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_asset_freshness_source
  ON data.asset_freshness_snapshots (source_id, freshness_status_code, refreshed_at DESC);

DROP TRIGGER IF EXISTS freshness_status_codes_set_updated_at ON data.freshness_status_codes;
CREATE TRIGGER freshness_status_codes_set_updated_at
BEFORE UPDATE ON data.freshness_status_codes
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS freshness_reason_codes_set_updated_at ON data.freshness_reason_codes;
CREATE TRIGGER freshness_reason_codes_set_updated_at
BEFORE UPDATE ON data.freshness_reason_codes
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS freshness_frequency_policies_set_updated_at ON data.freshness_frequency_policies;
CREATE TRIGGER freshness_frequency_policies_set_updated_at
BEFORE UPDATE ON data.freshness_frequency_policies
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

DROP TRIGGER IF EXISTS source_freshness_policies_set_updated_at ON data.source_freshness_policies;
CREATE TRIGGER source_freshness_policies_set_updated_at
BEFORE UPDATE ON data.source_freshness_policies
FOR EACH ROW
EXECUTE FUNCTION data.set_updated_at();

CREATE OR REPLACE VIEW data.vw_asset_freshness AS
SELECT
  asset.domain_id,
  asset.domain_code,
  asset.domain_name,
  asset.asset_id,
  asset.asset_code,
  asset.asset_name,
  asset.asset_kind_code,
  asset.frequency_code,
  asset.asset_active,
  asset.discoverable,
  asset.source_id,
  asset.source_code,
  asset.source_name,
  asset.provider_name,
  asset.provider_asset_code,
  snapshot.refreshed_at,
  snapshot.policy_frequency_code,
  snapshot.policy_origin_code,
  snapshot.release_lag_days,
  snapshot.freshness_tolerance_days,
  snapshot.expected_latest_date,
  snapshot.source_latest_date,
  snapshot.target_relation_exists,
  snapshot.target_row_count,
  snapshot.target_min_date,
  snapshot.target_latest_date,
  snapshot.source_target_gap_days,
  snapshot.last_attempt_at,
  snapshot.last_attempt_status,
  snapshot.last_success_at,
  snapshot.freshness_status_code,
  status.name AS freshness_status_name,
  status.severity_code,
  snapshot.freshness_reason_code,
  reason.name AS freshness_reason_name,
  reason.description AS freshness_reason_description,
  snapshot.message,
  snapshot.evidence
FROM data.vw_assets asset
LEFT JOIN data.asset_freshness_snapshots snapshot
  ON snapshot.asset_id = asset.asset_id
LEFT JOIN data.freshness_status_codes status
  ON status.freshness_status_code = snapshot.freshness_status_code
LEFT JOIN data.freshness_reason_codes reason
  ON reason.freshness_reason_code = snapshot.freshness_reason_code;

ALTER VIEW data.vw_asset_freshness OWNER TO postgres;

COMMENT ON VIEW data.vw_asset_freshness IS
  'Generic asset catalogue joined to the latest persisted explainable-freshness evidence.';

COMMIT;
