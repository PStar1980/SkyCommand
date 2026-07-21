-- Seed: 00069__db_health_structured_output_seed.sql
-- Purpose: Makes Database Health workflow-aware while preserving direct CLI compatibility.

BEGIN;

UPDATE core.tools
SET description = 'Checks one or two PostgreSQL databases and emits structured online/offline evidence for workflows.',
    allow_params = TRUE,
    output_type = 'database_health_summary.v1',
    output_schema_path = 'packages/tools/contracts/database_health_summary.v1.schema.json',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_code = 'db_health';

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
  v.parameter_name,
  v.label,
  v.param_type_code,
  v.prompt,
  v.required,
  v.default_value,
  NULL,
  v.display_order,
  TRUE
FROM core.tools t
JOIN (
  VALUES
    ('databaseName1', 'Database 1', 'string', 'Optional first PostgreSQL database name. Leave blank to use PGDATABASE.', FALSE, NULL, 10),
    ('databaseName2', 'Database 2', 'string', 'Optional second PostgreSQL database name.', FALSE, NULL, 20)
) AS v(parameter_name, label, param_type_code, prompt, required, default_value, display_order)
  ON TRUE
WHERE t.tool_code = 'db_health'
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
