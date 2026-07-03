-- ============================================================
-- Seed: 00044__boc_statcan_ingestion_tool_upgrade_seed.sql
-- Purpose:
-- Upgrades BoC and StatCan ingestion tool manifests so both
-- primitives support selected indicators and batched concurrency,
-- matching the upgraded FRED ingestion primitive.
-- ============================================================

BEGIN;

WITH target_tools AS (
  UPDATE core.tools
  SET description = CASE tool_code
        WHEN 'ingestion_boc' THEN 'Loads active Bank of Canada macroeconomic indicators into PostgreSQL with optional selected indicators and batched concurrency.'
        WHEN 'ingestion_statcan' THEN 'Loads active Statistics Canada vector-based macroeconomic indicators into PostgreSQL with optional selected indicators and batched concurrency.'
        ELSE description
      END,
      allow_params = TRUE,
      captures_output = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE tool_code IN ('ingestion_boc', 'ingestion_statcan')
  RETURNING tool_id, tool_code
), parameter_seed (
  tool_code,
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
      'ingestion_boc',
      'indicators',
      'Indicators',
      'string',
      'Optional Bank of Canada indicator codes, comma/space/newline separated. Leave blank for every configured BoC indicator.',
      FALSE,
      NULL,
      NULL,
      10
    ),
    (
      'ingestion_boc',
      'concurrency',
      'Concurrency',
      'number',
      'Optional batch concurrency. Defaults to 3 and caps at 10.',
      FALSE,
      '3',
      NULL,
      20
    ),
    (
      'ingestion_statcan',
      'indicators',
      'Indicators',
      'string',
      'Optional Statistics Canada indicator codes, comma/space/newline separated. Leave blank for every configured StatCan indicator.',
      FALSE,
      NULL,
      NULL,
      10
    ),
    (
      'ingestion_statcan',
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
  target_tools.tool_id,
  parameter_seed.parameter_name,
  parameter_seed.label,
  parameter_seed.param_type_code,
  parameter_seed.prompt,
  parameter_seed.required,
  parameter_seed.default_value,
  parameter_seed.option_source_code,
  parameter_seed.display_order,
  TRUE
FROM target_tools
JOIN parameter_seed
  ON parameter_seed.tool_code = target_tools.tool_code
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
