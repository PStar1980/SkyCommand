-- Table: worker.temporal_workflow_run_records
-- Purpose: SkyCommand control-plane metadata for Temporal workflow starts/actions.

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

ALTER TABLE worker.temporal_workflow_run_records OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS idx_temporal_run_records_execution_unique
  ON worker.temporal_workflow_run_records (namespace, workflow_id, COALESCE(temporal_run_id, ''));

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_code_created
  ON worker.temporal_workflow_run_records (workflow_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_status_created
  ON worker.temporal_workflow_run_records (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_run_records_workflow_id
  ON worker.temporal_workflow_run_records (workflow_id);

COMMENT ON TABLE worker.temporal_workflow_run_records IS 'SkyCommand-owned run index for Temporal workflow starts, action requests, and visibility snapshots.';
COMMENT ON COLUMN worker.temporal_workflow_run_records.launch_input IS 'Normalized input SkyCommand sent to the Temporal workflow start call.';
COMMENT ON COLUMN worker.temporal_workflow_run_records.last_seen_in_temporal_at IS 'Most recent time SkyCommand observed this execution in Temporal visibility or describe output.';
