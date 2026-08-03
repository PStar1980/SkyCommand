-- Table: worker.workflow_run_records
-- Purpose: SkyCommand workflow run ledger for the workflow executor.

CREATE TABLE IF NOT EXISTS worker.workflow_run_records (
  workflow_run_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id UUID REFERENCES worker.workflow_definitions(workflow_definition_id) ON DELETE SET NULL,
  workflow_version_id UUID REFERENCES worker.workflow_versions(workflow_version_id) ON DELETE SET NULL,
  workflow_code TEXT NOT NULL,
  version_number INTEGER,
  run_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (run_source IN ('manual', 'api', 'scheduler', 'listener', 'child_workflow', 'system')),
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (trigger_type IN ('MANUAL', 'API', 'SCHEDULER', 'LISTENER', 'CHILD_WORKFLOW', 'SYSTEM')),
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED')),
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  started_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_run_records_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT workflow_run_records_input_object CHECK (jsonb_typeof(input) = 'object'),
  CONSTRAINT workflow_run_records_request_context_object CHECK (jsonb_typeof(request_context) = 'object'),
  CONSTRAINT workflow_run_records_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE worker.workflow_run_records OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_run_records_code_created
  ON worker.workflow_run_records (workflow_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_records_status_created
  ON worker.workflow_run_records (status, created_at DESC);

COMMENT ON TABLE worker.workflow_run_records IS 'SkyCommand workflow run ledger for the future workflow executor. Separate from worker.temporal_workflow_run_records.';
