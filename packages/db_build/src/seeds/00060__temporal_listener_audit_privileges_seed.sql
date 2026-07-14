-- ============================================================
-- Seed: 00060__temporal_listener_audit_privileges_seed.sql
-- Purpose:
-- Adds granular worker-listener processing permissions and retires
-- the legacy broad listener-write permission. Direct Temporal
-- audit events are emitted by the API controller and need no
-- database schema change.
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
      'WORKER_LISTENER_CREATE',
      'worker_listeners',
      'create',
      'Create worker listener definitions.',
      TRUE
    ),
    (
      'WORKER_LISTENER_CHANGE',
      'worker_listeners',
      'change',
      'Update, enable, or disable worker listener definitions.',
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
), listener_permissions(permission_code) AS (
  VALUES
    ('WORKER_LISTENER_CREATE'),
    ('WORKER_LISTENER_CHANGE')
)
INSERT INTO auth.role_permissions (
  role_id,
  permission_id,
  active
)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN privileged_roles pr
  ON pr.role_code = r.role_code
JOIN listener_permissions lp
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = lp.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

-- Keep listener processing restricted to the two administrative
-- roles even if a previous manual grant exists.
UPDATE auth.role_permissions rp
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.roles r,
     auth.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND p.permission_code IN (
    'WORKER_LISTENER_CREATE',
    'WORKER_LISTENER_CHANGE'
  )
  AND r.role_code NOT IN ('SUPER_ADMIN', 'ADMIN');

-- Retire the broad legacy permission after routes and Admin-Web
-- move to granular create/change guards. Keeping the permission row
-- preserves historical audit and role-assignment references.
UPDATE auth.permissions
SET active = FALSE,
    description = 'Deprecated broad worker listener write permission. Use WORKER_LISTENER_CREATE and WORKER_LISTENER_CHANGE.',
    updated_at = CURRENT_TIMESTAMP
WHERE permission_code = 'WORKER_LISTENER_WRITE';

UPDATE auth.role_permissions rp
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.permissions p
WHERE rp.permission_id = p.permission_id
  AND p.permission_code = 'WORKER_LISTENER_WRITE';

COMMIT;
