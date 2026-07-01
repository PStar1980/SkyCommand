-- ============================================================
-- Seed: 00041__workflow_executor_permission_hotfix.sql
-- Purpose:
-- Adds first-class SkyServer workflow permissions and corrects
-- the Admin-owned SkyWeb alert evaluation worker-tool permission
-- used by workflow executor v1.
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
      'WORKFLOW_READ',
      'workflows',
      'read',
      'Read SkyServer workflow definitions, workflow run records, and node run timelines.',
      TRUE
    ),
    (
      'WORKFLOW_START',
      'workflows',
      'start',
      'Start approved SkyServer workflow definitions through Admin-Web or SkyServer Core API.',
      TRUE
    ),
    (
      'WORKFLOW_CANCEL',
      'workflows',
      'cancel',
      'Cancel or stop running SkyServer workflow executions when supported by the executor.',
      TRUE
    ),
    (
      'SKYWEB_ALERT_EVALUATE',
      'skyweb_alerts',
      'evaluate',
      'Run the SkyWeb alert evaluation operational tool from SkyServer Admin, Scheduler, or workflows.',
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

WITH super_admin_permissions(permission_code) AS (
  VALUES
    ('WORKFLOW_READ'),
    ('WORKFLOW_START'),
    ('WORKFLOW_CANCEL'),
    ('SKYWEB_ALERT_EVALUATE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN super_admin_permissions sp
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = sp.permission_code
 AND p.app_id = r.app_id
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

WITH admin_permissions(permission_code) AS (
  VALUES
    ('WORKFLOW_READ'),
    ('WORKFLOW_START'),
    ('WORKFLOW_CANCEL'),
    ('SKYWEB_ALERT_EVALUATE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN admin_permissions ap
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = ap.permission_code
 AND p.app_id = r.app_id
WHERE r.role_code = 'ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

WITH operator_permissions(permission_code) AS (
  VALUES
    ('WORKFLOW_READ'),
    ('WORKFLOW_START'),
    ('SKYWEB_ALERT_EVALUATE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN operator_permissions op
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = op.permission_code
 AND p.app_id = r.app_id
WHERE r.role_code = 'OPERATOR'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

WITH viewer_permissions(permission_code) AS (
  VALUES
    ('WORKFLOW_READ')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN viewer_permissions vp
  ON TRUE
JOIN auth.permissions p
  ON p.permission_code = vp.permission_code
 AND p.app_id = r.app_id
WHERE r.role_code = 'VIEWER'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

UPDATE worker.workflow_definitions
SET start_permission_code = 'WORKFLOW_START',
    cancel_permission_code = 'WORKFLOW_CANCEL',
    config = config || '{"permissionModel":"skyserver_workflow","phase":"10.10-hotfix"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE workflow_code = 'macro-refresh-pipeline';

UPDATE core.tools
SET permission_code = 'SKYWEB_ALERT_EVALUATE',
    description = 'Evaluates active SkyWeb Analytics macro alert rules and writes event history for scheduled or workflow-driven alert checks.',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'skyweb_alerts_evaluate';

COMMIT;
