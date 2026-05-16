-- View: skyweb.vw_user_profiles
-- Purpose: App-friendly SkyWeb profile view with shared auth identity metadata.

CREATE OR REPLACE VIEW skyweb.vw_user_profiles AS
SELECT
  u.user_id,
  u.email,
  u.username,
  u.display_name AS user_display_name,
  p.display_name AS profile_display_name,
  p.headline,
  p.bio,
  p.timezone,
  p.locale,
  p.avatar_url,
  p.profile_metadata,
  p.created_at,
  p.updated_at
FROM skyweb.user_profiles p
JOIN auth.users u
  ON u.user_id = p.user_id;

ALTER VIEW skyweb.vw_user_profiles OWNER TO postgres;
