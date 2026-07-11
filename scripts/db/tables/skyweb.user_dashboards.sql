-- Table: skyweb.user_dashboards
-- Purpose: User-owned SkyWeb Analytics dashboard definitions.

CREATE TABLE IF NOT EXISTS skyweb.user_dashboards (
  dashboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  dashboard_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  layout_preset TEXT NOT NULL DEFAULT 'executive',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_dashboards_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT user_dashboards_user_key_unique
    UNIQUE (user_id, dashboard_key),

  CONSTRAINT user_dashboards_key_check
    CHECK (dashboard_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT user_dashboards_title_length_check
    CHECK (char_length(title) BETWEEN 1 AND 160),

  CONSTRAINT user_dashboards_description_length_check
    CHECK (description IS NULL OR char_length(description) <= 800),

  CONSTRAINT user_dashboards_layout_preset_check
    CHECK (layout_preset IN ('executive', 'research', 'compact'))
);

ALTER TABLE skyweb.user_dashboards OWNER TO postgres;

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboards_one_default_per_user_idx
  ON skyweb.user_dashboards (user_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS user_dashboards_user_id_idx
  ON skyweb.user_dashboards (user_id);

CREATE INDEX IF NOT EXISTS user_dashboards_user_sort_idx
  ON skyweb.user_dashboards (user_id, sort_order ASC, updated_at DESC);

COMMENT ON TABLE skyweb.user_dashboards IS 'User-owned SkyWeb Analytics dashboard definitions.';
