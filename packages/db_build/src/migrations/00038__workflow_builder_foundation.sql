-- ============================================================
-- Migration: 00038__workflow_builder_foundation.sql
-- Purpose:
-- Adds SkyServer workflow-builder metadata tables. These tables
-- model user/config-defined workflows as graphs of nodes while
-- keeping tools, APIs, agents, and child workflows as lower-level
-- composable primitives.
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

-- Node type registry. This is the palette used by the future builder UI.
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

DROP TRIGGER IF EXISTS workflow_node_types_set_updated_at ON worker.workflow_node_types;
CREATE TRIGGER workflow_node_types_set_updated_at
BEFORE UPDATE ON worker.workflow_node_types
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_node_types IS 'Workflow-builder node palette. Examples: TOOL, API_CALL, AGENT, WORKFLOW, TEMPORAL_WORKFLOW, CONDITION, WAIT.';
COMMENT ON COLUMN worker.workflow_node_types.target_kind IS 'Optional target category, such as core.tools, worker.workflow_definitions, or worker.temporal_workflow_definitions.';

-- SkyServer workflow definition: the user-facing orchestration container.
CREATE TABLE IF NOT EXISTS worker.workflow_definitions (
  workflow_definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  visible_in_admin BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  start_permission_code TEXT,
  cancel_permission_code TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_definitions_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT workflow_definitions_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT workflow_definitions_config_object CHECK (jsonb_typeof(config) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_status_enabled
  ON worker.workflow_definitions (status, enabled, visible_in_admin, workflow_code);

DROP TRIGGER IF EXISTS workflow_definitions_set_updated_at ON worker.workflow_definitions;
CREATE TRIGGER workflow_definitions_set_updated_at
BEFORE UPDATE ON worker.workflow_definitions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_definitions IS 'SkyServer workflow definitions. These are user/config-defined orchestration graphs, not raw Temporal workflow types.';

-- Versioned graph snapshots. Editing happens on draft versions; published versions are runnable.
CREATE TABLE IF NOT EXISTS worker.workflow_versions (
  workflow_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id UUID NOT NULL REFERENCES worker.workflow_definitions(workflow_definition_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  version_label TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  graph_version TEXT NOT NULL DEFAULT '1.0',
  definition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  published_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_versions_snapshot_object CHECK (jsonb_typeof(definition_snapshot) = 'object'),
  UNIQUE (workflow_definition_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_definition_status
  ON worker.workflow_versions (workflow_definition_id, status, version_number DESC);

DROP TRIGGER IF EXISTS workflow_versions_set_updated_at ON worker.workflow_versions;
CREATE TRIGGER workflow_versions_set_updated_at
BEFORE UPDATE ON worker.workflow_versions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_versions IS 'Versioned SkyServer workflow graphs. Runnable workflows should point at a published version.';

-- Workflow nodes. A node references a primitive by type + target_code.
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

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_version_order
  ON worker.workflow_nodes (workflow_version_id, display_order, node_key);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_type_target
  ON worker.workflow_nodes (node_type_code, target_code);

DROP TRIGGER IF EXISTS workflow_nodes_set_updated_at ON worker.workflow_nodes;
CREATE TRIGGER workflow_nodes_set_updated_at
BEFORE UPDATE ON worker.workflow_nodes
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_nodes IS 'Workflow graph nodes. Node type + target_code lets tools, APIs, agents, child workflows, and Temporal templates remain primitives.';
COMMENT ON COLUMN worker.workflow_nodes.target_code IS 'Stable target code interpreted by node_type_code. Example TOOL target: core.tools.tool_code = ingestion_fred.';

-- Workflow edges. Sequential now, branch/condition later.
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

CREATE INDEX IF NOT EXISTS idx_workflow_edges_version_order
  ON worker.workflow_edges (workflow_version_id, display_order);

DROP TRIGGER IF EXISTS workflow_edges_set_updated_at ON worker.workflow_edges;
CREATE TRIGGER workflow_edges_set_updated_at
BEFORE UPDATE ON worker.workflow_edges
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_edges IS 'Directed graph edges between workflow nodes. Starts with sequential execution but allows branching later.';

-- Workflow run records for the future SkyServer workflow executor.
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

CREATE INDEX IF NOT EXISTS idx_workflow_run_records_code_created
  ON worker.workflow_run_records (workflow_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_run_records_status_created
  ON worker.workflow_run_records (status, created_at DESC);

DROP TRIGGER IF EXISTS workflow_run_records_set_updated_at ON worker.workflow_run_records;
CREATE TRIGGER workflow_run_records_set_updated_at
BEFORE UPDATE ON worker.workflow_run_records
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_run_records IS 'SkyServer workflow run ledger for the future workflow executor. Separate from worker.temporal_workflow_run_records.';

-- Node-level run records for future timeline/playback UI.
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

CREATE INDEX IF NOT EXISTS idx_workflow_node_run_records_run_created
  ON worker.workflow_node_run_records (workflow_run_record_id, created_at);

DROP TRIGGER IF EXISTS workflow_node_run_records_set_updated_at ON worker.workflow_node_run_records;
CREATE TRIGGER workflow_node_run_records_set_updated_at
BEFORE UPDATE ON worker.workflow_node_run_records
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_node_run_records IS 'Node-level execution ledger for future workflow run detail, timeline, and playback UI.';

-- Definition summary view for Admin/API.
CREATE OR REPLACE VIEW worker.vw_workflow_definitions AS
WITH version_counts AS (
  SELECT
    workflow_definition_id,
    COUNT(*)::INTEGER AS version_count,
    MAX(version_number) AS latest_version_number,
    MAX(version_number) FILTER (WHERE status = 'PUBLISHED') AS published_version_number
  FROM worker.workflow_versions
  GROUP BY workflow_definition_id
), graph_counts AS (
  SELECT
    v.workflow_definition_id,
    v.workflow_version_id,
    COUNT(DISTINCT n.workflow_node_id)::INTEGER AS node_count,
    COUNT(DISTINCT e.workflow_edge_id)::INTEGER AS edge_count
  FROM worker.workflow_versions v
  LEFT JOIN worker.workflow_nodes n
    ON n.workflow_version_id = v.workflow_version_id
  LEFT JOIN worker.workflow_edges e
    ON e.workflow_version_id = v.workflow_version_id
  GROUP BY v.workflow_definition_id, v.workflow_version_id
)
SELECT
  d.workflow_definition_id,
  d.workflow_code,
  d.display_name,
  d.description,
  d.status,
  d.visible_in_admin,
  d.enabled,
  d.start_permission_code,
  d.cancel_permission_code,
  d.config,
  d.created_by_user_id,
  creator.email AS created_by_email,
  creator.display_name AS created_by_display_name,
  d.updated_by_user_id,
  updater.email AS updated_by_email,
  updater.display_name AS updated_by_display_name,
  d.created_at,
  d.updated_at,
  COALESCE(vc.version_count, 0) AS version_count,
  vc.latest_version_number,
  vc.published_version_number,
  latest.workflow_version_id AS latest_version_id,
  published.workflow_version_id AS published_version_id,
  COALESCE(latest_counts.node_count, 0) AS latest_node_count,
  COALESCE(latest_counts.edge_count, 0) AS latest_edge_count,
  COALESCE(published_counts.node_count, 0) AS published_node_count,
  COALESCE(published_counts.edge_count, 0) AS published_edge_count
FROM worker.workflow_definitions d
LEFT JOIN version_counts vc
  ON vc.workflow_definition_id = d.workflow_definition_id
LEFT JOIN worker.workflow_versions latest
  ON latest.workflow_definition_id = d.workflow_definition_id
 AND latest.version_number = vc.latest_version_number
LEFT JOIN worker.workflow_versions published
  ON published.workflow_definition_id = d.workflow_definition_id
 AND published.version_number = vc.published_version_number
LEFT JOIN graph_counts latest_counts
  ON latest_counts.workflow_version_id = latest.workflow_version_id
LEFT JOIN graph_counts published_counts
  ON published_counts.workflow_version_id = published.workflow_version_id
LEFT JOIN auth.users creator
  ON creator.user_id = d.created_by_user_id
LEFT JOIN auth.users updater
  ON updater.user_id = d.updated_by_user_id;

COMMENT ON VIEW worker.vw_workflow_definitions IS 'SkyServer workflow definitions with version and graph summary counts.';

CREATE OR REPLACE VIEW worker.vw_workflow_nodes AS
SELECT
  d.workflow_definition_id,
  d.workflow_code,
  d.display_name AS workflow_display_name,
  v.workflow_version_id,
  v.version_number,
  v.status AS version_status,
  n.workflow_node_id,
  n.node_key,
  n.node_type_code,
  nt.display_name AS node_type_display_name,
  nt.category AS node_type_category,
  nt.target_kind,
  n.display_name,
  n.description,
  n.target_code,
  n.target_ref_id,
  n.target_config,
  n.input_parameters,
  n.retry_policy,
  n.timeout_ms,
  n.position_x,
  n.position_y,
  n.display_order,
  n.enabled,
  n.config,
  n.created_at,
  n.updated_at
FROM worker.workflow_nodes n
JOIN worker.workflow_versions v
  ON v.workflow_version_id = n.workflow_version_id
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
JOIN worker.workflow_node_types nt
  ON nt.node_type_code = n.node_type_code;

COMMENT ON VIEW worker.vw_workflow_nodes IS 'Workflow nodes joined to definition, version, and node type metadata.';

CREATE OR REPLACE VIEW worker.vw_workflow_run_records AS
SELECT
  r.workflow_run_record_id,
  r.workflow_definition_id,
  d.workflow_code AS definition_workflow_code,
  d.display_name AS workflow_display_name,
  r.workflow_version_id,
  v.version_number AS definition_version_number,
  r.workflow_code,
  r.version_number,
  r.run_source,
  r.trigger_type,
  r.status,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.input,
  r.request_context,
  r.summary,
  r.started_by_user_id,
  u.email AS started_by_email,
  u.display_name AS started_by_display_name,
  r.started_at,
  r.completed_at,
  r.metadata,
  r.created_at,
  r.updated_at
FROM worker.workflow_run_records r
LEFT JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = r.workflow_definition_id
LEFT JOIN worker.workflow_versions v
  ON v.workflow_version_id = r.workflow_version_id
LEFT JOIN auth.users u
  ON u.user_id = r.started_by_user_id;

COMMENT ON VIEW worker.vw_workflow_run_records IS 'SkyServer workflow run records joined to user and workflow metadata.';
