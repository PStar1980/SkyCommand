-- Migration: 00161__development_promotion_secret_leak_gate.sql
-- Purpose: Register a fail-closed, redacted Secret Leak Gate and publish
--          immutable Development Promotion graph versions that place it after
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
  'SECRET_LEAK_GATE',
  'files',
  'run_secret_leak_gate',
  'Inspect the exact promotion source scope and generated public artifacts for credential material without returning secret values.',
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
  AND p.permission_code = 'SECRET_LEAK_GATE'
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
       'secret_leak_gate',
       'secretLeakGate',
       'Secret Leak Gate',
       'Fail-closed redacted inspection of the exact Git promotion scope and generated Capability Catalogue, Repository Map, and Repository ZIP artifacts.',
       r.repo_id,
       'packages/dev-finalization/src/secretLeakGate.js',
       'node',
       'SECRET_LEAK_GATE',
       'medium',
       FALSE,
       NULL,
       TRUE,
       TRUE,
       25,
       TRUE,
       'secret_leak_gate_summary.v1',
       'packages/tools/contracts/secret_leak_gate_summary.v1.schema.json',
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
WHERE t.tool_code = 'secret_leak_gate'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH gate_parameters (
  parameter_name,
  label,
  prompt,
  param_type_code,
  required,
  display_order
) AS (
  VALUES
    ('repoName', 'Repository', 'The registered repository to inspect.', 'repo', TRUE, 10),
    ('capabilityCatalogJsonPath', 'Capability Catalogue JSON', 'The generated JSON artifact path.', 'string', TRUE, 20),
    ('capabilityCatalogXlsxPath', 'Capability Catalogue XLSX', 'The generated XLSX artifact path.', 'string', TRUE, 30),
    ('repositoryMapPath', 'Repository Map', 'The generated Repository Map artifact path.', 'string', TRUE, 40),
    ('repositoryZipPath', 'Repository ZIP', 'The generated Repository ZIP artifact path.', 'string', TRUE, 50),
    ('workflowRunId', 'Promotion Workflow Run ID', 'The current governed promotion workflow run record ID.', 'string', TRUE, 60),
    ('expectedSourceIdentityDigest', 'Expected Source Identity Digest', 'Optional expected source identity digest used only for revalidation.', 'string', FALSE, 70),
    ('expectedArtifactIdentityDigest', 'Expected Artifact Identity Digest', 'Optional expected artifact identity digest used only for revalidation.', 'string', FALSE, 80)
)
INSERT INTO core.tool_parameters (
  tool_id,
  parameter_name,
  label,
  param_type_code,
  prompt,
  required,
  default_value,
  option_source_code,
  display_order,
  enabled,
  argument_mode,
  cli_flag
)
SELECT t.tool_id,
       p.parameter_name,
       p.label,
       p.param_type_code,
       p.prompt,
       p.required,
       NULL,
       CASE WHEN p.param_type_code = 'repo' THEN 'repositories' ELSE NULL END,
       p.display_order,
       TRUE,
       'POSITIONAL',
       NULL
FROM core.tools t
CROSS JOIN gate_parameters p
WHERE t.tool_code = 'secret_leak_gate'
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

WITH commit_parameters (
  parameter_name,
  label,
  prompt,
  display_order
) AS (
  VALUES
    ('secretLeakGateSourceIdentityDigest', 'Secret Leak Gate Source Identity Digest', 'The source identity digest produced by the immediately preceding Secret Leak Gate.', 50),
    ('secretLeakGateArtifactIdentityDigest', 'Secret Leak Gate Artifact Identity Digest', 'The artifact identity digest produced by the immediately preceding Secret Leak Gate.', 60),
    ('secretLeakGateCapabilityCatalogJsonPath', 'Secret Leak Gate Capability Catalogue JSON Path', 'The exact Capability Catalogue JSON path inspected by the gate.', 70),
    ('secretLeakGateCapabilityCatalogXlsxPath', 'Secret Leak Gate Capability Catalogue XLSX Path', 'The exact Capability Catalogue XLSX path inspected by the gate.', 80),
    ('secretLeakGateRepositoryMapPath', 'Secret Leak Gate Repository Map Path', 'The exact Repository Map path inspected by the gate.', 90),
    ('secretLeakGateRepositoryZipPath', 'Secret Leak Gate Repository ZIP Path', 'The exact Repository ZIP path inspected by the gate.', 100)
)
INSERT INTO core.tool_parameters (
  tool_id,
  parameter_name,
  label,
  param_type_code,
  prompt,
  required,
  default_value,
  option_source_code,
  display_order,
  enabled,
  argument_mode,
  cli_flag
)
SELECT t.tool_id,
       p.parameter_name,
       p.label,
       'string',
       p.prompt,
       FALSE,
       NULL,
       NULL,
       p.display_order,
       TRUE,
       'POSITIONAL',
       NULL
FROM core.tools t
CROSS JOIN commit_parameters p
WHERE t.tool_code = 'dev_commit'
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
  gate_parameter_count INTEGER;
  commit_parameter_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO gate_parameter_count
  FROM core.vw_tool_parameters
  WHERE tool_code = 'secret_leak_gate'
    AND parameter_name IN (
      'repoName', 'capabilityCatalogJsonPath', 'capabilityCatalogXlsxPath',
      'repositoryMapPath', 'repositoryZipPath', 'workflowRunId',
      'expectedSourceIdentityDigest', 'expectedArtifactIdentityDigest'
    );
  IF gate_parameter_count <> 8 THEN
    RAISE EXCEPTION '00161: Secret Leak Gate parameter contract is incomplete';
  END IF;

  SELECT COUNT(*) INTO commit_parameter_count
  FROM core.vw_tool_parameters
  WHERE tool_code = 'dev_commit'
    AND parameter_name IN (
      'repoName', 'commitMessage', 'finalizationWorkflowRunId', 'workflowRunId',
      'secretLeakGateSourceIdentityDigest', 'secretLeakGateArtifactIdentityDigest',
      'secretLeakGateCapabilityCatalogJsonPath', 'secretLeakGateCapabilityCatalogXlsxPath',
      'secretLeakGateRepositoryMapPath', 'secretLeakGateRepositoryZipPath'
    );
  IF commit_parameter_count <> 10 THEN
    RAISE EXCEPTION '00161: dev_commit Secret Leak Gate binding parameters are incomplete';
  END IF;
END;
$$;

DO $$
DECLARE
  current_workflow_code TEXT;
  definition_id UUID;
  old_version_id UUID;
  new_version_id UUID;
  old_version_number INTEGER;
  expected_old_version INTEGER;
  new_version_number INTEGER;
  commit_order INTEGER;
  commit_position_x NUMERIC;
  commit_position_y NUMERIC;
  zip_commit_edge_order INTEGER;
  deleted_edge_count INTEGER;
  gate_tool_id UUID;
BEGIN
  SELECT tool_id INTO gate_tool_id FROM core.tools WHERE tool_code = 'secret_leak_gate' AND enabled = TRUE;
  IF gate_tool_id IS NULL THEN
    RAISE EXCEPTION '00161: registered Secret Leak Gate Tool is unavailable';
  END IF;

  FOREACH current_workflow_code IN ARRAY ARRAY['skyserver_dev_commit', 'skycommand-dev-promo-alt']
  LOOP
    expected_old_version := CASE
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 22
      ELSE 8
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
      RAISE EXCEPTION '00161: expected published source version is unavailable for %', current_workflow_code;
    END IF;
    IF EXISTS (
      SELECT 1 FROM worker.workflow_versions
      WHERE workflow_definition_id = definition_id AND version_number = new_version_number
    ) THEN
      RAISE EXCEPTION '00161: target version already exists for %', current_workflow_code;
    END IF;

    IF EXISTS (
      SELECT 1 FROM worker.workflow_nodes
      WHERE workflow_version_id = old_version_id AND node_type_code = 'HUMAN_APPROVAL'
    ) THEN
      RAISE EXCEPTION '00161: source promotion graph contains an approval node for %', current_workflow_code;
    END IF;

    INSERT INTO worker.workflow_versions (
      workflow_definition_id, version_number, version_label, status,
      graph_version, definition_snapshot, created_by_user_id,
      published_by_user_id, published_at, created_at, updated_at
    )
    SELECT definition_id,
           new_version_number,
           CASE WHEN current_workflow_code = 'skyserver_dev_commit'
             THEN 'Development Promotion Secret Leak Gate v23'
             ELSE 'Development Promotion Secret Leak Gate v9'
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

    SELECT display_order, position_x, position_y
      INTO commit_order, commit_position_x, commit_position_y
    FROM worker.workflow_nodes
    WHERE workflow_version_id = new_version_id
      AND node_key = 'dev_commit_node';
    IF commit_order IS NULL THEN
      RAISE EXCEPTION '00161: dev_commit_node is missing for %', current_workflow_code;
    END IF;

    UPDATE worker.workflow_nodes
    SET display_order = display_order + 1
    WHERE workflow_version_id = new_version_id
      AND display_order >= commit_order;

    INSERT INTO worker.workflow_nodes (
      workflow_version_id, node_key, node_type_code, display_name,
      description, target_code, target_ref_id, target_config,
      input_parameters, retry_policy, timeout_ms, position_x, position_y,
      display_order, enabled, config
    )
    SELECT new_version_id,
           'secret_leak_gate_node',
           'TOOL',
           'Secret Leak Gate',
           'Fail closed if the exact source-control mutation scope or generated public evidence contains credential material or cannot be safely inspected.',
           'secret_leak_gate',
           gate_tool_id,
           '{}'::jsonb,
           jsonb_build_object(
             'repoName', '{{ params.repoName }}',
             'capabilityCatalogJsonPath', '{{ nodes.capability_catalog_node.output.generatedArtifactPaths.json }}',
             'capabilityCatalogXlsxPath', '{{ nodes.capability_catalog_node.output.generatedArtifactPaths.xlsx }}',
             'repositoryMapPath', '{{ nodes.repo_map_node.output.artifactPath }}',
             'repositoryZipPath', '{{ nodes.repo_zip_node.output.artifactPath }}',
             'workflowRunId', '{{ workflow.workflowRunRecordId }}'
           ),
           '{"maximumAttempts":1,"initialIntervalSeconds":5}'::jsonb,
           900000,
           commit_position_x,
           commit_position_y,
           commit_order,
           TRUE,
           jsonb_build_object(
             'createdBy', '00161_development_promotion_secret_leak_gate',
             'failClosed', TRUE,
             'sourceScope', 'GIT_ADD_A',
             'revalidateAtDevCommit', TRUE
           );

    UPDATE worker.workflow_nodes
    SET input_parameters = COALESCE(input_parameters, '{}'::jsonb) || jsonb_build_object(
      'secretLeakGateSourceIdentityDigest', '{{ nodes.secret_leak_gate_node.output.sourceIdentityDigest }}',
      'secretLeakGateArtifactIdentityDigest', '{{ nodes.secret_leak_gate_node.output.artifactIdentityDigest }}',
      'secretLeakGateCapabilityCatalogJsonPath', '{{ nodes.capability_catalog_node.output.generatedArtifactPaths.json }}',
      'secretLeakGateCapabilityCatalogXlsxPath', '{{ nodes.capability_catalog_node.output.generatedArtifactPaths.xlsx }}',
      'secretLeakGateRepositoryMapPath', '{{ nodes.repo_map_node.output.artifactPath }}',
      'secretLeakGateRepositoryZipPath', '{{ nodes.repo_zip_node.output.artifactPath }}'
    ),
        config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
          'createdBy', '00161_development_promotion_secret_leak_gate',
          'secretLeakGateRequired', TRUE,
          'revalidateBeforeGitMutation', TRUE
        )
    WHERE workflow_version_id = new_version_id
      AND node_key = 'dev_commit_node';

    SELECT e.display_order
      INTO zip_commit_edge_order
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = new_version_id
      AND from_node.node_key = 'repo_zip_node'
      AND to_node.node_key = 'dev_commit_node'
    LIMIT 1;
    IF zip_commit_edge_order IS NULL THEN
      RAISE EXCEPTION '00161: source artifact-to-mutation edge is missing for %', current_workflow_code;
    END IF;

    DELETE FROM worker.workflow_edges e
    USING worker.workflow_nodes from_node, worker.workflow_nodes to_node
    WHERE e.workflow_version_id = new_version_id
      AND e.from_node_id = from_node.workflow_node_id
      AND e.to_node_id = to_node.workflow_node_id
      AND from_node.workflow_version_id = new_version_id
      AND to_node.workflow_version_id = new_version_id
      AND from_node.node_key = 'repo_zip_node'
      AND to_node.node_key = 'dev_commit_node';
    GET DIAGNOSTICS deleted_edge_count = ROW_COUNT;
    IF deleted_edge_count <> 1 THEN
      RAISE EXCEPTION '00161: expected one artifact-to-mutation edge for %', current_workflow_code;
    END IF;

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      condition_expression, display_order, config
    )
    SELECT new_version_id,
           'repo_zip_node_to_secret_leak_gate_node',
           from_node.workflow_node_id,
           gate_node.workflow_node_id,
           'SEQUENTIAL',
           NULL,
           zip_commit_edge_order,
           jsonb_build_object('createdBy', '00161_development_promotion_secret_leak_gate')
    FROM worker.workflow_nodes from_node
    JOIN worker.workflow_nodes gate_node
      ON gate_node.workflow_version_id = new_version_id
     AND gate_node.node_key = 'secret_leak_gate_node'
    WHERE from_node.workflow_version_id = new_version_id
      AND from_node.node_key = 'repo_zip_node';

    INSERT INTO worker.workflow_edges (
      workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
      condition_expression, display_order, config
    )
    SELECT new_version_id,
           'secret_leak_gate_node_to_dev_commit_node',
           gate_node.workflow_node_id,
           commit_node.workflow_node_id,
           'SEQUENTIAL',
           NULL,
           zip_commit_edge_order + 1,
           jsonb_build_object('createdBy', '00161_development_promotion_secret_leak_gate')
    FROM worker.workflow_nodes gate_node
    JOIN worker.workflow_nodes commit_node
      ON commit_node.workflow_version_id = new_version_id
     AND commit_node.node_key = 'dev_commit_node'
    WHERE gate_node.workflow_version_id = new_version_id
      AND gate_node.node_key = 'secret_leak_gate_node';

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
        'migration', '00161',
        'feature', 'development_promotion_secret_leak_gate',
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
    AND v.version_number = 23
    AND v.status = 'PUBLISHED';
  IF principal_id IS NULL OR primary_version_id IS NULL THEN
    RAISE EXCEPTION '00161: primary Assistant authority target is unavailable';
  END IF;

  UPDATE worker.workflow_execution_resource_grants
  SET allowed_permission_codes = CASE
        WHEN allowed_permission_codes ? 'SECRET_LEAK_GATE'
          THEN allowed_permission_codes
        ELSE allowed_permission_codes || '["SECRET_LEAK_GATE"]'::jsonb
      END,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'managedBy', '00161_development_promotion_secret_leak_gate',
        'pinnedWorkflowVersionId', primary_version_id,
        'pinnedVersionNumber', 23
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
    RAISE EXCEPTION '00161: expected two active primary Assistant grants, updated %', updated_grant_count;
  END IF;
END;
$$;

DO $$
DECLARE
  current_workflow_code TEXT;
  expected_version INTEGER;
  current_version_id UUID;
  previous_version_status TEXT;
  gate_count INTEGER;
  approval_count INTEGER;
  zip_order INTEGER;
  gate_order INTEGER;
  commit_order INTEGER;
  github_order INTEGER;
  merge_order INTEGER;
  local_order INTEGER;
  summary_order INTEGER;
  maximum_order INTEGER;
  gate_incoming_count INTEGER;
  gate_outgoing_count INTEGER;
  required_edge_count INTEGER;
  bypass_edge_count INTEGER;
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
      WHEN current_workflow_code = 'skyserver_dev_commit' THEN 23
      ELSE 9
    END;
    SELECT v.workflow_version_id INTO current_version_id
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version
      AND v.status = 'PUBLISHED';
    IF current_version_id IS NULL THEN
      RAISE EXCEPTION '00161: Secret Leak Gate published version is missing for %', current_workflow_code;
    END IF;

    SELECT v.status INTO previous_version_status
    FROM worker.workflow_versions v
    JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
    WHERE d.workflow_code = current_workflow_code
      AND v.version_number = expected_version - 1;
    IF previous_version_status <> 'RETIRED' THEN
      RAISE EXCEPTION '00161: historical source version was not retired for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE node_type_code = 'HUMAN_APPROVAL'),
           COUNT(*) FILTER (WHERE node_key = 'secret_leak_gate_node' AND target_code = 'secret_leak_gate')
      INTO approval_count, gate_count
    FROM worker.workflow_nodes
    WHERE workflow_version_id = current_version_id;
    IF approval_count <> 0 OR gate_count <> 1 THEN
      RAISE EXCEPTION '00161: Secret Leak Gate node invariant failed for %', current_workflow_code;
    END IF;

    SELECT MAX(display_order) FILTER (WHERE node_key = 'repo_zip_node'),
           MAX(display_order) FILTER (WHERE node_key = 'secret_leak_gate_node'),
           MAX(display_order) FILTER (WHERE node_key = 'dev_commit_node'),
           MAX(display_order) FILTER (WHERE node_key = 'github_dev_pr_merge_node'),
           MAX(display_order) FILTER (WHERE node_key = 'merge_sync_node'),
           MAX(display_order) FILTER (WHERE node_key = 'local_repo_sync_node'),
           MAX(display_order) FILTER (WHERE node_key = 'dev_promotion_summary'),
           MAX(display_order)
      INTO zip_order, gate_order, commit_order, github_order, merge_order,
           local_order, summary_order, maximum_order
    FROM worker.workflow_nodes
    WHERE workflow_version_id = current_version_id;
    IF gate_order IS NULL OR zip_order >= gate_order OR gate_order >= commit_order
       OR commit_order >= github_order OR github_order >= merge_order
       OR merge_order >= local_order OR local_order >= summary_order
       OR summary_order <> maximum_order THEN
      RAISE EXCEPTION '00161: Secret Leak Gate display order invariant failed for %', current_workflow_code;
    END IF;

    SELECT COUNT(*) FILTER (WHERE to_node.node_key = 'secret_leak_gate_node'),
           COUNT(*) FILTER (WHERE from_node.node_key = 'secret_leak_gate_node'),
           COUNT(*) FILTER (WHERE
             (from_node.node_key = 'repo_zip_node' AND to_node.node_key = 'secret_leak_gate_node') OR
             (from_node.node_key = 'secret_leak_gate_node' AND to_node.node_key = 'dev_commit_node') OR
             (from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'github_dev_pr_merge_node') OR
             (from_node.node_key = 'github_dev_pr_merge_node' AND to_node.node_key = 'merge_sync_node') OR
             (from_node.node_key = 'merge_sync_node' AND to_node.node_key = 'local_repo_sync_node') OR
             (from_node.node_key = 'local_repo_sync_node' AND to_node.node_key = 'dev_promotion_summary')),
           COUNT(*) FILTER (WHERE from_node.node_key = 'dev_commit_node' AND to_node.node_key = 'merge_sync_node')
      INTO gate_incoming_count, gate_outgoing_count, required_edge_count, bypass_edge_count
    FROM worker.workflow_edges e
    JOIN worker.workflow_nodes from_node ON from_node.workflow_node_id = e.from_node_id
    JOIN worker.workflow_nodes to_node ON to_node.workflow_node_id = e.to_node_id
    WHERE e.workflow_version_id = current_version_id;
    IF gate_incoming_count <> 1 OR gate_outgoing_count <> 1
       OR required_edge_count <> 6 OR bypass_edge_count <> 0 THEN
      RAISE EXCEPTION '00161: Secret Leak Gate edge chain invariant failed for %', current_workflow_code;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM worker.workflow_nodes n
      WHERE n.workflow_version_id = current_version_id
        AND n.node_key = 'dev_commit_node'
        AND (
          NOT (n.input_parameters ? 'secretLeakGateSourceIdentityDigest') OR
          NOT (n.input_parameters ? 'secretLeakGateArtifactIdentityDigest') OR
          NOT (n.input_parameters ? 'secretLeakGateRepositoryZipPath') OR
          NOT (n.config ? 'secretLeakGateRequired')
        )
    ) THEN
      RAISE EXCEPTION '00161: source-control gate binding invariant failed for %', current_workflow_code;
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
      RAISE EXCEPTION '00161: definition snapshot does not equal live graph for %', current_workflow_code;
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
    AND v.version_number = 23
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
    AND g.metadata->>'pinnedVersionNumber' = '23';
  IF primary_grant_count <> 2 THEN
    RAISE EXCEPTION '00161: primary Assistant Secret Leak Gate grant pin invariant failed';
  END IF;

  SELECT COUNT(*) INTO required_permission_count
  FROM worker.workflow_execution_resource_grants g
  WHERE g.workflow_execution_principal_id = principal_id
    AND g.repository_code = 'SkyCommand'
    AND g.workflow_code = 'skyserver_dev_commit'
    AND g.status = 'ACTIVE'
    AND g.environment_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND g.config_profile_code IN ('DEV_LOCAL', 'DOCKER_LOCAL')
    AND jsonb_array_length(g.allowed_permission_codes) = 13
    AND g.allowed_permission_codes ?& ARRAY[
      'WORKFLOW_RUN', 'DEV_PROMOTION_PREFLIGHT', 'CAPABILITY_CATALOG_EXPORT',
      'REPO_MAP_GENERATE', 'REPO_ZIP_GENERATE', 'SECRET_LEAK_GATE',
      'GIT_COMMIT_RUN', 'GIT_DEV_PR_MERGE_RUN', 'GIT_MAIN_MERGE_RUN',
      'GIT_LOCAL_SYNC_RUN', 'CORE_RUN_LOW_RISK_SCRIPT',
      'CORE_RUN_MEDIUM_RISK_SCRIPT', 'CORE_RUN_HIGH_RISK_SCRIPT'
    ];
  IF required_permission_count <> 2 THEN
    RAISE EXCEPTION '00161: primary Assistant Secret Leak Gate permission invariant failed';
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
    RAISE EXCEPTION '00161: alternate Assistant grant must remain absent';
  END IF;
END;
$$;
