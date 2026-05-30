-- ============================================================
-- Migration: 00025__skyweb_saved_macro_views.sql
-- Purpose:
-- Adds the first personalized SkyWeb dashboard object: saved
-- macro views. These records form the watchlist foundation for
-- future saved dashboards, alerts, and member command surfaces.
-- ============================================================

BEGIN;

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

DROP TRIGGER IF EXISTS saved_macro_views_set_updated_at ON skyweb.saved_macro_views;

CREATE TRIGGER saved_macro_views_set_updated_at
BEFORE UPDATE ON skyweb.saved_macro_views
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.saved_macro_views OWNER TO postgres;

COMMENT ON TABLE skyweb.saved_macro_views IS
'Saved macro view watchlist records for authenticated SkyWeb members.';

CREATE OR REPLACE VIEW skyweb.vw_saved_macro_views AS
SELECT
  saved.saved_view_id,
  saved.user_id,
  u.email,
  u.username,
  saved.view_key,
  saved.display_label,
  saved.note,
  saved.pinned,
  saved.sort_order,
  saved.created_at,
  saved.updated_at
FROM skyweb.saved_macro_views saved
JOIN auth.users u
  ON u.user_id = saved.user_id;

ALTER VIEW skyweb.vw_saved_macro_views OWNER TO postgres;

COMMIT;
