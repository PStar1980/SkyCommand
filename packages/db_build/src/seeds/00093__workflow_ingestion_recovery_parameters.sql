-- Seed: 00093__workflow_ingestion_recovery_parameters.sql
-- Phase 16.7.3: Expose production ingestion recovery parameters through
-- the published Macro Refresh Pipeline runtime-parameter contract.

BEGIN;

WITH recovery_parameters AS (
  SELECT jsonb_build_array(
    jsonb_build_object(
      'key', 'fredResumeRunId',
      'label', 'FRED resume run ID',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional failed or partial FRED ingestion run UUID. When supplied, the FRED node recovers only eligible failed assets.',
      'displayOrder', 21
    ),
    jsonb_build_object(
      'key', 'fredRecoveryMode',
      'label', 'FRED recovery mode',
      'type', 'string',
      'required', false,
      'defaultValue', 'INCREMENTAL',
      'description', 'Recovery mode passed to the FRED ingestion tool. Current production recovery supports INCREMENTAL.',
      'displayOrder', 22
    ),
    jsonb_build_object(
      'key', 'fredForceRefresh',
      'label', 'FRED force refresh',
      'type', 'boolean',
      'required', false,
      'defaultValue', false,
      'description', 'Request a forced FRED refresh during recovery when supported.',
      'displayOrder', 23
    ),
    jsonb_build_object(
      'key', 'bocResumeRunId',
      'label', 'Bank of Canada resume run ID',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional failed or partial Bank of Canada ingestion run UUID. When supplied, the BoC node recovers only eligible failed assets.',
      'displayOrder', 41
    ),
    jsonb_build_object(
      'key', 'bocRecoveryMode',
      'label', 'Bank of Canada recovery mode',
      'type', 'string',
      'required', false,
      'defaultValue', 'INCREMENTAL',
      'description', 'Recovery mode passed to the Bank of Canada ingestion tool. Current production recovery supports INCREMENTAL.',
      'displayOrder', 42
    ),
    jsonb_build_object(
      'key', 'bocForceRefresh',
      'label', 'Bank of Canada force refresh',
      'type', 'boolean',
      'required', false,
      'defaultValue', false,
      'description', 'Request a forced Bank of Canada refresh during recovery when supported.',
      'displayOrder', 43
    ),
    jsonb_build_object(
      'key', 'statcanResumeRunId',
      'label', 'Statistics Canada resume run ID',
      'type', 'string',
      'required', false,
      'defaultValue', '',
      'description', 'Optional failed or partial Statistics Canada ingestion run UUID. When supplied, the StatCan node recovers only eligible failed assets.',
      'displayOrder', 61
    ),
    jsonb_build_object(
      'key', 'statcanRecoveryMode',
      'label', 'Statistics Canada recovery mode',
      'type', 'string',
      'required', false,
      'defaultValue', 'INCREMENTAL',
      'description', 'Recovery mode passed to the Statistics Canada ingestion tool. Current production recovery supports INCREMENTAL.',
      'displayOrder', 62
    ),
    jsonb_build_object(
      'key', 'statcanForceRefresh',
      'label', 'Statistics Canada force refresh',
      'type', 'boolean',
      'required', false,
      'defaultValue', false,
      'description', 'Request a forced Statistics Canada refresh during recovery when supported.',
      'displayOrder', 63
    )
  ) AS schema_json
)
UPDATE worker.workflow_definitions definition
SET config = jsonb_set(
      COALESCE(definition.config, '{}'::jsonb) || jsonb_build_object(
        'runtimeParameterVersion', '16.7.3',
        'runtimeParameterUpdatedBy', '00093__workflow_ingestion_recovery_parameters'
      ),
      '{runtimeParameters}',
      COALESCE((
        SELECT jsonb_agg(parameter ORDER BY COALESCE((parameter->>'displayOrder')::int, 9999), parameter->>'key')
        FROM (
          SELECT existing_parameter AS parameter
          FROM jsonb_array_elements(COALESCE(definition.config->'runtimeParameters', '[]'::jsonb)) existing_parameter
          WHERE NOT ((existing_parameter->>'key') = ANY(ARRAY[
            'fredResumeRunId', 'fredRecoveryMode', 'fredForceRefresh',
            'bocResumeRunId', 'bocRecoveryMode', 'bocForceRefresh',
            'statcanResumeRunId', 'statcanRecoveryMode', 'statcanForceRefresh'
          ]::text[]))
          UNION ALL
          SELECT added_parameter
          FROM jsonb_array_elements(recovery_parameters.schema_json) added_parameter
        ) merged_parameters
      ), '[]'::jsonb),
      TRUE
    ),
    updated_at = CURRENT_TIMESTAMP
FROM recovery_parameters
WHERE definition.workflow_code = 'macro-refresh-pipeline';

WITH macro_versions AS (
  SELECT version.workflow_version_id
  FROM worker.workflow_versions version
  JOIN worker.workflow_definitions definition
    ON definition.workflow_definition_id = version.workflow_definition_id
  WHERE definition.workflow_code = 'macro-refresh-pipeline'
)
UPDATE worker.workflow_nodes node
SET input_parameters = COALESCE(node.input_parameters, '{}'::jsonb) || CASE node.node_key
      WHEN 'fred_ingestion' THEN jsonb_build_object(
        'resumeRunId', '{{ params.fredResumeRunId }}',
        'recoveryMode', '{{ params.fredRecoveryMode }}',
        'forceRefresh', '{{ params.fredForceRefresh }}'
      )
      WHEN 'boc_ingestion' THEN jsonb_build_object(
        'resumeRunId', '{{ params.bocResumeRunId }}',
        'recoveryMode', '{{ params.bocRecoveryMode }}',
        'forceRefresh', '{{ params.bocForceRefresh }}'
      )
      WHEN 'statcan_ingestion' THEN jsonb_build_object(
        'resumeRunId', '{{ params.statcanResumeRunId }}',
        'recoveryMode', '{{ params.statcanRecoveryMode }}',
        'forceRefresh', '{{ params.statcanForceRefresh }}'
      )
      ELSE '{}'::jsonb
    END,
    config = COALESCE(node.config, '{}'::jsonb) || jsonb_build_object(
      'recoveryRuntimeParameterVersion', '16.7.3',
      'recoveryRuntimeParameterUpdatedBy', '00093__workflow_ingestion_recovery_parameters'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM macro_versions
WHERE node.workflow_version_id = macro_versions.workflow_version_id
  AND node.node_key IN ('fred_ingestion', 'boc_ingestion', 'statcan_ingestion');

COMMIT;
