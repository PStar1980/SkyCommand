-- View: core.vw_cli_categories
-- Purpose: CLI-visible enabled tool categories.

CREATE OR REPLACE VIEW core.vw_cli_categories AS
SELECT
  a.app_code,
  c.category_id,
  c.category_code,
  c.name,
  c.label,
  c.description,
  c.display_order,
  c.enabled
FROM core.tool_categories c
JOIN core.applications a
  ON a.app_id = c.app_id
JOIN core.tool_category_visibility cv
  ON cv.category_id = c.category_id
WHERE cv.channel_code = 'cli'
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_cli_categories OWNER TO postgres;
