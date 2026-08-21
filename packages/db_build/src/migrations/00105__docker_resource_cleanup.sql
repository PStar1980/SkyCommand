-- Migration: 00105__docker_resource_cleanup.sql
-- Phase 17.8: deep Docker image/volume/network inspection plus narrowly guarded cleanup.
-- Cleanup is separated from ordinary lifecycle control. Persistent volumes remain data-protected.

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
  'INFRASTRUCTURE_DOCKER_CLEANUP',
  'infrastructure_docker',
  'cleanup',
  'Remove eligible unused Docker image references and non-system networks through guarded Host Agent operations. Persistent volume deletion is not exposed.',
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
  ON permission.permission_code = 'INFRASTRUCTURE_DOCKER_CLEANUP'
 AND permission.app_id = role.app_id
JOIN core.applications application
  ON application.app_id = role.app_id
 AND application.app_code = 'SKYSERVER_ADMIN'
WHERE role.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

UPDATE auth.permissions
SET description = 'View Docker Engine, Compose projects, containers, images, volumes, networks, bounded logs, deep resource inspection, and attachment relationships through the SkyCommand Host Agent.',
    updated_at = CURRENT_TIMESTAMP
WHERE permission_code = 'INFRASTRUCTURE_DOCKER_READ';

COMMIT;
