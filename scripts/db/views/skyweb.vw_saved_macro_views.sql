-- View: skyweb.vw_saved_macro_views
-- Purpose: App-friendly saved macro view watchlist records with auth identity metadata.

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
