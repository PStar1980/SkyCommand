-- ============================================================
-- Seed: 00042__skyserver_workflow_schedule_bridge_seed.sql
-- Purpose:
-- Seeds a worker-visible scheduler bridge tool that starts approved
-- SkyServer workflow definitions through the Temporal-backed executor.
-- ============================================================

BEGIN;

WITH option_source_seed AS (
  INSERT INTO core.option_sources (
    option_source_code,
    option_source_name,
    description,
    active
  )
  VALUES (
    'skyserver_workflows',
    'SkyServer Workflows',
    'Active, enabled, Admin-visible SkyServer workflow definitions that have a published current graph.',
    TRUE
  )
  ON CONFLICT (option_source_code)
  DO UPDATE SET
    option_source_name = EXCLUDED.option_source_name,
    description = EXCLUDED.description,
    active = EXCLUDED.active
), core_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_CORE'
  LIMIT 1
), skyserver_repo AS (
  SELECT repo_id
  FROM core.repositories
  WHERE repo_code = 'SkyServer'
  LIMIT 1
), category_seed AS (
  INSERT INTO core.tool_categories (
    app_id,
    category_code,
    name,
    label,
    description,
    display_order,
    enabled
  )
  SELECT
    core_app.app_id,
    'workflow_tools',
    'Workflow Tools',
    'Workflow Tools',
    'Temporal and SkyServer workflow orchestration bridge operations.',
    35,
    TRUE
  FROM core_app
  ON CONFLICT (app_id, category_code)
  DO UPDATE SET
    name = EXCLUDED.name,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP
  RETURNING category_id
), target_category AS (
  SELECT category_id FROM category_seed
  UNION ALL
  SELECT c.category_id
  FROM core.tool_categories c
  JOIN core_app a ON a.app_id = c.app_id
  WHERE c.category_code = 'workflow_tools'
  LIMIT 1
), bridge_tool AS (
  INSERT INTO core.tools (
    category_id,
    tool_code,
    name,
    label,
    description,
    script_repo_id,
    script_path,
    runtime_code,
    permission_code,
    risk_code,
    requires_confirmation,
    confirmation_text,
    captures_output,
    allow_params,
    display_order,
    enabled
  )
  SELECT
    target_category.category_id,
    'skyserver_workflow_start',
    'skyserverWorkflowStart',
    'Start SkyServer Workflow',
    'Bridge tool that starts an approved SkyServer workflow definition through the Temporal-backed workflow executor from Admin-Web, API, or worker schedules.',
    skyserver_repo.repo_id,
    'packages/temporal/src/worker.js',
    'node',
    'WORKFLOW_START',
    'medium',
    TRUE,
    'This action will start an approved SkyServer workflow through the Temporal-backed executor. Confirm only when the workflow, timing, and input JSON are intentional.',
    TRUE,
    TRUE,
    20,
    TRUE
  FROM target_category
  CROSS JOIN skyserver_repo
  ON CONFLICT (tool_code)
  DO UPDATE SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    script_repo_id = EXCLUDED.script_repo_id,
    script_path = EXCLUDED.script_path,
    runtime_code = EXCLUDED.runtime_code,
    permission_code = EXCLUDED.permission_code,
    risk_code = EXCLUDED.risk_code,
    requires_confirmation = EXCLUDED.requires_confirmation,
    confirmation_text = EXCLUDED.confirmation_text,
    captures_output = EXCLUDED.captures_output,
    allow_params = EXCLUDED.allow_params,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP
  RETURNING tool_id
), target_tool AS (
  SELECT tool_id FROM bridge_tool
  UNION ALL
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'skyserver_workflow_start'
  LIMIT 1
), visibility_seed AS (
  INSERT INTO core.tool_category_visibility (category_id, channel_code)
  SELECT target_category.category_id, channel.channel_code
  FROM target_category
  CROSS JOIN (VALUES ('admin-web'), ('api'), ('worker')) AS channel(channel_code)
  ON CONFLICT (category_id, channel_code) DO NOTHING
), tool_visibility_seed AS (
  INSERT INTO core.tool_visibility (tool_id, channel_code)
  SELECT target_tool.tool_id, channel.channel_code
  FROM target_tool
  CROSS JOIN (VALUES ('admin-web'), ('api'), ('worker')) AS channel(channel_code)
  ON CONFLICT (tool_id, channel_code) DO NOTHING
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
      'workflowCode',
      'Workflow',
      'select',
      'Choose an active SkyServer workflow definition.',
      TRUE,
      'macro-refresh-pipeline',
      'skyserver_workflows',
      10
    ),
    (
      'workflowId',
      'Temporal Workflow ID Override',
      'string',
      'Optional Temporal workflow ID override for the executor workflow. Leave blank for an auto-generated ID.',
      FALSE,
      NULL,
      NULL,
      20
    ),
    (
      'inputJson',
      'Workflow Input JSON',
      'string',
      'Optional JSON object passed to the SkyServer workflow. Leave blank to use the workflow node defaults configured in Manage Workflows.',
      FALSE,
      NULL,
      NULL,
      30
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
  target_tool.tool_id,
  parameter_seed.parameter_name,
  parameter_seed.label,
  parameter_seed.param_type_code,
  parameter_seed.prompt,
  parameter_seed.required,
  parameter_seed.default_value,
  parameter_seed.option_source_code,
  parameter_seed.display_order,
  TRUE
FROM target_tool
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
