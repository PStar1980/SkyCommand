-- Migration: 00134__capability_catalog_r1_invariant_validation.sql
-- Purpose: Validate the applied R1 Capability Catalogue registration and
--          workflow integrations with explicit fail-closed control flow.
--          Migration 00133 remains immutable applied history.

DO $migration$
DECLARE
  tool_count INTEGER;
  permission_count INTEGER;
  parameter_count INTEGER;
  workflow_count INTEGER;
  catalog_node_count INTEGER;
  promotion_workflow_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO tool_count
  FROM core.tools
  WHERE tool_code = 'capability_catalog_export'
    AND enabled = TRUE;

  IF tool_count <> 1 THEN
    RAISE EXCEPTION
      '00134: expected exactly one enabled capability_catalog_export Tool, found %',
      tool_count;
  END IF;

  SELECT COUNT(*)
    INTO permission_count
  FROM auth.permissions
  WHERE permission_code = 'CAPABILITY_CATALOG_EXPORT'
    AND resource = 'files'
    AND action = 'export_capability_catalog'
    AND active = TRUE;

  IF permission_count <> 1 THEN
    RAISE EXCEPTION
      '00134: expected exactly one active CAPABILITY_CATALOG_EXPORT permission with the registered resource/action, found %',
      permission_count;
  END IF;

  SELECT COUNT(*)
    INTO parameter_count
  FROM core.tool_parameters p
  JOIN core.tools t
    ON t.tool_id = p.tool_id
  WHERE t.tool_code = 'capability_catalog_export';

  IF parameter_count <> 0 THEN
    RAISE EXCEPTION
      '00134: capability_catalog_export must have zero registered parameters, found %',
      parameter_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.tools
    WHERE tool_code = 'capability_catalog_export'
      AND (
        permission_code IS DISTINCT FROM 'CAPABILITY_CATALOG_EXPORT'
        OR output_type IS DISTINCT FROM 'capability_catalog_summary.v1'
        OR allow_params IS DISTINCT FROM FALSE
        OR requires_confirmation IS DISTINCT FROM FALSE
        OR runtime_code IS DISTINCT FROM 'node'
        OR script_path IS DISTINCT FROM 'scripts/capabilityCatalogExport.js'
        OR enabled IS DISTINCT FROM TRUE
      )
  ) THEN
    RAISE EXCEPTION
      '00134: capability_catalog_export Tool metadata does not match the accepted R1 contract';
  END IF;

  SELECT COUNT(*)
    INTO workflow_count
  FROM worker.workflow_definitions d
  JOIN worker.workflow_versions v
    ON v.workflow_definition_id = d.workflow_definition_id
   AND v.status = 'PUBLISHED'
   AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
  WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
    AND d.status = 'ACTIVE'
    AND d.enabled = TRUE;

  IF workflow_count <> 3 THEN
    RAISE EXCEPTION
      '00134: expected one published R1 Capability Catalogue version for each required workflow, found %',
      workflow_count;
  END IF;

  IF EXISTS (
    SELECT d.workflow_code
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions v
      ON v.workflow_definition_id = d.workflow_definition_id
     AND v.status = 'PUBLISHED'
     AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
    WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
    GROUP BY d.workflow_code
    HAVING COUNT(*) <> 1
  ) THEN
    RAISE EXCEPTION
      '00134: required workflow codes do not each have exactly one published R1 version';
  END IF;

  SELECT COUNT(*)
    INTO catalog_node_count
  FROM worker.workflow_definitions d
  JOIN worker.workflow_versions v
    ON v.workflow_definition_id = d.workflow_definition_id
   AND v.status = 'PUBLISHED'
   AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
  JOIN worker.workflow_nodes n
    ON n.workflow_version_id = v.workflow_version_id
   AND n.node_key = 'capability_catalog_node'
   AND n.node_type_code = 'TOOL'
   AND n.target_code = 'capability_catalog_export'
   AND n.enabled = TRUE
  WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
    AND d.status = 'ACTIVE'
    AND d.enabled = TRUE;

  IF catalog_node_count <> 3 THEN
    RAISE EXCEPTION
      '00134: expected one enabled Capability Catalogue node in each required R1 workflow, found %',
      catalog_node_count;
  END IF;

  IF EXISTS (
    SELECT d.workflow_code
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions v
      ON v.workflow_definition_id = d.workflow_definition_id
     AND v.status = 'PUBLISHED'
     AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
    LEFT JOIN worker.workflow_nodes n
      ON n.workflow_version_id = v.workflow_version_id
     AND n.node_key = 'capability_catalog_node'
     AND n.node_type_code = 'TOOL'
     AND n.target_code = 'capability_catalog_export'
     AND n.enabled = TRUE
    WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
    GROUP BY d.workflow_code, v.workflow_version_id
    HAVING COUNT(n.workflow_node_id) <> 1
  ) THEN
    RAISE EXCEPTION
      '00134: required workflow versions do not each contain exactly one enabled Capability Catalogue node';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions v
      ON v.workflow_definition_id = d.workflow_definition_id
     AND v.status = 'PUBLISHED'
     AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
    WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM worker.workflow_nodes catalog_node
        JOIN worker.workflow_nodes map_node
          ON map_node.workflow_version_id = v.workflow_version_id
         AND map_node.node_key = 'repo_map_node'
         AND map_node.enabled = TRUE
         AND catalog_node.display_order < map_node.display_order
        JOIN worker.workflow_nodes zip_node
          ON zip_node.workflow_version_id = v.workflow_version_id
         AND zip_node.node_key = 'repo_zip_node'
         AND zip_node.enabled = TRUE
         AND map_node.display_order < zip_node.display_order
        WHERE catalog_node.workflow_version_id = v.workflow_version_id
          AND catalog_node.node_key = 'capability_catalog_node'
          AND catalog_node.enabled = TRUE
      )
  ) THEN
    RAISE EXCEPTION
      '00134: Capability Catalogue must be ordered before Repository Map and Repository Zip in every required R1 workflow';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions v
      ON v.workflow_definition_id = d.workflow_definition_id
     AND v.status = 'PUBLISHED'
     AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
    JOIN worker.workflow_nodes catalog_node
      ON catalog_node.workflow_version_id = v.workflow_version_id
     AND catalog_node.node_key = 'capability_catalog_node'
    JOIN worker.workflow_nodes map_node
      ON map_node.workflow_version_id = v.workflow_version_id
     AND map_node.node_key = 'repo_map_node'
    JOIN worker.workflow_nodes zip_node
      ON zip_node.workflow_version_id = v.workflow_version_id
     AND zip_node.node_key = 'repo_zip_node'
    WHERE d.workflow_code IN ('repo-map-zip', 'skycommand-dev-promo-alt', 'skyserver_dev_commit')
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
      AND (
        NOT EXISTS (
          SELECT 1
          FROM worker.workflow_edges e
          WHERE e.workflow_version_id = v.workflow_version_id
            AND e.from_node_id = catalog_node.workflow_node_id
            AND e.to_node_id = map_node.workflow_node_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM worker.workflow_edges e
          WHERE e.workflow_version_id = v.workflow_version_id
            AND e.from_node_id = map_node.workflow_node_id
            AND e.to_node_id = zip_node.workflow_node_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      '00134: R1 workflow graph must connect Capability Catalogue to Repository Map and Repository Map to Repository Zip';
  END IF;

  SELECT COUNT(*)
    INTO promotion_workflow_count
  FROM worker.workflow_definitions
  WHERE workflow_code IN ('skycommand-dev-promo-alt', 'skyserver_dev_commit')
    AND status = 'ACTIVE'
    AND enabled = TRUE;

  IF promotion_workflow_count <> 2 THEN
    RAISE EXCEPTION
      '00134: expected both active Development Promotion workflow variants, found %',
      promotion_workflow_count;
  END IF;

  IF EXISTS (
    WITH expected_nodes(workflow_code, node_key) AS (
      VALUES
        ('skycommand-dev-promo-alt', 'local_dev_pull_node'),
        ('skycommand-dev-promo-alt', 'capability_catalog_node'),
        ('skycommand-dev-promo-alt', 'repo_map_node'),
        ('skycommand-dev-promo-alt', 'repo_zip_node'),
        ('skycommand-dev-promo-alt', 'dev_commit_node'),
        ('skycommand-dev-promo-alt', 'merge_approval_node'),
        ('skycommand-dev-promo-alt', 'merge_sync_node'),
        ('skycommand-dev-promo-alt', 'local_repo_sync_node'),
        ('skycommand-dev-promo-alt', 'dev_promotion_summary'),
        ('skyserver_dev_commit', 'capability_catalog_node'),
        ('skyserver_dev_commit', 'repo_map_node'),
        ('skyserver_dev_commit', 'repo_zip_node'),
        ('skyserver_dev_commit', 'dev_commit_node'),
        ('skyserver_dev_commit', 'merge_approval_node'),
        ('skyserver_dev_commit', 'merge_sync_node'),
        ('skyserver_dev_commit', 'local_repo_sync_node'),
        ('skyserver_dev_commit', 'dev_promotion_summary')
    ),
    intended AS (
      SELECT d.workflow_code, v.workflow_version_id
      FROM worker.workflow_definitions d
      JOIN worker.workflow_versions v
        ON v.workflow_definition_id = d.workflow_definition_id
       AND v.status = 'PUBLISHED'
       AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
      WHERE d.workflow_code IN ('skycommand-dev-promo-alt', 'skyserver_dev_commit')
        AND d.status = 'ACTIVE'
        AND d.enabled = TRUE
    )
    SELECT 1
    FROM expected_nodes expected
    LEFT JOIN intended
      ON intended.workflow_code = expected.workflow_code
    LEFT JOIN worker.workflow_nodes n
      ON n.workflow_version_id = intended.workflow_version_id
     AND n.node_key = expected.node_key
     AND n.enabled = TRUE
    GROUP BY expected.workflow_code, expected.node_key
    HAVING COUNT(n.workflow_node_id) <> 1
  ) THEN
    RAISE EXCEPTION
      '00134: a Development Promotion variant is missing a required R1 node';
  END IF;

  IF EXISTS (
    WITH expected_edges(workflow_code, from_node_key, to_node_key) AS (
      VALUES
        ('skycommand-dev-promo-alt', 'local_dev_pull_node', 'capability_catalog_node'),
        ('skycommand-dev-promo-alt', 'capability_catalog_node', 'repo_map_node'),
        ('skycommand-dev-promo-alt', 'repo_map_node', 'repo_zip_node'),
        ('skycommand-dev-promo-alt', 'repo_zip_node', 'dev_commit_node'),
        ('skycommand-dev-promo-alt', 'dev_commit_node', 'merge_approval_node'),
        ('skycommand-dev-promo-alt', 'merge_approval_node', 'merge_sync_node'),
        ('skycommand-dev-promo-alt', 'merge_sync_node', 'local_repo_sync_node'),
        ('skycommand-dev-promo-alt', 'local_repo_sync_node', 'dev_promotion_summary'),
        ('skyserver_dev_commit', 'capability_catalog_node', 'repo_map_node'),
        ('skyserver_dev_commit', 'repo_map_node', 'repo_zip_node'),
        ('skyserver_dev_commit', 'repo_zip_node', 'dev_commit_node'),
        ('skyserver_dev_commit', 'dev_commit_node', 'merge_approval_node'),
        ('skyserver_dev_commit', 'merge_approval_node', 'merge_sync_node'),
        ('skyserver_dev_commit', 'merge_sync_node', 'local_repo_sync_node'),
        ('skyserver_dev_commit', 'local_repo_sync_node', 'dev_promotion_summary')
    ),
    intended AS (
      SELECT d.workflow_code, v.workflow_version_id
      FROM worker.workflow_definitions d
      JOIN worker.workflow_versions v
        ON v.workflow_definition_id = d.workflow_definition_id
       AND v.status = 'PUBLISHED'
       AND v.version_label = format('R1 Capability Catalogue export v%s', v.version_number)
      WHERE d.workflow_code IN ('skycommand-dev-promo-alt', 'skyserver_dev_commit')
        AND d.status = 'ACTIVE'
        AND d.enabled = TRUE
    )
    SELECT 1
    FROM expected_edges expected
    LEFT JOIN intended
      ON intended.workflow_code = expected.workflow_code
    LEFT JOIN worker.workflow_nodes from_node
      ON from_node.workflow_version_id = intended.workflow_version_id
     AND from_node.node_key = expected.from_node_key
     AND from_node.enabled = TRUE
    LEFT JOIN worker.workflow_nodes to_node
      ON to_node.workflow_version_id = intended.workflow_version_id
     AND to_node.node_key = expected.to_node_key
     AND to_node.enabled = TRUE
    LEFT JOIN worker.workflow_edges e
      ON e.workflow_version_id = intended.workflow_version_id
     AND e.from_node_id = from_node.workflow_node_id
     AND e.to_node_id = to_node.workflow_node_id
    GROUP BY expected.workflow_code, expected.from_node_key, expected.to_node_key
    HAVING COUNT(e.workflow_edge_id) <> 1
  ) THEN
    RAISE EXCEPTION
      '00134: a Development Promotion variant is missing a required R1 execution edge';
  END IF;
END;
$migration$;
