-- Table: worker.temporal_workflow_parameters
-- Purpose: Parameter schema for approved Temporal workflow templates.

CREATE TABLE IF NOT EXISTS worker.temporal_workflow_parameters (
  parameter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES worker.temporal_workflow_definitions(definition_id) ON DELETE CASCADE,
  parameter_name TEXT NOT NULL,
  label TEXT NOT NULL,
  parameter_type TEXT NOT NULL
    CHECK (parameter_type IN ('STRING', 'STRING_ARRAY', 'INTEGER', 'BOOLEAN', 'JSON', 'SELECT')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  default_value JSONB,
  min_value INTEGER,
  max_value INTEGER,
  allowed_values JSONB,
  placeholder TEXT,
  help_text TEXT,
  validation_regex TEXT,
  admin_visible BOOLEAN NOT NULL DEFAULT TRUE,
  start_form_field BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 100,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT temporal_workflow_parameters_name_not_blank CHECK (btrim(parameter_name) <> ''),
  CONSTRAINT temporal_workflow_parameters_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT temporal_workflow_parameters_allowed_values_array CHECK (
    allowed_values IS NULL OR jsonb_typeof(allowed_values) = 'array'
  ),
  CONSTRAINT temporal_workflow_parameters_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT temporal_workflow_parameters_integer_bounds CHECK (
    min_value IS NULL OR max_value IS NULL OR max_value >= min_value
  ),
  UNIQUE (definition_id, parameter_name)
);

ALTER TABLE worker.temporal_workflow_parameters OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_temporal_workflow_parameters_definition_order
  ON worker.temporal_workflow_parameters (definition_id, display_order, parameter_name);

COMMENT ON TABLE worker.temporal_workflow_parameters IS 'Allowed parameter schema for approved Temporal workflow templates.';
COMMENT ON COLUMN worker.temporal_workflow_parameters.parameter_type IS 'Admin/API parameter type used for validation and dynamic form rendering.';
