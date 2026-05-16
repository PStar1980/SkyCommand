-- ============================================================
-- Migration: 00023__skyweb_auth_profiles.sql
-- Purpose:
-- Creates the first SkyWeb-owned member schema for app-scoped
-- profile and preference data. Public macro dashboards remain
-- unauthenticated; these objects support future private SkyWeb
-- saved dashboards, alerts, and personalization.
-- ============================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS skyweb;

ALTER SCHEMA skyweb OWNER TO postgres;

CREATE OR REPLACE FUNCTION skyweb.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION skyweb.set_updated_at() OWNER TO postgres;

CREATE TABLE IF NOT EXISTS skyweb.user_profiles (
  user_id UUID PRIMARY KEY,
  display_name TEXT,
  headline TEXT,
  bio TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Toronto',
  locale TEXT NOT NULL DEFAULT 'en-CA',
  avatar_url TEXT,
  profile_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_profiles_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_profiles_timezone_idx
  ON skyweb.user_profiles (timezone);

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON skyweb.user_profiles;

CREATE TRIGGER user_profiles_set_updated_at
BEFORE UPDATE ON skyweb.user_profiles
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.user_profiles OWNER TO postgres;

COMMENT ON TABLE skyweb.user_profiles IS
'SkyWeb app profile records for shared auth.users identities.';

CREATE TABLE IF NOT EXISTS skyweb.user_preferences (
  preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT user_preferences_user_key_unique
    UNIQUE (user_id, preference_key)
);

CREATE INDEX IF NOT EXISTS user_preferences_user_id_idx
  ON skyweb.user_preferences (user_id);

CREATE INDEX IF NOT EXISTS user_preferences_key_idx
  ON skyweb.user_preferences (preference_key);

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON skyweb.user_preferences;

CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON skyweb.user_preferences
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.user_preferences OWNER TO postgres;

COMMENT ON TABLE skyweb.user_preferences IS
'Key/value JSONB preference records for SkyWeb member personalization.';

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

COMMIT;
