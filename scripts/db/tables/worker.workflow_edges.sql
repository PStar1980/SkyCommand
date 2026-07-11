-- Table: worker.workflow_edges
-- Purpose: Directed graph edges between workflow nodes.

CREATE TABLE IF NOT EXISTS worker.workflow_edges (
  workflow_edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_version_id UUID NOT NULL REFERENCES worker.workflow_versions(workflow_version_id) ON DELETE CASCADE,
  edge_key TEXT,
  from_node_id UUID NOT NULL REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL DEFAULT 'SEQUENTIAL'
    CHECK (edge_type IN ('SEQUENTIAL', 'CONDITIONAL', 'PARALLEL', 'ERROR', 'ALWAYS')),
  condition_expression TEXT,
  display_order INTEGER NOT NULL DEFAULT 100,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_edges_no_self_loop CHECK (from_node_id <> to_node_id),
  CONSTRAINT workflow_edges_config_object CHECK (jsonb_typeof(config) = 'object'),
  UNIQUE (workflow_version_id, from_node_id, to_node_id, edge_type)
);

ALTER TABLE worker.workflow_edges OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_edges_version_order
  ON worker.workflow_edges (workflow_version_id, display_order);

COMMENT ON TABLE worker.workflow_edges IS 'Directed graph edges between workflow nodes. Starts with sequential execution but allows branching later.';
