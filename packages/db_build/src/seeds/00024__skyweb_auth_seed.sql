-- ============================================================
-- SkyWeb Auth Seed Data
-- Roles + Permissions + initial application membership
-- ============================================================

BEGIN;

INSERT INTO core.applications (app_code, title, manifest_version, description, active)
VALUES (
  'SKYWEB',
  'SkyWeb Analytics',
  '0.1.0',
  'Public-facing analytics layer and member dashboard experience for Sky ecosystem dashboards.',
  TRUE
)
ON CONFLICT (app_code) DO UPDATE
SET title = EXCLUDED.title,
    manifest_version = EXCLUDED.manifest_version,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

WITH skyweb_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYWEB'
  LIMIT 1
), role_seed(role_code, role_name, description, is_system_role, active) AS (
  VALUES
    (
      'SKYWEB_USER',
      'SkyWeb Analytics User',
      'Standard SkyWeb Analytics member access for profile, saved dashboard, and future preference surfaces.',
      TRUE,
      TRUE
    ),
    (
      'SKYWEB_ADMIN',
      'SkyWeb Analytics Administrator',
      'Elevated SkyWeb Analytics member administration role reserved for future public-site moderation and user support workflows.',
      TRUE,
      TRUE
    )
)
INSERT INTO auth.roles (app_id, role_code, role_name, description, is_system_role, active)
SELECT
  skyweb_app.app_id,
  role_seed.role_code,
  role_seed.role_name,
  role_seed.description,
  role_seed.is_system_role,
  role_seed.active
FROM role_seed
CROSS JOIN skyweb_app
ON CONFLICT (role_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  role_name = EXCLUDED.role_name,
  description = EXCLUDED.description,
  is_system_role = EXCLUDED.is_system_role,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH skyweb_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYWEB'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'SKYWEB_PROFILE_READ',
      'skyweb_profile',
      'read',
      'Read the authenticated user SkyWeb profile.',
      TRUE
    ),
    (
      'SKYWEB_PROFILE_WRITE',
      'skyweb_profile',
      'write',
      'Update the authenticated user SkyWeb profile.',
      TRUE
    ),
    (
      'SKYWEB_PREFERENCES_READ',
      'skyweb_preferences',
      'read',
      'Read the authenticated user SkyWeb dashboard preferences.',
      TRUE
    ),
    (
      'SKYWEB_PREFERENCES_WRITE',
      'skyweb_preferences',
      'write',
      'Update the authenticated user SkyWeb dashboard preferences.',
      TRUE
    ),
    (
      'SKYWEB_DASHBOARD_READ',
      'skyweb_dashboards',
      'read',
      'Read saved SkyWeb dashboards and member dashboard metadata.',
      TRUE
    ),
    (
      'SKYWEB_DASHBOARD_WRITE',
      'skyweb_dashboards',
      'write',
      'Create or update saved SkyWeb dashboards.',
      TRUE
    ),
    (
      'SKYWEB_ALERT_READ',
      'skyweb_alerts',
      'read',
      'Read SkyWeb alert and watchlist configuration.',
      TRUE
    ),
    (
      'SKYWEB_ALERT_WRITE',
      'skyweb_alerts',
      'write',
      'Create or update SkyWeb alert and watchlist configuration.',
      TRUE
    )
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
SELECT
  skyweb_app.app_id,
  permission_seed.permission_code,
  permission_seed.resource,
  permission_seed.action,
  permission_seed.description,
  permission_seed.active
FROM permission_seed
CROSS JOIN skyweb_app
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH user_permissions(permission_code) AS (
  VALUES
    ('SKYWEB_PROFILE_READ'),
    ('SKYWEB_PROFILE_WRITE'),
    ('SKYWEB_PREFERENCES_READ'),
    ('SKYWEB_PREFERENCES_WRITE'),
    ('SKYWEB_DASHBOARD_READ'),
    ('SKYWEB_DASHBOARD_WRITE'),
    ('SKYWEB_ALERT_READ'),
    ('SKYWEB_ALERT_WRITE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN user_permissions up ON TRUE
JOIN auth.permissions p
  ON p.permission_code = up.permission_code
WHERE r.role_code = 'SKYWEB_USER'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN auth.permissions p
  ON p.app_id = r.app_id
WHERE r.role_code = 'SKYWEB_ADMIN'
  AND p.active = TRUE
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

WITH skyweb_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYWEB'
  LIMIT 1
)
INSERT INTO auth.user_applications (user_id, app_id, status, created_by, updated_by)
SELECT
  u.user_id,
  skyweb_app.app_id,
  'ACTIVE',
  u.created_by,
  u.updated_by
FROM auth.users u
CROSS JOIN skyweb_app
WHERE u.status = 'ACTIVE'
  AND u.is_system_user = FALSE
ON CONFLICT (user_id, app_id)
DO UPDATE SET
  status = CASE
    WHEN auth.user_applications.status = 'DISABLED' THEN 'DISABLED'
    ELSE EXCLUDED.status
  END,
  updated_by = EXCLUDED.updated_by,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.user_roles (user_id, role_id, assigned_by, active)
SELECT
  ua.user_id,
  r.role_id,
  u.updated_by,
  TRUE
FROM auth.user_applications ua
JOIN core.applications app
  ON app.app_id = ua.app_id
JOIN auth.roles r
  ON r.app_id = app.app_id
 AND r.role_code = 'SKYWEB_USER'
JOIN auth.users u
  ON u.user_id = ua.user_id
WHERE app.app_code = 'SKYWEB'
  AND ua.status = 'ACTIVE'
  AND u.status = 'ACTIVE'
  AND u.is_system_user = FALSE
ON CONFLICT (user_id, role_id)
DO UPDATE SET
  assigned_at = CURRENT_TIMESTAMP,
  assigned_by = EXCLUDED.assigned_by,
  active = TRUE;

INSERT INTO skyweb.user_profiles (user_id, display_name)
SELECT
  ua.user_id,
  u.display_name
FROM auth.user_applications ua
JOIN core.applications app
  ON app.app_id = ua.app_id
JOIN auth.users u
  ON u.user_id = ua.user_id
WHERE app.app_code = 'SKYWEB'
  AND ua.status = 'ACTIVE'
  AND u.status = 'ACTIVE'
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
