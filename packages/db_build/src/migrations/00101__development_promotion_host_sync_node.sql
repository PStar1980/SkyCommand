-- Migration: 00101__development_promotion_host_sync_node.sql
-- Purpose:
--   Publishes a new immutable Development Promotion workflow version that inserts
--   the guarded Host Agent-backed Local Repository Sync tool between remote
--   Repo Merge / Sync and the final Development Promotion Summary.
--
--   Historical published versions are retained as RETIRED so prior workflow runs
--   continue to resolve against the exact graph they executed. Any existing draft
--   blocks the migration rather than silently publishing or discarding unreviewed
--   workflow edits.

BEGIN;

CREATE TEMP TABLE _00101_node_map (
  old_node_id UUID PRIMARY KEY,
  new_node_id UUID NOT NULL UNIQUE
) ON COMMIT DROP;

DO $$
DECLARE
  target_workflow_code CONSTANT TEXT := 'skyserver_dev_commit';
  merge_node_key CONSTANT TEXT := 'merge_sync_node';
  summary_node_key CONSTANT TEXT := 'dev_promotion_summary';
  local_sync_node_key CONSTANT TEXT := 'local_repo_sync_node';

  definition_id UUID;
  source_version_id UUID;
  new_version_id UUID;
  local_sync_tool_id UUID;
  new_version_number INTEGER;
  source_node_count INTEGER;
  source_edge_count INTEGER;
  new_node_count INTEGER;
  new_edge_count INTEGER;
  summary_display_order INTEGER;
  merge_position_x INTEGER;
  merge_position_y INTEGER;
  summary_position_x INTEGER;
  summary_position_y INTEGER;
  local_position_x INTEGER;
  local_position_y INTEGER;
  definition_row RECORD;
  node_row RECORD;
  generated_node_id UUID;
BEGIN
  SELECT d.workflow_definition_id,
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
         d.updated_by_user_id
    INTO definition_row
    FROM worker.workflow_definitions d
   WHERE d.workflow_code = target_workflow_code
   LIMIT 1;

  definition_id := definition_row.workflow_definition_id;

  IF definition_id IS NULL THEN
    RAISE EXCEPTION '00101: workflow % was not found', target_workflow_code;
  END IF;

  SELECT t.tool_id
    INTO local_sync_tool_id
    FROM core.tools t
   WHERE t.tool_code = 'local_repo_sync'
     AND t.enabled = TRUE
   LIMIT 1;

  IF local_sync_tool_id IS NULL THEN
    RAISE EXCEPTION '00101: local_repo_sync tool is unavailable; apply migrations 00099 and 00100 first';
  END IF;

  SELECT v.workflow_version_id
    INTO source_version_id
    FROM worker.workflow_versions v
   WHERE v.workflow_definition_id = definition_id
     AND v.status = 'PUBLISHED'
   ORDER BY v.version_number DESC
   LIMIT 1;

  IF source_version_id IS NULL THEN
    RAISE EXCEPTION '00101: Development Promotion has no published workflow version to upgrade';
  END IF;

  -- Idempotent rerun: if the current published graph already contains the host
  -- synchronization node, verify the critical bindings and stop without creating
  -- another workflow version.
  IF EXISTS (
    SELECT 1
      FROM worker.workflow_nodes n
     WHERE n.workflow_version_id = source_version_id
       AND n.node_type_code = 'TOOL'
       AND n.target_code = 'local_repo_sync'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
        FROM worker.workflow_nodes n
       WHERE n.workflow_version_id = source_version_id
         AND n.node_key = local_sync_node_key
         AND n.target_code = 'local_repo_sync'
         AND n.input_parameters ->> 'repoName' = '{{ params.repoName }}'
         AND n.input_parameters ->> 'expectedLocalDevSha' = '{{ nodes.dev_commit_node.output.currentHeadSha }}'
         AND n.input_parameters ->> 'expectedSynchronizedHeadSha' = '{{ nodes.merge_sync_node.output.synchronizedHeadSha }}'
    ) THEN
      RAISE EXCEPTION '00101: current published Development Promotion already contains local_repo_sync, but its canonical node key or trusted SHA bindings differ';
    END IF;

    RAISE NOTICE '00101: Development Promotion Host Agent local synchronization is already integrated';
    RETURN;
  END IF;

  -- A draft is user-owned mutable state. Never publish over it implicitly.
  IF EXISTS (
    SELECT 1
      FROM worker.workflow_versions v
     WHERE v.workflow_definition_id = definition_id
       AND v.status = 'DRAFT'
  ) THEN
    RAISE EXCEPTION '00101: Development Promotion has an existing DRAFT workflow version. Publish or remove the draft deliberately before applying this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM worker.workflow_nodes
     WHERE workflow_version_id = source_version_id
       AND node_key = merge_node_key
       AND node_type_code = 'TOOL'
       AND target_code = 'main_merge'
  ) THEN
    RAISE EXCEPTION '00101: expected Repo Merge / Sync node % -> main_merge is missing', merge_node_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM worker.workflow_nodes
     WHERE workflow_version_id = source_version_id
       AND node_key = summary_node_key
       AND node_type_code = 'SUMMARY'
  ) THEN
    RAISE EXCEPTION '00101: expected Development Promotion Summary node % is missing', summary_node_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
     WHERE e.workflow_version_id = source_version_id
       AND f.node_key = merge_node_key
       AND t.node_key = summary_node_key
  ) THEN
    RAISE EXCEPTION '00101: expected edge % -> % is missing', merge_node_key, summary_node_key;
  END IF;

  SELECT COUNT(*)::INTEGER
    INTO source_node_count
    FROM worker.workflow_nodes
   WHERE workflow_version_id = source_version_id;

  SELECT COUNT(*)::INTEGER
    INTO source_edge_count
    FROM worker.workflow_edges
   WHERE workflow_version_id = source_version_id;

  SELECT n.display_order, n.position_x, n.position_y
    INTO summary_display_order, summary_position_x, summary_position_y
    FROM worker.workflow_nodes n
   WHERE n.workflow_version_id = source_version_id
     AND n.node_key = summary_node_key;

  SELECT n.position_x, n.position_y
    INTO merge_position_x, merge_position_y
    FROM worker.workflow_nodes n
   WHERE n.workflow_version_id = source_version_id
     AND n.node_key = merge_node_key;

  local_position_x := CASE
    WHEN merge_position_x IS NOT NULL AND summary_position_x IS NOT NULL
      THEN (merge_position_x + summary_position_x) / 2
    WHEN merge_position_x IS NOT NULL THEN merge_position_x + 220
    ELSE NULL
  END;
  local_position_y := COALESCE(merge_position_y, summary_position_y);

  SELECT COALESCE(MAX(v.version_number), 0) + 1
    INTO new_version_number
    FROM worker.workflow_versions v
   WHERE v.workflow_definition_id = definition_id;

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
  SELECT
    v.workflow_definition_id,
    new_version_number,
    'Host Agent local repository sync integration',
    'PUBLISHED',
    v.graph_version,
    '{}'::jsonb,
    COALESCE(definition_row.updated_by_user_id, v.created_by_user_id),
    COALESCE(definition_row.updated_by_user_id, v.published_by_user_id, v.created_by_user_id),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM worker.workflow_versions v
  WHERE v.workflow_version_id = source_version_id
  RETURNING workflow_version_id INTO new_version_id;

  -- Clone every existing node into the new immutable version. Shift Summary and
  -- any later nodes by ten display-order points to make room for Local Sync.
  FOR node_row IN
    SELECT *
      FROM worker.workflow_nodes
     WHERE workflow_version_id = source_version_id
     ORDER BY display_order, node_key
  LOOP
    generated_node_id := gen_random_uuid();

    INSERT INTO worker.workflow_nodes (
      workflow_node_id,
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
      config,
      created_at,
      updated_at
    ) VALUES (
      generated_node_id,
      new_version_id,
      node_row.node_key,
      node_row.node_type_code,
      node_row.display_name,
      node_row.description,
      node_row.target_code,
      node_row.target_ref_id,
      node_row.target_config,
      node_row.input_parameters,
      node_row.retry_policy,
      node_row.timeout_ms,
      node_row.position_x,
      node_row.position_y,
      CASE
        WHEN node_row.display_order >= summary_display_order THEN node_row.display_order + 10
        ELSE node_row.display_order
      END,
      node_row.enabled,
      node_row.config,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );

    INSERT INTO _00101_node_map(old_node_id, new_node_id)
    VALUES (node_row.workflow_node_id, generated_node_id);
  END LOOP;

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
  ) VALUES (
    new_version_id,
    local_sync_node_key,
    'TOOL',
    'Local Repository Sync',
    'Safely fast-forwards host-owned local main/dev refs to the exact approved synchronized head through the SkyCommand Host Agent.',
    'local_repo_sync',
    local_sync_tool_id,
    '{}'::jsonb,
    jsonb_build_object(
      'repoName', '{{ params.repoName }}',
      'expectedLocalDevSha', '{{ nodes.dev_commit_node.output.currentHeadSha }}',
      'expectedSynchronizedHeadSha', '{{ nodes.merge_sync_node.output.synchronizedHeadSha }}'
    ),
    jsonb_build_object('maximumAttempts', 1, 'initialIntervalSeconds', 5),
    600000,
    local_position_x,
    local_position_y,
    summary_display_order,
    TRUE,
    jsonb_build_object(
      'executionTarget', 'HOST_AGENT',
      'transport', 'TEMPORAL',
      'hostTaskQueue', 'skycommand-host-local',
      'integrationMigration', '00101'
    )
  )
  RETURNING workflow_node_id INTO generated_node_id;

  -- Clone all original edges except the direct remote-sync -> Summary edge.
  INSERT INTO worker.workflow_edges (
    workflow_version_id,
    edge_key,
    from_node_id,
    to_node_id,
    edge_type,
    condition_expression,
    display_order,
    config,
    created_at,
    updated_at
  )
  SELECT
    new_version_id,
    e.edge_key,
    fm.new_node_id,
    tm.new_node_id,
    e.edge_type,
    e.condition_expression,
    e.display_order,
    e.config,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM worker.workflow_edges e
  JOIN worker.workflow_nodes old_from ON old_from.workflow_node_id = e.from_node_id
  JOIN worker.workflow_nodes old_to ON old_to.workflow_node_id = e.to_node_id
  JOIN _00101_node_map fm ON fm.old_node_id = e.from_node_id
  JOIN _00101_node_map tm ON tm.old_node_id = e.to_node_id
  WHERE e.workflow_version_id = source_version_id
    AND NOT (old_from.node_key = merge_node_key AND old_to.node_key = summary_node_key);

  INSERT INTO worker.workflow_edges (
    workflow_version_id,
    edge_key,
    from_node_id,
    to_node_id,
    edge_type,
    display_order,
    config
  )
  SELECT
    new_version_id,
    'merge_sync_to_local_repo_sync',
    merge_map.new_node_id,
    generated_node_id,
    'SEQUENTIAL',
    summary_display_order,
    jsonb_build_object('createdBy', '00101_host_agent_local_sync')
  FROM worker.workflow_nodes old_merge
  JOIN _00101_node_map merge_map ON merge_map.old_node_id = old_merge.workflow_node_id
  WHERE old_merge.workflow_version_id = source_version_id
    AND old_merge.node_key = merge_node_key;

  INSERT INTO worker.workflow_edges (
    workflow_version_id,
    edge_key,
    from_node_id,
    to_node_id,
    edge_type,
    display_order,
    config
  )
  SELECT
    new_version_id,
    'local_repo_sync_to_summary',
    generated_node_id,
    summary_map.new_node_id,
    'SEQUENTIAL',
    summary_display_order + 10,
    jsonb_build_object('createdBy', '00101_host_agent_local_sync')
  FROM worker.workflow_nodes old_summary
  JOIN _00101_node_map summary_map ON summary_map.old_node_id = old_summary.workflow_node_id
  WHERE old_summary.workflow_version_id = source_version_id
    AND old_summary.node_key = summary_node_key;

  -- Preserve version history: the prior runnable graph becomes RETIRED and the
  -- new graph is the only current PUBLISHED version.
  UPDATE worker.workflow_versions
     SET status = 'RETIRED',
         updated_at = CURRENT_TIMESTAMP
   WHERE workflow_definition_id = definition_id
     AND status = 'PUBLISHED'
     AND workflow_version_id <> new_version_id;

  -- Rebuild the lightweight graph snapshot used for management/version detail.
  UPDATE worker.workflow_versions v
     SET definition_snapshot = jsonb_build_object(
       'workflowCode', definition_row.workflow_code,
       'displayName', definition_row.display_name,
       'description', definition_row.description,
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
         WHERE n.workflow_version_id = new_version_id
       ), '[]'::jsonb),
       'edges', COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'edgeKey', e.edge_key,
             'fromNodeKey', f.node_key,
             'toNodeKey', t.node_key,
             'edgeType', e.edge_type,
             'conditionExpression', e.condition_expression,
             'displayOrder', e.display_order,
             'config', e.config
           ) ORDER BY e.display_order, e.edge_key
         )
         FROM worker.workflow_edges e
         JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
         JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
         WHERE e.workflow_version_id = new_version_id
       ), '[]'::jsonb),
       'integration', jsonb_build_object(
         'migration', '00101',
         'feature', 'host_agent_local_repository_sync',
         'sourceWorkflowVersionId', source_version_id,
         'publishedAt', CURRENT_TIMESTAMP
       )
     ),
     updated_at = CURRENT_TIMESTAMP
   WHERE v.workflow_version_id = new_version_id;

  UPDATE worker.workflow_definitions
     SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
       'hostAgentLocalSyncIntegrated', TRUE,
       'hostAgentLocalSyncVersion', new_version_number
     ),
         updated_at = CURRENT_TIMESTAMP
   WHERE workflow_definition_id = definition_id;

  SELECT COUNT(*)::INTEGER
    INTO new_node_count
    FROM worker.workflow_nodes
   WHERE workflow_version_id = new_version_id;

  SELECT COUNT(*)::INTEGER
    INTO new_edge_count
    FROM worker.workflow_edges
   WHERE workflow_version_id = new_version_id;

  IF new_node_count <> source_node_count + 1 THEN
    RAISE EXCEPTION '00101: node-count verification failed: source %, new %', source_node_count, new_node_count;
  END IF;

  IF new_edge_count <> source_edge_count + 1 THEN
    RAISE EXCEPTION '00101: edge-count verification failed: source %, new %', source_edge_count, new_edge_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
     WHERE e.workflow_version_id = new_version_id
       AND f.node_key = merge_node_key
       AND t.node_key = local_sync_node_key
  ) OR NOT EXISTS (
    SELECT 1
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
     WHERE e.workflow_version_id = new_version_id
       AND f.node_key = local_sync_node_key
       AND t.node_key = summary_node_key
  ) THEN
    RAISE EXCEPTION '00101: Local Repository Sync edge verification failed';
  END IF;

  RAISE NOTICE '00101: Development Promotion published as version % with Host Agent Local Repository Sync integrated', new_version_number;
END;
$$;

COMMIT;
