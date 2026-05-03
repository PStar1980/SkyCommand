-- ------------------------------------------------------------
-- View: auth.vw_user_roles
-- Purpose:
-- Shows each active user-to-role assignment.
-- Useful for Admin-Web user management screens.
-- ------------------------------------------------------------

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
    ur.assigned_by
FROM auth.users u
JOIN auth.user_roles ur
    ON ur.user_id = u.user_id
JOIN auth.roles r
    ON r.role_id = ur.role_id
WHERE u.status = 'ACTIVE'
  AND r.active = TRUE
  AND ur.active = TRUE;

ALTER VIEW auth.vw_user_roles OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_roles IS
'Active user-to-role assignments for Admin-Web user management and authorization inspection.';
