-- Migration: 00133__capability_catalog_export_and_workflow_integration.sql
-- Purpose: Register the read-only Capability Catalogue exporter and publish
--          immutable R1 graph versions for the live repository/promotion
--          workflows. Existing versions and execution history remain intact.

INSERT INTO auth.permissions (
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
)
VALUES (
  (SELECT app_id FROM core.applications WHERE app_code = 'SKYSERVER_ADMIN' AND active = TRUE LIMIT 1),
  'CAPABILITY_CATALOG_EXPORT',
  'files',
  'export_capability_catalog',
  'Read the live capability catalogue and write the fixed generated JSON and XLSX snapshots.',
  TRUE
)
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
CROSS JOIN auth.permissions p
WHERE r.role_code IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  AND p.permission_code = 'CAPABILITY_CATALOG_EXPORT'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

INSERT INTO core.tools (
  category_id,
  tool_code,
  name,
  label,
  description,
  script_repo_id,
  script_path,
  runtime_code,
  permission_code,
  risk_code,
  requires_confirmation,
  confirmation_text,
  captures_output,
  allow_params,
  display_order,
  enabled,
  output_type,
  output_schema_path,
  managed_by_skycommand
)
SELECT c.category_id,
       'capability_catalog_export',
       'capabilityCatalogExport',
       'Export Capability Catalogue',
       'Reads the live SkyCommand PostgreSQL capability catalogue in a read-only transaction and writes the fixed generated JSON and XLSX snapshots under docs/generated/.',
       r.repo_id,
       'scripts/capabilityCatalogExport.js',
       'node',
       'CAPABILITY_CATALOG_EXPORT',
       'low',
       FALSE,
       NULL,
       TRUE,
       FALSE,
       30,
       TRUE,
       'capability_catalog_summary.v1',
       'packages/capability-catalog/contracts/capability_catalog_summary.v1.schema.json',
       FALSE
FROM core.applications a
JOIN core.tool_categories c
  ON c.app_id = a.app_id
JOIN core.repositories r
  ON r.repo_code = 'SkyCommand'
 AND r.active = TRUE
WHERE a.app_code = 'SKYSERVER_CORE'
  AND a.active = TRUE
  AND c.category_code = 'file_tools'
  AND c.enabled = TRUE
ON CONFLICT (tool_code)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  script_repo_id = EXCLUDED.script_repo_id,
  script_path = EXCLUDED.script_path,
  runtime_code = EXCLUDED.runtime_code,
  permission_code = EXCLUDED.permission_code,
  risk_code = EXCLUDED.risk_code,
  requires_confirmation = EXCLUDED.requires_confirmation,
  confirmation_text = EXCLUDED.confirmation_text,
  captures_output = EXCLUDED.captures_output,
  allow_params = EXCLUDED.allow_params,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  output_type = EXCLUDED.output_type,
  output_schema_path = EXCLUDED.output_schema_path,
  managed_by_skycommand = EXCLUDED.managed_by_skycommand,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT t.tool_id, v.channel_code
FROM core.tools t
CROSS JOIN (VALUES ('cli'), ('admin-web'), ('api'), ('worker')) AS v(channel_code)
WHERE t.tool_code = 'capability_catalog_export'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

SELECT 1 / NULLIF(1 - SIGN(COUNT(*)), 0)
FROM core.tool_parameters p
JOIN core.tools t ON t.tool_id = p.tool_id
WHERE t.tool_code = 'capability_catalog_export';

WITH latest AS (
  SELECT DISTINCT ON (d.workflow_definition_id)
         d.workflow_definition_id,
         v.workflow_version_id,
         v.version_number,
         d.updated_by_user_id,
         v.created_by_user_id,
         v.published_by_user_id,
         v.graph_version
  FROM worker.workflow_definitions d
  JOIN worker.workflow_versions v
    ON v.workflow_definition_id = d.workflow_definition_id
   AND v.status = 'PUBLISHED'
  WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
    AND d.status = 'ACTIVE'
    AND d.enabled = TRUE
  ORDER BY d.workflow_definition_id, v.version_number DESC
),
guards AS (
  SELECT 1 / NULLIF(1 - SIGN(ABS((SELECT COUNT(*) FROM latest) - 3)), 0) AS source_guard,
         1 / NULLIF(1 - SIGN((
           SELECT COUNT(*)
           FROM latest l
           JOIN worker.workflow_versions existing
             ON existing.workflow_definition_id = l.workflow_definition_id
            AND existing.version_number = l.version_number + 1
         )), 0) AS target_guard
)
INSERT INTO worker.workflow_versions (
  workflow_definition_id,
  version_number,
  version_label,
  status,
  graph_version,
  definition_snapshot,
  created_by_user_id,
  published_by_user_id,
  published_at,
  created_at,
  updated_at
)
SELECT l.workflow_definition_id,
       l.version_number + 1,
       format('R1 Capability Catalogue export v%s', l.version_number + 1),
       'PUBLISHED',
       l.graph_version,
       '{}'::jsonb,
       COALESCE(l.updated_by_user_id, l.created_by_user_id),
       COALESCE(l.updated_by_user_id, l.published_by_user_id, l.created_by_user_id),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM latest l
CROSS JOIN guards g;

INSERT INTO worker.workflow_nodes (
  workflow_version_id,
  node_key,
  node_type_code,
  display_name,
  description,
  target_code,
  target_ref_id,
  target_config,
  input_parameters,
  retry_policy,
  timeout_ms,
  position_x,
  position_y,
  display_order,
  enabled,
  config
)
SELECT new_version.workflow_version_id,
       old_node.node_key,
       old_node.node_type_code,
       old_node.display_name,
       old_node.description,
       old_node.target_code,
       old_node.target_ref_id,
       old_node.target_config,
       old_node.input_parameters,
       old_node.retry_policy,
       old_node.timeout_ms,
       old_node.position_x,
       old_node.position_y,
       old_node.display_order,
       old_node.enabled,
       old_node.config
FROM worker.workflow_versions old_version
JOIN worker.workflow_versions new_version
  ON new_version.workflow_definition_id = old_version.workflow_definition_id
 AND new_version.version_number = old_version.version_number + 1
 AND new_version.version_label LIKE 'R1 Capability Catalogue export v%'
JOIN worker.workflow_nodes old_node
  ON old_node.workflow_version_id = old_version.workflow_version_id
WHERE old_version.status = 'PUBLISHED';

INSERT INTO worker.workflow_nodes (
  workflow_version_id,
  node_key,
  node_type_code,
  display_name,
  description,
  target_code,
  target_ref_id,
  target_config,
  input_parameters,
  retry_policy,
  timeout_ms,
  display_order,
  enabled,
  config
)
SELECT v.workflow_version_id,
       'capability_catalog_node',
       'TOOL',
       'Export Capability Catalogue',
       'Refresh the redacted JSON/XLSX capability snapshots before packaging.',
       'capability_catalog_export',
       t.tool_id,
       '{}'::jsonb,
       '{}'::jsonb,
       jsonb_build_object('maximumAttempts', 1, 'initialIntervalSeconds', 5),
       600000,
       CASE WHEN d.workflow_code = 'skycommand-dev-promo-alt' THEN 15 ELSE 5 END,
       TRUE,
       jsonb_build_object('createdBy', '00133_r1_capability_catalog')
FROM worker.workflow_versions v
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
JOIN core.tools t
  ON t.tool_code = 'capability_catalog_export'
WHERE v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

INSERT INTO worker.workflow_edges (
  workflow_version_id,
  edge_key,
  from_node_id,
  to_node_id,
  edge_type,
  condition_expression,
  display_order,
  config
)
SELECT new_version.workflow_version_id,
       old_edge.edge_key,
       new_from.workflow_node_id,
       new_to.workflow_node_id,
       old_edge.edge_type,
       old_edge.condition_expression,
       old_edge.display_order,
       old_edge.config
FROM worker.workflow_edges old_edge
JOIN worker.workflow_versions old_version
  ON old_version.workflow_version_id = old_edge.workflow_version_id
JOIN worker.workflow_versions new_version
  ON new_version.workflow_definition_id = old_version.workflow_definition_id
 AND new_version.version_number = old_version.version_number + 1
 AND new_version.version_label LIKE 'R1 Capability Catalogue export v%'
JOIN worker.workflow_nodes old_from
  ON old_from.workflow_node_id = old_edge.from_node_id
JOIN worker.workflow_nodes old_to
  ON old_to.workflow_node_id = old_edge.to_node_id
JOIN worker.workflow_nodes new_from
  ON new_from.workflow_version_id = new_version.workflow_version_id
 AND new_from.node_key = old_from.node_key
JOIN worker.workflow_nodes new_to
  ON new_to.workflow_version_id = new_version.workflow_version_id
 AND new_to.node_key = old_to.node_key
WHERE old_version.status = 'PUBLISHED'
  AND NOT (
    EXISTS (
      SELECT 1
      FROM worker.workflow_definitions d
      WHERE d.workflow_definition_id = old_version.workflow_definition_id
        AND d.workflow_code = 'skycommand-dev-promo-alt'
    )
    AND old_from.node_key = 'local_dev_pull_node'
    AND old_to.node_key = 'repo_map_node'
  );

INSERT INTO worker.workflow_edges (
  workflow_version_id,
  edge_key,
  from_node_id,
  to_node_id,
  edge_type,
  display_order,
  config
)
SELECT v.workflow_version_id,
       'local_dev_pull_node_to_capability_catalog_node',
       pull_node.workflow_node_id,
       catalog_node.workflow_node_id,
       'SEQUENTIAL',
       15,
       jsonb_build_object('createdBy', '00133_r1_capability_catalog')
FROM worker.workflow_versions v
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
JOIN worker.workflow_nodes pull_node
  ON pull_node.workflow_version_id = v.workflow_version_id
 AND pull_node.node_key = 'local_dev_pull_node'
JOIN worker.workflow_nodes catalog_node
  ON catalog_node.workflow_version_id = v.workflow_version_id
 AND catalog_node.node_key = 'capability_catalog_node'
WHERE d.workflow_code = 'skycommand-dev-promo-alt'
  AND v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

INSERT INTO worker.workflow_edges (
  workflow_version_id,
  edge_key,
  from_node_id,
  to_node_id,
  edge_type,
  display_order,
  config
)
SELECT v.workflow_version_id,
       'capability_catalog_node_to_repo_map_node',
       catalog_node.workflow_node_id,
       map_node.workflow_node_id,
       'SEQUENTIAL',
       CASE WHEN d.workflow_code = 'skycommand-dev-promo-alt' THEN 20 ELSE 5 END,
       jsonb_build_object('createdBy', '00133_r1_capability_catalog')
FROM worker.workflow_versions v
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
JOIN worker.workflow_nodes catalog_node
  ON catalog_node.workflow_version_id = v.workflow_version_id
 AND catalog_node.node_key = 'capability_catalog_node'
JOIN worker.workflow_nodes map_node
  ON map_node.workflow_version_id = v.workflow_version_id
 AND map_node.node_key = 'repo_map_node'
WHERE v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

UPDATE worker.workflow_versions old_version
SET status = 'RETIRED',
    updated_at = CURRENT_TIMESTAMP
WHERE old_version.status = 'PUBLISHED'
  AND old_version.version_label NOT LIKE 'R1 Capability Catalogue export v%'
  AND old_version.workflow_definition_id IN (
    SELECT d.workflow_definition_id
    FROM worker.workflow_definitions d
    WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
  );

UPDATE worker.workflow_versions v
SET definition_snapshot = jsonb_build_object(
      'workflowCode', d.workflow_code,
      'displayName', d.display_name,
      'description', d.description,
      'status', 'PUBLISHED',
      'graphVersion', v.graph_version,
      'nodes', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'nodeKey', n.node_key,
            'nodeTypeCode', n.node_type_code,
            'displayName', n.display_name,
            'targetCode', n.target_code,
            'displayOrder', n.display_order
          ) ORDER BY n.display_order, n.node_key
        )
        FROM worker.workflow_nodes n
        WHERE n.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'edges', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'edgeKey', e.edge_key,
            'fromNodeKey', from_node.node_key,
            'toNodeKey', to_node.node_key,
            'edgeType', e.edge_type,
            'conditionExpression', e.condition_expression,
            'displayOrder', e.display_order,
            'config', e.config
          ) ORDER BY e.display_order, e.edge_key
        )
        FROM worker.workflow_edges e
        JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
        JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
        WHERE e.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'integration', jsonb_build_object(
        'migration', '00133',
        'feature', 'capability_catalog_export',
        'publishedAt', CURRENT_TIMESTAMP
      )
    ),
    updated_at = CURRENT_TIMESTAMP
FROM worker.workflow_definitions d
WHERE d.workflow_definition_id = v.workflow_definition_id
  AND v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

UPDATE worker.workflow_definitions d
SET config = COALESCE(d.config, '{}'::jsonb) || jsonb_build_object(
      'capabilityCatalogExportIntegrated', TRUE,
      'capabilityCatalogExportVersion', v.version_number
    ),
    updated_at = CURRENT_TIMESTAMP
FROM worker.workflow_versions v
WHERE v.workflow_definition_id = d.workflow_definition_id
  AND v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

SELECT 1 / NULLIF(1 - SIGN(ABS(COUNT(*) - 1)), 0)
FROM core.tools
WHERE tool_code = 'capability_catalog_export';

SELECT 1 / NULLIF(1 - SIGN(COUNT(*)), 0)
FROM core.tool_parameters p
JOIN core.tools t ON t.tool_id = p.tool_id
WHERE t.tool_code = 'capability_catalog_export';

SELECT 1 / NULLIF(1 - SIGN(ABS(COUNT(*) - 3)), 0)
FROM worker.workflow_versions v
JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = v.workflow_definition_id
WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
  AND v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%';

SELECT 1 / NULLIF(1 - SIGN(COUNT(*)), 0)
FROM worker.workflow_edges e
JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
JOIN worker.workflow_versions v ON v.workflow_version_id = e.workflow_version_id
WHERE v.status = 'PUBLISHED'
  AND v.version_label LIKE 'R1 Capability Catalogue export v%'
  AND from_node.node_key = 'capability_catalog_node'
  AND to_node.node_key = 'repo_map_node';
