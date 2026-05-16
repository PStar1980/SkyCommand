-- Table: skyweb.user_profiles
-- Purpose: SkyWeb member profile records mapped to shared auth.users identities.

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

ALTER TABLE skyweb.user_profiles OWNER TO postgres;
