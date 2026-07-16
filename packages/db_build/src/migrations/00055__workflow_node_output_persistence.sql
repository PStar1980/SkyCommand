-- ============================================================
-- Migration: 00055__workflow_node_output_persistence.sql
-- Purpose:
-- Adds durable node-output and workflow-context storage for the
-- Phase 13 live workflow intelligence layer. Existing
-- worker.workflow_node_run_records remain the execution ledger;
-- these tables preserve structured outputs and context values in
-- queryable, versioned rows for Workflow History, telemetry, and
-- future parameter/context-aware workflow nodes.
-- ============================================================

BEGIN;

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

CREATE TABLE IF NOT EXISTS worker.workflow_run_node_outputs (
  workflow_run_node_output_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  workflow_node_run_record_id UUID REFERENCES worker.workflow_node_run_records(workflow_node_run_record_id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE SET NULL,
  node_key TEXT NOT NULL,
  node_type_code TEXT,
  target_code TEXT,
  output_key TEXT NOT NULL DEFAULT 'result',
  output_type TEXT NOT NULL DEFAULT 'object',
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
  CONSTRAINT workflow_run_node_outputs_output_type_not_blank CHECK (btrim(output_type) <> ''),
  CONSTRAINT workflow_run_node_outputs_input_snapshot_object CHECK (jsonb_typeof(input_snapshot_json) = 'object'),
  CONSTRAINT workflow_run_node_outputs_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (workflow_node_run_record_id, output_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_run_node_outputs_run_node
  ON worker.workflow_run_node_outputs (workflow_run_record_id, node_key, output_key);

CREATE INDEX IF NOT EXISTS idx_workflow_run_node_outputs_run_created
  ON worker.workflow_run_node_outputs (workflow_run_record_id, created_at);

DROP TRIGGER IF EXISTS workflow_run_node_outputs_set_updated_at ON worker.workflow_run_node_outputs;
CREATE TRIGGER workflow_run_node_outputs_set_updated_at
BEFORE UPDATE ON worker.workflow_run_node_outputs
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_run_node_outputs IS 'Durable structured node-output ledger for SkyCommand Workflow History, telemetry, and future workflow context mapping.';
COMMENT ON COLUMN worker.workflow_run_node_outputs.output_key IS 'Stable output key for the node result, such as result, response, artifact, or summary.';
COMMENT ON COLUMN worker.workflow_run_node_outputs.output_type IS 'Structural JSON type for generic nodes or a versioned semantic result contract such as macro_ingestion_summary.v1.';
COMMENT ON COLUMN worker.workflow_run_node_outputs.input_snapshot_json IS 'Resolved input parameters captured when the node completed.';
COMMENT ON COLUMN worker.workflow_run_node_outputs.output_json IS 'Structured output payload returned by the node/tool/API/wrapper.';

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

CREATE INDEX IF NOT EXISTS idx_workflow_run_context_values_run_key
  ON worker.workflow_run_context_values (workflow_run_record_id, context_key);

CREATE INDEX IF NOT EXISTS idx_workflow_run_context_values_source_node
  ON worker.workflow_run_context_values (workflow_run_record_id, source_node_key);

DROP TRIGGER IF EXISTS workflow_run_context_values_set_updated_at ON worker.workflow_run_context_values;
CREATE TRIGGER workflow_run_context_values_set_updated_at
BEFORE UPDATE ON worker.workflow_run_context_values
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_run_context_values IS 'Durable workflow-run context key/value store used by future context-aware nodes, runtime parameters, output mapping, and telemetry panels.';
COMMENT ON COLUMN worker.workflow_run_context_values.context_key IS 'Stable workflow context key, such as params.repoName, node.generateRepoMap.fileCount, or temporalHealthy.';
COMMENT ON COLUMN worker.workflow_run_context_values.value_json IS 'JSON value available to future nodes and Workflow History context displays.';

CREATE OR REPLACE VIEW worker.vw_workflow_run_node_outputs AS
SELECT
  o.workflow_run_node_output_id,
  o.workflow_run_record_id,
  r.workflow_code,
  r.status AS workflow_status,
  o.workflow_node_run_record_id,
  o.workflow_node_id,
  o.node_key,
  o.node_type_code,
  o.target_code,
  o.output_key,
  o.output_type,
  o.input_snapshot_json,
  o.output_json,
  o.output_summary,
  o.status,
  o.attempt_count,
  o.metadata,
  o.created_at,
  o.updated_at
FROM worker.workflow_run_node_outputs o
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = o.workflow_run_record_id;

COMMENT ON VIEW worker.vw_workflow_run_node_outputs IS 'Structured node outputs joined to workflow run metadata for Workflow History and live telemetry.';

CREATE OR REPLACE VIEW worker.vw_workflow_run_context_values AS
SELECT
  c.workflow_run_context_value_id,
  c.workflow_run_record_id,
  r.workflow_code,
  r.status AS workflow_status,
  c.context_key,
  c.value_json,
  c.value_type,
  c.source_node_key,
  c.source_node_run_record_id,
  c.metadata,
  c.created_at,
  c.updated_at
FROM worker.workflow_run_context_values c
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = c.workflow_run_record_id;

COMMENT ON VIEW worker.vw_workflow_run_context_values IS 'Workflow run context values joined to workflow run metadata for future context-aware execution and telemetry.';

COMMIT;
