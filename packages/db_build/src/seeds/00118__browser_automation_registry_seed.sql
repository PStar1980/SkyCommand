-- Seed: 00118__browser_automation_registry_seed.sql
-- Purpose: Seeds Playwright Automation permissions and initial registry categories.

BEGIN;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed(permission_code, resource, action, description, active) AS (
  VALUES
    (
      'BROWSER_AUTOMATION_READ',
      'browser_automations',
      'read',
      'View enabled Playwright Automation definitions, safety metadata, output contracts, environments, and parameters.',
      TRUE
    ),
    (
      'BROWSER_AUTOMATION_RUN',
      'browser_automations',
      'run',
      'Start approved Playwright Automation executions through the browser execution runtime.',
      TRUE
    ),
    (
      'ADMIN_BROWSER_AUTOMATION_READ',
      'admin_browser_automations',
      'read',
      'View Playwright Automation registry configuration, parameters, environments, permissions, risk, and output contracts.',
      TRUE
    ),
    (
      'ADMIN_BROWSER_AUTOMATION_WRITE',
      'admin_browser_automations',
      'write',
      'Create, update, enable, disable, and manage Playwright Automation registry configuration.',
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

WITH read_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN'), ('OPERATOR'), ('VIEWER')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN read_roles rr ON rr.role_code = r.role_code
JOIN auth.permissions p
  ON p.permission_code = 'BROWSER_AUTOMATION_READ'
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

WITH run_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN'), ('OPERATOR')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN run_roles rr ON rr.role_code = r.role_code
JOIN auth.permissions p
  ON p.permission_code = 'BROWSER_AUTOMATION_RUN'
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

WITH admin_roles(role_code) AS (
  VALUES ('SUPER_ADMIN'), ('ADMIN')
), admin_permissions(permission_code) AS (
  VALUES ('ADMIN_BROWSER_AUTOMATION_READ'), ('ADMIN_BROWSER_AUTOMATION_WRITE')
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

UPDATE auth.role_permissions rp
SET active = FALSE,
    granted_at = CURRENT_TIMESTAMP
FROM auth.roles r,
     auth.permissions p
WHERE rp.role_id = r.role_id
  AND rp.permission_id = p.permission_id
  AND p.permission_code IN ('ADMIN_BROWSER_AUTOMATION_READ', 'ADMIN_BROWSER_AUTOMATION_WRITE')
  AND r.role_code NOT IN ('SUPER_ADMIN', 'ADMIN');

INSERT INTO core.browser_automation_categories (
  category_code,
  name,
  label,
  description,
  display_order,
  enabled
)
VALUES
  (
    'skycommand',
    'SkyCommand',
    'SkyCommand',
    'Operational Playwright automations that interact with SkyCommand through its browser UI.',
    10,
    TRUE
  ),
  (
    'data_acquisition',
    'Data Acquisition',
    'Data Acquisition',
    'Read-oriented browser automations that retrieve reports, files, or structured data from web-only systems.',
    20,
    TRUE
  ),
  (
    'administration',
    'Administration',
    'Administration',
    'Browser automations that perform controlled administrative work in web-only systems.',
    30,
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


-- Register the first low-risk reference automation as disabled until the Phase 7 execution surface is connected.
-- Its source exists now so the registry never points at an invented future file.
INSERT INTO core.browser_automations (
  category_id,
  automation_code,
  name,
  label,
  description,
  script_repo_id,
  script_path,
  browser_type,
  default_environment_code,
  timeout_seconds,
  retry_count,
  max_concurrency,
  permission_code,
  risk_code,
  requires_confirmation,
  confirmation_text,
  side_effect_level,
  idempotency_mode,
  output_type,
  output_schema_path,
  display_order,
  enabled,
  managed_by_skycommand,
  registered_at
)
SELECT
  c.category_id,
  'command-center-status-snapshot',
  'Command Center Status Snapshot',
  'Command Center Status Snapshot',
  'Collects a read-only structured snapshot of the SkyCommand Command Center service-status cards.',
  r.repo_id,
  'browser-automation/scripts/skycommand/commandCenterStatus.js',
  'chromium',
  'LOCAL',
  60,
  1,
  1,
  'BROWSER_AUTOMATION_RUN',
  'low',
  FALSE,
  NULL,
  'READ_ONLY',
  'READ_ONLY',
  'browser_automation_summary.v1',
  'packages/browser/contracts/browser_automation_summary.v1.schema.json',
  10,
  FALSE,
  TRUE,
  CURRENT_TIMESTAMP
FROM core.browser_automation_categories c
JOIN core.repositories r ON r.repo_code = 'SkyCommand'
WHERE c.category_code = 'skycommand'
ON CONFLICT (automation_code)
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
  max_concurrency = EXCLUDED.max_concurrency,
  permission_code = EXCLUDED.permission_code,
  risk_code = EXCLUDED.risk_code,
  requires_confirmation = EXCLUDED.requires_confirmation,
  confirmation_text = EXCLUDED.confirmation_text,
  side_effect_level = EXCLUDED.side_effect_level,
  idempotency_mode = EXCLUDED.idempotency_mode,
  output_type = EXCLUDED.output_type,
  output_schema_path = EXCLUDED.output_schema_path,
  display_order = EXCLUDED.display_order,
  managed_by_skycommand = EXCLUDED.managed_by_skycommand,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.browser_automation_environments (automation_id, environment_code)
SELECT automation_id, 'LOCAL'
FROM core.browser_automations
WHERE automation_code = 'command-center-status-snapshot'
ON CONFLICT (automation_id, environment_code) DO NOTHING;

COMMIT;
