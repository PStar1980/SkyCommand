-- Migration: 00143__github_dev_pr_merge_r6_correction.sql
-- Purpose: Bind R6 DEV promotion to an authenticated GitHub DEV -> main PR,
--          preserve the accepted R6 versions, and add durable terminal evidence.

ALTER TABLE worker.dev_promotion_admissions
  ADD COLUMN IF NOT EXISTS terminal_run_status TEXT,
  ADD COLUMN IF NOT EXISTS terminal_outcome TEXT,
  ADD COLUMN IF NOT EXISTS terminal_receipt JSONB,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_source TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'worker.dev_promotion_admissions'::regclass
      AND conname = 'dev_promotion_admission_workflow_ck'
  ) THEN
    ALTER TABLE worker.dev_promotion_admissions
      DROP CONSTRAINT dev_promotion_admission_workflow_ck;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'worker.dev_promotion_admissions'::regclass
      AND conname = 'dev_promotion_admission_workflow_variant_ck'
  ) THEN
    ALTER TABLE worker.dev_promotion_admissions
      ADD CONSTRAINT dev_promotion_admission_workflow_variant_ck CHECK (
        workflow_code IN ('skyserver_dev_commit', 'skycommand-dev-promo-alt')
      );
  END IF;
END;
$$;

COMMENT ON COLUMN worker.dev_promotion_admissions.terminal_receipt IS
  'Redacted durable evidence recorded when the admitted workflow reaches a terminal status.';

INSERT INTO auth.permissions (
  app_id, permission_code, resource, action, description, active
)
VALUES (
  (SELECT app_id FROM core.applications
   WHERE app_code = 'SKYSERVER_ADMIN' AND active = TRUE LIMIT 1),
  'GIT_DEV_PR_MERGE_RUN',
  'development_promotion',
  'merge_dev_pull_request',
  'Merge the reviewed SkyCommand DEV pull request into the registered GitHub main branch after exact SHA and protection checks.',
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
JOIN auth.permissions p ON p.permission_code = 'GIT_DEV_PR_MERGE_RUN'
WHERE r.role_code IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

INSERT INTO core.tools (
  category_id, tool_code, name, label, description, script_repo_id, script_path,
  runtime_code, permission_code, risk_code, requires_confirmation,
  confirmation_text, captures_output, allow_params, display_order, enabled,
  output_type, output_schema_path, managed_by_skycommand
)
SELECT c.category_id,
       'github_dev_pr_merge',
       'githubDevPrMerge',
       'Merge GitHub Dev PR',
       'Verify the reviewed DEV and main SHAs, create or select the unique registered DEV to main pull request, and merge it through the authenticated host GitHub CLI transport.',
       r.repo_id,
       'packages/git/src/github_dev_pr_merge.js',
       'node',
       'GIT_DEV_PR_MERGE_RUN',
       'high',
       FALSE,
       NULL,
       TRUE,
       TRUE,
       35,
       TRUE,
       'github_dev_pr_merge_summary.v1',
       'packages/tools/contracts/github_dev_pr_merge_summary.v1.schema.json',
       FALSE
FROM core.applications a
JOIN core.tool_categories c ON c.app_id = a.app_id
JOIN core.repositories r
  ON r.repo_code = 'SkyCommand'
 AND r.is_skycommand_repository = TRUE
 AND r.active = TRUE
WHERE a.app_code = 'SKYSERVER_CORE'
  AND a.active = TRUE
  AND c.category_code = 'git_tools'
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
CROSS JOIN (VALUES ('admin-web'), ('api'), ('worker')) AS v(channel_code)
WHERE t.tool_code = 'github_dev_pr_merge'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH parameter_seed (
  parameter_name, label, param_type_code, prompt, required,
  default_value, option_source_code, display_order
) AS (
  VALUES
    ('repoName', 'Repository', 'repo', 'The registered SkyCommand repository.', TRUE, NULL, 'repositories', 10),
    ('expectedDevSha', 'Expected DEV SHA', 'string', 'The exact DEV SHA produced by the governed source node.', TRUE, NULL, NULL, 20),
    ('workflowRunId', 'Promotion workflow run id', 'string', 'The governed promotion workflow run record id.', TRUE, NULL, NULL, 30),
    ('expectedMainSha', 'Expected main SHA', 'string', 'The exact main SHA observed by promotion preflight.', TRUE, NULL, NULL, 40)
)
INSERT INTO core.tool_parameters (
  tool_id, parameter_name, label, param_type_code, prompt, required,
  default_value, option_source_code, display_order, enabled,
  argument_mode, cli_flag
)
SELECT t.tool_id, p.parameter_name, p.label, p.param_type_code, p.prompt,
       p.required, p.default_value, p.option_source_code, p.display_order,
       TRUE, 'POSITIONAL', NULL
FROM parameter_seed p
JOIN core.tools t ON t.tool_code = 'github_dev_pr_merge'
ON CONFLICT (tool_id, parameter_name)
DO UPDATE SET
  label = EXCLUDED.label,
  param_type_code = EXCLUDED.param_type_code,
  prompt = EXCLUDED.prompt,
  required = EXCLUDED.required,
  default_value = EXCLUDED.default_value,
  option_source_code = EXCLUDED.option_source_code,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  argument_mode = EXCLUDED.argument_mode,
  cli_flag = EXCLUDED.cli_flag,
  updated_at = CURRENT_TIMESTAMP;

DO $$
DECLARE
  current_workflow_code TEXT;
  definition_id UUID;
  old_version_id UUID;
  new_version_id UUID;
  old_version_number INTEGER;
  expected_old_version INTEGER;
  new_version_number INTEGER;
  github_tool_id UUID;
BEGIN
  SELECT tool_id INTO github_tool_id
  FROM core.tools
  WHERE tool_code = 'github_dev_pr_merge' AND enabled = TRUE;
  IF github_tool_id IS NULL THEN
    RAISE EXCEPTION '00143: GitHub promotion Tool registration is missing';
  END IF;

  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_old_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 20
      ELSE 6
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
      RAISE EXCEPTION '00143: expected accepted R6 workflow version is unavailable for %', current_workflow_code;
    END IF;
    IF EXISTS (
      SELECT 1 FROM worker.workflow_versions
      WHERE workflow_definition_id = definition_id
        AND version_number = new_version_number
    ) THEN
      RAISE EXCEPTION '00143: corrective workflow version already exists for %', current_workflow_code;
    END IF;

    INSERT INTO worker.workflow_versions (
      workflow_definition_id, version_number, version_label, status,
      graph_version, definition_snapshot, created_by_user_id,
      published_by_user_id, published_at, created_at, updated_at
    )
    SELECT definition_id, new_version_number,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit'
             THEN 'R6 GitHub DEV PR merge correction v21'
             ELSE 'R6 GitHub DEV PR merge correction v7'
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
    WHERE n.workflow_version_id = old_version_id
      AND n.node_type_code <> 'HUMAN_APPROVAL';

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
    WHERE e.workflow_version_id = old_version_id
      AND old_from.node_type_code <> 'HUMAN_APPROVAL'
      AND old_to.node_type_code <> 'HUMAN_APPROVAL';

    UPDATE worker.workflow_nodes
       SET input_parameters = jsonb_set(
         jsonb_set(
           jsonb_set(
             COALESCE(input_parameters, '{}'::jsonb),
             '{finalizationWorkflowRunId}',
             '"{{ params.finalizationWorkflowRunId }}"'::jsonb
           ),
           '{workflowRunId}',
           '"{{ workflow.workflowRunRecordId }}"'::jsonb
         ),
         '{repoName}',
         COALESCE(input_parameters->'repoName', '"{{ params.repoName }}"'::jsonb)
       ),
       config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('createdBy', '00143_r6_github_dev_pr_merge_correction')
     WHERE workflow_version_id = new_version_id
       AND node_key = 'dev_commit_node';

    INSERT INTO worker.workflow_nodes (
      workflow_version_id, node_key, node_type_code, display_name,
      description, target_code, target_ref_id, target_config,
      input_parameters, retry_policy, timeout_ms, position_x, position_y,
      display_order, enabled, config
    )
    SELECT new_version_id,
           'github_dev_pr_merge_node',
           'TOOL',
           'Merge GitHub Dev PR',
           'Verify exact reviewed DEV/main SHAs and merge the unique authenticated GitHub DEV to main pull request.',
           'github_dev_pr_merge',
           github_tool_id,
           '{}'::jsonb,
           jsonb_build_object(
             'repoName', '{{ params.repoName }}',
             'expectedDevSha', '{{ nodes.dev_commit_node.output.currentHeadSha }}',
             'workflowRunId', '{{ workflow.workflowRunRecordId }}',
             'expectedMainSha', '{{ nodes.promotion_preflight_node.output.repository.expectedMainSha }}'
           ),
           '{"maximumAttempts":1,"initialIntervalSeconds":10}'::jsonb,
           900000,
           0,
           0,
           (SELECT COALESCE(MAX(display_order), 0) + 1 FROM worker.workflow_nodes WHERE workflow_version_id = new_version_id),
           TRUE,
           jsonb_build_object('createdBy', '00143_r6_github_dev_pr_merge_correction')
    WHERE NOT EXISTS (
      SELECT 1 FROM worker.workflow_nodes
      WHERE workflow_version_id = new_version_id AND node_key = 'github_dev_pr_merge_node'
    );

    DELETE FROM worker.workflow_edges e
    USING worker.workflow_nodes from_node, worker.workflow_nodes to_node
    WHERE e.workflow_version_id = new_version_id
      AND e.from_node_id = from_node.workflow_node_id
      AND e.to_node_id = to_node.workflow_node_id
      AND from_node.workflow_version_id = new_version_id
      AND to_node.workflow_version_id = new_version_id
      AND from_node.node_key = 'dev_commit_node'
      AND to_node.node_key = 'merge_sync_node';

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      condition_expression, display_order, config
    )
    SELECT new_version_id,
           'dev_commit_node_to_github_dev_pr_merge_node',
           commit_node.workflow_node_id,
           github_node.workflow_node_id,
           'SEQUENTIAL',
           NULL,
           40,
           jsonb_build_object('createdBy', '00143_r6_github_dev_pr_merge_correction')
    FROM worker.workflow_nodes commit_node
    JOIN worker.workflow_nodes github_node
      ON github_node.workflow_version_id = new_version_id
     AND github_node.node_key = 'github_dev_pr_merge_node'
    WHERE commit_node.workflow_version_id = new_version_id
      AND commit_node.node_key = 'dev_commit_node'
      AND NOT EXISTS (
        SELECT 1 FROM worker.workflow_edges e
        WHERE e.workflow_version_id = new_version_id
          AND e.from_node_id = commit_node.workflow_node_id
          AND e.to_node_id = github_node.workflow_node_id
      );

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      condition_expression, display_order, config
    )
    SELECT new_version_id,
           'github_dev_pr_merge_node_to_merge_sync_node',
           github_node.workflow_node_id,
           merge_node.workflow_node_id,
           'SEQUENTIAL',
           NULL,
           41,
           jsonb_build_object('createdBy', '00143_r6_github_dev_pr_merge_correction')
    FROM worker.workflow_nodes github_node
    JOIN worker.workflow_nodes merge_node
      ON merge_node.workflow_version_id = new_version_id
     AND merge_node.node_key = 'merge_sync_node'
    WHERE github_node.workflow_version_id = new_version_id
      AND github_node.node_key = 'github_dev_pr_merge_node'
      AND NOT EXISTS (
        SELECT 1 FROM worker.workflow_edges e
        WHERE e.workflow_version_id = new_version_id
          AND e.from_node_id = github_node.workflow_node_id
          AND e.to_node_id = merge_node.workflow_node_id
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
           'migration', '00143',
           'feature', 'r6_github_dev_pr_merge_correction',
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
BEGIN
  SELECT workflow_execution_principal_id INTO principal_id
  FROM auth.workflow_execution_principals
  WHERE principal_code = 'assistant-http' AND status = 'ACTIVE'
  LIMIT 1;
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit'
    AND v.version_number = 21
    AND v.status = 'PUBLISHED';
  IF principal_id IS NULL OR primary_version_id IS NULL THEN
    RAISE EXCEPTION '00143: primary corrected promotion authority is unavailable';
  END IF;

  INSERT INTO worker.workflow_execution_resource_grants (
    workflow_execution_principal_id, repository_code, environment_code,
    config_profile_code, workflow_code, allowed_permission_codes, status, metadata
  )
  SELECT principal_id, 'SkyCommand', scope.environment_code,
         scope.config_profile_code, 'skyserver_dev_commit',
         '["WORKFLOW_RUN","DEV_PROMOTION_PREFLIGHT","CAPABILITY_CATALOG_EXPORT","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","GIT_COMMIT_RUN","GIT_DEV_PR_MERGE_RUN","GIT_MAIN_MERGE_RUN","GIT_LOCAL_SYNC_RUN","CORE_RUN_LOW_RISK_SCRIPT","CORE_RUN_MEDIUM_RISK_SCRIPT","CORE_RUN_HIGH_RISK_SCRIPT"]'::jsonb,
         'ACTIVE',
         jsonb_build_object(
           'managedBy', '00143_r6_github_dev_pr_merge_correction',
           'pinnedWorkflowVersionId', primary_version_id,
           'pinnedVersionNumber', 21,
           'scope', 'R6_github_pr_merge',
           'humanApprovalRequired', FALSE,
           'githubTransport', 'host_gh_keyring'
         )
  FROM (VALUES ('DEV_LOCAL', 'DEV_LOCAL'), ('DOCKER_LOCAL', 'DOCKER_LOCAL'))
    AS scope(environment_code, config_profile_code)
  ON CONFLICT (
    workflow_execution_principal_id, repository_code, environment_code,
    config_profile_code, workflow_code
  )
  DO UPDATE SET
    allowed_permission_codes = EXCLUDED.allowed_permission_codes,
    status = EXCLUDED.status,
    metadata = EXCLUDED.metadata,
    updated_at = CURRENT_TIMESTAMP;
END;
$$;

DO $$
DECLARE
  primary_version_id UUID;
  alternate_version_id UUID;
  github_tool_id UUID;
  primary_grant_count INTEGER;
  github_node_count INTEGER;
  direct_edge_count INTEGER;
  approval_count INTEGER;
  required_edge_count INTEGER;
BEGIN
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit' AND v.version_number = 21 AND v.status = 'PUBLISHED';
  SELECT v.workflow_version_id INTO alternate_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skycommand-dev-promo-alt' AND v.version_number = 7 AND v.status = 'PUBLISHED';
  SELECT tool_id INTO github_tool_id FROM core.tools WHERE tool_code = 'github_dev_pr_merge' AND enabled = TRUE;
  IF primary_version_id IS NULL OR alternate_version_id IS NULL OR github_tool_id IS NULL THEN
    RAISE EXCEPTION '00143: corrected promotion versions or GitHub Tool are incomplete';
  END IF;

  SELECT COUNT(*) FILTER (WHERE node_type_code = 'HUMAN_APPROVAL'),
         COUNT(*) FILTER (WHERE node_key = 'github_dev_pr_merge_node' AND target_code = 'github_dev_pr_merge')
    INTO approval_count, github_node_count
  FROM worker.workflow_nodes
  WHERE workflow_version_id IN (primary_version_id, alternate_version_id);
  IF approval_count <> 0 OR github_node_count <> 2 THEN
    RAISE EXCEPTION '00143: corrected promotion graph node invariant failed';
  END IF;

  SELECT COUNT(*) INTO direct_edge_count
  FROM worker.workflow_edges e
  JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
  JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
  WHERE e.workflow_version_id IN (primary_version_id, alternate_version_id)
    AND from_node.node_key = 'dev_commit_node'
    AND to_node.node_key = 'merge_sync_node';
  IF direct_edge_count <> 0 THEN
    RAISE EXCEPTION '00143: corrected promotion graph retains a bypass edge';
  END IF;

  SELECT COUNT(*) INTO required_edge_count
  FROM worker.workflow_edges e
  JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
  JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
  WHERE e.workflow_version_id IN (primary_version_id, alternate_version_id)
    AND (
      (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
      (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
      (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
      (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')
    );
  IF required_edge_count <> 8 THEN
    RAISE EXCEPTION '00143: corrected promotion graph required edge invariant failed';
  END IF;

  SELECT COUNT(*) INTO primary_grant_count
  FROM worker.workflow_execution_resource_grants
  WHERE workflow_code = 'skyserver_dev_commit'
    AND status = 'ACTIVE'
    AND metadata->>'managedBy' = '00143_r6_github_dev_pr_merge_correction'
    AND allowed_permission_codes ?& ARRAY[
      'WORKFLOW_RUN', 'DEV_PROMOTION_PREFLIGHT', 'GIT_COMMIT_RUN',
      'GIT_DEV_PR_MERGE_RUN', 'GIT_MAIN_MERGE_RUN', 'GIT_LOCAL_SYNC_RUN'
    ];
  IF primary_grant_count <> 2 THEN
    RAISE EXCEPTION '00143: corrected primary authority grant invariant failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.tools
    WHERE tool_id = github_tool_id
      AND label = 'Merge GitHub Dev PR'
      AND name = 'githubDevPrMerge'
      AND permission_code = 'GIT_DEV_PR_MERGE_RUN'
      AND risk_code = 'high'
      AND requires_confirmation = FALSE
      AND output_type = 'github_dev_pr_merge_summary.v1'
      AND script_path = 'packages/git/src/github_dev_pr_merge.js'
  ) THEN
    RAISE EXCEPTION '00143: GitHub promotion Tool invariant failed';
  END IF;
END;
$$;
