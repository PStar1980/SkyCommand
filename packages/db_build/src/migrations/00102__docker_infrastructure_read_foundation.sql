-- Migration: 00102__docker_infrastructure_read_foundation.sql
-- Phase 17.1: Kubernetes-ready infrastructure provider foundation.
-- The first capability is deliberately read-only Docker inventory transported through
-- the host-native SkyCommand Host Agent. No Docker socket is exposed to Admin-Web/API.

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
  'INFRASTRUCTURE_DOCKER_READ',
  'infrastructure_docker',
  'read',
  'View Docker Engine, Compose project, container, image, volume, and network inventory through the SkyCommand Host Agent.',
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
  ON permission.permission_code = 'INFRASTRUCTURE_DOCKER_READ'
 AND permission.app_id = role.app_id
JOIN core.applications application
  ON application.app_id = role.app_id
 AND application.app_code = 'SKYSERVER_ADMIN'
WHERE role.role_code IN ('SUPER_ADMIN', 'ADMIN')
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

COMMIT;
