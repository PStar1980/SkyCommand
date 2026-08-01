-- Seed: 00092__production_ingestion_recovery_integration.sql
-- Phase 16.7.2: Enable failed-only recovery for production macro ingestion tools.

BEGIN;

UPDATE data.ingestion_tool_profiles profile
SET supports_resume = TRUE,
    updated_at = CURRENT_TIMESTAMP
FROM core.tools tool
WHERE tool.tool_id = profile.tool_id
  AND tool.tool_code IN ('ingestion_fred', 'ingestion_boc', 'ingestion_statcan');

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
  tool.tool_id,
  parameter.parameter_name,
  parameter.label,
  parameter.param_type_code,
  parameter.prompt,
  FALSE,
  parameter.default_value,
  NULL,
  parameter.display_order,
  TRUE
FROM core.tools tool
CROSS JOIN (
  VALUES
    (
      'resumeRunId',
      'Resume Run ID',
      'string',
      'Optional ingestion run UUID. When supplied, rerun only failed assets from that durable run. The Indicators field may narrow the failed subset.',
      NULL,
      30
    ),
    (
      'recoveryMode',
      'Recovery Mode',
      'string',
      'Recovery mode: INCREMENTAL, BACKFILL, or FULL. Current production adapters support INCREMENTAL recovery.',
      'INCREMENTAL',
      40
    ),
    (
      'forceRefresh',
      'Force Refresh',
      'boolean',
      'Request a forced refresh during recovery when supported by the source adapter.',
      'false',
      50
    )
) AS parameter(
  parameter_name,
  label,
  param_type_code,
  prompt,
  default_value,
  display_order
)
WHERE tool.tool_code IN ('ingestion_fred', 'ingestion_boc', 'ingestion_statcan')
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
