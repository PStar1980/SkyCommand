-- ============================================================
-- Seed: 00072__api_telemetry_permissions_seed.sql
-- Purpose:
-- Adds read access for the SkyCommand API observability dashboard.
-- ============================================================

BEGIN;

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
  'API_TELEMETRY_READ',
  'api_telemetry',
  'read',
  'View normalized SkyCommand API request volumes, error rates, latency trends, and route-level telemetry.',
  TRUE
FROM admin_app
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH readable_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN'), ('OPERATOR'), ('VIEWER')
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
JOIN readable_roles readable_role
  ON readable_role.role_code = role.role_code
JOIN auth.permissions permission
  ON permission.permission_code = 'API_TELEMETRY_READ'
 AND permission.app_id = role.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

COMMIT;
