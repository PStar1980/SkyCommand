-- ------------------------------------------------------------
-- View: auth.vw_role_permissions
-- Purpose:
-- Shows each active role-to-permission relationship.
-- Useful for Admin-Web role screens and permission inspection.
-- ------------------------------------------------------------

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
    rp.granted_by
FROM auth.roles r
JOIN auth.role_permissions rp
    ON rp.role_id = r.role_id
JOIN auth.permissions p
    ON p.permission_id = rp.permission_id
WHERE r.active = TRUE
  AND p.active = TRUE
  AND rp.active = TRUE;

ALTER VIEW auth.vw_role_permissions OWNER TO postgres;

COMMENT ON VIEW auth.vw_role_permissions IS
'Active role-to-permission relationships for RBAC inspection and Admin-Web permission management.';
