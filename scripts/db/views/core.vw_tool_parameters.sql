-- View: core.vw_tool_parameters
-- Purpose: Enabled tool parameter metadata.

CREATE OR REPLACE VIEW core.vw_tool_parameters AS
SELECT
  t.tool_id,
  t.tool_code,
  p.parameter_id,
  p.parameter_name,
  p.label,
  p.param_type_code,
  p.prompt,
  p.required,
  p.default_value,
  p.option_source_code,
  p.display_order,
  p.enabled
FROM core.tool_parameters p
JOIN core.tools t
  ON t.tool_id = p.tool_id
WHERE p.enabled = TRUE
  AND t.enabled = TRUE;

ALTER VIEW core.vw_tool_parameters OWNER TO postgres;
