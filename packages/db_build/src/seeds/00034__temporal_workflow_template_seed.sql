-- ============================================================
-- Seed: 00034__temporal_workflow_template_seed.sql
-- Purpose:
-- Seeds approved Temporal workflow templates and parameter schemas
-- for SkyServer Admin-Web workflow configuration.
-- ============================================================

BEGIN;

WITH upsert_definition AS (
  INSERT INTO worker.temporal_workflow_definitions (
    workflow_code,
    workflow_type,
    display_name,
    description,
    task_queue_name,
    task_queue_config_key,
    workflow_id_prefix,
    run_source_default,
    default_timeout_ms,
    max_timeout_ms,
    default_concurrency,
    max_concurrency,
    start_permission_code,
    cancel_permission_code,
    terminate_permission_code,
    visible_in_admin,
    enabled,
    config
  )
  VALUES (
    'fred-ingestion',
    'fredIngestionWorkflow',
    'FRED Macro Ingestion',
    'Runs Temporal-backed FRED macro ingestion at the indicator level with configurable batching and concurrency.',
    NULL,
    'TEMPORAL_TASK_QUEUE',
    'skyserver-fred-ingestion',
    'api_manual',
    1800000,
    86400000,
    3,
    10,
    'TEMPORAL_WORKFLOW_START',
    'TEMPORAL_WORKFLOW_CANCEL',
    'TEMPORAL_WORKFLOW_TERMINATE',
    TRUE,
    TRUE,
    '{
      "source": "FRED",
      "mode": "indicator_batch",
      "adminForm": {
        "title": "Run FRED ingestion",
        "submitLabel": "Start workflow",
        "successTemplate": "Started {workflowType} as {workflowId}."
      }
    }'::jsonb
  )
  ON CONFLICT (workflow_code)
  DO UPDATE SET
    workflow_type = EXCLUDED.workflow_type,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    task_queue_name = EXCLUDED.task_queue_name,
    task_queue_config_key = EXCLUDED.task_queue_config_key,
    workflow_id_prefix = EXCLUDED.workflow_id_prefix,
    run_source_default = EXCLUDED.run_source_default,
    default_timeout_ms = EXCLUDED.default_timeout_ms,
    max_timeout_ms = EXCLUDED.max_timeout_ms,
    default_concurrency = EXCLUDED.default_concurrency,
    max_concurrency = EXCLUDED.max_concurrency,
    start_permission_code = EXCLUDED.start_permission_code,
    cancel_permission_code = EXCLUDED.cancel_permission_code,
    terminate_permission_code = EXCLUDED.terminate_permission_code,
    visible_in_admin = EXCLUDED.visible_in_admin,
    enabled = EXCLUDED.enabled,
    config = EXCLUDED.config,
    updated_at = CURRENT_TIMESTAMP
  RETURNING definition_id
), target_definition AS (
  SELECT definition_id FROM upsert_definition
  UNION ALL
  SELECT definition_id
  FROM worker.temporal_workflow_definitions
  WHERE workflow_code = 'fred-ingestion'
  LIMIT 1
), parameter_seed (
  parameter_name,
  label,
  parameter_type,
  required,
  default_value,
  min_value,
  max_value,
  allowed_values,
  placeholder,
  help_text,
  validation_regex,
  admin_visible,
  start_form_field,
  display_order,
  config
) AS (
  VALUES
  (
    'indicators',
    'Indicators',
    'STRING_ARRAY',
    FALSE,
    '[]'::jsonb,
    NULL,
    NULL,
    NULL,
    'GDP, UNRATE, DGS10 — leave blank for full FRED set',
    'Comma, space, or newline separated. Blank runs every configured FRED indicator.',
    '^[A-Za-z0-9_,\\s-]*$',
    TRUE,
    TRUE,
    10,
    '{"textareaRows": 4}'::jsonb
  ),
  (
    'concurrency',
    'Concurrency',
    'INTEGER',
    FALSE,
    '3'::jsonb,
    1,
    10,
    NULL,
    NULL,
    'Worker batches up to this many indicator activities at once.',
    NULL,
    TRUE,
    TRUE,
    20,
    '{}'::jsonb
  ),
  (
    'workflowId',
    'Workflow ID override',
    'STRING',
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL,
    'Optional; normally auto-generated',
    'Optional manual workflow ID. Leave blank unless you need a stable run identifier.',
    '^[A-Za-z0-9_-]*$',
    TRUE,
    TRUE,
    30,
    '{}'::jsonb
  ),
  (
    'timeoutMs',
    'Activity timeout',
    'INTEGER',
    FALSE,
    '1800000'::jsonb,
    1000,
    86400000,
    NULL,
    NULL,
    'Reserved advanced setting. Defaults to 30 minutes and is capped at 24 hours.',
    NULL,
    FALSE,
    FALSE,
    90,
    '{}'::jsonb
  ),
  (
    'runSource',
    'Run source',
    'STRING',
    FALSE,
    '"admin_web_manual"'::jsonb,
    NULL,
    NULL,
    NULL,
    NULL,
    'Source tag used for auditing and future run attribution.',
    NULL,
    FALSE,
    FALSE,
    100,
    '{}'::jsonb
  )
)
INSERT INTO worker.temporal_workflow_parameters (
  definition_id,
  parameter_name,
  label,
  parameter_type,
  required,
  default_value,
  min_value,
  max_value,
  allowed_values,
  placeholder,
  help_text,
  validation_regex,
  admin_visible,
  start_form_field,
  display_order,
  config
)
SELECT
  target_definition.definition_id,
  parameter_seed.parameter_name,
  parameter_seed.label,
  parameter_seed.parameter_type,
  parameter_seed.required,
  parameter_seed.default_value,
  parameter_seed.min_value,
  parameter_seed.max_value,
  parameter_seed.allowed_values,
  parameter_seed.placeholder,
  parameter_seed.help_text,
  parameter_seed.validation_regex,
  parameter_seed.admin_visible,
  parameter_seed.start_form_field,
  parameter_seed.display_order,
  parameter_seed.config
FROM parameter_seed
CROSS JOIN target_definition
ON CONFLICT (definition_id, parameter_name)
DO UPDATE SET
  label = EXCLUDED.label,
  parameter_type = EXCLUDED.parameter_type,
  required = EXCLUDED.required,
  default_value = EXCLUDED.default_value,
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value,
  allowed_values = EXCLUDED.allowed_values,
  placeholder = EXCLUDED.placeholder,
  help_text = EXCLUDED.help_text,
  validation_regex = EXCLUDED.validation_regex,
  admin_visible = EXCLUDED.admin_visible,
  start_form_field = EXCLUDED.start_form_field,
  display_order = EXCLUDED.display_order,
  config = EXCLUDED.config,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
