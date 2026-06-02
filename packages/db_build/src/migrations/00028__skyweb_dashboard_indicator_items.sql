-- ============================================================
-- Migration: 00028__skyweb_dashboard_indicator_items.sql
-- Purpose:
-- Extends SkyWeb Analytics dashboard items so standard dashboard
-- cards can reference macro indicators directly instead of always
-- depending on saved macro views.
-- ============================================================

BEGIN;

-- Existing deployments already have skyweb.vw_user_dashboard_items with
-- view_key as the first item-specific column. PostgreSQL does not allow
-- CREATE OR REPLACE VIEW to rename/reorder existing view columns, so drop
-- the compatibility view before recreating it with the expanded indicator-aware
-- projection below.
DROP VIEW IF EXISTS skyweb.vw_user_dashboard_items;

ALTER TABLE skyweb.user_dashboard_items
  ADD COLUMN IF NOT EXISTS item_source TEXT NOT NULL DEFAULT 'view';

ALTER TABLE skyweb.user_dashboard_items
  ADD COLUMN IF NOT EXISTS indicator_code TEXT;

UPDATE skyweb.user_dashboard_items
SET item_source = 'view'
WHERE item_source IS NULL;

ALTER TABLE skyweb.user_dashboard_items
  ALTER COLUMN item_source SET DEFAULT 'view';

ALTER TABLE skyweb.user_dashboard_items
  ALTER COLUMN item_source SET NOT NULL;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_dashboard_view_unique;

DROP INDEX IF EXISTS skyweb.user_dashboard_items_dashboard_view_unique_idx;
DROP INDEX IF EXISTS skyweb.user_dashboard_items_dashboard_indicator_unique_idx;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_view_key_check;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_source_check;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_indicator_code_check;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_source_target_check;

ALTER TABLE skyweb.user_dashboard_items
  ALTER COLUMN view_key DROP NOT NULL;

ALTER TABLE skyweb.user_dashboard_items
  ADD CONSTRAINT user_dashboard_items_source_check
  CHECK (item_source IN ('view', 'indicator'));

ALTER TABLE skyweb.user_dashboard_items
  ADD CONSTRAINT user_dashboard_items_view_key_check
  CHECK (view_key IS NULL OR view_key ~ '^[a-z0-9][a-z0-9-]{0,127}$');

ALTER TABLE skyweb.user_dashboard_items
  ADD CONSTRAINT user_dashboard_items_indicator_code_check
  CHECK (indicator_code IS NULL OR indicator_code ~ '^[A-Z0-9_]{1,128}$');

ALTER TABLE skyweb.user_dashboard_items
  ADD CONSTRAINT user_dashboard_items_source_target_check
  CHECK (
    (item_source = 'view' AND view_key IS NOT NULL AND indicator_code IS NULL)
    OR
    (item_source = 'indicator' AND indicator_code IS NOT NULL AND view_key IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboard_items_dashboard_view_unique_idx
  ON skyweb.user_dashboard_items (dashboard_id, view_key)
  WHERE item_source = 'view';

CREATE UNIQUE INDEX IF NOT EXISTS user_dashboard_items_dashboard_indicator_unique_idx
  ON skyweb.user_dashboard_items (dashboard_id, indicator_code)
  WHERE item_source = 'indicator';

CREATE INDEX IF NOT EXISTS user_dashboard_items_indicator_code_idx
  ON skyweb.user_dashboard_items (indicator_code)
  WHERE indicator_code IS NOT NULL;

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
 AND i.item_source = 'view'
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
  i.item_source,
  i.view_key,
  i.indicator_code,
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
 AND saved.view_key = i.view_key
 AND i.item_source = 'view';

ALTER VIEW skyweb.vw_user_dashboard_items OWNER TO postgres;

COMMENT ON TABLE skyweb.user_dashboard_items IS
'Dashboard item records pointing at either saved macro view surfaces or direct macro indicators.';

COMMENT ON COLUMN skyweb.user_dashboard_items.item_source IS
'Dashboard item source type: view items use saved macro views; indicator items use direct macro indicator time series.';

COMMENT ON COLUMN skyweb.user_dashboard_items.indicator_code IS
'Macro indicator code for direct indicator-based dashboard items.';

COMMIT;
