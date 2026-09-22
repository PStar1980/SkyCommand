-- Seed: 00152__agent_run_permissions_and_fake_runtime.sql
-- Purpose: Phase 19.2A narrow Agent Run permissions and source-controlled fake
-- runtime fixtures. Real-provider metadata remains non-executable.

WITH permission_seed(permission_code, resource, action, description) AS (
  VALUES
    ('AGENT_RUN', 'agent_run', 'start', 'Admit source-controlled internal fake Agent Runs.'),
    ('AGENT_RUN_CANCEL_OWN', 'agent_run', 'cancel_own', 'Cancel an owned Agent Run.'),
    ('AGENT_RUN_CANCEL_PROJECT', 'agent_run', 'cancel_project', 'Cancel an Agent Run in an authorized Project.'),
    ('AGENT_ROOT_STOP', 'agent_root', 'stop', 'Stop an authorized root execution and revoke its future grants.')
)
INSERT INTO auth.permissions (app_id, permission_code, resource, action, description, active)
SELECT a.app_id, s.permission_code, s.resource, s.action, s.description, TRUE
FROM core.applications a
CROSS JOIN permission_seed s
WHERE a.app_code = 'SKYSERVER_ADMIN'
  AND a.active = TRUE
ON CONFLICT (permission_code)
DO UPDATE SET
  app_id = EXCLUDED.app_id,
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO auth.role_permissions (role_id, permission_id, active)
SELECT r.role_id, p.permission_id, TRUE
FROM auth.roles r
JOIN auth.permissions p ON p.permission_code IN (
  'AGENT_RUN',
  'AGENT_RUN_CANCEL_OWN',
  'AGENT_RUN_CANCEL_PROJECT',
  'AGENT_ROOT_STOP'
)
WHERE r.role_code = 'SUPER_ADMIN'
ON CONFLICT (role_id, permission_id)
DO UPDATE SET active = TRUE, granted_at = CURRENT_TIMESTAMP;

INSERT INTO core.agent_runtimes (runtime_code, runtime_name, description, active)
VALUES
  ('FAKE_PERSISTENT', 'Phase 19.2A Fake Persistent Runtime', 'Source-controlled provider-neutral persistent fake runtime fixture.', TRUE),
  ('FAKE_EPHEMERAL', 'Phase 19.2A Fake Ephemeral Runtime', 'Source-controlled provider-neutral ephemeral fake runtime fixture.', TRUE)
ON CONFLICT (runtime_code)
DO UPDATE SET runtime_name = EXCLUDED.runtime_name, description = EXCLUDED.description, active = TRUE, updated_at = CURRENT_TIMESTAMP;

WITH runtime_rows AS (
  SELECT agent_runtime_id, runtime_code
  FROM core.agent_runtimes
  WHERE runtime_code IN ('FAKE_PERSISTENT', 'FAKE_EPHEMERAL')
), installation_seed AS (
  SELECT * FROM (VALUES
    ('phase19-2a-fake-persistent', 'FAKE_PERSISTENT', 'FAKE_PERSISTENT_DEFAULT'),
    ('phase19-2a-fake-ephemeral', 'FAKE_EPHEMERAL', 'FAKE_EPHEMERAL_DEFAULT')
  ) AS v(installation_code, runtime_code, profile_code)
)
INSERT INTO core.agent_runtime_installations (
  agent_runtime_id,
  installation_code,
  adapter_version,
  protocol_schema_digest,
  capability_manifest_revision,
  capability_manifest_digest,
  capability_manifest,
  host_code,
  runtime_profile,
  containment_class,
  certification_state,
  enabled,
  execution_enabled,
  execution_enablement_source,
  reviewed_source_revision,
  configuration_revision,
  configuration_digest,
  process_generation,
  service_generation,
  observed_at,
  freshness_status,
  metadata
)
SELECT
  r.agent_runtime_id,
  s.installation_code,
  'agent-runtime-adapter.v1',
  'agent-runtime-adapter.v1',
  'phase19.2a',
  repeat('A', 64),
  jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN'),
      'actions', jsonb_build_array('AGENT_RUN'),
      'resources', jsonb_build_array('fake-runtime'),
      'environments', jsonb_build_array('DEV_LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Internal fake runtime execution only.'))),
    'sourceControlledFixture', TRUE,
    'fixtureCaseId', CASE WHEN s.runtime_code = 'FAKE_PERSISTENT' THEN 'persistent-delayed-usage' ELSE 'ephemeral-absent-usage' END
  ),
  'DEV_LOCAL',
  s.runtime_code,
  'DEDICATED_AGENT_RUNTIME_WORKER',
  'CERTIFIED',
  TRUE,
  TRUE,
  'INTERNAL_FAKE_FIXTURE',
  'fixture:phase19.2a',
  'phase19.2a',
  repeat('B', 64),
  'fixture-seed',
  'phase19.2a',
  CURRENT_TIMESTAMP,
  'CURRENT',
  jsonb_build_object('sourceControlledFixture', TRUE, 'phase', '19.2A')
FROM installation_seed s
JOIN runtime_rows r ON r.runtime_code = s.runtime_code
ON CONFLICT (installation_code)
DO UPDATE SET
  agent_runtime_id = EXCLUDED.agent_runtime_id,
  adapter_version = EXCLUDED.adapter_version,
  protocol_schema_digest = EXCLUDED.protocol_schema_digest,
  capability_manifest_revision = EXCLUDED.capability_manifest_revision,
  capability_manifest_digest = EXCLUDED.capability_manifest_digest,
  capability_manifest = EXCLUDED.capability_manifest,
  runtime_profile = EXCLUDED.runtime_profile,
  containment_class = EXCLUDED.containment_class,
  certification_state = EXCLUDED.certification_state,
  enabled = EXCLUDED.enabled,
  execution_enabled = EXCLUDED.execution_enabled,
  execution_enablement_source = EXCLUDED.execution_enablement_source,
  reviewed_source_revision = EXCLUDED.reviewed_source_revision,
  configuration_revision = EXCLUDED.configuration_revision,
  configuration_digest = EXCLUDED.configuration_digest,
  service_generation = EXCLUDED.service_generation,
  observed_at = EXCLUDED.observed_at,
  freshness_status = EXCLUDED.freshness_status,
  metadata = EXCLUDED.metadata,
  updated_at = CURRENT_TIMESTAMP;

WITH installation_rows AS (
  SELECT i.installation_id, i.installation_code
  FROM core.agent_runtime_installations i
  WHERE i.installation_code IN ('phase19-2a-fake-persistent', 'phase19-2a-fake-ephemeral')
), account_seed AS (
  SELECT * FROM (VALUES
    ('phase19-2a-fake-persistent-account', 'phase19-2a-fake-persistent'),
    ('phase19-2a-fake-ephemeral-account', 'phase19-2a-fake-ephemeral')
  ) AS v(account_code, installation_code)
)
INSERT INTO core.agent_runtime_accounts (
  installation_id,
  account_code,
  account_alias,
  trust_domain,
  usage_visibility,
  account_state,
  policy_revision,
  account_policy,
  execution_enabled,
  execution_enablement_source,
  metadata
)
SELECT
  i.installation_id,
  s.account_code,
  s.account_code,
  'phase19.2a.fake',
  'PROJECT_MEMBERS',
  'CONFIGURED',
  'phase19.2a.fake-account.v1',
  jsonb_build_object('scope', jsonb_build_object('capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN'), 'actions', jsonb_build_array('AGENT_RUN'), 'resources', jsonb_build_array('fake-runtime'), 'environments', jsonb_build_array('DEV_LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')), 'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW')))),
  TRUE,
  'INTERNAL_FAKE_FIXTURE',
  jsonb_build_object('sourceControlledFixture', TRUE, 'phase', '19.2A')
FROM account_seed s
JOIN installation_rows i ON i.installation_code = s.installation_code
ON CONFLICT (installation_id, account_code)
DO UPDATE SET
  account_state = EXCLUDED.account_state,
  account_policy = EXCLUDED.account_policy,
  execution_enabled = EXCLUDED.execution_enabled,
  execution_enablement_source = EXCLUDED.execution_enablement_source,
  metadata = EXCLUDED.metadata,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.agent_capability_profiles (
  profile_code,
  profile_name,
  policy_schema_version,
  policy_revision,
  policy_digest,
  policy,
  active,
  execution_enabled,
  execution_enablement_source
)
VALUES
  ('FAKE_PERSISTENT_DEFAULT', 'Phase 19.2A Fake Persistent Default', 'agent-capability-policy.v1', 'phase19.2a', repeat('C', 64), jsonb_build_object('scope', jsonb_build_object('capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN'), 'actions', jsonb_build_array('AGENT_RUN'), 'resources', jsonb_build_array('fake-runtime'), 'environments', jsonb_build_array('DEV_LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')), 'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW')))), TRUE, TRUE, 'INTERNAL_FAKE_FIXTURE'),
  ('FAKE_EPHEMERAL_DEFAULT', 'Phase 19.2A Fake Ephemeral Default', 'agent-capability-policy.v1', 'phase19.2a', repeat('D', 64), jsonb_build_object('scope', jsonb_build_object('capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN'), 'actions', jsonb_build_array('AGENT_RUN'), 'resources', jsonb_build_array('fake-runtime'), 'environments', jsonb_build_array('DEV_LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')), 'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW')))), TRUE, TRUE, 'INTERNAL_FAKE_FIXTURE')
ON CONFLICT (profile_code)
DO UPDATE SET
  profile_name = EXCLUDED.profile_name,
  policy_revision = EXCLUDED.policy_revision,
  policy_digest = EXCLUDED.policy_digest,
  policy = EXCLUDED.policy,
  active = EXCLUDED.active,
  execution_enabled = EXCLUDED.execution_enabled,
  execution_enablement_source = EXCLUDED.execution_enablement_source,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.agent_definitions (agent_code, agent_name, description, lifecycle_state, active)
VALUES
  ('PHASE19_2A_FAKE_PERSISTENT', 'Phase 19.2A Fake Persistent Agent', 'Internal test-only Agent definition backed by the persistent fake runtime.', 'ACTIVE', TRUE),
  ('PHASE19_2A_FAKE_EPHEMERAL', 'Phase 19.2A Fake Ephemeral Agent', 'Internal test-only Agent definition backed by the ephemeral fake runtime.', 'ACTIVE', TRUE)
ON CONFLICT (agent_code)
DO UPDATE SET agent_name = EXCLUDED.agent_name, description = EXCLUDED.description, lifecycle_state = EXCLUDED.lifecycle_state, active = TRUE, updated_at = CURRENT_TIMESTAMP;

WITH definition_rows AS (
  SELECT definition_id, agent_code
  FROM core.agent_definitions
  WHERE agent_code IN ('PHASE19_2A_FAKE_PERSISTENT', 'PHASE19_2A_FAKE_EPHEMERAL')
), binding_rows AS (
  SELECT a.account_binding_id, a.account_code, a.installation_id, i.installation_code
  FROM core.agent_runtime_accounts a
  JOIN core.agent_runtime_installations i ON i.installation_id = a.installation_id
  WHERE i.installation_code IN ('phase19-2a-fake-persistent', 'phase19-2a-fake-ephemeral')
), profile_rows AS (
  SELECT capability_profile_id, profile_code
  FROM core.agent_capability_profiles
  WHERE profile_code IN ('FAKE_PERSISTENT_DEFAULT', 'FAKE_EPHEMERAL_DEFAULT')
), version_seed AS (
  SELECT * FROM (VALUES
    ('PHASE19_2A_FAKE_PERSISTENT', 'phase19-2a-fake-persistent-account', 'FAKE_PERSISTENT_DEFAULT', 'persistent-delayed-usage'),
    ('PHASE19_2A_FAKE_EPHEMERAL', 'phase19-2a-fake-ephemeral-account', 'FAKE_EPHEMERAL_DEFAULT', 'ephemeral-absent-usage')
  ) AS v(agent_code, account_code, profile_code, case_id)
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
  1,
  repeat(CASE WHEN s.case_id = 'persistent-delayed-usage' THEN 'E' ELSE 'F' END, 64),
  'fixture:phase19.2a/' || s.case_id,
  repeat(CASE WHEN s.case_id = 'persistent-delayed-usage' THEN '1' ELSE '2' END, 64),
  b.installation_id,
  b.account_binding_id,
  p.capability_profile_id,
  'phase19.2a',
  jsonb_build_object(
    'runtimeCaseId', s.case_id,
    'sourceControlledFixture', TRUE,
    'scope', jsonb_build_object('capabilities', jsonb_build_array('FAKE_RUNTIME_EXECUTION', 'AGENT_RUN'), 'actions', jsonb_build_array('AGENT_RUN'), 'resources', jsonb_build_array('fake-runtime'), 'environments', jsonb_build_array('DEV_LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW')))
  )
FROM version_seed s
JOIN definition_rows d ON d.agent_code = s.agent_code
JOIN binding_rows b ON b.account_code = s.account_code
JOIN profile_rows p ON p.profile_code = s.profile_code
WHERE NOT EXISTS (
  SELECT 1 FROM core.agent_definition_versions v
  WHERE v.definition_id = d.definition_id AND v.revision = 1
);
