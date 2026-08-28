-- View: worker.vw_workflow_definitions
-- Purpose: SkyCommand workflow definitions with version and graph summary counts.

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
  COALESCE(published_counts.edge_count, 0) AS published_edge_count,
  d.workflow_category_id,
  category.category_code,
  category.display_name AS category_display_name,
  category.description AS category_description,
  category.display_order AS category_display_order,
  category.enabled AS category_enabled
FROM worker.workflow_definitions d
JOIN worker.workflow_categories category
  ON category.workflow_category_id = d.workflow_category_id
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

ALTER VIEW worker.vw_workflow_definitions OWNER TO postgres;

COMMENT ON VIEW worker.vw_workflow_definitions IS 'SkyCommand workflow definitions with category metadata, version counts, and graph summary counts.';
