-- Migration: 00123__playwright_workflow_node_types.sql
-- Purpose: Adds first-class workflow node types for registered Playwright Tests,
-- Test Suites, and Playwright Automations.

BEGIN;

INSERT INTO worker.workflow_node_types (
  node_type_code,
  display_name,
  description,
  category,
  target_kind,
  icon,
  requires_target,
  enabled,
  config
)
VALUES
  (
    'BROWSER_TEST',
    'Playwright Test',
    'Runs a registered Playwright Test headlessly and waits for the durable browser execution result.',
    'ACTION',
    'core.browser_tests',
    'test',
    TRUE,
    TRUE,
    '{"initiallySupported":true,"builderCard":"playwright_test","executionMode":"HEADLESS"}'::jsonb
  ),
  (
    'BROWSER_TEST_SUITE',
    'Playwright Test Suite',
    'Runs a registered Playwright Test Suite headlessly and waits for its aggregate result.',
    'WORKFLOW',
    'core.browser_test_suites',
    'suite',
    TRUE,
    TRUE,
    '{"initiallySupported":true,"builderCard":"playwright_test_suite","executionMode":"HEADLESS"}'::jsonb
  ),
  (
    'BROWSER_AUTOMATION',
    'Playwright Automation',
    'Runs a registered Playwright Automation headlessly and waits for its structured operational result.',
    'ACTION',
    'core.browser_automations',
    'browser',
    TRUE,
    TRUE,
    '{"initiallySupported":true,"builderCard":"playwright_automation","executionMode":"HEADLESS"}'::jsonb
  )
ON CONFLICT (node_type_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  target_kind = EXCLUDED.target_kind,
  icon = EXCLUDED.icon,
  requires_target = EXCLUDED.requires_target,
  enabled = EXCLUDED.enabled,
  config = EXCLUDED.config;

COMMIT;
