-- View: worker.vw_workflow_nodes
-- Purpose: Workflow nodes joined to definition, version, and node type metadata.

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

ALTER VIEW worker.vw_workflow_nodes OWNER TO postgres;

COMMENT ON VIEW worker.vw_workflow_nodes IS 'Workflow nodes joined to definition, version, and node type metadata.';
