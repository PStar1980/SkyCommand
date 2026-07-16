-- ============================================================
-- Migration: 00062__workflow_output_type_contracts.sql
-- Purpose:
-- Allows workflow node output_type to store versioned semantic
-- ToolResult contract names (for example
-- macro_ingestion_summary.v1) in addition to legacy structural
-- JSON type labels. Phase 14 persists the canonical ToolResult
-- envelope as one authoritative node-output record.
-- ============================================================

BEGIN;

ALTER TABLE worker.workflow_run_node_outputs
  DROP CONSTRAINT IF EXISTS workflow_run_node_outputs_output_type_check;

ALTER TABLE worker.workflow_run_node_outputs
  DROP CONSTRAINT IF EXISTS workflow_run_node_outputs_output_type_not_blank;

ALTER TABLE worker.workflow_run_node_outputs
  ADD CONSTRAINT workflow_run_node_outputs_output_type_not_blank
  CHECK (btrim(output_type) <> '');

COMMENT ON COLUMN worker.workflow_run_node_outputs.output_type IS
  'Structural JSON type for generic nodes or a versioned semantic result contract such as macro_ingestion_summary.v1.';

COMMIT;
