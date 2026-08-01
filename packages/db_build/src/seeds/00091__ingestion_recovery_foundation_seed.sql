-- Seed: 00091__ingestion_recovery_foundation_seed.sql
-- Phase 16.7.1: Recovery request lifecycle codes.

BEGIN;

INSERT INTO data.ingestion_recovery_status_codes (
  status_code, name, description, terminal, active
)
VALUES
  ('PLANNED', 'Planned', 'Recovery assets and lineage are durably recorded but execution has not started.', FALSE, TRUE),
  ('RUNNING', 'Running', 'The failed-only or explicit-asset recovery is executing.', FALSE, TRUE),
  ('COMPLETED', 'Completed', 'The recovery run completed and is linked to the original run.', TRUE, TRUE),
  ('FAILED', 'Failed', 'Recovery execution or evidence persistence failed.', TRUE, TRUE),
  ('CANCELLED', 'Cancelled', 'Recovery was cancelled before completion.', TRUE, TRUE)
ON CONFLICT (status_code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    terminal = EXCLUDED.terminal,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
