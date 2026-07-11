-- Table: skyweb.user_dashboard_items
-- Purpose: Dashboard item records pointing at saved macro views or direct macro indicators.

CREATE TABLE IF NOT EXISTS skyweb.user_dashboard_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL,
  item_source TEXT NOT NULL DEFAULT 'view',
  view_key TEXT,
  indicator_code TEXT,
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

  CONSTRAINT user_dashboard_items_source_check
    CHECK (item_source IN ('view', 'indicator')),

  CONSTRAINT user_dashboard_items_view_key_check
    CHECK (view_key IS NULL OR view_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT user_dashboard_items_indicator_code_check
    CHECK (indicator_code IS NULL OR indicator_code ~ '^[A-Z0-9_]{1,128}$'),

  CONSTRAINT user_dashboard_items_source_target_check
    CHECK (
      (item_source = 'view' AND view_key IS NOT NULL AND indicator_code IS NULL)
      OR
      (item_source = 'indicator' AND indicator_code IS NOT NULL AND view_key IS NULL)
    ),

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

ALTER TABLE skyweb.user_dashboard_items OWNER TO postgres;

CREATE INDEX IF NOT EXISTS user_dashboard_items_dashboard_id_idx
  ON skyweb.user_dashboard_items (dashboard_id);

CREATE INDEX IF NOT EXISTS user_dashboard_items_view_key_idx
  ON skyweb.user_dashboard_items (view_key);

CREATE INDEX IF NOT EXISTS user_dashboard_items_sort_idx
  ON skyweb.user_dashboard_items (dashboard_id, sort_order ASC, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboard_items_dashboard_view_unique_idx
  ON skyweb.user_dashboard_items (dashboard_id, view_key)
  WHERE item_source = 'view';

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboard_items_dashboard_indicator_unique_idx
  ON skyweb.user_dashboard_items (dashboard_id, indicator_code)
  WHERE item_source = 'indicator';

CREATE INDEX IF NOT EXISTS user_dashboard_items_indicator_code_idx
  ON skyweb.user_dashboard_items (indicator_code)
  WHERE indicator_code IS NOT NULL;

COMMENT ON TABLE skyweb.user_dashboard_items IS 'Dashboard item records pointing at saved macro view surfaces or direct macro indicators.';
COMMENT ON CONSTRAINT user_dashboard_items_mode_check ON skyweb.user_dashboard_items IS 'Allowed SkyWeb Analytics dashboard visualization modes for saved macro view and direct indicator items.';
