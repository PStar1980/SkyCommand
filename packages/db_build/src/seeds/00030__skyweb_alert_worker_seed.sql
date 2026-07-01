-- ============================================================
-- Seed: 00030__skyweb_alert_worker_seed.sql
-- Purpose:
-- Registers the SkyWeb Analytics alert evaluation worker tool
-- and seeds a default hourly schedule for active alert rules.
-- ============================================================

BEGIN;

-- Ensure the Admin-owned operational permission exists before the
-- SkyWeb alert evaluation tool references it. This seed is intentionally
-- self-contained so it works both during full db_build and when rerun
-- manually against an existing database.
INSERT INTO core.applications (app_code, title, manifest_version, description, active)
VALUES (
  'SKYSERVER_ADMIN',
  'SkyServer Admin',
  '1.0.0',
  'Private administrative web console for SkyServer control-plane operations.',
  TRUE
)
ON CONFLICT (app_code) DO UPDATE
SET title = EXCLUDED.title,
    manifest_version = EXCLUDED.manifest_version,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
), permission_seed AS (
  SELECT
    admin_app.app_id,
    'SKYWEB_ALERT_EVALUATE'::TEXT AS permission_code,
    'skyweb_alerts'::TEXT AS resource,
    'evaluate'::TEXT AS action,
    'Run the SkyWeb alert evaluation operational tool from SkyServer Admin, Scheduler, or workflows.'::TEXT AS description,
    TRUE AS active
  FROM admin_app
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
SELECT
  app_id,
  permission_code,
  resource,
  action,
  description,
  active
FROM permission_seed
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  updated_at = CURRENT_TIMESTAMP;

WITH granted_roles(role_code) AS (
  VALUES
    ('SUPER_ADMIN'),
    ('ADMIN'),
    ('OPERATOR')
)
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT
  r.role_id,
  p.permission_id,
  TRUE
FROM auth.roles r
JOIN granted_roles gr
  ON gr.role_code = r.role_code
JOIN auth.permissions p
  ON p.permission_code = 'SKYWEB_ALERT_EVALUATE'
 AND p.app_id = r.app_id
ON CONFLICT (role_id, permission_id)
DO UPDATE SET
  active = TRUE,
  granted_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_categories (app_id, category_code, name, label, description, display_order, enabled)
SELECT
  a.app_id,
  'skyweb_tools',
  'SkyWeb Tools',
  'SkyWeb Tools',
  'SkyWeb Analytics operational tools for alert evaluation and future member automation.',
  50,
  TRUE
FROM core.applications a
WHERE a.app_code = 'SKYSERVER_CORE'
ON CONFLICT (app_id, category_code) DO UPDATE
SET name = EXCLUDED.name,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_category_visibility (category_id, channel_code)
SELECT c.category_id, v.channel_code
FROM core.tool_categories c
JOIN core.applications a
  ON a.app_id = c.app_id
JOIN (
  VALUES
    ('admin-web'),
    ('api'),
    ('worker')
) AS v(channel_code)
  ON TRUE
WHERE a.app_code = 'SKYSERVER_CORE'
  AND c.category_code = 'skyweb_tools'
ON CONFLICT (category_id, channel_code) DO NOTHING;

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
  c.category_id,
  'skyweb_alerts_evaluate',
  'evaluateSkyWebAlerts',
  'Evaluate SkyWeb Alerts',
  'Evaluates active SkyWeb Analytics macro alert rules and writes event history for scheduled alert checks.',
  r.repo_id,
  'packages/skyweb/src/evaluateSkyWebAlerts.js',
  'node',
  'SKYWEB_ALERT_EVALUATE',
  'medium',
  FALSE,
  NULL,
  TRUE,
  TRUE,
  10,
  TRUE
FROM core.applications a
JOIN core.tool_categories c
  ON c.app_id = a.app_id
 AND c.category_code = 'skyweb_tools'
JOIN core.repositories r
  ON r.repo_code = 'SkyServer'
WHERE a.app_code = 'SKYSERVER_CORE'
ON CONFLICT (tool_code) DO UPDATE
SET category_id = EXCLUDED.category_id,
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
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT t.tool_id, v.channel_code
FROM core.tools t
JOIN (
  VALUES
    ('admin-web'),
    ('api'),
    ('worker')
) AS v(channel_code)
  ON TRUE
WHERE t.tool_code = 'skyweb_alerts_evaluate'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

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
  t.tool_id,
  v.parameter_name,
  v.label,
  v.param_type_code,
  v.prompt,
  v.required,
  v.default_value,
  NULL,
  v.display_order,
  TRUE
FROM core.tools t
JOIN (
  VALUES
    ('maxRules', 'Maximum Rules', 'number', 'Maximum alert rules to evaluate in one scheduled batch.', FALSE, '500', 10),
    ('activeOnly', 'Active Only', 'boolean', 'Evaluate active alert rules only.', FALSE, 'true', 20)
) AS v(parameter_name, label, param_type_code, prompt, required, default_value, display_order)
  ON TRUE
WHERE t.tool_code = 'skyweb_alerts_evaluate'
ON CONFLICT (tool_id, parameter_name) DO UPDATE
SET label = EXCLUDED.label,
    param_type_code = EXCLUDED.param_type_code,
    prompt = EXCLUDED.prompt,
    required = EXCLUDED.required,
    default_value = EXCLUDED.default_value,
    option_source_code = EXCLUDED.option_source_code,
    display_order = EXCLUDED.display_order,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO worker.schedules (
  schedule_code,
  schedule_name,
  description,
  tool_id,
  profile_id,
  schedule_type,
  timezone,
  run_at,
  interval_value,
  interval_unit,
  parameters,
  enabled,
  max_concurrent_runs,
  misfire_policy,
  next_run_at
)
SELECT
  'skyweb-alerts-evaluate-active-hourly',
  'Evaluate active SkyWeb alerts hourly',
  'Scheduled evaluation loop for active SkyWeb Analytics macro alert rules. Writes alert_rule_events and updates last alert status.',
  t.tool_id,
  cp.profile_id,
  'INTERVAL',
  'America/Toronto',
  CURRENT_TIMESTAMP,
  1,
  'HOUR',
  jsonb_build_object('maxRules', '500', 'activeOnly', 'true'),
  TRUE,
  1,
  'RUN_ONCE',
  CURRENT_TIMESTAMP + INTERVAL '1 minute'
FROM core.tools t
LEFT JOIN core.config_profiles cp
  ON cp.profile_code = 'DEV_LOCAL'
WHERE t.tool_code = 'skyweb_alerts_evaluate'
ON CONFLICT (schedule_code) DO UPDATE
SET schedule_name = EXCLUDED.schedule_name,
    description = EXCLUDED.description,
    tool_id = EXCLUDED.tool_id,
    profile_id = EXCLUDED.profile_id,
    schedule_type = EXCLUDED.schedule_type,
    timezone = EXCLUDED.timezone,
    interval_value = EXCLUDED.interval_value,
    interval_unit = EXCLUDED.interval_unit,
    parameters = EXCLUDED.parameters,
    max_concurrent_runs = EXCLUDED.max_concurrent_runs,
    misfire_policy = EXCLUDED.misfire_policy,
    next_run_at = CASE
      WHEN worker.schedules.next_run_at IS NULL AND worker.schedules.enabled = TRUE
        THEN CURRENT_TIMESTAMP + INTERVAL '1 minute'
      ELSE worker.schedules.next_run_at
    END,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;
