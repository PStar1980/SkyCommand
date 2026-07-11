-- Table: worker.workflow_node_types
-- Purpose: Workflow-builder node palette.

CREATE TABLE IF NOT EXISTS worker.workflow_node_types (
  node_type_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'ACTION',
  target_kind TEXT,
  icon TEXT,
  requires_target BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_node_types_code_not_blank CHECK (btrim(node_type_code) <> ''),
  CONSTRAINT workflow_node_types_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT workflow_node_types_category_valid CHECK (
    category IN ('ACTION', 'CONTROL', 'INTEGRATION', 'HUMAN', 'AI', 'WORKFLOW')
  ),
  CONSTRAINT workflow_node_types_config_object CHECK (jsonb_typeof(config) = 'object')
);

ALTER TABLE worker.workflow_node_types OWNER TO postgres;

COMMENT ON TABLE worker.workflow_node_types IS 'Workflow-builder node palette. Examples: TOOL, API_CALL, AGENT, WORKFLOW, TEMPORAL_WORKFLOW, CONDITION, WAIT.';
COMMENT ON COLUMN worker.workflow_node_types.target_kind IS 'Optional target category, such as core.tools, worker.workflow_definitions, or worker.temporal_workflow_definitions.';
