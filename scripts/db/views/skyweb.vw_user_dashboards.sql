-- View: skyweb.vw_user_dashboards
-- Purpose: User dashboard definitions with item counts.

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
