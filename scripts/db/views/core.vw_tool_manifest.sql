-- View: core.vw_tool_manifest
-- Purpose: Full operational tool manifest for trusted API/service-side execution.

CREATE OR REPLACE VIEW core.vw_tool_manifest AS
SELECT
  a.app_code,
  a.title AS app_title,
  a.manifest_version,
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
  r.repo_code AS script_repo_code,
  t.script_path,
  t.runtime_code,
  rt.executable AS runtime_executable,
  t.permission_code,
  t.risk_code,
  rl.risk_rank,
  t.requires_confirmation,
  t.confirmation_text,
  t.captures_output,
  t.allow_params,
  t.display_order AS tool_display_order,
  t.enabled AS tool_enabled
FROM core.tools t
JOIN core.tool_categories c ON c.category_id = t.category_id
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.repositories r ON r.repo_id = t.script_repo_id
JOIN core.runtimes rt ON rt.runtime_code = t.runtime_code
JOIN core.risk_levels rl ON rl.risk_code = t.risk_code
WHERE t.enabled = TRUE
  AND c.enabled = TRUE
  AND a.active = TRUE;

ALTER VIEW core.vw_tool_manifest OWNER TO postgres;
