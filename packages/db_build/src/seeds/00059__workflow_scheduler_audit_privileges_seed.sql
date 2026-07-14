-- ============================================================
-- Seed: 00059__workflow_scheduler_audit_privileges_seed.sql
-- Purpose:
-- Adds granular workflow and scheduler processing permissions.
-- These privileges are intentionally limited to ADMIN and
-- SUPER_ADMIN roles.
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
      'WORKFLOW_CREATE',
      'workflows',
      'create',
      'Create or clone SkyCommand workflow definitions.',
      TRUE
    ),
    (
      'WORKFLOW_RUN',
      'workflow_runs',
      'run',
      'Start, retry, cancel, or terminate SkyCommand workflow runs.',
      TRUE
    ),
    (
      'WORKFLOW_CHANGE',
      'workflows',
      'change',
      'Update, archive, delete, version, publish, or change SkyCommand workflow definitions and graphs.',
      TRUE
    ),
    (
      'WORKER_SCHEDULE_CREATE',
      'worker_schedules',
      'create',
      'Create worker scheduler definitions.',
      TRUE
    ),
    (
      'WORKER_SCHEDULE_CHANGE',
      'worker_schedules',
      'change',
      'Update, enable, disable, unqueue, or delete worker scheduler definitions.',
      TRUE
    ),
    (
      'WORKER_SCHEDULE_RUN_IMMEDIATE',
      'worker_schedules',
      'run_immediate',
      'Queue an existing worker schedule for immediate execution.',
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
), processing_permissions(permission_code) AS (
  VALUES
    ('WORKFLOW_CREATE'),
    ('WORKFLOW_RUN'),
    ('WORKFLOW_CHANGE'),
    ('WORKER_SCHEDULE_CREATE'),
    ('WORKER_SCHEDULE_CHANGE'),
    ('WORKER_SCHEDULE_RUN_IMMEDIATE')
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
JOIN processing_permissions pp
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = pp.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

-- Explicitly keep these processing privileges restricted to the
-- two administrative roles even if a previous manual grant exists.
UPDATE auth.role_permissions rp
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.roles r,
     auth.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND p.permission_code IN (
    'WORKFLOW_CREATE',
    'WORKFLOW_RUN',
    'WORKFLOW_CHANGE',
    'WORKER_SCHEDULE_CREATE',
    'WORKER_SCHEDULE_CHANGE',
    'WORKER_SCHEDULE_RUN_IMMEDIATE'
  )
  AND r.role_code NOT IN ('SUPER_ADMIN', 'ADMIN');

-- Keep the workflow-start bridge tool aligned with the granular
-- workflow run privilege. This prevents the legacy WORKFLOW_START
-- permission from remaining as an alternate execution path.
UPDATE core.tools
SET permission_code = 'WORKFLOW_RUN',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'skyserver_workflow_start';

-- Move workflow definitions using the former broad defaults onto
-- the new run privilege while preserving any custom permission.
UPDATE worker.workflow_definitions
SET start_permission_code = CASE
      WHEN start_permission_code IS NULL OR start_permission_code = 'WORKFLOW_START'
        THEN 'WORKFLOW_RUN'
      ELSE start_permission_code
    END,
    cancel_permission_code = CASE
      WHEN cancel_permission_code IS NULL OR cancel_permission_code = 'WORKFLOW_CANCEL'
        THEN 'WORKFLOW_RUN'
      ELSE cancel_permission_code
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE start_permission_code IS NULL
   OR start_permission_code = 'WORKFLOW_START'
   OR cancel_permission_code IS NULL
   OR cancel_permission_code = 'WORKFLOW_CANCEL';

COMMIT;
