-- ============================================================
-- Seed: 00043__workflow_builder_permissions_seed.sql
-- Purpose:
-- Adds the workflow builder write permission used by Phase 10.14
-- Create Workflow UI v1.
-- ============================================================

BEGIN;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'WORKFLOW_WRITE',
      'workflows',
      'write',
      'Create and edit SkyServer workflow definitions, draft versions, and workflow-builder node metadata.',
      TRUE
    )
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
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

WITH writer_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN')
), builder_permissions(permission_code) AS (
  VALUES ('WORKFLOW_WRITE'), ('WORKFLOW_READ'), ('WORKFLOW_START')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN writer_roles wr
  ON wr.role_code = r.role_code
JOIN builder_permissions bp
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = bp.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

COMMIT;
