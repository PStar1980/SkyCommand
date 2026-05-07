-- View: core.vw_admin_web_tools
-- Purpose: Admin-Web-visible enabled tools with safe display metadata.
-- Note: script_path is intentionally omitted from this view.

CREATE OR REPLACE VIEW core.vw_admin_web_tools AS
SELECT
  a.app_code,
  c.category_id,
  c.category_code,
  c.label AS category_label,
  c.description AS category_description,
  c.display_order AS category_display_order,
  t.tool_id,
  t.tool_code,
  t.name,
  t.label,
  t.description,
  t.permission_code,
  t.risk_code,
  rl.risk_rank,
  t.requires_confirmation,
  t.confirmation_text,
  t.captures_output,
  t.allow_params,
  t.display_order,
  t.enabled
FROM core.tools t
JOIN core.tool_categories c ON c.category_id = t.category_id
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.risk_levels rl ON rl.risk_code = t.risk_code
JOIN core.tool_visibility tv ON tv.tool_id = t.tool_id
WHERE tv.channel_code = 'admin-web'
  AND t.enabled = TRUE
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_admin_web_tools OWNER TO postgres;
