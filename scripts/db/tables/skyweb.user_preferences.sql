-- Table: skyweb.user_preferences
-- Purpose: Key/value JSONB preferences for SkyWeb member personalization.

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

ALTER TABLE skyweb.user_preferences OWNER TO postgres;
