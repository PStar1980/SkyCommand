-- Migration: 00111__local_dev_pull_tool.sql
-- Purpose:
--   Registers Local Dev Pull, a host-only guarded Git convergence primitive for
--   workflows that begin with commits already present on origin/dev. The tool
--   fast-forwards the checked-out local dev worktree only when origin/dev is
--   strictly ahead and local dev is its ancestor; Docker callers dispatch the
--   mutation through the SkyCommand Host Agent.

BEGIN;

WITH admin_app AS (
  SELECT app_id
  FROM core.applications
  WHERE app_code = 'SKYSERVER_ADMIN'
  LIMIT 1
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
  'GIT_LOCAL_DEV_PULL_RUN',
  'git',
  'local_dev_pull',
  'Safely fast-forward the host-owned local dev worktree to a strictly-ahead origin/dev head.',
  TRUE
FROM admin_app
ON CONFLICT (permission_code) DO UPDATE
SET app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN auth.permissions p
  ON p.permission_code = 'GIT_LOCAL_DEV_PULL_RUN'
 AND p.app_id = r.app_id
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET active = TRUE,
    granted_at = CURRENT_TIMESTAMP;

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
  enabled,
  output_type,
  output_schema_path,
  managed_by_skycommand
)
SELECT
  c.category_id,
  'local_dev_pull',
  'local_dev_pull',
  'Local Dev Pull',
  'Host-only guarded fast-forward of the checked-out local dev worktree to origin/dev. Requires a clean repository, a strictly-ahead remote dev head, fast-forward ancestry, stable remote state, and final local/remote equality.',
  repo.repo_id,
  'packages/git/src/local_dev_pull.js',
  'node',
  'GIT_LOCAL_DEV_PULL_RUN',
  'high',
  TRUE,
  'This operation requests the SkyCommand Host Agent to fast-forward the checked-out local dev worktree only if origin/dev is strictly ahead and all Git safety guardrails pass.',
  TRUE,
  TRUE,
  15,
  TRUE,
  'git_dev_pull_summary.v1',
  'packages/tools/contracts/git_dev_pull_summary.v1.schema.json',
  FALSE
FROM core.tool_categories c
JOIN core.applications a ON a.app_id = c.app_id
JOIN core.repositories repo ON repo.repo_code = 'SkyCommand'
WHERE a.app_code = 'SKYSERVER_CORE'
  AND c.category_code = 'git_tools'
ON CONFLICT (tool_code) DO UPDATE
SET category_id = EXCLUDED.category_id,
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
    output_type = EXCLUDED.output_type,
    output_schema_path = EXCLUDED.output_schema_path,
    managed_by_skycommand = EXCLUDED.managed_by_skycommand,
    updated_at = CURRENT_TIMESTAMP;

WITH local_dev_pull AS (
  SELECT tool_id
  FROM core.tools
  WHERE tool_code = 'local_dev_pull'
  LIMIT 1
), channels(channel_code) AS (
  VALUES ('cli'), ('admin-web'), ('api'), ('worker')
)
INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT local_dev_pull.tool_id, channels.channel_code
FROM local_dev_pull
CROSS JOIN channels
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH parameter_seed(parameter_name, label, param_type_code, prompt, required, option_source_code, display_order) AS (
  VALUES
    ('repoName', 'Repository', 'repo', 'Select repository whose local dev branch should fast-forward to origin/dev', TRUE, 'repositories', 10)
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
  t.tool_id,
  p.parameter_name,
  p.label,
  p.param_type_code,
  p.prompt,
  p.required,
  NULL,
  p.option_source_code,
  p.display_order,
  TRUE
FROM core.tools t
CROSS JOIN parameter_seed p
WHERE t.tool_code = 'local_dev_pull'
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

DO $$
DECLARE
  expected_app_id UUID;
  local_dev_pull_tool_id UUID;
  required_channel TEXT;
BEGIN
  SELECT app_id
    INTO expected_app_id
    FROM core.applications
   WHERE app_code = 'SKYSERVER_ADMIN'
   LIMIT 1;

  IF expected_app_id IS NULL THEN
    RAISE EXCEPTION '00111: SKYSERVER_ADMIN application is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM auth.permissions
     WHERE permission_code = 'GIT_LOCAL_DEV_PULL_RUN'
       AND app_id = expected_app_id
       AND active = TRUE
  ) THEN
    RAISE EXCEPTION '00111: GIT_LOCAL_DEV_PULL_RUN permission registration failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM auth.roles r
      JOIN auth.role_permissions rp ON rp.role_id = r.role_id AND rp.active = TRUE
      JOIN auth.permissions p ON p.permission_id = rp.permission_id
     WHERE r.role_code = 'SUPER_ADMIN'
       AND p.permission_code = 'GIT_LOCAL_DEV_PULL_RUN'
       AND p.app_id = r.app_id
  ) THEN
    RAISE EXCEPTION '00111: SUPER_ADMIN grant for GIT_LOCAL_DEV_PULL_RUN failed';
  END IF;

  SELECT tool_id
    INTO local_dev_pull_tool_id
    FROM core.tools
   WHERE tool_code = 'local_dev_pull'
   LIMIT 1;

  IF local_dev_pull_tool_id IS NULL THEN
    RAISE EXCEPTION '00111: local_dev_pull tool registration failed';
  END IF;

  FOREACH required_channel IN ARRAY ARRAY['cli', 'admin-web', 'api', 'worker']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM core.tool_visibility
       WHERE tool_id = local_dev_pull_tool_id
         AND channel_code = required_channel
    ) THEN
      RAISE EXCEPTION '00111: local_dev_pull visibility missing for channel %', required_channel;
    END IF;
  END LOOP;

  IF (
    SELECT COUNT(*)
      FROM core.tool_parameters
     WHERE tool_id = local_dev_pull_tool_id
       AND enabled = TRUE
       AND parameter_name = 'repoName'
  ) <> 1 THEN
    RAISE EXCEPTION '00111: local_dev_pull parameter registration is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM core.tools
     WHERE tool_id = local_dev_pull_tool_id
       AND output_type = 'git_dev_pull_summary.v1'
       AND output_schema_path = 'packages/tools/contracts/git_dev_pull_summary.v1.schema.json'
  ) THEN
    RAISE EXCEPTION '00111: local_dev_pull structured output registration failed';
  END IF;
END;
$$;

COMMIT;
