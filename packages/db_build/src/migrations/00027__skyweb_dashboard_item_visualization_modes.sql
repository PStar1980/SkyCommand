-- ============================================================
-- Migration: 00027__skyweb_dashboard_item_visualization_modes.sql
-- Purpose:
-- Extends dashboard item mode validation for richer SkyWeb
-- Analytics dashboard visualization blocks.
-- ============================================================

BEGIN;

ALTER TABLE skyweb.user_dashboard_items
  DROP CONSTRAINT IF EXISTS user_dashboard_items_mode_check;

ALTER TABLE skyweb.user_dashboard_items
  ADD CONSTRAINT user_dashboard_items_mode_check
  CHECK (item_mode IN (
    'view_card',
    'wide_card',
    'compact_card',
    'metric_card',
    'mini_chart',
    'latest_row',
    'table_preview'
  ));

COMMENT ON CONSTRAINT user_dashboard_items_mode_check
  ON skyweb.user_dashboard_items IS
'Allowed SkyWeb Analytics dashboard visualization modes for saved macro view items.';

COMMIT;
