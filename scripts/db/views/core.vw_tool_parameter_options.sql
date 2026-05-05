-- View: core.vw_tool_parameter_options
-- Purpose: Static parameter options for enabled parameters.

CREATE OR REPLACE VIEW core.vw_tool_parameter_options AS
SELECT
  t.tool_code,
  p.parameter_name,
  o.option_id,
  o.option_label,
  o.option_value,
  o.display_order,
  o.enabled
FROM core.tool_parameter_options o
JOIN core.tool_parameters p
  ON p.parameter_id = o.parameter_id
JOIN core.tools t
  ON t.tool_id = p.tool_id
WHERE o.enabled = TRUE
  AND p.enabled = TRUE
  AND t.enabled = TRUE;

ALTER VIEW core.vw_tool_parameter_options OWNER TO postgres;
