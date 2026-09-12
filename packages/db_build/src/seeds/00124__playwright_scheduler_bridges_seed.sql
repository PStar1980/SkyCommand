-- Seed: 00124__playwright_scheduler_bridges_seed.sql
-- Purpose: Adds worker-visible scheduler bridge tools for first-class Playwright targets.
-- These bridge tools preserve the existing worker.schedules schema while the Scheduler UI
-- presents Browser Test, Test Suite, and Browser Automation as native target types.

BEGIN;

WITH core_app AS (
  SELECT app_id FROM core.applications WHERE app_code = 'SKYSERVER_CORE' LIMIT 1
), skycommand_repo AS (
  SELECT repo_id FROM core.repositories WHERE repo_code = 'SkyCommand' LIMIT 1
), category_seed AS (
  INSERT INTO core.tool_categories (
    app_id, category_code, name, label, description, display_order, enabled
  )
  SELECT
    core_app.app_id,
    'playwright_scheduler_bridges',
    'Playwright Scheduler Bridges',
    'Playwright Scheduler Bridges',
    'Internal worker-visible bridge tools used to schedule registered Playwright targets.',
    36,
    TRUE
  FROM core_app
  ON CONFLICT (app_id, category_code) DO UPDATE SET
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
  WHERE c.category_code = 'playwright_scheduler_bridges'
  LIMIT 1
), bridge_seed(tool_code, name, label, description, permission_code, risk_code, display_order) AS (
  VALUES
    (
      'browser_test_schedule_start',
      'browserTestScheduleStart',
      'Run Playwright Test',
      'Internal scheduler bridge that executes a registered Playwright Test headlessly and waits for its durable result.',
      'BROWSER_TEST_RUN',
      'low',
      10
    ),
    (
      'browser_test_suite_schedule_start',
      'browserTestSuiteScheduleStart',
      'Run Playwright Test Suite',
      'Internal scheduler bridge that executes a registered Playwright Test Suite headlessly and waits for its aggregate durable result.',
      'BROWSER_TEST_SUITE_RUN',
      'low',
      20
    ),
    (
      'browser_automation_schedule_start',
      'browserAutomationScheduleStart',
      'Run Playwright Automation',
      'Internal scheduler bridge that executes a registered unattended-safe Playwright Automation headlessly and waits for its durable result.',
      'BROWSER_AUTOMATION_RUN',
      'medium',
      30
    )
), bridge_tools AS (
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
    bridge_seed.tool_code,
    bridge_seed.name,
    bridge_seed.label,
    bridge_seed.description,
    skycommand_repo.repo_id,
    'apps/worker/src/jobs/scheduledPlaywrightRunner.js',
    'node',
    bridge_seed.permission_code,
    bridge_seed.risk_code,
    FALSE,
    NULL,
    TRUE,
    TRUE,
    bridge_seed.display_order,
    TRUE
  FROM target_category
  CROSS JOIN skycommand_repo
  CROSS JOIN bridge_seed
  ON CONFLICT (tool_code) DO UPDATE SET
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
  RETURNING tool_id, tool_code
), target_tools AS (
  SELECT tool_id, tool_code FROM bridge_tools
  UNION ALL
  SELECT t.tool_id, t.tool_code
  FROM core.tools t
  WHERE t.tool_code IN (
    'browser_test_schedule_start',
    'browser_test_suite_schedule_start',
    'browser_automation_schedule_start'
  )
    AND NOT EXISTS (SELECT 1 FROM bridge_tools b WHERE b.tool_id = t.tool_id)
), category_visibility_seed AS (
  INSERT INTO core.tool_category_visibility (category_id, channel_code)
  SELECT target_category.category_id, 'worker'
  FROM target_category
  ON CONFLICT (category_id, channel_code) DO NOTHING
), tool_visibility_seed AS (
  INSERT INTO core.tool_visibility (tool_id, channel_code)
  SELECT target_tools.tool_id, 'worker'
  FROM target_tools
  ON CONFLICT (tool_id, channel_code) DO NOTHING
), parameter_seed(tool_code, parameter_name, label, param_type_code, prompt, required, default_value, display_order) AS (
  VALUES
    ('browser_test_schedule_start', 'testCode', 'Playwright Test', 'string', 'Registered Playwright Test code.', TRUE, NULL, 10),
    ('browser_test_schedule_start', 'environmentCode', 'Environment', 'string', 'Allowed Playwright Test environment code.', TRUE, 'LOCAL', 20),
    ('browser_test_schedule_start', 'parametersJson', 'Test Parameters', 'json', 'Runtime parameter object passed to the Playwright Test.', FALSE, NULL, 30),

    ('browser_test_suite_schedule_start', 'suiteCode', 'Playwright Test Suite', 'string', 'Registered Playwright Test Suite code.', TRUE, NULL, 10),
    ('browser_test_suite_schedule_start', 'environmentCode', 'Environment', 'string', 'Environment code used by the Playwright Test Suite.', TRUE, 'LOCAL', 20),

    ('browser_automation_schedule_start', 'automationCode', 'Playwright Automation', 'string', 'Registered Playwright Automation code.', TRUE, NULL, 10),
    ('browser_automation_schedule_start', 'environmentCode', 'Environment', 'string', 'Allowed Playwright Automation environment code.', TRUE, 'LOCAL', 20),
    ('browser_automation_schedule_start', 'parametersJson', 'Automation Parameters', 'json', 'Runtime parameter object passed to the Playwright Automation.', FALSE, NULL, 30)
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
  NULL,
  parameter_seed.display_order,
  TRUE
FROM target_tools
JOIN parameter_seed ON parameter_seed.tool_code = target_tools.tool_code
ON CONFLICT (tool_id, parameter_name) DO UPDATE SET
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
