-- View: auth.vw_role_permissions
-- Purpose: Phase 8.6 app-aware auth view.

CREATE OR REPLACE VIEW auth.vw_role_permissions
AS
SELECT
    r.role_id,
    r.role_code,
    r.role_name,
    r.description AS role_description,
    r.is_system_role,
    r.active AS role_active,

    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description AS permission_description,
    p.active AS permission_active,

    rp.active AS role_permission_active,
    rp.granted_at,
    rp.granted_by,

    r.app_id AS role_app_id,
    role_app.app_code AS role_app_code,
    role_app.title AS role_app_title,
    p.app_id AS permission_app_id,
    permission_app.app_code AS permission_app_code,
    permission_app.title AS permission_app_title
FROM auth.roles r
JOIN core.applications role_app
    ON role_app.app_id = r.app_id
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
   AND p.app_id = r.app_id
JOIN core.applications permission_app
    ON permission_app.app_id = p.app_id
WHERE r.active = TRUE
  AND p.active = TRUE
  AND rp.active = TRUE
  AND role_app.active = TRUE
  AND permission_app.active = TRUE;

ALTER VIEW auth.vw_role_permissions OWNER TO postgres;
