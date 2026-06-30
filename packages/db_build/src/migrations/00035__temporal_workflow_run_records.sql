-- ============================================================
-- Migration: 00035__temporal_workflow_run_records.sql
-- Purpose:
-- Adds SkyServer-owned Temporal workflow launch/run metadata so
-- Admin-Web has an audit-friendly run index even when local
-- Temporal dev history is ephemeral.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS worker;

CREATE OR REPLACE FUNCTION worker.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Table: worker.temporal_workflow_run_records
-- Purpose: SkyServer control-plane metadata for Temporal workflow starts/actions.
CREATE TABLE IF NOT EXISTS worker.temporal_workflow_run_records (
  run_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID REFERENCES worker.temporal_workflow_definitions(definition_id) ON DELETE SET NULL,

  workflow_code TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  temporal_run_id TEXT,
  namespace TEXT NOT NULL DEFAULT 'default',
  task_queue TEXT,
  run_source TEXT NOT NULL DEFAULT 'api_manual',

  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN (
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELED',
      'CANCELLED',
      'TERMINATED',
      'CONTINUED_AS_NEW',
      'TIMED_OUT',
      'UNKNOWN',
      'CANCEL_REQUESTED',
      'TERMINATE_REQUESTED'
    )),

  launch_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  history_length INTEGER,
  temporal_started_at TIMESTAMPTZ,
  temporal_execution_at TIMESTAMPTZ,
  temporal_closed_at TIMESTAMPTZ,
  last_seen_in_temporal_at TIMESTAMPTZ,

  started_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  cancel_requested_at TIMESTAMPTZ,
  cancel_requested_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  terminate_requested_at TIMESTAMPTZ,
  terminate_requested_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  terminate_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT temporal_run_records_workflow_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT temporal_run_records_workflow_type_not_blank CHECK (btrim(workflow_type) <> ''),
  CONSTRAINT temporal_run_records_workflow_id_not_blank CHECK (btrim(workflow_id) <> ''),
  CONSTRAINT temporal_run_records_namespace_not_blank CHECK (btrim(namespace) <> ''),
  CONSTRAINT temporal_run_records_launch_input_object CHECK (jsonb_typeof(launch_input) = 'object'),
  CONSTRAINT temporal_run_records_request_context_object CHECK (jsonb_typeof(request_context) = 'object'),
  CONSTRAINT temporal_run_records_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_temporal_run_records_execution_unique
  ON worker.temporal_workflow_run_records (namespace, workflow_id, COALESCE(temporal_run_id, ''));

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_code_created
  ON worker.temporal_workflow_run_records (workflow_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_status_created
  ON worker.temporal_workflow_run_records (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_workflow_id
  ON worker.temporal_workflow_run_records (workflow_id);

DROP TRIGGER IF EXISTS temporal_workflow_run_records_set_updated_at ON worker.temporal_workflow_run_records;

CREATE TRIGGER temporal_workflow_run_records_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_run_records
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.temporal_workflow_run_records IS 'SkyServer-owned run index for Temporal workflow starts, action requests, and visibility snapshots.';
COMMENT ON COLUMN worker.temporal_workflow_run_records.launch_input IS 'Normalized input SkyServer sent to the Temporal workflow start call.';
COMMENT ON COLUMN worker.temporal_workflow_run_records.last_seen_in_temporal_at IS 'Most recent time SkyServer observed this execution in Temporal visibility or describe output.';

-- View: worker.vw_temporal_workflow_run_records
-- Purpose: Admin/API-friendly run record view with template and user metadata.
CREATE OR REPLACE VIEW worker.vw_temporal_workflow_run_records AS
SELECT
  r.run_record_id,
  r.definition_id,
  COALESCE(d.workflow_code, r.workflow_code) AS workflow_code,
  COALESCE(d.workflow_type, r.workflow_type) AS workflow_type,
  COALESCE(d.display_name, r.workflow_code) AS display_name,
  r.workflow_id,
  r.temporal_run_id,
  r.namespace,
  r.task_queue,
  r.run_source,
  r.status,
  r.launch_input,
  r.request_context,
  r.metadata,
  r.history_length,
  r.temporal_started_at,
  r.temporal_execution_at,
  r.temporal_closed_at,
  r.last_seen_in_temporal_at,
  starter.user_id AS started_by_user_id,
  starter.email AS started_by_email,
  starter.display_name AS started_by_display_name,
  r.cancel_requested_at,
  canceler.user_id AS cancel_requested_by_user_id,
  canceler.email AS cancel_requested_by_email,
  canceler.display_name AS cancel_requested_by_display_name,
  r.terminate_requested_at,
  terminator.user_id AS terminate_requested_by_user_id,
  terminator.email AS terminate_requested_by_email,
  terminator.display_name AS terminate_requested_by_display_name,
  r.terminate_reason,
  r.created_at,
  r.updated_at
FROM worker.temporal_workflow_run_records r
LEFT JOIN worker.temporal_workflow_definitions d
  ON d.definition_id = r.definition_id
LEFT JOIN auth.users starter
  ON starter.user_id = r.started_by_user_id
LEFT JOIN auth.users canceler
  ON canceler.user_id = r.cancel_requested_by_user_id
LEFT JOIN auth.users terminator
  ON terminator.user_id = r.terminate_requested_by_user_id;

COMMENT ON VIEW worker.vw_temporal_workflow_run_records IS 'SkyServer Temporal workflow run records enriched with definition and user metadata.';
