-- Migration: 00142__dev_promotion_r6_workflow_simplification.sql
-- Purpose: Add the R6 reviewed-finalization promotion admission boundary,
--          register deterministic promotion preflight, and publish immutable
--          approval-free versions of both DEV promotion workflows.

CREATE TABLE IF NOT EXISTS worker.dev_promotion_admissions (
  dev_promotion_admission_id UUID PRIMARY KEY,
  workflow_execution_admission_id UUID NOT NULL
    REFERENCES worker.workflow_execution_admissions(workflow_execution_admission_id),
  workflow_run_record_id UUID NOT NULL
    REFERENCES worker.workflow_run_records(workflow_run_record_id),
  principal_code TEXT NOT NULL,
  principal_id UUID,
  repository_code TEXT NOT NULL,
  environment_code TEXT NOT NULL,
  config_profile_code TEXT NOT NULL,
  workflow_code TEXT NOT NULL,
  workflow_version_id UUID NOT NULL
    REFERENCES worker.workflow_versions(workflow_version_id),
  version_number INTEGER NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  finalization_workflow_run_record_id UUID NOT NULL
    REFERENCES worker.workflow_run_records(workflow_run_record_id),
  finalization_receipt_sha256 TEXT NOT NULL,
  finalization_source_identity_digest TEXT NOT NULL,
  trusted_attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PREFLIGHT_RUNNING',
  preflight_output JSONB,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dev_promotion_admission_status_ck CHECK (
    status IN ('PREFLIGHT_RUNNING', 'AUTHORIZED', 'FAILED', 'COMPLETED')
  ),
  CONSTRAINT dev_promotion_admission_workflow_ck CHECK (
    workflow_code = 'skyserver_dev_commit'
  ),
  CONSTRAINT dev_promotion_admission_receipt_digest_ck CHECK (
    finalization_receipt_sha256 ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT dev_promotion_admission_source_digest_ck CHECK (
    finalization_source_identity_digest ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT dev_promotion_admission_request_digest_ck CHECK (
    request_digest ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT dev_promotion_admission_idempotency_digest_ck CHECK (
    idempotency_key_hash ~ '^[A-Fa-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_promotion_admissions_workflow_run
  ON worker.dev_promotion_admissions (workflow_run_record_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_promotion_admissions_scope_active
  ON worker.dev_promotion_admissions (
    repository_code, environment_code, config_profile_code
  )
  WHERE status IN ('PREFLIGHT_RUNNING', 'AUTHORIZED');

CREATE INDEX IF NOT EXISTS idx_dev_promotion_admissions_finalization
  ON worker.dev_promotion_admissions (finalization_workflow_run_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dev_promotion_admissions_principal
  ON worker.dev_promotion_admissions (principal_code, created_at DESC);

DROP TRIGGER IF EXISTS dev_promotion_admissions_set_updated_at
  ON worker.dev_promotion_admissions;
CREATE TRIGGER dev_promotion_admissions_set_updated_at
BEFORE UPDATE ON worker.dev_promotion_admissions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.dev_promotion_admissions IS
  'Durable R6 Assistant promotion admission bound to one reviewed R5 finalization receipt and preflight evidence.';

INSERT INTO auth.permissions (
  app_id, permission_code, resource, action, description, active
)
VALUES (
  (SELECT app_id FROM core.applications
   WHERE app_code = 'SKYSERVER_ADMIN' AND active = TRUE LIMIT 1),
  'DEV_PROMOTION_PREFLIGHT',
  'development_promotion',
  'verify_preflight',
  'Verify reviewed DEV finalization evidence, source identity, database readiness, graph, and promotion ownership before Git mutation.',
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
JOIN auth.permissions p ON p.permission_code = 'DEV_PROMOTION_PREFLIGHT'
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
       'dev_promotion_preflight',
       'devPromotionPreflight',
       'Verify DEV Promotion Preflight',
       'Verify the Assistant-owned R6 promotion admission, reviewed R5 finalization receipt, exact source/config/SQL identity, DEV database readiness, workflow graph, and concurrent-scope lease before Git mutation.',
       r.repo_id,
       'packages/dev-finalization/src/promotionPreflight.js',
       'node',
       'DEV_PROMOTION_PREFLIGHT',
       'medium',
       FALSE,
       NULL,
       TRUE,
       TRUE,
       460,
       TRUE,
       'dev_promotion_preflight_summary.v1',
       'packages/tools/contracts/dev_promotion_preflight_summary.v1.schema.json',
       FALSE
FROM core.applications a
JOIN core.tool_categories c ON c.app_id = a.app_id
JOIN core.repositories r
  ON r.repo_code = 'SkyCommand'
 AND r.is_skycommand_repository = TRUE
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
WHERE t.tool_code = 'dev_promotion_preflight'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH parameter_seed (
  parameter_name, label, param_type_code, prompt, required,
  default_value, option_source_code, display_order
) AS (
  VALUES
    ('repoName', 'Repository', 'repo', 'The registered SkyCommand repository.', TRUE, NULL, 'repositories', 10),
    ('workflowRunId', 'Promotion workflow run id', 'string', 'The governed R6 promotion workflow run record id.', TRUE, NULL, NULL, 20),
    ('finalizationWorkflowRunId', 'Reviewed finalization workflow run id', 'string', 'The successful R5 DEV finalization workflow run record id bound to this promotion.', TRUE, NULL, NULL, 30)
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
JOIN core.tools t ON t.tool_code = 'dev_promotion_preflight'
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
  definition_id UUID;
BEGIN
  FOR definition_id IN
    SELECT workflow_definition_id
    FROM worker.workflow_definitions
    WHERE workflow_code IN ('skyserver_dev_commit', 'skycommand-dev-promo-alt')
      AND status = 'ACTIVE'
      AND enabled = TRUE
  LOOP
    UPDATE worker.workflow_definitions d
    SET config = jsonb_set(
      COALESCE(d.config, '{}'::jsonb),
      '{runtimeParameters}',
      (
        SELECT jsonb_agg(parameter ORDER BY COALESCE((parameter->>'displayOrder')::INTEGER, 999))
        FROM (
          SELECT parameter
          FROM jsonb_array_elements(COALESCE(d.config->'runtimeParameters', '[]'::jsonb)) parameter
          WHERE parameter->>'key' <> 'finalizationWorkflowRunId'
          UNION ALL
          SELECT jsonb_build_object(
            'key', 'finalizationWorkflowRunId',
            'type', 'string',
            'label', 'Reviewed Finalization Workflow Run',
            'prompt', 'Bind this promotion to a successful reviewed R5 DEV finalization receipt.',
            'required', TRUE,
            'maxLength', 64,
            'displayOrder', 30,
            'paramTypeCode', 'string',
            'parameterName', 'finalizationWorkflowRunId'
          )
        ) parameters
      )
    ) || jsonb_build_object(
      'r6PromotionSimplification', TRUE,
      'promotionHumanApprovalRequired', FALSE,
      'promotionTerminalObservationRequired', TRUE,
      'promotionFinalizationWorkflowCode', 'dev_change_finalize'
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE d.workflow_definition_id = definition_id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  current_workflow_code TEXT;
  definition_id UUID;
  old_version_id UUID;
  new_version_id UUID;
  old_version_number INTEGER;
  expected_version_number INTEGER;
  old_approval_count INTEGER;
  new_label TEXT;
BEGIN
  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_version_number := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 20
      ELSE 6
    END;

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

    IF definition_id IS NULL OR old_version_id IS NULL THEN
      RAISE EXCEPTION '00142: active published source workflow % is missing', current_workflow_code;
    END IF;
    IF old_version_number + 1 <> expected_version_number THEN
      RAISE EXCEPTION '00142: expected % source version % before R6, found %', current_workflow_code, expected_version_number - 1, old_version_number;
    END IF;
    SELECT COUNT(*) INTO old_approval_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = old_version_id
      AND node_type_code = 'HUMAN_APPROVAL'
      AND node_key = 'merge_approval_node';
    IF old_approval_count <> 1 THEN
      RAISE EXCEPTION '00142: expected exactly one historical Merge Approval node for %', current_workflow_code;
    END IF;
    IF EXISTS (
      SELECT 1 FROM worker.workflow_versions
      WHERE workflow_definition_id = definition_id
        AND version_number = expected_version_number
    ) THEN
      RAISE EXCEPTION '00142: target version % already exists for %', expected_version_number, current_workflow_code;
    END IF;

    new_label := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 'R6 Promotion Preflight approval simplification v20'
      ELSE 'R6 Promotion Preflight approval simplification v6'
    END;
    INSERT INTO worker.workflow_versions (
      workflow_definition_id, version_number, version_label, status,
      graph_version, definition_snapshot, created_by_user_id,
      published_by_user_id, published_at, created_at, updated_at
    )
    SELECT definition_id, expected_version_number, new_label, 'PUBLISHED',
           graph_version, '{}'::jsonb, COALESCE(published_by_user_id, created_by_user_id),
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

    INSERT INTO worker.workflow_nodes (
      workflow_version_id, node_key, node_type_code, display_name,
      description, target_code, target_ref_id, target_config,
      input_parameters, retry_policy, timeout_ms, position_x, position_y,
      display_order, enabled, config
    )
    SELECT new_version_id,
           'promotion_preflight_node',
           'TOOL',
           'Verify DEV Promotion Preflight',
           'Verify reviewed R5 finalization evidence and current DEV identity before Git mutation.',
           'dev_promotion_preflight',
           t.tool_id,
           '{}'::jsonb,
           jsonb_build_object(
             'repoName', '{{ params.repoName }}',
             'workflowRunId', '{{ workflow.workflowRunRecordId }}',
             'finalizationWorkflowRunId', '{{ params.finalizationWorkflowRunId }}'
           ),
           '{"maximumAttempts":1,"initialIntervalSeconds":5}'::jsonb,
           600000,
           0,
           0,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit' THEN 1 ELSE 5 END,
           TRUE,
           jsonb_build_object('createdBy', '00142_r6_promotion_simplification')
    FROM core.tools t
    WHERE t.tool_code = 'dev_promotion_preflight';

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

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      display_order, config
    )
    SELECT new_version_id,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit'
             THEN 'promotion_preflight_node_to_capability_catalog_node'
             ELSE 'promotion_preflight_node_to_local_dev_pull_node'
           END,
           preflight.workflow_node_id,
           first_node.workflow_node_id,
           'SEQUENTIAL',
           1,
           jsonb_build_object('createdBy', '00142_r6_promotion_simplification')
    FROM worker.workflow_nodes preflight
    JOIN worker.workflow_nodes first_node
      ON first_node.workflow_version_id = new_version_id
     AND first_node.node_key = CASE WHEN current_workflow_code = 'skyserver_dev_commit'
       THEN 'capability_catalog_node' ELSE 'local_dev_pull_node' END
    WHERE preflight.workflow_version_id = new_version_id
      AND preflight.node_key = 'promotion_preflight_node';

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      display_order, config
    )
    SELECT new_version_id, 'dev_commit_node_to_merge_sync_node',
           commit_node.workflow_node_id, merge_node.workflow_node_id,
           'SEQUENTIAL', 40,
           jsonb_build_object('createdBy', '00142_r6_promotion_simplification')
    FROM worker.workflow_nodes commit_node
    JOIN worker.workflow_nodes merge_node
      ON merge_node.workflow_version_id = new_version_id
     AND merge_node.node_key = 'merge_sync_node'
    WHERE commit_node.workflow_version_id = new_version_id
      AND commit_node.node_key = 'dev_commit_node';

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
        'migration', '00142',
        'feature', 'r6_promotion_preflight_approval_simplification',
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
  WHERE principal_code = 'assistant-http'
    AND status = 'ACTIVE'
  LIMIT 1;
  IF principal_id IS NULL THEN
    RAISE EXCEPTION '00142: assistant-http execution principal is missing';
  END IF;
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit'
    AND v.version_number = 20
    AND v.status = 'PUBLISHED';
  IF primary_version_id IS NULL THEN
    RAISE EXCEPTION '00142: published skyserver_dev_commit v20 is missing';
  END IF;

  INSERT INTO worker.workflow_execution_resource_grants (
    workflow_execution_principal_id, repository_code, environment_code,
    config_profile_code, workflow_code, allowed_permission_codes, status, metadata
  )
  SELECT principal_id, 'SkyCommand', scope.environment_code,
         scope.config_profile_code, 'skyserver_dev_commit',
         '["WORKFLOW_RUN","DEV_PROMOTION_PREFLIGHT","CAPABILITY_CATALOG_EXPORT","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","GIT_COMMIT_RUN","GIT_MAIN_MERGE_RUN","GIT_LOCAL_SYNC_RUN","CORE_RUN_LOW_RISK_SCRIPT","CORE_RUN_MEDIUM_RISK_SCRIPT","CORE_RUN_HIGH_RISK_SCRIPT"]'::jsonb,
         'ACTIVE',
         jsonb_build_object(
           'managedBy', '00142_r6_promotion_simplification',
           'pinnedWorkflowVersionId', primary_version_id,
           'pinnedVersionNumber', 20,
           'scope', 'R6_promotion',
           'humanApprovalRequired', FALSE
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
  approval_count INTEGER;
  preflight_count INTEGER;
  direct_merge_count INTEGER;
  grant_count INTEGER;
BEGIN
  SELECT v.workflow_version_id INTO primary_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skyserver_dev_commit' AND v.version_number = 20 AND v.status = 'PUBLISHED';
  SELECT v.workflow_version_id INTO alternate_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'skycommand-dev-promo-alt' AND v.version_number = 6 AND v.status = 'PUBLISHED';
  IF primary_version_id IS NULL OR alternate_version_id IS NULL THEN
    RAISE EXCEPTION '00142: R6 published promotion workflow versions are incomplete';
  END IF;

  SELECT COUNT(*) FILTER (WHERE node_type_code = 'HUMAN_APPROVAL'),
         COUNT(*) FILTER (WHERE node_key = 'promotion_preflight_node'),
         COUNT(*) FILTER (WHERE target_code = 'dev_promotion_preflight')
  INTO approval_count, preflight_count, direct_merge_count
  FROM worker.workflow_nodes
  WHERE workflow_version_id = primary_version_id;
  IF approval_count <> 0 OR preflight_count <> 1 OR direct_merge_count <> 1 THEN
    RAISE EXCEPTION '00142: primary R6 workflow graph invariant failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = primary_version_id
      AND from_node.node_key = 'dev_commit_node'
      AND to_node.node_key = 'merge_sync_node'
  ) THEN
    RAISE EXCEPTION '00142: primary R6 direct merge edge is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM worker.workflow_nodes
    WHERE workflow_version_id IN (primary_version_id, alternate_version_id)
      AND node_type_code = 'HUMAN_APPROVAL'
  ) THEN
    RAISE EXCEPTION '00142: R6 promotion versions retain a human approval node';
  END IF;

  SELECT COUNT(*) INTO grant_count
  FROM worker.workflow_execution_resource_grants
  WHERE workflow_code = 'skyserver_dev_commit'
    AND status = 'ACTIVE'
    AND metadata->>'managedBy' = '00142_r6_promotion_simplification'
    AND allowed_permission_codes ?& ARRAY[
      'WORKFLOW_RUN', 'DEV_PROMOTION_PREFLIGHT', 'CAPABILITY_CATALOG_EXPORT',
      'REPO_MAP_GENERATE', 'REPO_ZIP_GENERATE', 'GIT_COMMIT_RUN',
      'GIT_MAIN_MERGE_RUN', 'GIT_LOCAL_SYNC_RUN'
    ];
  IF grant_count <> 2 THEN
    RAISE EXCEPTION '00142: expected DEV_LOCAL and DOCKER_LOCAL R6 grants, found %', grant_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.tools
    WHERE tool_code = 'dev_promotion_preflight'
      AND enabled = TRUE
      AND permission_code = 'DEV_PROMOTION_PREFLIGHT'
      AND risk_code = 'medium'
      AND output_type = 'dev_promotion_preflight_summary.v1'
  ) THEN
    RAISE EXCEPTION '00142: R6 promotion preflight Tool registration is invalid';
  END IF;
END;
$$;
