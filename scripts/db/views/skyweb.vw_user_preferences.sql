-- View: skyweb.vw_user_preferences
-- Purpose: App-friendly SkyWeb preference view with shared auth identity metadata.

CREATE OR REPLACE VIEW skyweb.vw_user_preferences AS
SELECT
  pref.preference_id,
  pref.user_id,
  u.email,
  u.username,
  pref.preference_key,
  pref.preference_value,
  pref.created_at,
  pref.updated_at
FROM skyweb.user_preferences pref
JOIN auth.users u
  ON u.user_id = pref.user_id;

ALTER VIEW skyweb.vw_user_preferences OWNER TO postgres;
