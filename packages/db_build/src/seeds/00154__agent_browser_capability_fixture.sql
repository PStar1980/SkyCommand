-- Seed: 00154__agent_browser_capability_fixture.sql
-- Purpose: Phase 19.2B narrow fake-runtime Browser Automation capability ceiling
-- and a separate source-controlled acceptance Project. No broad capability
-- permission or real-provider credential is created.

WITH capability_scope AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object(
      'surfaces', jsonb_build_array(
        jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Bounded managed Browser Automation capability only.')
      )
    ),
    'managedCapabilities', jsonb_build_object(
      'BROWSER_AUTOMATION', jsonb_build_object(
        'codes', jsonb_build_array('command-center-status-snapshot'),
        'version', 'registered.v1',
        'sideEffectLevel', 'READ_ONLY',
        'idempotencyMode', 'READ_ONLY',
        'requiresConfirmation', FALSE,
        'environment', 'LOCAL',
        'parameterMode', 'EMPTY_OBJECT'
      )
    )
  ) AS policy
)
UPDATE core.agent_capability_profiles p
SET policy = s.policy,
    policy_revision = 'phase19.2b',
    policy_digest = repeat('E', 64),
    updated_at = CURRENT_TIMESTAMP
FROM capability_scope s
WHERE p.profile_code IN ('FAKE_PERSISTENT_DEFAULT', 'FAKE_EPHEMERAL_DEFAULT')
  AND p.active = TRUE
  AND p.execution_enabled = TRUE
  AND p.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE';

WITH capability_scope AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object(
      'surfaces', jsonb_build_array(
        jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Bounded managed Browser Automation capability only.')
      )
    ),
    'managedCapabilities', jsonb_build_object(
      'BROWSER_AUTOMATION', jsonb_build_object(
        'codes', jsonb_build_array('command-center-status-snapshot'),
        'version', 'registered.v1',
        'sideEffectLevel', 'READ_ONLY',
        'idempotencyMode', 'READ_ONLY',
        'requiresConfirmation', FALSE,
        'environment', 'LOCAL',
        'parameterMode', 'EMPTY_OBJECT'
      )
    )
  ) AS policy
)
UPDATE core.agent_runtime_installations i
SET capability_manifest = s.policy || jsonb_build_object(
      'sourceControlledFixture', TRUE,
      'fixtureCaseId', CASE WHEN i.runtime_profile = 'FAKE_PERSISTENT' THEN 'persistent-delayed-usage' ELSE 'ephemeral-absent-usage' END
    ),
    capability_manifest_revision = 'phase19.2b',
    capability_manifest_digest = repeat('F', 64),
    configuration_revision = 'phase19.2b',
    configuration_digest = repeat('A', 64),
    updated_at = CURRENT_TIMESTAMP
FROM capability_scope s
WHERE i.installation_code IN ('phase19-2a-fake-persistent', 'phase19-2a-fake-ephemeral')
  AND i.enabled = TRUE
  AND i.execution_enabled = TRUE
  AND i.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE';

WITH capability_scope AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object(
      'surfaces', jsonb_build_array(
        jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Bounded managed Browser Automation capability only.')
      )
    ),
    'managedCapabilities', jsonb_build_object(
      'BROWSER_AUTOMATION', jsonb_build_object(
        'codes', jsonb_build_array('command-center-status-snapshot'),
        'version', 'registered.v1',
        'sideEffectLevel', 'READ_ONLY',
        'idempotencyMode', 'READ_ONLY',
        'requiresConfirmation', FALSE,
        'environment', 'LOCAL',
        'parameterMode', 'EMPTY_OBJECT'
      )
    )
  ) AS policy
)
UPDATE core.agent_runtime_accounts a
SET account_policy = s.policy,
    policy_revision = 'phase19.2b.fake-account.v1',
    updated_at = CURRENT_TIMESTAMP
FROM capability_scope s
WHERE a.account_code IN ('phase19-2a-fake-persistent-account', 'phase19-2a-fake-ephemeral-account')
  AND a.account_state = 'CONFIGURED'
  AND a.execution_enabled = TRUE
  AND a.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE';

WITH definition_rows AS (
  SELECT definition_id, agent_code
  FROM core.agent_definitions
  WHERE agent_code IN ('PHASE19_2A_FAKE_PERSISTENT', 'PHASE19_2A_FAKE_EPHEMERAL')
), binding_rows AS (
  SELECT a.account_binding_id, a.account_code, a.installation_id
  FROM core.agent_runtime_accounts a
  WHERE a.account_code IN ('phase19-2a-fake-persistent-account', 'phase19-2a-fake-ephemeral-account')
), profile_rows AS (
  SELECT capability_profile_id, profile_code
  FROM core.agent_capability_profiles
  WHERE profile_code IN ('FAKE_PERSISTENT_DEFAULT', 'FAKE_EPHEMERAL_DEFAULT')
), version_seed AS (
  SELECT * FROM (VALUES
    ('PHASE19_2A_FAKE_PERSISTENT', 'phase19-2a-fake-persistent-account', 'FAKE_PERSISTENT_DEFAULT', 'browser-capability-success', '1'),
    ('PHASE19_2A_FAKE_EPHEMERAL', 'phase19-2a-fake-ephemeral-account', 'FAKE_EPHEMERAL_DEFAULT', 'browser-capability-success', '2')
  ) AS v(agent_code, account_code, profile_code, case_id, digest_suffix)
)
INSERT INTO core.agent_definition_versions (
  definition_id,
  revision,
  content_digest,
  instruction_reference,
  instruction_digest,
  installation_id,
  account_binding_id,
  capability_profile_id,
  policy_revision,
  configuration
)
SELECT
  d.definition_id,
  2,
  repeat(CASE WHEN s.digest_suffix = '1' THEN '1' ELSE '2' END, 64),
  'fixture:phase19.2b/' || s.case_id,
  repeat(CASE WHEN s.digest_suffix = '1' THEN '3' ELSE '4' END, 64),
  b.installation_id,
  b.account_binding_id,
  p.capability_profile_id,
  'phase19.2b',
  jsonb_build_object(
    'runtimeCaseId', s.case_id,
    'sourceControlledFixture', TRUE,
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'managedCapabilityAllowlist', jsonb_build_object('kind', 'BROWSER_AUTOMATION', 'codes', jsonb_build_array('command-center-status-snapshot'), 'version', 'registered.v1')
  )
FROM version_seed s
JOIN definition_rows d ON d.agent_code = s.agent_code
JOIN binding_rows b ON b.account_code = s.account_code
JOIN profile_rows p ON p.profile_code = s.profile_code
WHERE NOT EXISTS (
  SELECT 1 FROM core.agent_definition_versions v
  WHERE v.definition_id = d.definition_id AND v.revision = 2
);

WITH project_policy AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'constraints', jsonb_build_object('maxChildren', 0, 'maxConcurrentChildren', 0, 'maxDurationMs', 300000),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'obligations', jsonb_build_array('INTERNAL_FAKE_RUNTIME_ONLY', 'MANAGED_BROWSER_AUTOMATION_ONLY')
  ) AS policy
), project_row AS (
  INSERT INTO core.projects (project_code, project_name, description, lifecycle_state, data_classification, policy_revision, authority_policy, active)
  SELECT 'PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE', 'Phase 19.2B Browser Capability Acceptance', 'Source-controlled DEV acceptance Project for one managed fake-runtime Browser Automation capability.', 'ACTIVE', 'INTERNAL', 'phase19.2b.acceptance', policy, TRUE
  FROM project_policy
  ON CONFLICT (project_code)
  DO UPDATE SET project_name = EXCLUDED.project_name, description = EXCLUDED.description, lifecycle_state = 'ACTIVE', data_classification = 'INTERNAL', policy_revision = EXCLUDED.policy_revision, authority_policy = EXCLUDED.authority_policy, active = TRUE, updated_at = CURRENT_TIMESTAMP
  RETURNING project_id
)
INSERT INTO core.project_repositories (project_id, repo_id, active)
SELECT p.project_id, r.repo_id, TRUE
FROM project_row p
JOIN core.repositories r ON r.repo_code = 'SkyCommand' AND r.active = TRUE
ON CONFLICT (project_id, repo_id)
DO UPDATE SET active = TRUE, updated_at = CURRENT_TIMESTAMP;

WITH project_row AS (
  SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE'
), policy_row AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('fake-runtime', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'constraints', jsonb_build_object('maxChildren', 0, 'maxConcurrentChildren', 0, 'maxDurationMs', 300000),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'obligations', jsonb_build_array('INTERNAL_FAKE_RUNTIME_ONLY', 'MANAGED_BROWSER_AUTOMATION_ONLY')
  ) AS policy
)
INSERT INTO core.project_workspaces (project_id, repo_path_id, environment_code, workspace_mode, policy_revision, workspace_policy, active)
SELECT p.project_id, rp.repo_path_id, 'DEV_LOCAL', 'READ_ONLY', 'phase19.2b.acceptance', policy, TRUE
FROM project_row p
JOIN core.repository_paths rp ON rp.repo_id = (SELECT repo_id FROM core.repositories WHERE repo_code = 'SkyCommand')
JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id AND cp.profile_code = 'DEV_LOCAL' AND cp.active = TRUE
CROSS JOIN policy_row
WHERE rp.active = TRUE
ON CONFLICT (project_id, repo_path_id, workspace_mode)
DO UPDATE SET active = TRUE, environment_code = 'DEV_LOCAL', policy_revision = EXCLUDED.policy_revision, workspace_policy = EXCLUDED.workspace_policy, updated_at = CURRENT_TIMESTAMP;

WITH project_row AS (
  SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE'
), workspace_row AS (
  SELECT project_workspace_id, project_id
  FROM core.project_workspaces
  WHERE project_id = (SELECT project_id FROM project_row)
    AND workspace_mode = 'READ_ONLY'
    AND active = TRUE
), definitions AS (
  SELECT d.definition_id, v.definition_version_id
  FROM core.agent_definitions d
  JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id AND v.revision = 2
  WHERE d.agent_code IN ('PHASE19_2A_FAKE_PERSISTENT', 'PHASE19_2A_FAKE_EPHEMERAL')
)
INSERT INTO core.project_agent_allow_rules (project_id, definition_id, definition_version_id, allow_state, policy_revision)
SELECT p.project_id, d.definition_id, d.definition_version_id, 'ACTIVE', 'phase19.2b.acceptance'
FROM project_row p
CROSS JOIN definitions d
WHERE NOT EXISTS (
  SELECT 1
  FROM core.project_agent_allow_rules existing
  WHERE existing.project_id = p.project_id
    AND existing.definition_id = d.definition_id
    AND existing.definition_version_id = d.definition_version_id
);

UPDATE core.project_agent_allow_rules rule
SET allow_state = 'ACTIVE', policy_revision = 'phase19.2b.acceptance', updated_at = CURRENT_TIMESTAMP
WHERE rule.project_id = (SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_2B_BROWSER_CAPABILITY_ACCEPTANCE')
  AND rule.definition_version_id IN (
    SELECT v.definition_version_id
    FROM core.agent_definition_versions v
    WHERE v.revision = 2
  );
