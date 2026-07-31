-- Seed: 00083__generic_ingestion_ledger_seed.sql
-- Phase 16.4.1: Generic run status, item outcome, and error category codes.

BEGIN;

INSERT INTO data.ingestion_run_status_codes (
  status_code, name, description, terminal, success_like, active
)
VALUES
  ('QUEUED', 'Queued', 'Run is registered but has not begun work.', FALSE, FALSE, TRUE),
  ('RUNNING', 'Running', 'Run is actively processing one or more assets.', FALSE, FALSE, TRUE),
  ('SUCCESS', 'Success', 'All requested assets completed successfully.', TRUE, TRUE, TRUE),
  ('PARTIAL', 'Partial', 'At least one asset succeeded and at least one asset failed.', TRUE, FALSE, TRUE),
  ('FAILED', 'Failed', 'The run failed without a successful terminal result for all requested assets.', TRUE, FALSE, TRUE),
  ('CANCELLED', 'Cancelled', 'The run was cancelled before normal completion.', TRUE, FALSE, TRUE)
ON CONFLICT (status_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    terminal = EXCLUDED.terminal,
    success_like = EXCLUDED.success_like,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.ingestion_item_outcome_codes (
  outcome_code, name, description, terminal, success_like, active
)
VALUES
  ('RUNNING', 'Running', 'Asset attempt is in progress.', FALSE, FALSE, TRUE),
  ('UPDATED', 'Updated', 'Asset completed and inserted or updated data.', TRUE, TRUE, TRUE),
  ('UNCHANGED', 'Unchanged', 'Asset completed successfully with no new or revised target values.', TRUE, TRUE, TRUE),
  ('FAILED', 'Failed', 'Asset attempt failed.', TRUE, FALSE, TRUE),
  ('SKIPPED', 'Skipped', 'Asset was intentionally skipped.', TRUE, FALSE, TRUE),
  ('REJECTED', 'Rejected', 'Asset or payload was rejected by validation or policy.', TRUE, FALSE, TRUE),
  ('CANCELLED', 'Cancelled', 'Asset attempt was cancelled.', TRUE, FALSE, TRUE)
ON CONFLICT (outcome_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    terminal = EXCLUDED.terminal,
    success_like = EXCLUDED.success_like,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO data.ingestion_error_categories (
  error_category_code, name, description, retryable_default, active
)
VALUES
  ('NETWORK', 'Network', 'Network connectivity or transport failure.', TRUE, TRUE),
  ('TIMEOUT', 'Timeout', 'Connection, response, or operation timeout.', TRUE, TRUE),
  ('HTTP', 'HTTP', 'Remote HTTP response failure.', FALSE, TRUE),
  ('AUTH', 'Authentication / Authorization', 'Credential, authentication, or authorization failure.', FALSE, TRUE),
  ('SOURCE_DATA', 'Source Data', 'Provider payload is missing, malformed, or incompatible.', FALSE, TRUE),
  ('NORMALIZATION', 'Normalization', 'Source-to-portable normalization failed.', FALSE, TRUE),
  ('VALIDATION', 'Validation', 'Portable quality or contract validation failed.', FALSE, TRUE),
  ('LOAD', 'Load', 'Target staging, merge, or persistence failed.', FALSE, TRUE),
  ('CONFIGURATION', 'Configuration', 'Catalogue, adapter, mapping, or runtime configuration is invalid.', FALSE, TRUE),
  ('CANCELLED', 'Cancelled', 'Work was cancelled intentionally.', FALSE, TRUE),
  ('UNKNOWN', 'Unknown', 'Failure category could not be determined safely.', FALSE, TRUE)
ON CONFLICT (error_category_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    retryable_default = EXCLUDED.retryable_default,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
