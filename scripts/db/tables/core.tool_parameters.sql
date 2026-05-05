-- Table: core.tool_parameters
-- Purpose: Stores parameter metadata for configured tools.

CREATE TABLE IF NOT EXISTS core.tool_parameters (
  parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  label TEXT NOT NULL,
  param_type_code TEXT NOT NULL REFERENCES core.param_types(param_type_code),
  prompt TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  option_source_code TEXT REFERENCES core.option_sources(option_source_code),
  display_order INTEGER NOT NULL DEFAULT 999,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tool_id, parameter_name)
);

ALTER TABLE core.tool_parameters OWNER TO postgres;

COMMENT ON TABLE core.tool_parameters IS 'Parameter definitions for configured tools/scripts.';
