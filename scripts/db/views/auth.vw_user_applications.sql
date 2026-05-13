-- View: auth.vw_user_applications
-- Purpose: Readable user-to-application membership view.

CREATE OR REPLACE VIEW auth.vw_user_applications
AS
SELECT
  ua.user_id,
  u.email,
  u.username,
  u.display_name,
  u.status AS user_status,
  u.is_system_user,

  ua.app_id,
  app.app_code,
  app.title AS app_title,
  app.active AS app_active,

  ua.status AS user_application_status,
  ua.created_at,
  ua.updated_at,
  ua.created_by,
  ua.updated_by
FROM auth.user_applications ua
JOIN auth.users u
  ON u.user_id = ua.user_id
JOIN core.applications app
  ON app.app_id = ua.app_id;

ALTER VIEW auth.vw_user_applications OWNER TO postgres;

COMMENT ON VIEW auth.vw_user_applications IS
'Readable user-to-application membership view for shared identity and app-specific access administration.';
