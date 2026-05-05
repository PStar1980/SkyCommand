-- Table: core.tool_parameter_options
-- Purpose: Stores static dropdown options for select-style parameters.

CREATE TABLE IF NOT EXISTS core.tool_parameter_options (
  option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_id UUID NOT NULL REFERENCES core.tool_parameters(parameter_id) ON DELETE CASCADE,
  option_label TEXT NOT NULL,
  option_value TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (parameter_id, option_value)
);

ALTER TABLE core.tool_parameter_options OWNER TO postgres;

COMMENT ON TABLE core.tool_parameter_options IS 'Static parameter options for configured tool parameters.';
