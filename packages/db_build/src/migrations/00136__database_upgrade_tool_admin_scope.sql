-- Migration: 00136__database_upgrade_tool_admin_scope.sql
-- Purpose: Align the R2 database-upgrade permission with the authenticated
--          Admin-Web/API application scope used by SUPER_ADMIN sessions.
--
-- 00135 is already applied and remains immutable. This additive correction
-- preserves its Tool/role grant while making the permission visible through
-- auth.vw_user_permissions for the existing SKYSERVER_ADMIN session scope.

UPDATE auth.permissions
SET app_id = (
      SELECT app_id
      FROM core.applications
      WHERE app_code = 'SKYSERVER_ADMIN'
        AND active = TRUE
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE permission_code = 'DB_UPGRADE_APPLY';

DO $validation$
DECLARE
  permission_count INTEGER;
  admin_scope_count INTEGER;
  grant_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO permission_count
  FROM auth.permissions p
  JOIN core.applications a ON a.app_id = p.app_id
  WHERE p.permission_code = 'DB_UPGRADE_APPLY'
    AND p.active = TRUE;
  IF permission_count <> 1 THEN
    RAISE EXCEPTION '00136: expected one active DB_UPGRADE_APPLY permission, found %', permission_count;
  END IF;

  SELECT COUNT(*) INTO admin_scope_count
  FROM auth.permissions p
  JOIN core.applications a ON a.app_id = p.app_id
  WHERE p.permission_code = 'DB_UPGRADE_APPLY'
    AND a.app_code = 'SKYSERVER_ADMIN';
  IF admin_scope_count <> 1 THEN
    RAISE EXCEPTION '00136: DB_UPGRADE_APPLY must belong to SKYSERVER_ADMIN scope, found %', admin_scope_count;
  END IF;

  SELECT COUNT(*) INTO grant_count
  FROM auth.role_permissions rp
  JOIN auth.roles r ON r.role_id = rp.role_id
  JOIN auth.permissions p ON p.permission_id = rp.permission_id
  WHERE r.role_code = 'SUPER_ADMIN'
    AND p.permission_code = 'DB_UPGRADE_APPLY'
    AND rp.active = TRUE;
  IF grant_count <> 1 THEN
    RAISE EXCEPTION '00136: expected one SUPER_ADMIN DB_UPGRADE_APPLY grant, found %', grant_count;
  END IF;
END;
$validation$;
