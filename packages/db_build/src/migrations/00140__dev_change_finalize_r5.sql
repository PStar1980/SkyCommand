-- R5 governed DEV finalization Workflow.
--
-- This migration registers one immutable, published workflow and its bounded
-- Tool graph. The workflow is limited to the registered SkyCommand DEV_LOCAL /
-- DOCKER_LOCAL repository bindings and never grants source-control mutation or
-- promotion authority.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS worker.dev_finalization_locks (
  lock_id UUID PRIMARY KEY,
  repository_code TEXT NOT NULL,
  environment_code TEXT NOT NULL,
  config_profile_code TEXT NOT NULL,
  owner_workflow_run_record_id UUID NOT NULL
    REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD', 'RELEASED', 'EXPIRED')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_finalization_active_lock_scope
  ON worker.dev_finalization_locks (repository_code, environment_code, config_profile_code)
  WHERE status = 'HELD';

CREATE INDEX IF NOT EXISTS idx_dev_finalization_lock_owner
  ON worker.dev_finalization_locks (owner_workflow_run_record_id, status);

DROP TRIGGER IF EXISTS dev_finalization_locks_set_updated_at ON worker.dev_finalization_locks;
CREATE TRIGGER dev_finalization_locks_set_updated_at
BEFORE UPDATE ON worker.dev_finalization_locks
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

CREATE TABLE IF NOT EXISTS worker.dev_finalization_runs (
  dev_finalization_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL UNIQUE
    REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  workflow_code TEXT NOT NULL,
  repository_code TEXT NOT NULL,
  environment_code TEXT NOT NULL,
  config_profile_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'BUSY')),
  lock_id UUID REFERENCES worker.dev_finalization_locks(lock_id) ON DELETE SET NULL,
  source_identity_digest TEXT,
  source_identity_manifest JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(source_identity_manifest) = 'array'),
  source_identity JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_identity) = 'object'),
  preflight_output JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(preflight_output) = 'object'),
  lifecycle_output JSONB,
  validation_output JSONB,
  readiness_output JSONB,
  artifact_manifest JSONB,
  receipt_payload JSONB,
  receipt_path TEXT,
  receipt_sha256 TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  CONSTRAINT dev_finalization_run_digest_ck CHECK (
    source_identity_digest IS NULL OR source_identity_digest ~ '^[A-Fa-f0-9]{64}$'
  ),
  CONSTRAINT dev_finalization_receipt_digest_ck CHECK (
    receipt_sha256 IS NULL OR receipt_sha256 ~ '^[A-Fa-f0-9]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_dev_finalization_runs_scope_status
  ON worker.dev_finalization_runs (
    repository_code, environment_code, config_profile_code, status, created_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_dev_finalization_runs_source_digest
  ON worker.dev_finalization_runs (source_identity_digest, completed_at DESC);

DROP TRIGGER IF EXISTS dev_finalization_runs_set_updated_at ON worker.dev_finalization_runs;
CREATE TRIGGER dev_finalization_runs_set_updated_at
BEFORE UPDATE ON worker.dev_finalization_runs
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.dev_finalization_locks IS
  'Durable repository/environment/profile lease for one concurrent R5 DEV finalization run.';
COMMENT ON TABLE worker.dev_finalization_runs IS
  'Durable R5 preflight, lifecycle, validation, readiness, artifact, receipt, and failure evidence.';

WITH permission_seed(permission_code, resource, action, description) AS (
  VALUES
    ('DEV_FINALIZATION_PREFLIGHT', 'development_finalization', 'preflight', 'Acquire and persist the bounded R5 DEV finalization lease and source identity.'),
    ('DEV_RUNTIME_LIFECYCLE', 'development_runtime', 'rebuild_allowlisted_services', 'Rebuild only the fixed R5 Docker service allowlist through the Host Agent Supervisor.'),
    ('DEV_FINALIZATION_VALIDATE', 'development_finalization', 'validate', 'Run the deterministic R5 validation profile.'),
    ('DEV_FINALIZATION_READINESS', 'development_finalization', 'readiness', 'Probe R5 database, runtime, registration, and Host Agent readiness.'),
    ('DEV_FINALIZATION_RECEIPT', 'development_finalization', 'persist_receipt', 'Persist the R5 finalization receipt and verified artifact hashes.')
)
INSERT INTO auth.permissions (
  app_id, permission_code, resource, action, description, active
)
SELECT a.app_id, s.permission_code, s.resource, s.action, s.description, TRUE
FROM core.applications a
CROSS JOIN permission_seed s
WHERE a.app_code = 'SKYSERVER_ADMIN'
  AND a.active = TRUE
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
JOIN auth.permissions p
  ON p.permission_code IN (
    'DEV_FINALIZATION_PREFLIGHT',
    'DEV_RUNTIME_LIFECYCLE',
    'DEV_FINALIZATION_VALIDATE',
    'DEV_FINALIZATION_READINESS',
    'DEV_FINALIZATION_RECEIPT'
  )
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

WITH tool_seed (
  tool_code, tool_name, tool_label, tool_description, script_path,
  permission_code, risk_code, output_type, output_schema_path, display_order
) AS (
  VALUES
    ('dev_finalization_preflight', 'devFinalizationPreflight', 'R5 DEV Finalization Preflight', 'Acquire the registered SkyCommand repository lease, compute the redacted source identity, and plan governed database changes.', 'packages/dev-finalization/src/preflight.js', 'DEV_FINALIZATION_PREFLIGHT', 'medium', 'dev_finalization_preflight_summary.v1', 'packages/tools/contracts/dev_finalization_preflight_summary.v1.schema.json', 410),
    ('dev_runtime_lifecycle', 'devRuntimeLifecycle', 'R5 DEV Runtime Lifecycle', 'Dispatch the fixed R5 REBUILD_SERVICES operation through the Host Agent Supervisor allowlist.', 'packages/dev-finalization/src/lifecycle.js', 'DEV_RUNTIME_LIFECYCLE', 'high', 'dev_finalization_lifecycle_summary.v1', 'packages/tools/contracts/dev_finalization_lifecycle_summary.v1.schema.json', 420),
    ('dev_finalization_validate', 'devFinalizationValidate', 'R5 DEV Finalization Validation', 'Run the deterministic R5 validation profile and persist pass or known-limitation evidence.', 'packages/dev-finalization/src/validation.js', 'DEV_FINALIZATION_VALIDATE', 'low', 'dev_finalization_validation_summary.v1', 'packages/tools/contracts/dev_finalization_validation_summary.v1.schema.json', 430),
    ('dev_finalization_readiness', 'devFinalizationReadiness', 'R5 DEV Finalization Readiness', 'Verify the live database, API, web scope, registered graph, and Host Agent runtime state.', 'packages/dev-finalization/src/readiness.js', 'DEV_FINALIZATION_READINESS', 'low', 'dev_finalization_readiness_summary.v1', 'packages/tools/contracts/dev_finalization_readiness_summary.v1.schema.json', 440),
    ('dev_finalization_receipt', 'devFinalizationReceipt', 'R5 DEV Finalization Receipt', 'Verify and hash the generated catalogue, map, and repository ZIP, then persist the durable R5 completion receipt.', 'packages/dev-finalization/src/receipt.js', 'DEV_FINALIZATION_RECEIPT', 'medium', 'dev_finalization_summary.v1', 'packages/tools/contracts/dev_finalization_summary.v1.schema.json', 450)
)
INSERT INTO core.tools (
  category_id, tool_code, name, label, description, script_repo_id, script_path,
  runtime_code, permission_code, risk_code, requires_confirmation, confirmation_text,
  captures_output, allow_params, display_order, enabled, output_type, output_schema_path,
  managed_by_skycommand
)
SELECT c.category_id, s.tool_code, s.tool_name, s.tool_label, s.tool_description,
       r.repo_id, s.script_path, 'node', s.permission_code, s.risk_code, FALSE, NULL,
       TRUE, TRUE, s.display_order, TRUE, s.output_type, s.output_schema_path, FALSE
FROM tool_seed s
JOIN core.applications a
  ON a.app_code = 'SKYSERVER_CORE' AND a.active = TRUE
JOIN core.tool_categories c
  ON c.app_id = a.app_id AND c.category_code = 'file_tools' AND c.enabled = TRUE
JOIN core.repositories r
  ON r.repo_code = 'SkyCommand' AND r.is_skycommand_repository = TRUE AND r.active = TRUE
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
WHERE t.tool_code IN (
  'dev_finalization_preflight',
  'dev_runtime_lifecycle',
  'dev_finalization_validate',
  'dev_finalization_readiness',
  'dev_finalization_receipt'
)
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH parameter_seed(tool_code, parameter_name, label, param_type_code, prompt, required, default_value, option_source_code, display_order) AS (
  VALUES
    ('dev_finalization_preflight', 'repoName', 'Repository', 'repo', 'The registered SkyCommand repository.', TRUE, NULL, 'repositories', 10),
    ('dev_finalization_preflight', 'workflowRunId', 'Workflow run id', 'string', 'The preallocated R5 workflow run record id.', TRUE, NULL, NULL, 20),
    ('dev_finalization_preflight', 'envPatchJson', 'Non-secret configuration patch JSON', 'string', 'An optional typed allowlisted configuration patch; use {} for no patch.', TRUE, '{}', NULL, 30),
    ('dev_runtime_lifecycle', 'runId', 'Workflow run id', 'string', 'The R5 workflow run record id.', TRUE, NULL, NULL, 10),
    ('dev_runtime_lifecycle', 'action', 'Lifecycle action', 'string', 'Fixed to REBUILD_SERVICES.', TRUE, 'REBUILD_SERVICES', NULL, 20),
    ('dev_runtime_lifecycle', 'servicesJson', 'Allowlisted services JSON', 'string', 'JSON array of services selected by R5 preflight.', TRUE, NULL, NULL, 30),
    ('dev_finalization_validate', 'runId', 'Workflow run id', 'string', 'The R5 workflow run record id.', TRUE, NULL, NULL, 10),
    ('dev_finalization_readiness', 'runId', 'Workflow run id', 'string', 'The R5 workflow run record id.', TRUE, NULL, NULL, 10),
    ('dev_finalization_receipt', 'runId', 'Workflow run id', 'string', 'The R5 workflow run record id.', TRUE, NULL, NULL, 10)
)
INSERT INTO core.tool_parameters (
  tool_id, parameter_name, label, param_type_code, prompt, required, default_value,
  option_source_code, display_order, enabled, argument_mode, cli_flag
)
SELECT t.tool_id, p.parameter_name, p.label, p.param_type_code, p.prompt, p.required,
       p.default_value, p.option_source_code, p.display_order, TRUE, 'POSITIONAL', NULL
FROM parameter_seed p
JOIN core.tools t ON t.tool_code = p.tool_code
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

DO $r5_workflow$
DECLARE
  definition_id UUID;
  version_id UUID;
  node_id UUID;
  principal_id UUID;
  r5_workflow_code CONSTANT TEXT := 'dev_change_finalize';
BEGIN
  INSERT INTO worker.workflow_definitions (
    workflow_code, workflow_category_id, display_name, description, status, visible_in_admin, enabled,
    start_permission_code, cancel_permission_code, config
  )
  VALUES (
    r5_workflow_code,
    (SELECT workflow_category_id FROM worker.workflow_categories WHERE category_code = 'REPOSITORY_AUTOMATION' AND enabled = TRUE LIMIT 1),
    'R5 DEV Change Finalization',
    'Bounded autonomous DEV_LOCAL/DOCKER_LOCAL finalization: preflight, typed environment reconciliation, governed database apply, conditional allowlisted lifecycle, validation, readiness, catalogue, repo map, repo ZIP, and durable receipt.',
    'ACTIVE', TRUE, TRUE, 'WORKFLOW_RUN', 'WORKFLOW_RUN',
    jsonb_build_object(
      'runtimeParameters', jsonb_build_array(
        jsonb_build_object('key', 'repoName', 'type', 'repo', 'label', 'Repository', 'required', TRUE, 'defaultValue', 'SkyCommand', 'maxLength', 128, 'displayOrder', 10),
        jsonb_build_object('key', 'envPatchJson', 'type', 'string', 'label', 'Non-secret configuration patch JSON', 'required', FALSE, 'defaultValue', '{}', 'maxLength', 1000, 'displayOrder', 20)
      ),
      'r5Contract', 'dev_finalization_summary.v1',
      'allowedProfiles', jsonb_build_array('DEV_LOCAL', 'DOCKER_LOCAL'),
      'promotionBoundary', 'EXCLUDED',
      'createdBy', '00140_r5_dev_change_finalize'
    )
  )
  ON CONFLICT (workflow_code)
  DO UPDATE SET
    workflow_category_id = EXCLUDED.workflow_category_id,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    status = 'ACTIVE',
    visible_in_admin = TRUE,
    enabled = TRUE,
    start_permission_code = EXCLUDED.start_permission_code,
    cancel_permission_code = EXCLUDED.cancel_permission_code,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP
  RETURNING workflow_definition_id INTO definition_id;

  IF definition_id IS NULL THEN
    SELECT workflow_definition_id INTO definition_id
    FROM worker.workflow_definitions wd WHERE wd.workflow_code = r5_workflow_code;
  END IF;

  SELECT workflow_version_id INTO version_id
  FROM worker.workflow_versions
  WHERE workflow_definition_id = definition_id AND version_number = 1;

  IF version_id IS NULL THEN
    INSERT INTO worker.workflow_versions (
      workflow_definition_id, version_number, version_label, status, graph_version,
      definition_snapshot, published_at, created_at, updated_at
    )
    VALUES (
      definition_id, 1, 'R5 deterministic DEV finalization v1', 'PUBLISHED', '1.0',
      '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    RETURNING workflow_version_id INTO version_id;
  ELSE
    UPDATE worker.workflow_versions
    SET status = 'PUBLISHED', version_label = 'R5 deterministic DEV finalization v1',
        published_at = COALESCE(published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE workflow_version_id = version_id;
  END IF;

  INSERT INTO worker.workflow_nodes (
    workflow_version_id, node_key, node_type_code, display_name, description,
    target_code, target_ref_id, target_config, input_parameters, retry_policy,
    timeout_ms, position_x, position_y, display_order, enabled, config
  )
  SELECT version_id, s.node_key, s.node_type_code, s.display_name, s.description,
         s.target_code, t.tool_id, s.target_config, s.input_parameters,
         '{"maximumAttempts":1}'::jsonb, s.timeout_ms, s.position_x, 120,
         s.display_order, TRUE, s.config
  FROM (VALUES
    ('preflight_node', 'TOOL', 'R5 Preflight', 'Acquire the durable R5 lease and persist source/database identity.', 'dev_finalization_preflight', '{}'::jsonb, jsonb_build_object('repoName', '{{ params.repoName }}', 'workflowRunId', '{{ workflow.workflowRunRecordId }}', 'envPatchJson', '{{ params.envPatchJson }}'), 300000, 80, 10, '{}'::jsonb),
    ('environment_reconcile_gate', 'CONDITION', 'Environment Reconcile Gate', 'Run R3 reconciliation only when the bounded patch is non-empty.', NULL, '{}'::jsonb, jsonb_build_object('leftPath', 'params.envPatchJson', 'operator', 'NOT_EQUALS', 'rightValue', '{}', 'rightType', 'STRING', 'trueTargetNodeKey', 'environment_reconcile_node', 'falseTargetNodeKey', 'database_upgrade_node', 'onFalse', 'CONTINUE'), 30000, 300, 20, jsonb_build_object('builderCard', 'condition')),
    ('environment_reconcile_node', 'TOOL', 'Reconcile DEV Environment', 'Apply only the typed R3 non-secret configuration patch.', 'dev_env_reconcile', '{}'::jsonb, jsonb_build_object('patchJson', '{{ params.envPatchJson }}'), 300000, 520, 30, '{}'::jsonb),
    ('database_upgrade_node', 'TOOL', 'Apply Governed Database Upgrade', 'Apply only pending canonical migrations/seeds through the registered R2 Tool.', 'database_upgrade_apply', '{}'::jsonb, '{}'::jsonb, 900000, 740, 40, '{}'::jsonb),
    ('runtime_lifecycle_gate', 'CONDITION', 'Runtime Lifecycle Gate', 'Rebuild only services selected from the persisted source/config change scope.', NULL, '{}'::jsonb, jsonb_build_object('leftPath', 'nodes.preflight_node.output.lifecycle.required', 'operator', 'EQUALS', 'rightValue', TRUE, 'rightType', 'BOOLEAN', 'trueTargetNodeKey', 'runtime_lifecycle_node', 'falseTargetNodeKey', 'validation_node', 'onFalse', 'CONTINUE'), 30000, 960, 50, jsonb_build_object('builderCard', 'condition')),
    ('runtime_lifecycle_node', 'TOOL', 'Rebuild Allowlisted Runtime', 'Dispatch the fixed Supervisor service allowlist through the Host Agent.', 'dev_runtime_lifecycle', jsonb_build_object('executionTarget', 'HOST_AGENT', 'transport', 'temporal_host_agent'), jsonb_build_object('runId', '{{ workflow.workflowRunRecordId }}', 'action', '{{ nodes.preflight_node.output.lifecycle.action }}', 'servicesJson', '{{ nodes.preflight_node.output.lifecycleServicesJson }}'), 900000, 1180, 60, jsonb_build_object('builderCard', 'tool', 'executionTarget', 'HOST_AGENT')),
    ('validation_node', 'TOOL', 'R5 Deterministic Validation', 'Run the fixed R5 validation profile and persist its result.', 'dev_finalization_validate', '{}'::jsonb, jsonb_build_object('runId', '{{ workflow.workflowRunRecordId }}'), 360000, 1400, 70, '{}'::jsonb),
    ('readiness_node', 'TOOL', 'R5 Runtime Readiness', 'Verify live runtime, database, registration, and Host Agent readiness.', 'dev_finalization_readiness', '{}'::jsonb, jsonb_build_object('runId', '{{ workflow.workflowRunRecordId }}'), 240000, 1620, 80, '{}'::jsonb),
    ('capability_catalog_node', 'TOOL', 'Export Capability Catalogue', 'Refresh the redacted JSON and XLSX capability snapshots.', 'capability_catalog_export', '{}'::jsonb, '{}'::jsonb, 600000, 1840, 90, '{}'::jsonb),
    ('repo_map_node', 'TOOL', 'Generate Repository Map', 'Generate the configured repository map artifact.', 'repo_map_generate', '{}'::jsonb, jsonb_build_object('repoName', '{{ params.repoName }}'), 600000, 2060, 100, '{}'::jsonb),
    ('repo_zip_node', 'TOOL', 'Generate Repository ZIP', 'Generate the configured compact repository ZIP artifact.', 'repo_zip_generate', '{}'::jsonb, jsonb_build_object('repoName', '{{ params.repoName }}'), 900000, 2280, 110, '{}'::jsonb),
    ('receipt_node', 'TOOL', 'Persist R5 Finalization Receipt', 'Verify all evidence and persist the durable completion receipt.', 'dev_finalization_receipt', '{}'::jsonb, jsonb_build_object('runId', '{{ workflow.workflowRunRecordId }}'), 300000, 2500, 120, '{}'::jsonb)
  ) AS s(node_key, node_type_code, display_name, description, target_code, target_config, input_parameters, timeout_ms, position_x, display_order, config)
  LEFT JOIN core.tools t ON t.tool_code = s.target_code
  ON CONFLICT (workflow_version_id, node_key)
  DO UPDATE SET
    node_type_code = EXCLUDED.node_type_code,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    target_code = EXCLUDED.target_code,
    target_ref_id = EXCLUDED.target_ref_id,
    target_config = EXCLUDED.target_config,
    input_parameters = EXCLUDED.input_parameters,
    retry_policy = EXCLUDED.retry_policy,
    timeout_ms = EXCLUDED.timeout_ms,
    position_x = EXCLUDED.position_x,
    position_y = EXCLUDED.position_y,
    display_order = EXCLUDED.display_order,
    enabled = TRUE,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP;

  INSERT INTO worker.workflow_edges (
    workflow_version_id, edge_key, from_node_id, to_node_id, edge_type,
    condition_expression, display_order, config
  )
  SELECT version_id, p.edge_key, from_node.workflow_node_id, to_node.workflow_node_id,
         p.edge_type, p.condition_expression, p.display_order,
         jsonb_build_object('createdBy', '00140_r5_dev_change_finalize', 'branch', p.branch)
  FROM (VALUES
    ('preflight_to_environment_gate', 'preflight_node', 'environment_reconcile_gate', 'SEQUENTIAL', NULL, 10, NULL),
    ('environment_gate_to_reconcile', 'environment_reconcile_gate', 'environment_reconcile_node', 'SEQUENTIAL', NULL, 20, NULL),
    ('environment_reconcile_to_database', 'environment_reconcile_node', 'database_upgrade_node', 'SEQUENTIAL', NULL, 30, NULL),
    ('environment_gate_to_database', 'environment_reconcile_gate', 'database_upgrade_node', 'CONDITIONAL', 'FALSE', 21, 'FALSE'),
    ('database_to_runtime_gate', 'database_upgrade_node', 'runtime_lifecycle_gate', 'SEQUENTIAL', NULL, 40, NULL),
    ('runtime_gate_to_lifecycle', 'runtime_lifecycle_gate', 'runtime_lifecycle_node', 'SEQUENTIAL', NULL, 50, NULL),
    ('runtime_lifecycle_to_validation', 'runtime_lifecycle_node', 'validation_node', 'SEQUENTIAL', NULL, 60, NULL),
    ('runtime_gate_to_validation', 'runtime_lifecycle_gate', 'validation_node', 'CONDITIONAL', 'FALSE', 51, 'FALSE'),
    ('validation_to_readiness', 'validation_node', 'readiness_node', 'SEQUENTIAL', NULL, 70, NULL),
    ('readiness_to_catalogue', 'readiness_node', 'capability_catalog_node', 'SEQUENTIAL', NULL, 80, NULL),
    ('catalogue_to_map', 'capability_catalog_node', 'repo_map_node', 'SEQUENTIAL', NULL, 90, NULL),
    ('map_to_zip', 'repo_map_node', 'repo_zip_node', 'SEQUENTIAL', NULL, 100, NULL),
    ('zip_to_receipt', 'repo_zip_node', 'receipt_node', 'SEQUENTIAL', NULL, 110, NULL),
    ('environment_gate_to_reconcile_true', 'environment_reconcile_gate', 'environment_reconcile_node', 'CONDITIONAL', 'TRUE', 22, 'TRUE'),
    ('runtime_gate_to_lifecycle_true', 'runtime_lifecycle_gate', 'runtime_lifecycle_node', 'CONDITIONAL', 'TRUE', 52, 'TRUE')
  ) AS p(edge_key, from_key, to_key, edge_type, condition_expression, display_order, branch)
  JOIN worker.workflow_nodes from_node
    ON from_node.workflow_version_id = version_id AND from_node.node_key = p.from_key
  JOIN worker.workflow_nodes to_node
    ON to_node.workflow_version_id = version_id AND to_node.node_key = p.to_key
  ON CONFLICT (workflow_version_id, from_node_id, to_node_id, edge_type)
  DO UPDATE SET
    edge_key = EXCLUDED.edge_key,
    condition_expression = EXCLUDED.condition_expression,
    display_order = EXCLUDED.display_order,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP;

  UPDATE worker.workflow_versions v
  SET definition_snapshot = jsonb_build_object(
    'workflowCode', r5_workflow_code,
    'displayName', 'R5 DEV Change Finalization',
    'description', 'Bounded R5 DEV finalization graph.',
    'status', 'PUBLISHED',
    'graphVersion', v.graph_version,
    'runtimeParameters', (SELECT config -> 'runtimeParameters' FROM worker.workflow_definitions WHERE workflow_definition_id = definition_id),
    'nodes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nodeKey', n.node_key,
        'nodeTypeCode', n.node_type_code,
        'displayName', n.display_name,
        'targetCode', n.target_code,
        'targetConfig', n.target_config,
        'inputParameters', n.input_parameters,
        'displayOrder', n.display_order
      ) ORDER BY n.display_order, n.node_key)
      FROM worker.workflow_nodes n WHERE n.workflow_version_id = v.workflow_version_id
    ), '[]'::jsonb),
    'edges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'edgeKey', e.edge_key,
        'fromNodeKey', f.node_key,
        'toNodeKey', t.node_key,
        'edgeType', e.edge_type,
        'conditionExpression', e.condition_expression,
        'displayOrder', e.display_order,
        'config', e.config
      ) ORDER BY e.display_order, e.edge_key)
      FROM worker.workflow_edges e
      JOIN worker.workflow_nodes f ON f.workflow_node_id = e.from_node_id
      JOIN worker.workflow_nodes t ON t.workflow_node_id = e.to_node_id
      WHERE e.workflow_version_id = v.workflow_version_id
    ), '[]'::jsonb),
    'integration', jsonb_build_object('migration', '00140', 'feature', 'r5_dev_change_finalize')
  ), updated_at = CURRENT_TIMESTAMP
  WHERE v.workflow_version_id = version_id;

  SELECT workflow_execution_principal_id INTO principal_id
  FROM auth.workflow_execution_principals
  WHERE principal_code = 'assistant-http' AND status = 'ACTIVE';
  IF principal_id IS NULL THEN
    RAISE EXCEPTION '00140: assistant-http execution principal is unavailable';
  END IF;

  INSERT INTO worker.workflow_execution_resource_grants (
    workflow_execution_principal_id, repository_code, environment_code,
    config_profile_code, workflow_code, allowed_permission_codes, status, metadata
  )
  VALUES (
    principal_id, 'SkyCommand', 'DOCKER_LOCAL', 'DOCKER_LOCAL', r5_workflow_code,
    '["WORKFLOW_RUN","DEV_FINALIZATION_PREFLIGHT","DEV_RUNTIME_LIFECYCLE","DEV_FINALIZATION_VALIDATE","DEV_FINALIZATION_READINESS","DEV_FINALIZATION_RECEIPT","DEV_ENV_RECONCILE","DB_UPGRADE_APPLY","CAPABILITY_CATALOG_EXPORT","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","CORE_RUN_LOW_RISK_SCRIPT","CORE_RUN_MEDIUM_RISK_SCRIPT","CORE_RUN_HIGH_RISK_SCRIPT"]'::jsonb,
    'ACTIVE', jsonb_build_object('managedBy', '00140_r5_dev_change_finalize', 'pinnedWorkflowVersionId', version_id, 'pinnedVersionNumber', 1, 'scope', 'R5_acceptance')
  )
  ON CONFLICT (workflow_execution_principal_id, repository_code, environment_code, config_profile_code, workflow_code)
  DO UPDATE SET allowed_permission_codes = EXCLUDED.allowed_permission_codes, status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP;

  INSERT INTO worker.workflow_execution_resource_grants (
    workflow_execution_principal_id, repository_code, environment_code,
    config_profile_code, workflow_code, allowed_permission_codes, status, metadata
  )
  VALUES (
    principal_id, 'SkyCommand', 'DEV_LOCAL', 'DEV_LOCAL', r5_workflow_code,
    '["WORKFLOW_RUN","DEV_FINALIZATION_PREFLIGHT","DEV_RUNTIME_LIFECYCLE","DEV_FINALIZATION_VALIDATE","DEV_FINALIZATION_READINESS","DEV_FINALIZATION_RECEIPT","DEV_ENV_RECONCILE","DB_UPGRADE_APPLY","CAPABILITY_CATALOG_EXPORT","REPO_MAP_GENERATE","REPO_ZIP_GENERATE","CORE_RUN_LOW_RISK_SCRIPT","CORE_RUN_MEDIUM_RISK_SCRIPT","CORE_RUN_HIGH_RISK_SCRIPT"]'::jsonb,
    'ACTIVE', jsonb_build_object('managedBy', '00140_r5_dev_change_finalize', 'pinnedWorkflowVersionId', version_id, 'pinnedVersionNumber', 1, 'scope', 'R5_acceptance')
  )
  ON CONFLICT (workflow_execution_principal_id, repository_code, environment_code, config_profile_code, workflow_code)
  DO UPDATE SET allowed_permission_codes = EXCLUDED.allowed_permission_codes, status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = CURRENT_TIMESTAMP;
END;
$r5_workflow$;

DO $validation$
DECLARE
  workflow_count INTEGER;
  node_count INTEGER;
  edge_count INTEGER;
  tool_count INTEGER;
  grant_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO workflow_count
  FROM worker.vw_workflow_definitions
  WHERE workflow_code = 'dev_change_finalize'
    AND status = 'ACTIVE'
    AND enabled = TRUE
    AND published_version_number = 1;
  IF workflow_count <> 1 THEN
    RAISE EXCEPTION '00140: expected one active published dev_change_finalize v1, found %', workflow_count;
  END IF;

  SELECT COUNT(*) INTO node_count
  FROM worker.workflow_nodes n
  JOIN worker.workflow_versions v ON v.workflow_version_id = n.workflow_version_id
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'dev_change_finalize' AND v.version_number = 1 AND v.status = 'PUBLISHED' AND n.enabled = TRUE;
  IF node_count <> 12 THEN
    RAISE EXCEPTION '00140: expected twelve enabled R5 workflow nodes, found %', node_count;
  END IF;

  SELECT COUNT(*) INTO edge_count
  FROM worker.workflow_edges e
  JOIN worker.workflow_versions v ON v.workflow_version_id = e.workflow_version_id
  JOIN worker.workflow_definitions d ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'dev_change_finalize' AND v.version_number = 1;
  IF edge_count <> 15 THEN
    RAISE EXCEPTION '00140: expected fifteen R5 workflow edges, found %', edge_count;
  END IF;

  SELECT COUNT(*) INTO tool_count
  FROM core.tools
  WHERE tool_code IN ('dev_finalization_preflight', 'dev_runtime_lifecycle', 'dev_finalization_validate', 'dev_finalization_readiness', 'dev_finalization_receipt')
    AND enabled = TRUE
    AND script_repo_id = (SELECT repo_id FROM core.repositories WHERE repo_code = 'SkyCommand' AND is_skycommand_repository = TRUE AND active = TRUE LIMIT 1);
  IF tool_count <> 5 THEN
    RAISE EXCEPTION '00140: expected five enabled R5 Tools, found %', tool_count;
  END IF;

  SELECT COUNT(*) INTO grant_count
  FROM worker.workflow_execution_resource_grants g
  WHERE g.workflow_code = 'dev_change_finalize'
    AND g.status = 'ACTIVE'
    AND g.allowed_permission_codes ?& ARRAY['WORKFLOW_RUN', 'DEV_FINALIZATION_PREFLIGHT', 'DEV_RUNTIME_LIFECYCLE', 'DEV_FINALIZATION_VALIDATE', 'DEV_FINALIZATION_READINESS', 'DEV_FINALIZATION_RECEIPT', 'DEV_ENV_RECONCILE', 'DB_UPGRADE_APPLY', 'CAPABILITY_CATALOG_EXPORT', 'REPO_MAP_GENERATE', 'REPO_ZIP_GENERATE'];
  IF grant_count <> 2 THEN
    RAISE EXCEPTION '00140: expected DEV_LOCAL and DOCKER_LOCAL R5 grants, found %', grant_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM core.tools
    WHERE tool_code = 'dev_runtime_lifecycle'
      AND (risk_code IS DISTINCT FROM 'high' OR requires_confirmation IS DISTINCT FROM FALSE OR allow_params IS DISTINCT FROM TRUE OR permission_code IS DISTINCT FROM 'DEV_RUNTIME_LIFECYCLE')
  ) THEN
    RAISE EXCEPTION '00140: R5 runtime lifecycle Tool metadata is outside its fixed contract';
  END IF;
END;
$validation$;
