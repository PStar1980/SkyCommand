-- Seed: 00081__explainable_freshness_foundation_seed.sql
-- Phase 16.3.1: Generic freshness states, reason codes, and cadence defaults.

BEGIN;

INSERT INTO data.freshness_status_codes (
  freshness_status_code, name, description, severity_code, active
)
VALUES
  ('CURRENT', 'Current', 'The asset is current according to its resolved freshness policy.', 'OK', TRUE),
  ('INACTIVE', 'Inactive', 'The asset is intentionally inactive or discontinued.', 'INFO', TRUE),
  ('WARNING', 'Warning', 'The asset requires attention but the pipeline is not proven failed.', 'WARNING', TRUE),
  ('ERROR', 'Error', 'The asset has pipeline, storage, or configuration evidence requiring action.', 'ERROR', TRUE),
  ('UNKNOWN', 'Unknown', 'Available evidence is insufficient for a confident freshness conclusion.', 'UNKNOWN', TRUE)
ON CONFLICT (freshness_status_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    severity_code = EXCLUDED.severity_code,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.freshness_reason_codes (
  freshness_reason_code, freshness_status_code, name, description, active
)
VALUES
  ('CURRENT', 'CURRENT', 'Current', 'Target data meets or exceeds the latest observation expected under the resolved policy.', TRUE),
  ('EXPECTED_PROVIDER_LAG', 'CURRENT', 'Expected provider lag', 'The stored observation date looks old under a simple age threshold but is still on schedule after accounting for period completion and publication lag.', TRUE),
  ('SOURCE_NOT_UPDATED', 'WARNING', 'Source not updated', 'The latest source evidence is older than the observation date currently expected from the provider.', TRUE),
  ('INGESTION_NOT_RUN', 'WARNING', 'Ingestion not run', 'No ingestion-attempt evidence is available for an asset that is behind its expected observation date.', TRUE),
  ('INGESTION_FAILED', 'ERROR', 'Ingestion failed', 'The latest ingestion attempt failed while the asset remains behind expected/source evidence.', TRUE),
  ('LOAD_BEHIND_SOURCE', 'ERROR', 'Load behind source', 'The provider/source contains a newer observation than the target storage relation.', TRUE),
  ('CONFIGURATION_ERROR', 'ERROR', 'Configuration error', 'Storage or freshness metadata is invalid or the configured target relation is unavailable.', TRUE),
  ('DISCONTINUED', 'INACTIVE', 'Discontinued', 'The provider has explicitly discontinued the asset or publication is intentionally retired.', TRUE),
  ('NO_DATA', 'WARNING', 'No data', 'The configured target exists but contains no usable observations.', TRUE),
  ('UNKNOWN', 'UNKNOWN', 'Unknown', 'Evidence is incomplete or no portable policy can be resolved.', TRUE)
ON CONFLICT (freshness_reason_code) DO UPDATE
SET freshness_status_code = EXCLUDED.freshness_status_code,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- These defaults intentionally preserve the spirit of the legacy age thresholds
-- while accounting for the fact that monthly/quarterly/annual rows are stored at
-- period start. Example: MONTHLY = one represented month + 30-day release lag +
-- 15-day tolerance, rather than interpreting a May 1 observation as 90 days stale
-- on July 30 simply because the stored date is the first day of the period.
INSERT INTO data.freshness_frequency_policies (
  frequency_code,
  period_unit_code,
  period_length,
  release_lag_days,
  freshness_tolerance_days,
  active,
  configuration
)
VALUES
  ('DAILY', 'DAY', 1, 2, 4, TRUE, '{"legacyAgeThresholdDays":7}'::jsonb),
  ('WEEKLY', 'WEEK', 1, 7, 7, TRUE, '{"legacyAgeThresholdDays":21}'::jsonb),
  ('MONTHLY', 'MONTH', 1, 30, 15, TRUE, '{"legacyAgeThresholdDays":75}'::jsonb),
  ('QUARTERLY', 'QUARTER', 1, 75, 25, TRUE, '{"legacyAgeThresholdDays":190}'::jsonb),
  ('ANNUAL', 'YEAR', 1, 150, 35, TRUE, '{"legacyAgeThresholdDays":550}'::jsonb),
  ('OTHER', 'EVENT', 1, 90, 30, TRUE, '{"legacyAgeThresholdDays":120}'::jsonb)
ON CONFLICT (frequency_code) DO UPDATE
SET period_unit_code = EXCLUDED.period_unit_code,
    period_length = EXCLUDED.period_length,
    release_lag_days = EXCLUDED.release_lag_days,
    freshness_tolerance_days = EXCLUDED.freshness_tolerance_days,
    active = EXCLUDED.active,
    configuration = data.freshness_frequency_policies.configuration || EXCLUDED.configuration,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
