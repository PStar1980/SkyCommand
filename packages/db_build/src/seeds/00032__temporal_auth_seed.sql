-- ============================================================
-- Seed: 00032__temporal_auth_seed.sql
-- Purpose:
-- Adds Temporal workflow permissions for SkyServer Core API and
-- future Admin-Web workflow cockpit controls.
-- ============================================================

BEGIN;

-- Existing SkyServer API/Admin sessions are scoped to SKYSERVER_ADMIN.
-- Temporal control-plane permissions therefore need the same app_id as
-- the Admin roles that will receive them.
INSERT INTO core.applications (app_code, title, manifest_version, description, active)
VALUES (
    'SKYSERVER_ADMIN',
    'SkyCommand',
    '1.0.0',
    'Private administrative web console for SkyServer control-plane operations.',
    TRUE
)
ON CONFLICT (app_code) DO UPDATE
SET title = EXCLUDED.title,
    manifest_version = EXCLUDED.manifest_version,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

WITH target_app AS (
    SELECT app_id
    FROM core.applications
    WHERE app_code = 'SKYSERVER_ADMIN'
    LIMIT 1
), permission_seed (
    permission_code,
    resource,
    action,
    description,
    active
) AS (
    VALUES
    (
        'TEMPORAL_WORKFLOW_READ',
        'temporal_workflows',
        'read',
        'View Temporal health, workflow definitions, workflow runs, and workflow run details.',
        TRUE
    ),
    (
        'TEMPORAL_WORKFLOW_START',
        'temporal_workflows',
        'start',
        'Start approved Temporal workflows through SkyServer Core API.',
        TRUE
    ),
    (
        'TEMPORAL_WORKFLOW_CANCEL',
        'temporal_workflows',
        'cancel',
        'Request cancellation of running Temporal workflows through SkyServer Core API.',
        TRUE
    ),
    (
        'TEMPORAL_WORKFLOW_TERMINATE',
        'temporal_workflows',
        'terminate',
        'Terminate Temporal workflows through SkyServer Core API. High-risk administrative operation.',
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
    target_app.app_id,
    permission_seed.permission_code,
    permission_seed.resource,
    permission_seed.action,
    permission_seed.description,
    permission_seed.active
FROM permission_seed
CROSS JOIN target_app
ON CONFLICT (permission_code)
DO UPDATE SET
    app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- SUPER_ADMIN gets all active Temporal workflow permissions.
-- Existing databases need this explicit grant because this seed is
-- applied after the original role/permission seed.
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
JOIN auth.permissions p
    ON p.app_id = r.app_id
WHERE r.role_code = 'SUPER_ADMIN'
  AND p.permission_code IN (
      'TEMPORAL_WORKFLOW_READ',
      'TEMPORAL_WORKFLOW_START',
      'TEMPORAL_WORKFLOW_CANCEL',
      'TEMPORAL_WORKFLOW_TERMINATE'
  )
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
    active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

WITH admin_permissions(permission_code) AS (
    VALUES
        ('TEMPORAL_WORKFLOW_READ'),
        ('TEMPORAL_WORKFLOW_START'),
        ('TEMPORAL_WORKFLOW_CANCEL')
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
        ('TEMPORAL_WORKFLOW_READ'),
        ('TEMPORAL_WORKFLOW_START')
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
        ('TEMPORAL_WORKFLOW_READ')
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

COMMIT;
