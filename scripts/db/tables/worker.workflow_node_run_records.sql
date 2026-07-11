-- Table: worker.workflow_node_run_records
-- Purpose: Node-level execution ledger for workflow run detail, timeline, and playback UI.

CREATE TABLE IF NOT EXISTS worker.workflow_node_run_records (
  workflow_node_run_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE SET NULL,
  node_key TEXT NOT NULL,
  node_type_code TEXT NOT NULL,
  target_code TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_node_run_records_key_not_blank CHECK (btrim(node_key) <> ''),
  CONSTRAINT workflow_node_run_records_output_object CHECK (jsonb_typeof(output) = 'object'),
  CONSTRAINT workflow_node_run_records_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE worker.workflow_node_run_records OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_node_run_records_run_created
  ON worker.workflow_node_run_records (workflow_run_record_id, created_at);

COMMENT ON TABLE worker.workflow_node_run_records IS 'Node-level execution ledger for future workflow run detail, timeline, and playback UI.';
