-- ============================================================
-- Seed: 00037__fred_ingestion_tool_upgrade_seed.sql
-- Purpose:
-- Upgrades the existing FRED ingestion tool manifest so the
-- tool primitive supports selected indicators and batched
-- concurrency without requiring Temporal.
-- ============================================================

BEGIN;

WITH target_tool AS (
  UPDATE core.tools
  SET description = 'Loads active FRED macroeconomic indicators into PostgreSQL with optional selected indicators and batched concurrency.',
      allow_params = TRUE,
      captures_output = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE tool_code = 'ingestion_fred'
  RETURNING tool_id
), fallback_tool AS (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'ingestion_fred'
  LIMIT 1
), tool_ref AS (
  SELECT tool_id FROM target_tool
  UNION ALL
  SELECT tool_id FROM fallback_tool
  LIMIT 1
), parameter_seed (
  parameter_name,
  label,
  param_type_code,
  prompt,
  required,
  default_value,
  option_source_code,
  display_order
) AS (
  VALUES
    (
      'indicators',
      'Indicators',
      'string',
      'Optional FRED indicators, comma/space/newline separated. Leave blank for every configured FRED indicator.',
      FALSE,
      NULL,
      NULL,
      10
    ),
    (
      'concurrency',
      'Concurrency',
      'number',
      'Optional batch concurrency. Defaults to 3 and caps at 10.',
      FALSE,
      '3',
      NULL,
      20
    )
)
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
  tool_ref.tool_id,
  parameter_seed.parameter_name,
  parameter_seed.label,
  parameter_seed.param_type_code,
  parameter_seed.prompt,
  parameter_seed.required,
  parameter_seed.default_value,
  parameter_seed.option_source_code,
  parameter_seed.display_order,
  TRUE
FROM tool_ref
CROSS JOIN parameter_seed
ON CONFLICT (tool_id, parameter_name)
DO UPDATE SET
  label = EXCLUDED.label,
  param_type_code = EXCLUDED.param_type_code,
  prompt = EXCLUDED.prompt,
  required = EXCLUDED.required,
  default_value = EXCLUDED.default_value,
  option_source_code = EXCLUDED.option_source_code,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
