-- Migration: 00135__autonomous_database_upgrade_tool.sql
-- Purpose: Register the autonomous DEV_LOCAL database-upgrade Tool around the
--          existing D1 engine. The Tool has no caller-controlled parameters;
--          the runner remains bound to the trusted DEV target configuration.
--
-- This migration intentionally has no transaction wrapper. D1 owns the
-- per-file transaction so registration and its ledger receipt are atomic.

INSERT INTO auth.permissions (
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
)
VALUES (
  (SELECT app_id FROM core.applications WHERE app_code = 'SKYSERVER_CORE' AND active = TRUE LIMIT 1),
  'DB_UPGRADE_APPLY',
  'database_upgrade',
  'apply',
  'Apply verified pending DEV_LOCAL migrations and seeds through the registered database-upgrade Tool.',
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

-- Database-upgrade APPLY is deliberately narrower than the general medium-risk
-- script permission and is granted only to the existing highest-trust role.
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN auth.permissions p ON p.permission_code = 'DB_UPGRADE_APPLY'
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
       'database_upgrade_apply',
       'databaseUpgradeApply',
       'Apply DEV Database Upgrade',
       'Applies all verified pending canonical DEV_LOCAL migrations and seeds through the D1 engine. The registered Tool binds the repository, environment, database, and PostgreSQL cluster identity and accepts no authority-bearing caller parameters.',
       r.repo_id,
       'packages/db_upgrade/src/databaseUpgradeApply.js',
       'node',
       'DB_UPGRADE_APPLY',
       'medium',
       FALSE,
       NULL,
       TRUE,
       FALSE,
       25,
       TRUE,
       'database_upgrade_summary.v1',
       'packages/tools/contracts/database_upgrade_summary.v1.schema.json',
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
  AND c.category_code = 'database_tools'
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
WHERE t.tool_code = 'database_upgrade_apply'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

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
  WHERE tool_code = 'database_upgrade_apply'
    AND enabled = TRUE;
  IF tool_count <> 1 THEN
    RAISE EXCEPTION '00135: expected exactly one enabled database_upgrade_apply Tool, found %', tool_count;
  END IF;

  SELECT COUNT(*) INTO permission_count
  FROM auth.permissions
  WHERE permission_code = 'DB_UPGRADE_APPLY'
    AND resource = 'database_upgrade'
    AND action = 'apply'
    AND active = TRUE;
  IF permission_count <> 1 THEN
    RAISE EXCEPTION '00135: expected exactly one active DB_UPGRADE_APPLY permission, found %', permission_count;
  END IF;

  SELECT COUNT(*) INTO grant_count
  FROM auth.role_permissions rp
  JOIN auth.roles r ON r.role_id = rp.role_id
  JOIN auth.permissions p ON p.permission_id = rp.permission_id
  WHERE r.role_code = 'SUPER_ADMIN'
    AND p.permission_code = 'DB_UPGRADE_APPLY'
    AND rp.active = TRUE;
  IF grant_count <> 1 THEN
    RAISE EXCEPTION '00135: expected one SUPER_ADMIN DB_UPGRADE_APPLY grant, found %', grant_count;
  END IF;

  SELECT COUNT(*) INTO parameter_count
  FROM core.tool_parameters p
  JOIN core.tools t ON t.tool_id = p.tool_id
  WHERE t.tool_code = 'database_upgrade_apply';
  IF parameter_count <> 0 THEN
    RAISE EXCEPTION '00135: database_upgrade_apply must expose zero parameters, found %', parameter_count;
  END IF;

  SELECT COUNT(*) INTO visibility_count
  FROM core.tool_visibility tv
  JOIN core.tools t ON t.tool_id = tv.tool_id
  WHERE t.tool_code = 'database_upgrade_apply'
    AND tv.channel_code IN ('cli', 'admin-web', 'api', 'worker');
  IF visibility_count <> 4 THEN
    RAISE EXCEPTION '00135: database_upgrade_apply must be visible on all four registered channels, found %', visibility_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM core.tools
    WHERE tool_code = 'database_upgrade_apply'
      AND (
        script_path IS DISTINCT FROM 'packages/db_upgrade/src/databaseUpgradeApply.js'
        OR runtime_code IS DISTINCT FROM 'node'
        OR permission_code IS DISTINCT FROM 'DB_UPGRADE_APPLY'
        OR risk_code IS DISTINCT FROM 'medium'
        OR requires_confirmation IS DISTINCT FROM FALSE
        OR allow_params IS DISTINCT FROM FALSE
        OR output_type IS DISTINCT FROM 'database_upgrade_summary.v1'
        OR output_schema_path IS DISTINCT FROM 'packages/tools/contracts/database_upgrade_summary.v1.schema.json'
      )
  ) THEN
    RAISE EXCEPTION '00135: database_upgrade_apply metadata does not match the accepted R2 contract';
  END IF;
END;
$validation$;
