-- Seed: 00070__db_build_structured_output_seed.sql
-- Purpose: Makes Database Build workflow-aware while preserving its existing destructive CLI behavior.

BEGIN;

UPDATE core.tools
SET description = 'Drops, recreates, and rebuilds a selected PostgreSQL database from globally ordered migration and seed files, with structured workflow evidence.',
    captures_output = TRUE,
    allow_params = TRUE,
    output_type = 'database_build_summary.v1',
    output_schema_path = 'packages/tools/contracts/database_build_summary.v1.schema.json',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'db_build';

INSERT INTO core.tool_parameters (
  tool_id,
  parameter_name,
  label,
  param_type_code,
  prompt,
  required,
  default_value,
  option_source_code,
  display_order,
  enabled
)
SELECT
  t.tool_id,
  'databaseName',
  'Database Name',
  'string',
  'Enter the target PostgreSQL database name, for example skyserver_dev or skyserver_test.',
  TRUE,
  NULL,
  NULL,
  10,
  TRUE
FROM core.tools t
WHERE t.tool_code = 'db_build'
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = TRUE,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
