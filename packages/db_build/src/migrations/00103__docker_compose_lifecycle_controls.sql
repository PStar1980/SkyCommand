-- Migration: 00103__docker_compose_lifecycle_controls.sql
-- Phase 17.4: guarded Docker Compose project lifecycle controls.
-- Read permission remains separate from write permission so infrastructure operators
-- can inspect Docker without receiving Start/Stop/Restart capability.

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
  'INFRASTRUCTURE_DOCKER_CONTROL',
  'infrastructure_docker',
  'control',
  'Start, stop, and restart eligible discovered Docker Compose projects through the SkyCommand Host Agent.',
  TRUE
FROM admin_app
ON CONFLICT (permission_code) DO UPDATE
SET app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT role.role_id, permission.permission_id, TRUE
FROM auth.roles role
JOIN auth.permissions permission
  ON permission.permission_code = 'INFRASTRUCTURE_DOCKER_CONTROL'
 AND permission.app_id = role.app_id
JOIN core.applications application
  ON application.app_id = role.app_id
 AND application.app_code = 'SKYSERVER_ADMIN'
WHERE role.role_code IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

COMMIT;
