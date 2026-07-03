-- ============================================================
-- Migration: 00045__workflow_lifecycle_simplification.sql
-- Purpose:
-- Simplifies the user-facing workflow lifecycle to ACTIVE / INACTIVE.
-- The version tables remain internal implementation detail for the
-- current graph snapshot and historical run linkage.
-- ============================================================

BEGIN;

ALTER TABLE worker.workflow_definitions
  DROP CONSTRAINT IF EXISTS workflow_definitions_status_check;

UPDATE worker.workflow_definitions
SET status = 'INACTIVE',
    enabled = FALSE,
    visible_in_admin = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE status IN ('DRAFT', 'ARCHIVED');

ALTER TABLE worker.workflow_definitions
  ADD CONSTRAINT workflow_definitions_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE'));

COMMIT;
