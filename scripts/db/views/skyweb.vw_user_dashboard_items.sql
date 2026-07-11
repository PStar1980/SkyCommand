-- View: skyweb.vw_user_dashboard_items
-- Purpose: Dashboard items joined to saved macro views and direct macro indicators.

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
  ind.source AS indicator_source,
  ind.description AS indicator_description,
  ind.frequency AS indicator_frequency,
  ind.active AS indicator_active,
  ind.display_group AS indicator_display_group,
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
LEFT JOIN macro.indicators ind
  ON ind.indicator_code = i.indicator_code;

ALTER VIEW skyweb.vw_user_dashboard_items OWNER TO postgres;
