-- ============================================================
-- Migration: 00033__temporal_workflow_templates.sql
-- Purpose:
-- Adds database-backed Temporal workflow template metadata for
-- approved SkyServer workflow configuration and Admin-Web forms.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS worker;

CREATE OR REPLACE FUNCTION worker.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Table: worker.temporal_workflow_definitions
-- Purpose: Approved Temporal workflow templates exposed by SkyServer Core/API.
CREATE TABLE IF NOT EXISTS worker.temporal_workflow_definitions (
  definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_code TEXT NOT NULL UNIQUE,
  workflow_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,

  task_queue_name TEXT,
  task_queue_config_key TEXT NOT NULL DEFAULT 'TEMPORAL_TASK_QUEUE',
  workflow_id_prefix TEXT NOT NULL,
  run_source_default TEXT NOT NULL DEFAULT 'api_manual',

  default_timeout_ms INTEGER NOT NULL DEFAULT 1800000 CHECK (default_timeout_ms > 0),
  max_timeout_ms INTEGER NOT NULL DEFAULT 86400000 CHECK (max_timeout_ms > 0),
  default_concurrency INTEGER CHECK (default_concurrency IS NULL OR default_concurrency > 0),
  max_concurrency INTEGER CHECK (max_concurrency IS NULL OR max_concurrency > 0),

  start_permission_code TEXT,
  cancel_permission_code TEXT,
  terminate_permission_code TEXT,

  visible_in_admin BOOLEAN NOT NULL DEFAULT TRUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT temporal_workflow_definitions_code_not_blank CHECK (btrim(workflow_code) <> ''),
  CONSTRAINT temporal_workflow_definitions_type_not_blank CHECK (btrim(workflow_type) <> ''),
  CONSTRAINT temporal_workflow_definitions_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT temporal_workflow_definitions_prefix_not_blank CHECK (btrim(workflow_id_prefix) <> ''),
  CONSTRAINT temporal_workflow_definitions_config_object CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT temporal_workflow_definitions_timeout_bounds CHECK (max_timeout_ms >= default_timeout_ms),
  CONSTRAINT temporal_workflow_definitions_concurrency_bounds CHECK (
    default_concurrency IS NULL
    OR max_concurrency IS NULL
    OR max_concurrency >= default_concurrency
  )
);

CREATE INDEX IF NOT EXISTS idx_temporal_workflow_definitions_enabled
  ON worker.temporal_workflow_definitions (enabled, visible_in_admin, workflow_code);

CREATE TRIGGER temporal_workflow_definitions_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_definitions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.temporal_workflow_definitions IS 'Approved Temporal workflow templates that SkyServer Core/API may expose to Admin-Web and other clients.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.workflow_code IS 'Stable SkyServer template code, such as fred-ingestion.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.workflow_type IS 'Temporal workflow type registered by a worker, such as fredIngestionWorkflow.';
COMMENT ON COLUMN worker.temporal_workflow_definitions.config IS 'Template-specific configuration reserved for future engines, schedules, and Admin-Web rendering hints.';

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

CREATE INDEX IF NOT EXISTS idx_temporal_workflow_parameters_definition_order
  ON worker.temporal_workflow_parameters (definition_id, display_order, parameter_name);

CREATE TRIGGER temporal_workflow_parameters_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_parameters
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.temporal_workflow_parameters IS 'Allowed parameter schema for approved Temporal workflow templates.';
COMMENT ON COLUMN worker.temporal_workflow_parameters.parameter_type IS 'Admin/API parameter type used for validation and dynamic form rendering.';

-- View: worker.vw_temporal_workflow_definitions
-- Purpose: API-friendly workflow definition payload with parameter schema.
CREATE OR REPLACE VIEW worker.vw_temporal_workflow_definitions AS
SELECT
  d.definition_id,
  d.workflow_code,
  d.workflow_type,
  d.display_name,
  d.description,
  d.task_queue_name,
  d.task_queue_config_key,
  d.workflow_id_prefix,
  d.run_source_default,
  d.default_timeout_ms,
  d.max_timeout_ms,
  d.default_concurrency,
  d.max_concurrency,
  d.start_permission_code,
  d.cancel_permission_code,
  d.terminate_permission_code,
  d.visible_in_admin,
  d.enabled,
  d.config,
  d.created_at,
  d.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'parameterId', p.parameter_id,
        'name', p.parameter_name,
        'label', p.label,
        'type', p.parameter_type,
        'required', p.required,
        'defaultValue', p.default_value,
        'minValue', p.min_value,
        'maxValue', p.max_value,
        'allowedValues', p.allowed_values,
        'placeholder', p.placeholder,
        'helpText', p.help_text,
        'validationRegex', p.validation_regex,
        'adminVisible', p.admin_visible,
        'startFormField', p.start_form_field,
        'displayOrder', p.display_order,
        'config', p.config
      )
      ORDER BY p.display_order, p.parameter_name
    ) FILTER (WHERE p.parameter_id IS NOT NULL),
    '[]'::jsonb
  ) AS parameters
FROM worker.temporal_workflow_definitions d
LEFT JOIN worker.temporal_workflow_parameters p
  ON p.definition_id = d.definition_id
GROUP BY d.definition_id;

COMMENT ON VIEW worker.vw_temporal_workflow_definitions IS 'Temporal workflow definitions with parameter schemas aggregated for SkyServer Core/API.';
