CREATE TABLE IF NOT EXISTS worker.workflow_run_context_values (
  workflow_run_context_value_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  context_key TEXT NOT NULL,
  value_json JSONB NOT NULL DEFAULT 'null'::jsonb,
  value_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (value_type IN ('object', 'array', 'string', 'number', 'boolean', 'null', 'unknown')),
  source_node_key TEXT,
  source_node_run_record_id UUID REFERENCES worker.workflow_node_run_records(workflow_node_run_record_id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_run_context_values_key_not_blank CHECK (btrim(context_key) <> ''),
  CONSTRAINT workflow_run_context_values_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (workflow_run_record_id, context_key)
);
