-- Seed: 00122__browser_test_suites_seed.sql
-- Purpose: Permissions and first safe Playwright Test Suite.

BEGIN;

WITH admin_app AS (
  SELECT app_id FROM core.applications WHERE app_code = 'SKYSERVER_ADMIN' LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    ('BROWSER_TEST_SUITE_READ', 'browser_test_suites', 'read', 'View Playwright Test Suite definitions and execution summaries.', TRUE),
    ('BROWSER_TEST_SUITE_RUN', 'browser_test_suites', 'run', 'Execute registered Playwright Test Suites.', TRUE),
    ('ADMIN_BROWSER_TEST_SUITE_WRITE', 'admin_browser_test_suites', 'write', 'Administer Playwright Test Suite definitions and membership.', TRUE)
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
SELECT admin_app.app_id, ps.permission_code, ps.resource, ps.action, ps.description, ps.active
FROM permission_seed ps CROSS JOIN admin_app
ON CONFLICT (permission_code) DO UPDATE SET
  app_id = EXCLUDED.app_id, resource = EXCLUDED.resource, action = EXCLUDED.action,
  description = EXCLUDED.description, active = EXCLUDED.active, updated_at = CURRENT_TIMESTAMP;

WITH role_seed(role_code, permission_code) AS (
  VALUES
    ('SUPER_ADMIN','BROWSER_TEST_SUITE_READ'), ('ADMIN','BROWSER_TEST_SUITE_READ'),
    ('OPERATOR','BROWSER_TEST_SUITE_READ'), ('VIEWER','BROWSER_TEST_SUITE_READ'),
    ('SUPER_ADMIN','BROWSER_TEST_SUITE_RUN'), ('ADMIN','BROWSER_TEST_SUITE_RUN'), ('OPERATOR','BROWSER_TEST_SUITE_RUN'),
    ('SUPER_ADMIN','ADMIN_BROWSER_TEST_SUITE_WRITE'), ('ADMIN','ADMIN_BROWSER_TEST_SUITE_WRITE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM role_seed rs
JOIN auth.roles r ON r.role_code = rs.role_code
JOIN auth.permissions p ON p.permission_code = rs.permission_code AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id) DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

INSERT INTO core.browser_test_suites (
  suite_code, name, label, description, default_environment_code,
  execution_mode, stop_on_failure, permission_code, display_order, enabled
)
VALUES (
  'skycommand-smoke',
  'SkyCommand Smoke Suite',
  'SkyCommand Smoke Suite',
  'Fast background browser confidence suite. Membership expands as additional stable smoke tests are registered.',
  'LOCAL',
  'HEADLESS',
  FALSE,
  'BROWSER_TEST_SUITE_RUN',
  10,
  TRUE
)
ON CONFLICT (suite_code) DO UPDATE SET
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_environment_code = EXCLUDED.default_environment_code,
  execution_mode = EXCLUDED.execution_mode,
  stop_on_failure = EXCLUDED.stop_on_failure,
  permission_code = EXCLUDED.permission_code,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled;

INSERT INTO core.browser_test_suite_members (
  suite_id, test_id, display_order, enabled
)
SELECT s.suite_id, t.test_id, 10, TRUE
FROM core.browser_test_suites s
JOIN core.browser_tests t ON t.test_code = 'workflow-initialization-e2e'
WHERE s.suite_code = 'skycommand-smoke'
ON CONFLICT (suite_id, test_id) DO UPDATE SET
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled;

COMMIT;
