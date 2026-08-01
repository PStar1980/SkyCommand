-- Seed: 00087__revision_quality_foundation_seed.sql
-- Phase 16.6.1: Portable quality statuses, severities, checks, and revision capability alignment.

BEGIN;

INSERT INTO data.ingestion_quality_status_codes (
  quality_status_code, name, description, successful, active
)
VALUES
  ('PASS', 'Pass', 'No blocking or warning quality findings were recorded.', TRUE, TRUE),
  ('WARN', 'Warning', 'The asset loaded, but one or more non-blocking quality findings were recorded.', TRUE, TRUE),
  ('FAIL', 'Fail', 'A blocking quality finding prevented trustworthy loading.', FALSE, TRUE)
ON CONFLICT (quality_status_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  successful = EXCLUDED.successful,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.ingestion_quality_severity_codes (
  severity_code, name, description, display_order, active
)
VALUES
  ('INFO', 'Information', 'Informational evidence that does not affect acceptance.', 10, TRUE),
  ('WARNING', 'Warning', 'A non-blocking finding that should be reviewed.', 20, TRUE),
  ('ERROR', 'Error', 'A blocking validation or quality failure.', 30, TRUE)
ON CONFLICT (severity_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.ingestion_quality_check_codes (
  check_code, name, description, default_severity_code,
  blocking_default, row_level, active
)
VALUES
  ('EMPTY_RESPONSE', 'Empty response', 'The source produced no data rows.', 'ERROR', TRUE, FALSE, TRUE),
  ('NO_VALID_ROWS', 'No valid rows', 'Rows were received, but none passed normalization and validation.', 'ERROR', TRUE, FALSE, TRUE),
  ('INVALID_DATE', 'Invalid date', 'A source row contains an invalid or missing observation date.', 'ERROR', TRUE, TRUE, TRUE),
  ('INVALID_NUMERIC', 'Invalid numeric value', 'A source row contains an invalid or missing numeric observation value.', 'ERROR', TRUE, TRUE, TRUE),
  ('DUPLICATE_KEY', 'Duplicate observation key', 'More than one source row resolves to the same observation key.', 'WARNING', FALSE, TRUE, TRUE),
  ('SOURCE_DATE_REGRESSION', 'Source date regression', 'The source maximum date is earlier than the existing target maximum date.', 'WARNING', FALSE, FALSE, TRUE),
  ('UNEXPECTED_GAP', 'Unexpected gap', 'The source series contains a gap outside its configured frequency tolerance.', 'WARNING', FALSE, FALSE, TRUE),
  ('ROW_COUNT_ANOMALY', 'Row-count anomaly', 'The source row count differs materially from the configured expectation.', 'WARNING', FALSE, FALSE, TRUE),
  ('TRANSFORMATION_FAILED', 'Transformation failure', 'A source row could not be transformed into the target contract.', 'ERROR', TRUE, TRUE, TRUE),
  ('UNIT_INCOMPATIBLE', 'Unit incompatibility', 'Source units are incompatible with the configured asset contract.', 'ERROR', TRUE, FALSE, TRUE),
  ('FREQUENCY_INCOMPATIBLE', 'Frequency incompatibility', 'Source frequency is incompatible with the configured asset contract.', 'ERROR', TRUE, FALSE, TRUE)
ON CONFLICT (check_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_severity_code = EXCLUDED.default_severity_code,
  blocking_default = EXCLUDED.blocking_default,
  row_level = EXCLUDED.row_level,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

UPDATE data.ingestion_tool_profiles
SET
  supports_revisions = TRUE,
  updated_at = CURRENT_TIMESTAMP
WHERE adapter_code IN ('FRED', 'BOC', 'STATCAN');

COMMIT;
