-- Seed: 00067__tool_catalogue_admin_permissions_seed.sql
-- Purpose: Adds Phase 15 Manage Tools read/write permissions and restricts writes to trusted administrators.

BEGIN;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'ADMIN_TOOL_READ',
      'admin_tools',
      'read',
      'View PostgreSQL tool catalogue configuration, parameters, choices, visibility, and status.',
      TRUE
    ),
    (
      'ADMIN_TOOL_WRITE',
      'admin_tools',
      'write',
      'Create, update, enable, disable, and manage PostgreSQL tool catalogue configuration.',
      TRUE
    )
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
  permission_seed.permission_code,
  permission_seed.resource,
  permission_seed.action,
  permission_seed.description,
  permission_seed.active
FROM permission_seed
CROSS JOIN admin_app
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH privileged_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN')
), tool_admin_permissions(permission_code) AS (
  VALUES ('ADMIN_TOOL_READ'), ('ADMIN_TOOL_WRITE')
)
INSERT INTO auth.role_permissions (
  role_id,
  permission_id,
  active
)
SELECT
  role.role_id,
  permission.permission_id,
  TRUE
FROM auth.roles role
JOIN privileged_roles privileged_role
  ON privileged_role.role_code = role.role_code
JOIN tool_admin_permissions tool_permission
  ON TRUE
JOIN auth.permissions permission
  ON permission.permission_code = tool_permission.permission_code
 AND permission.app_id = role.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

UPDATE auth.role_permissions role_permission
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.roles role,
     auth.permissions permission
WHERE role_permission.role_id = role.role_id
  AND role_permission.permission_id = permission.permission_id
  AND permission.permission_code = 'ADMIN_TOOL_WRITE'
  AND role.role_code NOT IN ('SUPER_ADMIN', 'ADMIN');

COMMIT;
