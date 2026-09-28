-- Migration: 00162__development_promotion_secret_leak_gate_decoupling.sql
-- Purpose: Preserve Secret Leak Gate as an independent promotion Tool while
--          removing Secret-Leak-Gate-specific state and semantics from Dev Commit.
--
-- 00161 has already been applied in DEV and is therefore immutable. This
-- corrective migration restores the pre-gate Dev Commit contract, publishes
-- new promotion workflow versions with the gate retained as an immediately
-- preceding standalone node, and updates the Assistant grant to the new primary
-- workflow version.

DELETE FROM core.tool_parameters tp
USING core.tools t
WHERE tp.tool_id = t.tool_id
  AND t.tool_code = 'dev_commit'
  AND tp.parameter_name IN (
    'secretLeakGateSourceIdentityDigest',
    'secretLeakGateArtifactIdentityDigest',
    'secretLeakGateCapabilityCatalogJsonPath',
    'secretLeakGateCapabilityCatalogXlsxPath',
    'secretLeakGateRepositoryMapPath',
    'secretLeakGateRepositoryZipPath'
  );

DO $$
DECLARE
  current_workflow_code TEXT;
  definition_id UUID;
  source_version_id UUID;
  baseline_version_id UUID;
  new_version_id UUID;
  source_version_number INTEGER;
  baseline_version_number INTEGER;
  new_version_number INTEGER;
  restored_count INTEGER;
BEGIN
  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    source_version_number := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 23
      ELSE 9
    END;
    baseline_version_number := source_version_number - 1;
    new_version_number := source_version_number + 1;

    SELECT d.workflow_definition_id, source.workflow_version_id, baseline.workflow_version_id
      INTO definition_id, source_version_id, baseline_version_id
    FROM worker.workflow_definitions d
    JOIN worker.workflow_versions source
      ON source.workflow_definition_id = d.workflow_definition_id
     AND source.version_number = source_version_number
    JOIN worker.workflow_versions baseline
      ON baseline.workflow_definition_id = d.workflow_definition_id
     AND baseline.version_number = baseline_version_number
    WHERE d.workflow_code = current_workflow_code
      AND d.status = 'ACTIVE'
      AND d.enabled = TRUE
      AND source.status = 'PUBLISHED'
    LIMIT 1;

    IF definition_id IS NULL OR source_version_id IS NULL OR baseline_version_id IS NULL THEN
      RAISE EXCEPTION '00162: required source/baseline workflow versions are unavailable for %', current_workflow_code;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM worker.workflow_versions
      WHERE workflow_definition_id = definition_id
        AND version_number = new_version_number
    ) THEN
      RAISE EXCEPTION '00162: target workflow version already exists for %', current_workflow_code;
    END IF;

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
    SELECT definition_id,
           new_version_number,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit'
             THEN 'Development Promotion Secret Leak Gate decoupled v24'
             ELSE 'Development Promotion Secret Leak Gate decoupled v10'
           END,
           'PUBLISHED',
           graph_version,
           '{}'::jsonb,
           COALESCE(published_by_user_id, created_by_user_id),
           COALESCE(published_by_user_id, created_by_user_id),
           CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP
    FROM worker.workflow_versions
    WHERE workflow_version_id = source_version_id
    RETURNING workflow_version_id INTO new_version_id;

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
    SELECT new_version_id,
           n.node_key,
           n.node_type_code,
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
           n.config
    FROM worker.workflow_nodes n
    WHERE n.workflow_version_id = source_version_id;

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
    SELECT new_version_id,
           e.edge_key,
           new_from.workflow_node_id,
           new_to.workflow_node_id,
           e.edge_type,
           e.condition_expression,
           e.display_order,
           e.config
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes old_from ON old_from.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes old_to ON old_to.workflow_node_id = e.to_node_id
    JOIN worker.workflow_nodes new_from
      ON new_from.workflow_version_id = new_version_id
     AND new_from.node_key = old_from.node_key
    JOIN worker.workflow_nodes new_to
      ON new_to.workflow_version_id = new_version_id
     AND new_to.node_key = old_to.node_key
    WHERE e.workflow_version_id = source_version_id;

    -- Restore Dev Commit's exact pre-gate workflow contract. The gate remains a
    -- separate predecessor node; Dev Commit no longer knows that the gate exists.
    UPDATE worker.workflow_nodes target
    SET input_parameters = baseline.input_parameters,
        config = baseline.config
    FROM worker.workflow_nodes baseline
    WHERE target.workflow_version_id = new_version_id
      AND target.node_key = 'dev_commit_node'
      AND baseline.workflow_version_id = baseline_version_id
      AND baseline.node_key = 'dev_commit_node';
    GET DIAGNOSTICS restored_count = ROW_COUNT;
    IF restored_count <> 1 THEN
      RAISE EXCEPTION '00162: expected one dev_commit node to restore for %, restored %', current_workflow_code, restored_count;
    END IF;

    -- Remove only the obsolete cross-tool revalidation marker from the gate's
    -- own node metadata. Fail-closed scanning and graph ordering remain intact.
    UPDATE worker.workflow_nodes
    SET config = COALESCE(config, '{}'::jsonb) - 'revalidateAtDevCommit'
    WHERE workflow_version_id = new_version_id
      AND node_key = 'secret_leak_gate_node';

    UPDATE worker.workflow_versions v
    SET definition_snapshot = jsonb_build_object(
      'workflowCode', d.workflow_code,
      'displayName', d.display_name,
      'description', d.description,
      'status', 'PUBLISHED',
      'graphVersion', v.graph_version,
      'nodes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nodeKey', n.node_key,
          'nodeTypeCode', n.node_type_code,
          'displayName', n.display_name,
          'targetCode', n.target_code,
          'displayOrder', n.display_order
        ) ORDER BY n.display_order, n.node_key)
        FROM worker.workflow_nodes n
        WHERE n.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'edges', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'edgeKey', e.edge_key,
          'fromNodeKey', from_node.node_key,
          'toNodeKey', to_node.node_key,
          'edgeType', e.edge_type,
          'conditionExpression', e.condition_expression,
          'displayOrder', e.display_order,
          'config', e.config
        ) ORDER BY e.display_order, e.edge_key)
        FROM worker.workflow_edges e
        JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
        JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
        WHERE e.workflow_version_id = v.workflow_version_id
      ), '[]'::jsonb),
      'integration', jsonb_build_object(
        'migration', '00162',
        'feature', 'development_promotion_secret_leak_gate_decoupling',
        'publishedAt', CURRENT_TIMESTAMP
      )
    ),
        updated_at = CURRENT_TIMESTAMP
    FROM worker.workflow_definitions d
    WHERE v.workflow_version_id = new_version_id
      AND d.workflow_definition_id = v.workflow_definition_id;

    UPDATE worker.workflow_versions
    SET status = 'RETIRED',
        updated_at = CURRENT_TIMESTAMP
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
    AND v.version_number = 24
    AND v.status = 'PUBLISHED';

  IF principal_id IS NULL OR primary_version_id IS NULL THEN
    RAISE EXCEPTION '00162: primary Assistant authority target is unavailable';
  END IF;

  UPDATE worker.workflow_execution_resource_grants
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'managedBy', '00162_development_promotion_secret_leak_gate_decoupling',
        'pinnedWorkflowVersionId', primary_version_id,
        'pinnedVersionNumber', 24
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
    RAISE EXCEPTION '00162: expected two active primary Assistant grants, updated %', updated_grant_count;
  END IF;
END;
$$;

DO $$
DECLARE
  current_workflow_code TEXT;
  expected_version INTEGER;
  baseline_version INTEGER;
  current_version_id UUID;
  baseline_version_id UUID;
  previous_version_status TEXT;
  gate_count INTEGER;
  approval_count INTEGER;
  gate_incoming_count INTEGER;
  gate_outgoing_count INTEGER;
  bypass_edge_count INTEGER;
  dev_commit_parameter_count INTEGER;
  contract_match_count INTEGER;
  live_nodes JSONB;
  live_edges JSONB;
  snapshot_nodes JSONB;
  snapshot_edges JSONB;
BEGIN
  SELECT COUNT(*) INTO dev_commit_parameter_count
  FROM core.tool_parameters tp
  JOIN core.tools t ON t.tool_id = tp.tool_id
  WHERE t.tool_code = 'dev_commit'
    AND tp.parameter_name IN (
      'secretLeakGateSourceIdentityDigest',
      'secretLeakGateArtifactIdentityDigest',
      'secretLeakGateCapabilityCatalogJsonPath',
      'secretLeakGateCapabilityCatalogXlsxPath',
      'secretLeakGateRepositoryMapPath',
      'secretLeakGateRepositoryZipPath'
    );

  IF dev_commit_parameter_count <> 0 THEN
    RAISE EXCEPTION '00162: dev_commit still exposes Secret Leak Gate parameters';
  END IF;

  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 24
      ELSE 10
    END;
    baseline_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 22
      ELSE 8
    END;

    SELECT v.workflow_version_id INTO current_version_id
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version
      AND v.status = 'PUBLISHED';

    SELECT v.workflow_version_id INTO baseline_version_id
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = baseline_version;

    IF current_version_id IS NULL OR baseline_version_id IS NULL THEN
      RAISE EXCEPTION '00162: validation workflow versions are unavailable for %', current_workflow_code;
    END IF;

    SELECT v.status INTO previous_version_status
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version - 1;

    IF previous_version_status <> 'RETIRED' THEN
      RAISE EXCEPTION '00162: superseded workflow version was not retired for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE node_type_code = 'HUMAN_APPROVAL'),
           COUNT(*) FILTER (WHERE node_key = 'secret_leak_gate_node' AND target_code = 'secret_leak_gate')
      INTO approval_count, gate_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = current_version_id;

    IF approval_count <> 0 OR gate_count <> 1 THEN
      RAISE EXCEPTION '00162: standalone gate graph invariant failed for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE to_node.node_key = 'secret_leak_gate_node'),
           COUNT(*) FILTER (WHERE from_node.node_key = 'secret_leak_gate_node'),
           COUNT(*) FILTER (WHERE from_node.node_key = 'repo_zip_node' AND to_node.node_key = 'dev_commit_node')
      INTO gate_incoming_count, gate_outgoing_count, bypass_edge_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = current_version_id;

    IF gate_incoming_count <> 1 OR gate_outgoing_count <> 1 OR bypass_edge_count <> 0 THEN
      RAISE EXCEPTION '00162: standalone gate edge invariant failed for %', current_workflow_code;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
      WHERE e.workflow_version_id = current_version_id
        AND from_node.node_key = 'repo_zip_node'
        AND to_node.node_key = 'secret_leak_gate_node'
        AND e.edge_type = 'SEQUENTIAL'
    ) OR NOT EXISTS (
      SELECT 1
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
      WHERE e.workflow_version_id = current_version_id
        AND from_node.node_key = 'secret_leak_gate_node'
        AND to_node.node_key = 'dev_commit_node'
        AND e.edge_type = 'SEQUENTIAL'
    ) THEN
      RAISE EXCEPTION '00162: standalone gate ordering invariant failed for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) INTO contract_match_count
    FROM worker.workflow_nodes current_commit
    JOIN worker.workflow_nodes baseline_commit
      ON baseline_commit.workflow_version_id = baseline_version_id
     AND baseline_commit.node_key = 'dev_commit_node'
    WHERE current_commit.workflow_version_id = current_version_id
      AND current_commit.node_key = 'dev_commit_node'
      AND current_commit.input_parameters IS NOT DISTINCT FROM baseline_commit.input_parameters
      AND current_commit.config IS NOT DISTINCT FROM baseline_commit.config;

    IF contract_match_count <> 1 THEN
      RAISE EXCEPTION '00162: dev_commit workflow contract was not restored for %', current_workflow_code;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM worker.workflow_nodes n
      WHERE n.workflow_version_id = current_version_id
        AND n.node_key = 'secret_leak_gate_node'
        AND COALESCE(n.config, '{}'::jsonb) ? 'revalidateAtDevCommit'
    ) THEN
      RAISE EXCEPTION '00162: Secret Leak Gate still advertises dev_commit revalidation for %', current_workflow_code;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nodeKey', n.node_key,
      'nodeTypeCode', n.node_type_code,
      'displayName', n.display_name,
      'targetCode', n.target_code,
      'displayOrder', n.display_order
    ) ORDER BY n.display_order, n.node_key), '[]'::jsonb)
      INTO live_nodes
    FROM worker.workflow_nodes n
    WHERE n.workflow_version_id = current_version_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'edgeKey', e.edge_key,
      'fromNodeKey', from_node.node_key,
      'toNodeKey', to_node.node_key,
      'edgeType', e.edge_type,
      'conditionExpression', e.condition_expression,
      'displayOrder', e.display_order,
      'config', e.config
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
      RAISE EXCEPTION '00162: definition snapshot does not equal live graph for %', current_workflow_code;
    END IF;
  END LOOP;
END;
$$;
