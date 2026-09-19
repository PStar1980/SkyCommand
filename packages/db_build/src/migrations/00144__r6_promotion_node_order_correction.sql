-- Migration: 00144__r6_promotion_node_order_correction.sql
-- Purpose: Publish R6 DEV promotion graph versions whose displayed node order
--          matches the governed execution chain in both registered variants.

DO $$
DECLARE
  current_workflow_code TEXT;
  definition_id UUID;
  old_version_id UUID;
  new_version_id UUID;
  old_version_number INTEGER;
  expected_old_version INTEGER;
  new_version_number INTEGER;
  approval_count INTEGER;
  target_node_count INTEGER;
  required_edge_count INTEGER;
  bypass_edge_count INTEGER;
  summary_incoming_count INTEGER;
  commit_order INTEGER;
  github_order INTEGER;
  merge_order INTEGER;
  local_order INTEGER;
  summary_order INTEGER;
  display_shift INTEGER;
  edge_shift INTEGER;
  commit_position_x NUMERIC;
  commit_position_y NUMERIC;
  merge_position_x NUMERIC;
BEGIN
  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_old_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 21
      ELSE 7
    END;
    new_version_number := expected_old_version + 1;

    SELECT d.workflow_definition_id, v.workflow_version_id, v.version_number
      INTO definition_id, old_version_id, old_version_number
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions v
      ON v.workflow_definition_id = d.workflow_definition_id
     AND v.status = 'PUBLISHED'
    WHERE d.workflow_code = current_workflow_code
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
    ORDER BY v.version_number DESC
    LIMIT 1;

    IF definition_id IS NULL OR old_version_id IS NULL OR old_version_number <> expected_old_version THEN
      RAISE EXCEPTION '00144: expected published source version is unavailable for %', current_workflow_code;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM worker.workflow_versions
      WHERE workflow_definition_id = definition_id
        AND version_number = new_version_number
    ) THEN
      RAISE EXCEPTION '00144: target version already exists for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) INTO approval_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = old_version_id
      AND node_type_code = 'HUMAN_APPROVAL';
    IF approval_count <> 0 THEN
      RAISE EXCEPTION '00144: source promotion graph contains an approval node for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) INTO target_node_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = old_version_id
      AND node_key IN (
        'dev_commit_node', 'github_dev_pr_merge_node', 'merge_sync_node',
        'local_repo_sync_node', 'dev_promotion_summary'
      );
    IF target_node_count <> 5 THEN
      RAISE EXCEPTION '00144: source promotion graph target-node set is incomplete for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) INTO required_edge_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = old_version_id
      AND (
        (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
        (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
        (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
        (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')
      );
    SELECT COUNT(*) INTO bypass_edge_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = old_version_id
      AND from_node.node_key = 'dev_commit_node'
      AND to_node.node_key = 'merge_sync_node';
    SELECT COUNT(*) INTO summary_incoming_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = old_version_id
      AND to_node.node_key = 'dev_promotion_summary';
    IF required_edge_count <> 4 OR bypass_edge_count <> 0 OR summary_incoming_count <> 1 THEN
      RAISE EXCEPTION '00144: source promotion graph edge chain is invalid for %', current_workflow_code;
    END IF;

    SELECT display_order INTO commit_order
    FROM worker.workflow_nodes
    WHERE workflow_version_id = old_version_id
      AND node_key = 'dev_commit_node';
    IF commit_order IS NULL OR EXISTS (
      SELECT 1
      FROM worker.workflow_nodes
      WHERE workflow_version_id = old_version_id
        AND node_key IN (
          'github_dev_pr_merge_node', 'merge_sync_node',
          'local_repo_sync_node', 'dev_promotion_summary'
        )
        AND display_order <= commit_order
    ) THEN
      RAISE EXCEPTION '00144: source promotion chain cannot be derived from the source node for %', current_workflow_code;
    END IF;

    INSERT INTO worker.workflow_versions (
      workflow_definition_id, version_number, version_label, status,
      graph_version, definition_snapshot, created_by_user_id,
      published_by_user_id, published_at, created_at, updated_at
    )
    SELECT definition_id, new_version_number,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit'
             THEN 'R6 promotion node order correction v22'
             ELSE 'R6 promotion node order correction v8'
           END,
           'PUBLISHED', graph_version, '{}'::jsonb,
           COALESCE(published_by_user_id, created_by_user_id),
           COALESCE(published_by_user_id, created_by_user_id),
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM worker.workflow_versions
    WHERE workflow_version_id = old_version_id
    RETURNING workflow_version_id INTO new_version_id;

    INSERT INTO worker.workflow_nodes (
      workflow_version_id, node_key, node_type_code, display_name,
      description, target_code, target_ref_id, target_config,
      input_parameters, retry_policy, timeout_ms, position_x, position_y,
      display_order, enabled, config
    )
    SELECT new_version_id, n.node_key, n.node_type_code, n.display_name,
           n.description, n.target_code, n.target_ref_id, n.target_config,
           n.input_parameters, n.retry_policy, n.timeout_ms, n.position_x,
           n.position_y, n.display_order, n.enabled, n.config
    FROM worker.workflow_nodes n
    WHERE n.workflow_version_id = old_version_id;

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      condition_expression, display_order, config
    )
    SELECT new_version_id, e.edge_key, new_from.workflow_node_id,
           new_to.workflow_node_id, e.edge_type, e.condition_expression,
           e.display_order, e.config
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes old_from ON old_from.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes old_to ON old_to.workflow_node_id = e.to_node_id
    JOIN worker.workflow_nodes new_from
      ON new_from.workflow_version_id = new_version_id
     AND new_from.node_key = old_from.node_key
    JOIN worker.workflow_nodes new_to
      ON new_to.workflow_version_id = new_version_id
     AND new_to.node_key = old_to.node_key
    WHERE e.workflow_version_id = old_version_id;

    SELECT display_order INTO commit_order
    FROM worker.workflow_nodes
    WHERE workflow_version_id = new_version_id
      AND node_key = 'dev_commit_node';
    SELECT COALESCE(MAX(display_order), 0) + 1000 INTO display_shift
    FROM worker.workflow_nodes
    WHERE workflow_version_id = new_version_id;

    UPDATE worker.workflow_nodes
    SET display_order = display_order + display_shift
    WHERE workflow_version_id = new_version_id
      AND display_order > commit_order;

    UPDATE worker.workflow_nodes
    SET display_order = CASE node_key
      WHEN 'github_dev_pr_merge_node' THEN commit_order + 1
      WHEN 'merge_sync_node' THEN commit_order + 2
      WHEN 'local_repo_sync_node' THEN commit_order + 3
      WHEN 'dev_promotion_summary' THEN commit_order + 4
      ELSE display_order - display_shift + 4
    END
    WHERE workflow_version_id = new_version_id
      AND (
        node_key IN (
          'github_dev_pr_merge_node', 'merge_sync_node',
          'local_repo_sync_node', 'dev_promotion_summary'
        )
        OR display_order > display_shift
      );

    SELECT position_x, position_y INTO commit_position_x, commit_position_y
    FROM worker.workflow_nodes
    WHERE workflow_version_id = new_version_id
      AND node_key = 'dev_commit_node';
    SELECT position_x INTO merge_position_x
    FROM worker.workflow_nodes
    WHERE workflow_version_id = new_version_id
      AND node_key = 'merge_sync_node';
    UPDATE worker.workflow_nodes github_node
    SET position_x = CASE
      WHEN commit_position_x IS NOT NULL AND merge_position_x IS NOT NULL
        THEN (commit_position_x + merge_position_x) / 2
      ELSE COALESCE(commit_position_x, merge_position_x, 0)
    END,
        position_y = COALESCE(commit_position_y, 0)
    WHERE github_node.workflow_version_id = new_version_id
      AND github_node.node_key = 'github_dev_pr_merge_node';

    SELECT COALESCE(MAX(display_order), 0) + 1000 INTO edge_shift
    FROM worker.workflow_edges
    WHERE workflow_version_id = new_version_id;
    UPDATE worker.workflow_edges e
    SET display_order = e.display_order + edge_shift
    FROM worker.workflow_nodes from_node, worker.workflow_nodes to_node
    WHERE e.workflow_version_id = new_version_id
      AND e.from_node_id = from_node.workflow_node_id
      AND e.to_node_id = to_node.workflow_node_id
      AND (
        (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
        (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
        (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
        (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')
      );
    UPDATE worker.workflow_edges e
    SET display_order = to_node.display_order
    FROM worker.workflow_nodes from_node, worker.workflow_nodes to_node
    WHERE e.workflow_version_id = new_version_id
      AND e.from_node_id = from_node.workflow_node_id
      AND e.to_node_id = to_node.workflow_node_id
      AND e.display_order > edge_shift
      AND (
        (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
        (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
        (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
        (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')
      );

    UPDATE worker.workflow_versions v
    SET definition_snapshot = jsonb_build_object(
      'workflowCode', d.workflow_code,
      'displayName', d.display_name,
      'description', d.description,
      'status', 'PUBLISHED',
      'graphVersion', v.graph_version,
      'nodes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nodeKey', n.node_key, 'nodeTypeCode', n.node_type_code,
          'displayName', n.display_name, 'targetCode', n.target_code,
          'displayOrder', n.display_order
        ) ORDER BY n.display_order, n.node_key)
        FROM worker.workflow_nodes n
        WHERE n.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'edges', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'edgeKey', e.edge_key, 'fromNodeKey', from_node.node_key,
          'toNodeKey', to_node.node_key, 'edgeType', e.edge_type,
          'conditionExpression', e.condition_expression,
          'displayOrder', e.display_order, 'config', e.config
        ) ORDER BY e.display_order, e.edge_key)
        FROM worker.workflow_edges e
        JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
        JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
        WHERE e.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'integration', jsonb_build_object(
        'migration', '00144',
        'feature', 'r6_promotion_node_order_correction',
        'publishedAt', CURRENT_TIMESTAMP
      )
    ),
        updated_at = CURRENT_TIMESTAMP
    FROM worker.workflow_definitions d
    WHERE v.workflow_version_id = new_version_id
      AND d.workflow_definition_id = v.workflow_definition_id;

    UPDATE worker.workflow_versions
    SET status = 'RETIRED', updated_at = CURRENT_TIMESTAMP
    WHERE workflow_definition_id = definition_id
      AND status = 'PUBLISHED'
      AND workflow_version_id <> new_version_id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  principal_id UUID;
  primary_version_id UUID;
  updated_grant_count INTEGER;
BEGIN
  SELECT workflow_execution_principal_id INTO principal_id
  FROM auth.workflow_execution_principals
  WHERE principal_code = 'assistant-http'
    AND status = 'ACTIVE'
  LIMIT 1;
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit'
    AND v.version_number = 22
    AND v.status = 'PUBLISHED';
  IF principal_id IS NULL OR primary_version_id IS NULL THEN
    RAISE EXCEPTION '00144: primary Assistant authority target is unavailable';
  END IF;

  UPDATE worker.workflow_execution_resource_grants
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'managedBy', '00144_r6_promotion_node_order_correction',
    'pinnedWorkflowVersionId', primary_version_id,
    'pinnedVersionNumber', 22
  ),
      updated_at = CURRENT_TIMESTAMP
  WHERE workflow_execution_principal_id = principal_id
    AND repository_code = 'SkyCommand'
    AND workflow_code = 'skyserver_dev_commit'
    AND environment_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND config_profile_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND status = 'ACTIVE';
  GET DIAGNOSTICS updated_grant_count = ROW_COUNT;
  IF updated_grant_count <> 2 THEN
    RAISE EXCEPTION '00144: expected two active primary Assistant grants, updated %', updated_grant_count;
  END IF;
END;
$$;

DO $$
DECLARE
  current_workflow_code TEXT;
  expected_version INTEGER;
  current_version_id UUID;
  previous_version_status TEXT;
  approval_count INTEGER;
  github_count INTEGER;
  target_key_count INTEGER;
  dev_order INTEGER;
  github_order INTEGER;
  merge_order INTEGER;
  local_order INTEGER;
  summary_order INTEGER;
  maximum_order INTEGER;
  chain_edge_count INTEGER;
  bypass_edge_count INTEGER;
  summary_incoming_count INTEGER;
  live_nodes JSONB;
  live_edges JSONB;
  snapshot_nodes JSONB;
  snapshot_edges JSONB;
  primary_version_id UUID;
  principal_id UUID;
  primary_grant_count INTEGER;
  required_permission_count INTEGER;
BEGIN
  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 22
      ELSE 8
    END;
    SELECT v.workflow_version_id INTO current_version_id
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version
      AND v.status = 'PUBLISHED';
    IF current_version_id IS NULL THEN
      RAISE EXCEPTION '00144: corrected published version is missing for %', current_workflow_code;
    END IF;

    SELECT v.status INTO previous_version_status
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version - 1;
    IF previous_version_status <> 'RETIRED' THEN
      RAISE EXCEPTION '00144: historical source version was not retired for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE node_type_code = 'HUMAN_APPROVAL'),
           COUNT(*) FILTER (WHERE node_key = 'github_dev_pr_merge_node' AND target_code = 'github_dev_pr_merge'),
           COUNT(*) FILTER (WHERE node_key IN (
             'dev_commit_node', 'github_dev_pr_merge_node', 'merge_sync_node',
             'local_repo_sync_node', 'dev_promotion_summary'
           ))
      INTO approval_count, github_count, target_key_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = current_version_id;
    IF approval_count <> 0 OR github_count <> 1 OR target_key_count <> 5 THEN
      RAISE EXCEPTION '00144: corrected promotion graph node invariant failed for %', current_workflow_code;
    END IF;

    SELECT MAX(display_order) FILTER (WHERE node_key = 'dev_commit_node'),
           MAX(display_order) FILTER (WHERE node_key = 'github_dev_pr_merge_node'),
           MAX(display_order) FILTER (WHERE node_key = 'merge_sync_node'),
           MAX(display_order) FILTER (WHERE node_key = 'local_repo_sync_node'),
           MAX(display_order) FILTER (WHERE node_key = 'dev_promotion_summary'),
           MAX(display_order)
      INTO dev_order, github_order, merge_order, local_order, summary_order, maximum_order
    FROM worker.workflow_nodes
    WHERE workflow_version_id = current_version_id;
    IF github_order <> dev_order + 1
       OR merge_order <> github_order + 1
       OR local_order <> merge_order + 1
       OR summary_order <> local_order + 1
       OR summary_order <> maximum_order THEN
      RAISE EXCEPTION '00144: corrected promotion display order invariant failed for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE
             (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
             (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
             (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
             (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')),
           COUNT(*) FILTER (WHERE from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'merge_sync_node'),
           COUNT(*) FILTER (WHERE to_node.node_key = 'dev_promotion_summary')
      INTO chain_edge_count, bypass_edge_count, summary_incoming_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = current_version_id;
    IF chain_edge_count <> 4 OR bypass_edge_count <> 0 OR summary_incoming_count <> 1 THEN
      RAISE EXCEPTION '00144: corrected promotion edge invariant failed for %', current_workflow_code;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nodeKey', n.node_key, 'nodeTypeCode', n.node_type_code,
      'displayName', n.display_name, 'targetCode', n.target_code,
      'displayOrder', n.display_order
    ) ORDER BY n.display_order, n.node_key), '[]'::jsonb)
      INTO live_nodes
    FROM worker.workflow_nodes n
    WHERE n.workflow_version_id = current_version_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'edgeKey', e.edge_key, 'fromNodeKey', from_node.node_key,
      'toNodeKey', to_node.node_key, 'edgeType', e.edge_type,
      'conditionExpression', e.condition_expression,
      'displayOrder', e.display_order, 'config', e.config
    ) ORDER BY e.display_order, e.edge_key), '[]'::jsonb)
      INTO live_edges
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = current_version_id;
    SELECT definition_snapshot->'nodes', definition_snapshot->'edges'
      INTO snapshot_nodes, snapshot_edges
    FROM worker.workflow_versions
    WHERE workflow_version_id = current_version_id;
    IF snapshot_nodes IS DISTINCT FROM live_nodes OR snapshot_edges IS DISTINCT FROM live_edges THEN
      RAISE EXCEPTION '00144: definition snapshot does not equal live graph for %', current_workflow_code;
    END IF;
  END LOOP;

  SELECT workflow_execution_principal_id INTO principal_id
  FROM auth.workflow_execution_principals
  WHERE principal_code = 'assistant-http'
    AND status = 'ACTIVE'
  LIMIT 1;
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit'
    AND v.version_number = 22
    AND v.status = 'PUBLISHED';
  SELECT COUNT(*) INTO primary_grant_count
  FROM worker.workflow_execution_resource_grants g
  WHERE g.workflow_execution_principal_id = principal_id
    AND g.repository_code = 'SkyCommand'
    AND g.workflow_code = 'skyserver_dev_commit'
    AND g.status = 'ACTIVE'
    AND g.environment_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND g.config_profile_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND g.metadata->>'pinnedWorkflowVersionId' = primary_version_id::TEXT
    AND g.metadata->>'pinnedVersionNumber' = '22';
  IF primary_grant_count <> 2 THEN
    RAISE EXCEPTION '00144: corrected primary Assistant grant pin invariant failed';
  END IF;

  SELECT COUNT(*) INTO required_permission_count
  FROM worker.workflow_execution_resource_grants g
  WHERE g.workflow_execution_principal_id = principal_id
    AND g.repository_code = 'SkyCommand'
    AND g.workflow_code = 'skyserver_dev_commit'
    AND g.status = 'ACTIVE'
    AND g.environment_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND g.config_profile_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND jsonb_array_length(g.allowed_permission_codes) = 12
    AND g.allowed_permission_codes ?& ARRAY[
      'WORKFLOW_RUN', 'DEV_PROMOTION_PREFLIGHT', 'CAPABILITY_CATALOG_EXPORT',
      'REPO_MAP_GENERATE', 'REPO_ZIP_GENERATE', 'GIT_COMMIT_RUN',
      'GIT_DEV_PR_MERGE_RUN', 'GIT_MAIN_MERGE_RUN', 'GIT_LOCAL_SYNC_RUN',
      'CORE_RUN_LOW_RISK_SCRIPT', 'CORE_RUN_MEDIUM_RISK_SCRIPT',
      'CORE_RUN_HIGH_RISK_SCRIPT'
    ];
  IF required_permission_count <> 2 THEN
    RAISE EXCEPTION '00144: corrected primary Assistant permission set invariant failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM worker.workflow_execution_resource_grants g
    JOIN auth.workflow_execution_principals p
      ON p.workflow_execution_principal_id = g.workflow_execution_principal_id
    WHERE p.principal_code = 'assistant-http'
      AND g.workflow_code = 'skycommand-dev-promo-alt'
      AND g.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION '00144: alternate Assistant grant must remain absent';
  END IF;
END;
$$;
