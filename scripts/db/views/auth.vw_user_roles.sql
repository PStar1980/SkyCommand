-- View: auth.vw_user_roles
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_user_roles
AS
SELECT
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,
    u.is_system_user,

    r.role_id,
    r.role_code,
    r.role_name,
    r.description AS role_description,
    r.is_system_role,
    r.active AS role_active,

    ur.active AS user_role_active,
    ur.assigned_at,
    ur.assigned_by,

    r.app_id,
    app.app_code,
    app.title AS app_title,
    ua.status AS user_application_status
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
JOIN core.applications app
    ON app.app_id = r.app_id
JOIN auth.user_applications ua
    ON ua.user_id = u.user_id
   AND ua.app_id = r.app_id
WHERE u.status = 'ACTIVE'
  AND r.active = TRUE
  AND ur.active = TRUE
  AND ua.status = 'ACTIVE'
  AND app.active = TRUE;

ALTER VIEW auth.vw_user_roles OWNER TO postgres;
