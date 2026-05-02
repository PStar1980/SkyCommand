-- ------------------------------------------------------------
-- View: auth.vw_user_permissions
-- Purpose:
-- One row per active user permission.
-- This is the main permission-checking view for API/Admin-Web.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW auth.vw_user_permissions
AS
SELECT
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status AS user_status,

    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description AS permission_description,

    STRING_AGG(DISTINCT r.role_code, ', ' ORDER BY r.role_code) AS granted_through_roles
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
WHERE u.status = 'ACTIVE'
  AND ur.active = TRUE
  AND r.active = TRUE
  AND rp.active = TRUE
  AND p.active = TRUE
GROUP BY
    u.user_id,
    u.email,
    u.username,
    u.display_name,
    u.status,
    p.permission_id,
    p.permission_code,
    p.resource,
    p.action,
    p.description;

ALTER VIEW auth.vw_user_permissions OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_permissions IS
'Resolved active permissions by user. Intended for API/Admin-Web authorization checks.';
