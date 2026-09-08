-- Seed: 00114__browser_test_registry_seed.sql
-- Purpose: Seeds Browser Test permissions, LOCAL environment, initial category, and Workflow Initialization E2E registration.

BEGIN;

-- Browser Tests need JSON parameter support in addition to the existing common parameter types.
INSERT INTO core.param_types (param_type_code, param_type_name, description, active)
VALUES ('json', 'JSON', 'Structured JSON object or array parameter.', TRUE)
ON CONFLICT (param_type_code)
DO UPDATE SET
  param_type_name = EXCLUDED.param_type_name,
  description = EXCLUDED.description,
  active = EXCLUDED.active;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'BROWSER_TEST_READ',
      'browser_tests',
      'read',
      'View enabled Browser Test definitions and runtime parameter metadata.',
      TRUE
    ),
    (
      'BROWSER_TEST_RUN',
      'browser_tests',
      'run',
      'Start approved Browser Test executions through the dedicated Browser Worker.',
      TRUE
    ),
    (
      'ADMIN_BROWSER_TEST_READ',
      'admin_browser_tests',
      'read',
      'View Browser Test registry configuration, categories, parameters, environments, permissions, and status.',
      TRUE
    ),
    (
      'ADMIN_BROWSER_TEST_WRITE',
      'admin_browser_tests',
      'write',
      'Create, update, enable, disable, and manage Browser Test registry configuration.',
      TRUE
    )
)
INSERT INTO auth.permissions (
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
)
SELECT
  admin_app.app_id,
  permission_seed.permission_code,
  permission_seed.resource,
  permission_seed.action,
  permission_seed.description,
  permission_seed.active
FROM permission_seed
CROSS JOIN admin_app
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

-- Read access is intentionally broad; execution remains restricted to operators and administrators.
WITH read_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN'), ('OPERATOR'), ('VIEWER')
), read_permissions(permission_code) AS (
  VALUES ('BROWSER_TEST_READ')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN read_roles rr ON rr.role_code = r.role_code
JOIN read_permissions rp ON TRUE
JOIN auth.permissions p
  ON p.permission_code = rp.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

WITH run_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN'), ('OPERATOR')
), run_permissions(permission_code) AS (
  VALUES ('BROWSER_TEST_RUN')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN run_roles rr ON rr.role_code = r.role_code
JOIN run_permissions rp ON TRUE
JOIN auth.permissions p
  ON p.permission_code = rp.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

WITH admin_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN')
), admin_permissions(permission_code) AS (
  VALUES ('ADMIN_BROWSER_TEST_READ'), ('ADMIN_BROWSER_TEST_WRITE')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN admin_roles ar ON ar.role_code = r.role_code
JOIN admin_permissions ap ON TRUE
JOIN auth.permissions p
  ON p.permission_code = ap.permission_code
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

-- Explicitly keep Browser Test administration restricted to ADMIN/SUPER_ADMIN.
UPDATE auth.role_permissions rp
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.roles r,
     auth.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND p.permission_code IN ('ADMIN_BROWSER_TEST_READ', 'ADMIN_BROWSER_TEST_WRITE')
  AND r.role_code NOT IN ('SUPER_ADMIN', 'ADMIN');

INSERT INTO core.browser_environments (
  environment_code,
  environment_name,
  description,
  base_url,
  display_order,
  enabled
)
VALUES (
  'LOCAL',
  'Local',
  'SkyCommand local Docker web environment used by the dedicated Browser Worker.',
  'http://web:8080',
  10,
  TRUE
)
ON CONFLICT (environment_code)
DO UPDATE SET
  environment_name = EXCLUDED.environment_name,
  description = EXCLUDED.description,
  base_url = EXCLUDED.base_url,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.browser_test_categories (
  category_code,
  name,
  label,
  description,
  display_order,
  enabled
)
VALUES (
  'workflows',
  'Workflows',
  'Workflows',
  'Browser tests covering workflow discovery, initialization, execution, and runtime observability.',
  10,
  TRUE
)
ON CONFLICT (category_code)
DO UPDATE SET
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.browser_tests (
  category_id,
  test_code,
  name,
  label,
  description,
  script_repo_id,
  script_path,
  browser_type,
  default_environment_code,
  timeout_seconds,
  retry_count,
  grep_pattern,
  permission_code,
  risk_code,
  requires_confirmation,
  confirmation_text,
  display_order,
  enabled,
  managed_by_skycommand,
  registered_at
)
SELECT
  c.category_id,
  'workflow-initialization-e2e',
  'Workflow Initialization E2E',
  'Workflow Initialization E2E',
  'Verifies that Start Workflow keeps initialization hidden until requested, then reveals the selected workflow launch controls without starting a workflow.',
  r.repo_id,
  'tests/browser/specs/workflows/workflowInitialization.spec.js',
  'chromium',
  'LOCAL',
  60,
  0,
  '@smoke',
  'BROWSER_TEST_RUN',
  'low',
  FALSE,
  NULL,
  10,
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP
FROM core.browser_test_categories c
JOIN core.repositories r ON r.repo_code = 'SkyCommand'
WHERE c.category_code = 'workflows'
ON CONFLICT (test_code)
DO UPDATE SET
  category_id = EXCLUDED.category_id,
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  script_repo_id = EXCLUDED.script_repo_id,
  script_path = EXCLUDED.script_path,
  browser_type = EXCLUDED.browser_type,
  default_environment_code = EXCLUDED.default_environment_code,
  timeout_seconds = EXCLUDED.timeout_seconds,
  retry_count = EXCLUDED.retry_count,
  grep_pattern = EXCLUDED.grep_pattern,
  permission_code = EXCLUDED.permission_code,
  risk_code = EXCLUDED.risk_code,
  requires_confirmation = EXCLUDED.requires_confirmation,
  confirmation_text = EXCLUDED.confirmation_text,
  display_order = EXCLUDED.display_order,
  enabled = EXCLUDED.enabled,
  managed_by_skycommand = EXCLUDED.managed_by_skycommand,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.browser_test_environments (test_id, environment_code)
SELECT bt.test_id, 'LOCAL'
FROM core.browser_tests bt
WHERE bt.test_code = 'workflow-initialization-e2e'
ON CONFLICT (test_id, environment_code) DO NOTHING;

INSERT INTO core.browser_test_parameters (
  test_id,
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
  bt.test_id,
  'workflowCode',
  'Workflow Code',
  'select',
  'Workflow code to locate and initialize on the Start Workflow page.',
  FALSE,
  'repo-map-zip',
  'skyserver_workflows',
  10,
  TRUE
FROM core.browser_tests bt
WHERE bt.test_code = 'workflow-initialization-e2e'
ON CONFLICT (test_id, parameter_name)
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
