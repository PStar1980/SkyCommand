-- ============================================================
-- Seed: 00057__workflow_runtime_parameter_scope_cleanup.sql
-- Purpose:
-- Keeps workflow-level runtime parameters separate from node-level
-- tool defaults. Phase 13.5 originally promoted the macro refresh
-- tool parameters into workflow-level runtime params as a proof case;
-- this cleanup returns those starter parameters to the nodes so
-- Start Workflow only prompts when operators explicitly define
-- workflow-level launch parameters.
-- ============================================================

BEGIN;

UPDATE worker.workflow_definitions d
SET config = d.config
      - 'runtimeParameters'
      - 'runtimeParameterVersion'
      - 'runtimeParameterUpdatedBy',
    updated_at = CURRENT_TIMESTAMP
WHERE d.workflow_code = 'macro-refresh-pipeline'
  AND jsonb_typeof(d.config->'runtimeParameters') = 'array'
  AND (
    d.config->>'runtimeParameterUpdatedBy' = '00056__workflow_runtime_parameters_seed'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(d.config->'runtimeParameters') AS parameter(value)
      WHERE parameter.value->>'key' IN (
        'fredIndicators',
        'fredConcurrency',
        'bocIndicators',
        'bocConcurrency',
        'statcanIndicators',
        'statcanConcurrency'
      )
    )
  );

WITH macro_nodes AS (
  SELECT n.workflow_node_id, n.target_code
  FROM worker.workflow_nodes n
  JOIN worker.workflow_versions v
    ON v.workflow_version_id = n.workflow_version_id
  JOIN worker.workflow_definitions d
    ON d.workflow_definition_id = v.workflow_definition_id
  WHERE d.workflow_code = 'macro-refresh-pipeline'
    AND n.node_type_code = 'TOOL'
    AND n.target_code IN ('ingestion_fred', 'ingestion_boc', 'ingestion_statcan')
    AND (
      n.config->>'runtimeParameterUpdatedBy' = '00056__workflow_runtime_parameters_seed'
      OR n.input_parameters::text LIKE '%{{ params.%'
    )
), node_defaults AS (
  SELECT *
  FROM (VALUES
    ('ingestion_fred',    '{"indicators":"","concurrency":"3"}'::jsonb),
    ('ingestion_boc',     '{"indicators":"","concurrency":"3"}'::jsonb),
    ('ingestion_statcan', '{"indicators":"","concurrency":"2"}'::jsonb)
  ) AS defaults(target_code, input_defaults)
)
UPDATE worker.workflow_nodes n
SET input_parameters = n.input_parameters || node_defaults.input_defaults,
    config = (COALESCE(n.config, '{}'::jsonb)
      - 'runtimeParameterTemplateVersion'
      - 'runtimeParameterUpdatedBy')
      || jsonb_build_object(
        'runtimeParameterScopeCleanup', true,
        'runtimeParameterScopeCleanupSeed', '00057__workflow_runtime_parameter_scope_cleanup'
      ),
    updated_at = CURRENT_TIMESTAMP
FROM macro_nodes
JOIN node_defaults
  ON node_defaults.target_code = macro_nodes.target_code
WHERE n.workflow_node_id = macro_nodes.workflow_node_id;

COMMIT;
