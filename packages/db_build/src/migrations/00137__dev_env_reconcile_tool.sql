-- Migration: 00137__dev_env_reconcile_tool.sql
-- Purpose: Register the deterministic DEV_LOCAL .env reconciliation Tool.
--
-- The Tool accepts one bounded structured patch parameter. Its source code
-- resolves the registered DEV_LOCAL SkyCommand repository binding and owns
-- the typed allowlist; this migration only installs the execution metadata.

INSERT INTO auth.permissions (
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
)
SELECT
  a.app_id,
  'DEV_ENV_RECONCILE',
  'environment_configuration',
  'reconcile',
  'Reconcile typed, allowlisted non-secret DEV_LOCAL application configuration through the registered Tool.',
  TRUE
FROM core.applications a
WHERE a.app_code = 'SKYSERVER_ADMIN'
  AND a.active = TRUE
LIMIT 1
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
JOIN auth.permissions p ON p.permission_code = 'DEV_ENV_RECONCILE'
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

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
       'dev_env_reconcile',
       'devEnvReconcile',
       'Reconcile DEV_LOCAL Environment',
       'Reconciles only typed, allowlisted non-secret application settings in the registered DEV_LOCAL SkyCommand .env and approved .env.example entries. Paths, targets, credentials, permissions, and execution controls are not caller-selectable.',
       r.repo_id,
       'packages/config/src/devEnvReconcile.js',
       'node',
       'DEV_ENV_RECONCILE',
       'medium',
       FALSE,
       NULL,
       TRUE,
       TRUE,
       30,
       TRUE,
       'dev_env_reconcile_summary.v1',
       'packages/tools/contracts/dev_env_reconcile_summary.v1.schema.json',
       FALSE
FROM core.applications a
JOIN core.tool_categories c
  ON c.app_id = a.app_id
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
WHERE t.tool_code = 'dev_env_reconcile'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

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
       'patchJson',
       'Non-secret configuration patch (JSON)',
       'string',
       'Provide a JSON object containing only the typed allowlisted DEV_LOCAL application keys.',
       TRUE,
       NULL,
       NULL,
       10,
       TRUE,
       'POSITIONAL',
       NULL
FROM core.tools t
WHERE t.tool_code = 'dev_env_reconcile'
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

DO $validation$
DECLARE
  tool_count INTEGER;
  permission_count INTEGER;
  grant_count INTEGER;
  parameter_count INTEGER;
  visibility_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tool_count
  FROM core.tools
  WHERE tool_code = 'dev_env_reconcile'
    AND enabled = TRUE;
  IF tool_count <> 1 THEN
    RAISE EXCEPTION '00137: expected exactly one enabled dev_env_reconcile Tool, found %', tool_count;
  END IF;

  SELECT COUNT(*) INTO permission_count
  FROM auth.permissions p
  JOIN core.applications a ON a.app_id = p.app_id
  WHERE p.permission_code = 'DEV_ENV_RECONCILE'
    AND a.app_code = 'SKYSERVER_ADMIN'
    AND p.resource = 'environment_configuration'
    AND p.action = 'reconcile'
    AND p.active = TRUE;
  IF permission_count <> 1 THEN
    RAISE EXCEPTION '00137: expected one active DEV_ENV_RECONCILE permission in SKYSERVER_ADMIN scope, found %', permission_count;
  END IF;

  SELECT COUNT(*) INTO grant_count
  FROM auth.role_permissions rp
  JOIN auth.roles r ON r.role_id = rp.role_id
  JOIN auth.permissions p ON p.permission_id = rp.permission_id
  WHERE r.role_code = 'SUPER_ADMIN'
    AND p.permission_code = 'DEV_ENV_RECONCILE'
    AND rp.active = TRUE;
  IF grant_count <> 1 THEN
    RAISE EXCEPTION '00137: expected one SUPER_ADMIN DEV_ENV_RECONCILE grant, found %', grant_count;
  END IF;

  SELECT COUNT(*) INTO parameter_count
  FROM core.tool_parameters p
  JOIN core.tools t ON t.tool_id = p.tool_id
  WHERE t.tool_code = 'dev_env_reconcile'
    AND p.enabled = TRUE;
  IF parameter_count <> 1 THEN
    RAISE EXCEPTION '00137: expected exactly one enabled dev_env_reconcile parameter, found %', parameter_count;
  END IF;

  SELECT COUNT(*) INTO visibility_count
  FROM core.tool_visibility tv
  JOIN core.tools t ON t.tool_id = tv.tool_id
  WHERE t.tool_code = 'dev_env_reconcile'
    AND tv.channel_code IN ('cli', 'admin-web', 'api', 'worker');
  IF visibility_count <> 4 THEN
    RAISE EXCEPTION '00137: expected four dev_env_reconcile visibility channels, found %', visibility_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.tools
    WHERE tool_code = 'dev_env_reconcile'
      AND (
        script_path IS DISTINCT FROM 'packages/config/src/devEnvReconcile.js'
        OR runtime_code IS DISTINCT FROM 'node'
        OR permission_code IS DISTINCT FROM 'DEV_ENV_RECONCILE'
        OR risk_code IS DISTINCT FROM 'medium'
        OR requires_confirmation IS DISTINCT FROM FALSE
        OR allow_params IS DISTINCT FROM TRUE
        OR output_type IS DISTINCT FROM 'dev_env_reconcile_summary.v1'
        OR output_schema_path IS DISTINCT FROM 'packages/tools/contracts/dev_env_reconcile_summary.v1.schema.json'
      )
  ) THEN
    RAISE EXCEPTION '00137: dev_env_reconcile metadata does not match the accepted R3 contract';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM core.tool_parameters p
    JOIN core.tools t ON t.tool_id = p.tool_id
    WHERE t.tool_code = 'dev_env_reconcile'
      AND (
        p.parameter_name IS DISTINCT FROM 'patchJson'
        OR p.param_type_code IS DISTINCT FROM 'string'
        OR p.required IS DISTINCT FROM TRUE
        OR p.argument_mode IS DISTINCT FROM 'POSITIONAL'
        OR p.cli_flag IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION '00137: dev_env_reconcile parameter does not match the bounded structured patch contract';
  END IF;
END;
$validation$;
