CREATE TABLE IF NOT EXISTS worker.workflow_run_node_outputs (
  workflow_run_node_output_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  workflow_node_run_record_id UUID REFERENCES worker.workflow_node_run_records(workflow_node_run_record_id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE SET NULL,
  node_key TEXT NOT NULL,
  node_type_code TEXT,
  target_code TEXT,
  output_key TEXT NOT NULL DEFAULT 'result',
  output_type TEXT NOT NULL DEFAULT 'object'
    CHECK (output_type IN ('object', 'array', 'string', 'number', 'boolean', 'null', 'unknown')),
  input_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary TEXT,
  status TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_run_node_outputs_node_key_not_blank CHECK (btrim(node_key) <> ''),
  CONSTRAINT workflow_run_node_outputs_output_key_not_blank CHECK (btrim(output_key) <> ''),
  CONSTRAINT workflow_run_node_outputs_input_snapshot_object CHECK (jsonb_typeof(input_snapshot_json) = 'object'),
  CONSTRAINT workflow_run_node_outputs_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (workflow_node_run_record_id, output_key)
);
