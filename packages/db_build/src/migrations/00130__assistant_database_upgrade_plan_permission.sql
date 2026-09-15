-- Migration: 00130__assistant_database_upgrade_plan_permission.sql
-- Purpose: Registers the strictly read-only Assistant database-upgrade PLAN
-- permission. APPLY is intentionally not registered as an Assistant capability.

-- The D1 upgrade runner owns the transaction so this change and its receipt
-- remain atomic. The destructive db:build path consumes it in normal order.

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
)
INSERT INTO auth.permissions (
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
)
SELECT
  admin_app.app_id,
  'DB_UPGRADE_PLAN',
  'database_upgrade',
  'plan',
  'Read the current governed database-upgrade PLAN metadata without applying changes.',
  TRUE
FROM admin_app
ON CONFLICT (permission_code) DO UPDATE
SET app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

-- Database-upgrade authority remains limited to the existing highest human
-- administrative role. This does not add the permission to the Assistant
-- service-token default set; Assistant access requires deliberate configuration.
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT role.role_id, permission.permission_id, TRUE
FROM auth.roles role
JOIN auth.permissions permission
  ON permission.permission_code = 'DB_UPGRADE_PLAN'
 AND permission.app_id = role.app_id
JOIN core.applications application
  ON application.app_id = role.app_id
 AND application.app_code = 'SKYSERVER_ADMIN'
WHERE role.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;
