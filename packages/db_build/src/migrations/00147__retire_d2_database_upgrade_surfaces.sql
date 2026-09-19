-- Purpose: Retire the superseded D2 database-upgrade request/approval
-- permissions while preserving their historical definitions, grants, and
-- audit evidence for read-only historical inspection.

UPDATE auth.role_permissions AS role_permission
SET active = FALSE
FROM auth.permissions AS permission
WHERE permission.permission_id = role_permission.permission_id
  AND permission.permission_code IN (
    'DB_UPGRADE_PLAN',
    'DB_UPGRADE_APPLY_REQUEST',
    'DB_UPGRADE_APPLY_APPROVE'
  )
  AND role_permission.active = TRUE;

UPDATE auth.permissions
SET active = FALSE
WHERE permission_code IN (
  'DB_UPGRADE_PLAN',
  'DB_UPGRADE_APPLY_REQUEST',
  'DB_UPGRADE_APPLY_APPROVE'
)
  AND active = TRUE;

DO $$
DECLARE
  active_permission_count INTEGER;
  active_role_grant_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO active_permission_count
    FROM auth.permissions
   WHERE permission_code IN (
     'DB_UPGRADE_PLAN',
     'DB_UPGRADE_APPLY_REQUEST',
     'DB_UPGRADE_APPLY_APPROVE'
   )
     AND active = TRUE;

  SELECT COUNT(*)
    INTO active_role_grant_count
    FROM auth.role_permissions role_permission
    JOIN auth.permissions permission
      ON permission.permission_id = role_permission.permission_id
   WHERE permission.permission_code IN (
     'DB_UPGRADE_PLAN',
     'DB_UPGRADE_APPLY_REQUEST',
     'DB_UPGRADE_APPLY_APPROVE'
   )
     AND role_permission.active = TRUE;

  IF active_permission_count <> 0 OR active_role_grant_count <> 0 THEN
    RAISE EXCEPTION '00147: superseded D2 database-upgrade permissions remain active';
  END IF;
END;
$$;
