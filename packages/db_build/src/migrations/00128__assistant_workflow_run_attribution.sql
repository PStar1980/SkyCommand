-- Migration: 00128__assistant_workflow_run_attribution.sql
-- Purpose: Extends workflow run attribution checks for first-class Assistant runs.

BEGIN;

ALTER TABLE worker.workflow_run_records
  DROP CONSTRAINT IF EXISTS workflow_run_records_run_source_check;

ALTER TABLE worker.workflow_run_records
  ADD CONSTRAINT workflow_run_records_run_source_check
  CHECK (run_source IN (
    'manual',
    'api',
    'scheduler',
    'listener',
    'child_workflow',
    'system',
    'assistant'
  ));

ALTER TABLE worker.workflow_run_records
  DROP CONSTRAINT IF EXISTS workflow_run_records_trigger_type_check;

ALTER TABLE worker.workflow_run_records
  ADD CONSTRAINT workflow_run_records_trigger_type_check
  CHECK (trigger_type IN (
    'MANUAL',
    'API',
    'SCHEDULER',
    'LISTENER',
    'CHILD_WORKFLOW',
    'SYSTEM',
    'ASSISTANT'
  ));

COMMIT;
