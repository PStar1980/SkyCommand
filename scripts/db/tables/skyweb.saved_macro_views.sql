-- Table: skyweb.saved_macro_views
-- Purpose: Saved macro view watchlist records for authenticated SkyWeb members.

CREATE TABLE IF NOT EXISTS skyweb.saved_macro_views (
  saved_view_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  view_key TEXT NOT NULL,
  display_label TEXT,
  note TEXT,
  pinned BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT saved_macro_views_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT saved_macro_views_user_view_unique
    UNIQUE (user_id, view_key),

  CONSTRAINT saved_macro_views_view_key_check
    CHECK (view_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT saved_macro_views_display_label_length_check
    CHECK (display_label IS NULL OR char_length(display_label) <= 160),

  CONSTRAINT saved_macro_views_note_length_check
    CHECK (note IS NULL OR char_length(note) <= 800)
);

CREATE INDEX IF NOT EXISTS saved_macro_views_user_id_idx
  ON skyweb.saved_macro_views (user_id);

CREATE INDEX IF NOT EXISTS saved_macro_views_view_key_idx
  ON skyweb.saved_macro_views (view_key);

CREATE INDEX IF NOT EXISTS saved_macro_views_user_sort_idx
  ON skyweb.saved_macro_views (user_id, pinned DESC, sort_order ASC, updated_at DESC);

ALTER TABLE skyweb.saved_macro_views OWNER TO postgres;
