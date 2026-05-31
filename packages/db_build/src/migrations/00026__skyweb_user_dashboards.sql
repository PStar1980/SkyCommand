-- ============================================================
-- Migration: 00026__skyweb_user_dashboards.sql
-- Purpose:
-- Adds first-class user-owned SkyWeb Analytics dashboards and
-- dashboard items. Saved macro views remain the source shelf;
-- dashboards organize those saved views into reusable layouts.
-- ============================================================

BEGIN;

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

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboards_one_default_per_user_idx
  ON skyweb.user_dashboards (user_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS user_dashboards_user_id_idx
  ON skyweb.user_dashboards (user_id);

CREATE INDEX IF NOT EXISTS user_dashboards_user_sort_idx
  ON skyweb.user_dashboards (user_id, sort_order ASC, updated_at DESC);

DROP TRIGGER IF EXISTS user_dashboards_set_updated_at ON skyweb.user_dashboards;

CREATE TRIGGER user_dashboards_set_updated_at
BEFORE UPDATE ON skyweb.user_dashboards
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.user_dashboards OWNER TO postgres;

COMMENT ON TABLE skyweb.user_dashboards IS
'User-owned SkyWeb Analytics dashboard definitions.';

CREATE TABLE IF NOT EXISTS skyweb.user_dashboard_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL,
  view_key TEXT NOT NULL,
  item_title TEXT,
  item_note TEXT,
  item_mode TEXT NOT NULL DEFAULT 'view_card',
  sort_order INTEGER NOT NULL DEFAULT 0,
  position_row INTEGER NOT NULL DEFAULT 0,
  position_col INTEGER NOT NULL DEFAULT 0,
  width_units INTEGER NOT NULL DEFAULT 1,
  height_units INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT user_dashboard_items_dashboard_id_fkey
    FOREIGN KEY (dashboard_id)
    REFERENCES skyweb.user_dashboards(dashboard_id)
    ON DELETE CASCADE,

  CONSTRAINT user_dashboard_items_dashboard_view_unique
    UNIQUE (dashboard_id, view_key),

  CONSTRAINT user_dashboard_items_view_key_check
    CHECK (view_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT user_dashboard_items_title_length_check
    CHECK (item_title IS NULL OR char_length(item_title) <= 160),

  CONSTRAINT user_dashboard_items_note_length_check
    CHECK (item_note IS NULL OR char_length(item_note) <= 800),

  CONSTRAINT user_dashboard_items_mode_check
    CHECK (item_mode IN (
      'view_card',
      'wide_card',
      'compact_card',
      'metric_card',
      'mini_chart',
      'latest_row',
      'table_preview'
    )),

  CONSTRAINT user_dashboard_items_position_check
    CHECK (position_row >= 0 AND position_col >= 0),

  CONSTRAINT user_dashboard_items_size_check
    CHECK (width_units BETWEEN 1 AND 4 AND height_units BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS user_dashboard_items_dashboard_id_idx
  ON skyweb.user_dashboard_items (dashboard_id);

CREATE INDEX IF NOT EXISTS user_dashboard_items_view_key_idx
  ON skyweb.user_dashboard_items (view_key);

CREATE INDEX IF NOT EXISTS user_dashboard_items_sort_idx
  ON skyweb.user_dashboard_items (dashboard_id, sort_order ASC, updated_at DESC);

DROP TRIGGER IF EXISTS user_dashboard_items_set_updated_at ON skyweb.user_dashboard_items;

CREATE TRIGGER user_dashboard_items_set_updated_at
BEFORE UPDATE ON skyweb.user_dashboard_items
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.user_dashboard_items OWNER TO postgres;

COMMENT ON TABLE skyweb.user_dashboard_items IS
'Dashboard item records pointing at saved macro view surfaces.';

CREATE OR REPLACE VIEW skyweb.vw_user_dashboards AS
SELECT
  d.dashboard_id,
  d.user_id,
  u.email,
  u.username,
  d.dashboard_key,
  d.title,
  d.description,
  d.layout_preset,
  d.is_default,
  d.sort_order,
  COUNT(i.item_id)::int AS item_count,
  COUNT(i.item_id) FILTER (WHERE saved.pinned IS TRUE)::int AS pinned_item_count,
  d.created_at,
  d.updated_at
FROM skyweb.user_dashboards d
JOIN auth.users u
  ON u.user_id = d.user_id
LEFT JOIN skyweb.user_dashboard_items i
  ON i.dashboard_id = d.dashboard_id
LEFT JOIN skyweb.saved_macro_views saved
  ON saved.user_id = d.user_id
 AND saved.view_key = i.view_key
GROUP BY
  d.dashboard_id,
  d.user_id,
  u.email,
  u.username,
  d.dashboard_key,
  d.title,
  d.description,
  d.layout_preset,
  d.is_default,
  d.sort_order,
  d.created_at,
  d.updated_at;

ALTER VIEW skyweb.vw_user_dashboards OWNER TO postgres;

CREATE OR REPLACE VIEW skyweb.vw_user_dashboard_items AS
SELECT
  i.item_id,
  i.dashboard_id,
  d.user_id,
  u.email,
  u.username,
  d.dashboard_key,
  d.title AS dashboard_title,
  i.view_key,
  i.item_title,
  i.item_note,
  i.item_mode,
  i.sort_order,
  i.position_row,
  i.position_col,
  i.width_units,
  i.height_units,
  saved.saved_view_id,
  saved.display_label AS saved_display_label,
  saved.note AS saved_note,
  saved.pinned AS saved_pinned,
  i.created_at,
  i.updated_at
FROM skyweb.user_dashboard_items i
JOIN skyweb.user_dashboards d
  ON d.dashboard_id = i.dashboard_id
JOIN auth.users u
  ON u.user_id = d.user_id
LEFT JOIN skyweb.saved_macro_views saved
  ON saved.user_id = d.user_id
 AND saved.view_key = i.view_key;

ALTER VIEW skyweb.vw_user_dashboard_items OWNER TO postgres;

COMMIT;
