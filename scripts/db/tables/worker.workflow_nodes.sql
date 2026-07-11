-- Table: worker.workflow_nodes
-- Purpose: Workflow graph nodes that reference composable primitives by type and target code.

CREATE TABLE IF NOT EXISTS worker.workflow_nodes (
  workflow_node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_version_id UUID NOT NULL REFERENCES worker.workflow_versions(workflow_version_id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type_code TEXT NOT NULL REFERENCES worker.workflow_node_types(node_type_code),
  display_name TEXT NOT NULL,
  description TEXT,
  target_code TEXT,
  target_ref_id UUID,
  target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms INTEGER CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  position_x INTEGER,
  position_y INTEGER,
  display_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_nodes_key_not_blank CHECK (btrim(node_key) <> ''),
  CONSTRAINT workflow_nodes_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT workflow_nodes_target_config_object CHECK (jsonb_typeof(target_config) = 'object'),
  CONSTRAINT workflow_nodes_input_parameters_object CHECK (jsonb_typeof(input_parameters) = 'object'),
  CONSTRAINT workflow_nodes_retry_policy_object CHECK (jsonb_typeof(retry_policy) = 'object'),
  CONSTRAINT workflow_nodes_config_object CHECK (jsonb_typeof(config) = 'object'),
  UNIQUE (workflow_version_id, node_key)
);

ALTER TABLE worker.workflow_nodes OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_version_order
  ON worker.workflow_nodes (workflow_version_id, display_order, node_key);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_type_target
  ON worker.workflow_nodes (node_type_code, target_code);

COMMENT ON TABLE worker.workflow_nodes IS 'Workflow graph nodes. Node type + target_code lets tools, APIs, agents, child workflows, and Temporal templates remain primitives.';
COMMENT ON COLUMN worker.workflow_nodes.target_code IS 'Stable target code interpreted by node_type_code. Example TOOL target: core.tools.tool_code = ingestion_fred.';
