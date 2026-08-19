-- Migration: 00099__local_repository_sync_tool.sql
-- Purpose:
--   Registers the guarded host-side Local Repository Sync tool. The tool is CLI-only
--   until a dedicated SkyCommand Host Agent/Temporal task queue is introduced.
--   Docker/API/worker visibility is intentionally withheld so Linux containers cannot
--   mutate refs in a Windows-owned .git working copy.

BEGIN;

-- Existing SkyCommand administrator sessions/roles are scoped to SKYSERVER_ADMIN.
-- Host-side repository synchronization is a privileged control-plane action, so its
-- permission must use the same application scope as the SUPER_ADMIN role receiving it.
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
  'GIT_LOCAL_SYNC_RUN',
  'git',
  'local_sync',
  'Safely fast-forward host-owned local repository refs to an exact approved synchronized Git head.',
  TRUE
FROM admin_app
ON CONFLICT (permission_code) DO UPDATE
SET app_id = EXCLUDED.app_id,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    active = EXCLUDED.active,
    updated_at = CURRENT_TIMESTAMP;

-- Keep this high-risk host mutation permission SUPER_ADMIN-only for the initial
-- foundation. Future host-agent policy can widen assignment deliberately. The app_id
-- equality is intentional: role/permission grants are application-scoped.
INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN auth.permissions p
  ON p.permission_code = 'GIT_LOCAL_SYNC_RUN'
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
  'local_repo_sync',
  'local_repo_sync',
  'Local Repository Sync',
  'Host-only guarded fast-forward synchronization of local main/dev refs to an exact approved remote head. Refuses dirty, changed, divergent, or moving repository state.',
  repo.repo_id,
  'packages/git/src/local_repo_sync.js',
  'node',
  'GIT_LOCAL_SYNC_RUN',
  'high',
  TRUE,
  'This host-side operation will fast-forward local Git branch refs only after all safety guardrails prove the exact expected source and target SHAs.',
  TRUE,
  TRUE,
  40,
  TRUE,
  'git_local_sync_summary.v1',
  'packages/tools/contracts/git_local_sync_summary.v1.schema.json',
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
    updated_at = CURRENT_TIMESTAMP;

-- Initial execution boundary: host CLI only. Admin-Web/API/worker execution will be
-- enabled only when the Host Agent can receive host-targeted Temporal activities.
DELETE FROM core.tool_visibility
WHERE tool_id = (SELECT tool_id FROM core.tools WHERE tool_code = 'local_repo_sync')
  AND channel_code <> 'cli';

INSERT INTO core.tool_visibility (tool_id, channel_code)
SELECT tool_id, 'cli'
FROM core.tools
WHERE tool_code = 'local_repo_sync'
ON CONFLICT (tool_id, channel_code) DO NOTHING;

WITH parameter_seed(parameter_name, label, param_type_code, prompt, required, option_source_code, display_order) AS (
  VALUES
    ('repoName', 'Repository', 'repo', 'Select repository', TRUE, 'repositories', 10),
    ('expectedLocalDevSha', 'Expected Local Dev SHA', 'string', 'Exact full SHA emitted by Dev Commit currentHeadSha', TRUE, NULL, 20),
    ('expectedSynchronizedHeadSha', 'Expected Synchronized Head SHA', 'string', 'Exact full SHA emitted by Remote Merge synchronizedHeadSha', TRUE, NULL, 30)
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
WHERE t.tool_code = 'local_repo_sync'
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


-- Fail closed if any registration seam was not created. These checks keep a manually
-- applied migration from appearing successful when an expected catalogue row is absent.
DO $$
DECLARE
  expected_app_id UUID;
  local_sync_tool_id UUID;
BEGIN
  SELECT app_id
    INTO expected_app_id
    FROM core.applications
   WHERE app_code = 'SKYSERVER_ADMIN'
   LIMIT 1;

  IF expected_app_id IS NULL THEN
    RAISE EXCEPTION '00099: SKYSERVER_ADMIN application is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM auth.permissions
     WHERE permission_code = 'GIT_LOCAL_SYNC_RUN'
       AND app_id = expected_app_id
       AND active = TRUE
  ) THEN
    RAISE EXCEPTION '00099: GIT_LOCAL_SYNC_RUN permission registration failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM auth.roles r
      JOIN auth.role_permissions rp ON rp.role_id = r.role_id AND rp.active = TRUE
      JOIN auth.permissions p ON p.permission_id = rp.permission_id
     WHERE r.role_code = 'SUPER_ADMIN'
       AND p.permission_code = 'GIT_LOCAL_SYNC_RUN'
       AND p.app_id = r.app_id
  ) THEN
    RAISE EXCEPTION '00099: SUPER_ADMIN grant for GIT_LOCAL_SYNC_RUN failed';
  END IF;

  SELECT tool_id
    INTO local_sync_tool_id
    FROM core.tools
   WHERE tool_code = 'local_repo_sync'
   LIMIT 1;

  IF local_sync_tool_id IS NULL THEN
    RAISE EXCEPTION '00099: local_repo_sync tool registration failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM core.tool_visibility
     WHERE tool_id = local_sync_tool_id
       AND channel_code = 'cli'
  ) THEN
    RAISE EXCEPTION '00099: local_repo_sync CLI visibility registration failed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM core.tool_visibility
     WHERE tool_id = local_sync_tool_id
       AND channel_code <> 'cli'
  ) THEN
    RAISE EXCEPTION '00099: local_repo_sync must remain CLI-only before Host Agent support';
  END IF;

  IF (
    SELECT COUNT(*)
      FROM core.tool_parameters
     WHERE tool_id = local_sync_tool_id
       AND enabled = TRUE
       AND parameter_name IN (
         'repoName',
         'expectedLocalDevSha',
         'expectedSynchronizedHeadSha'
       )
  ) <> 3 THEN
    RAISE EXCEPTION '00099: local_repo_sync parameter registration is incomplete';
  END IF;
END;
$$;

COMMIT;
