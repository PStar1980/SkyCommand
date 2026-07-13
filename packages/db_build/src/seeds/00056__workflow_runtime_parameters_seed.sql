-- ============================================================
-- Seed: 00056__workflow_runtime_parameters_seed.sql
-- Purpose:
-- Adds Phase 13.5 runtime parameter metadata to reusable
-- SkyCommand workflow definitions and wires the macro refresh
-- pipeline node defaults to parameter template references.
-- ============================================================

BEGIN;

WITH macro_runtime_parameters AS (
  SELECT jsonb_build_array(
    jsonb_build_object(
      'key', 'fredIndicators',
      'label', 'FRED indicators',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional FRED indicator codes, comma/space/newline separated. Leave blank for every configured FRED indicator.',
      'displayOrder', 10
    ),
    jsonb_build_object(
      'key', 'fredConcurrency',
      'label', 'FRED concurrency',
      'type', 'number',
      'required', false,
      'defaultValue', 3,
      'description', 'Batch concurrency passed to the FRED ingestion tool.',
      'displayOrder', 20
    ),
    jsonb_build_object(
      'key', 'bocIndicators',
      'label', 'Bank of Canada indicators',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional Bank of Canada indicator codes. Leave blank for every configured BoC indicator.',
      'displayOrder', 30
    ),
    jsonb_build_object(
      'key', 'bocConcurrency',
      'label', 'Bank of Canada concurrency',
      'type', 'number',
      'required', false,
      'defaultValue', 3,
      'description', 'Batch concurrency passed to the Bank of Canada ingestion tool.',
      'displayOrder', 40
    ),
    jsonb_build_object(
      'key', 'statcanIndicators',
      'label', 'Statistics Canada indicators',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional Statistics Canada vector IDs. Leave blank for every configured StatCan indicator.',
      'displayOrder', 50
    ),
    jsonb_build_object(
      'key', 'statcanConcurrency',
      'label', 'Statistics Canada concurrency',
      'type', 'number',
      'required', false,
      'defaultValue', 2,
      'description', 'Batch concurrency passed to the Statistics Canada ingestion tool.',
      'displayOrder', 60
    )
  ) AS schema_json
)
UPDATE worker.workflow_definitions d
SET config = d.config || jsonb_build_object(
      'runtimeParameters', macro_runtime_parameters.schema_json,
      'runtimeParameterVersion', '13.5',
      'runtimeParameterUpdatedBy', '00056__workflow_runtime_parameters_seed'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM macro_runtime_parameters
WHERE d.workflow_code = 'macro-refresh-pipeline';

WITH macro_versions AS (
  SELECT v.workflow_version_id
  FROM worker.workflow_versions v
  JOIN worker.workflow_definitions d
    ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'macro-refresh-pipeline'
)
UPDATE worker.workflow_nodes n
SET input_parameters = n.input_parameters || CASE n.node_key
      WHEN 'fred_ingestion' THEN '{"indicators":"{{ params.fredIndicators }}","concurrency":"{{ params.fredConcurrency }}"}'::jsonb
      WHEN 'boc_ingestion' THEN '{"indicators":"{{ params.bocIndicators }}","concurrency":"{{ params.bocConcurrency }}"}'::jsonb
      WHEN 'statcan_ingestion' THEN '{"indicators":"{{ params.statcanIndicators }}","concurrency":"{{ params.statcanConcurrency }}"}'::jsonb
      ELSE '{}'::jsonb
    END,
    config = n.config || jsonb_build_object(
      'runtimeParameterTemplateVersion', '13.5',
      'runtimeParameterUpdatedBy', '00056__workflow_runtime_parameters_seed'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM macro_versions
WHERE n.workflow_version_id = macro_versions.workflow_version_id
  AND n.node_key IN ('fred_ingestion', 'boc_ingestion', 'statcan_ingestion');

COMMIT;
