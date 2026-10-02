-- Seed: 00160__phase19_3a1_codex_read_only_pilot.sql
-- Purpose: Phase 19.3A1 one real Codex read-only Agent Run pilot.
--
-- The existing A0 installation/account remain the managed enrollment binding;
-- this seed adds a separate execution profile and immutable Agent revision.
-- No provider credential is stored here. The managed account volume remains
-- the only credential store and the account may stay UNCONFIGURED until the
-- separately governed enrollment flow has completed.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH pilot_policy AS (
  SELECT jsonb_build_object(
    'provider', 'OPENAI_CODEX',
    'executionMode', 'READ_ONLY_MANAGED_PILOT',
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object(
      'surfaces', jsonb_build_array(
        jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Only the registered read-only Browser capability is exposed to the managed Codex turn.')
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
    ),
    'nativeRoutes', jsonb_build_object(
      'shell', 'DENY',
      'filesystemWrite', 'DENY',
      'git', 'DENY',
      'docker', 'DENY',
      'externalMessaging', 'DENY',
      'spawn', 'DENY',
      'providerNativeTools', 'DENY'
    ),
    'workspace', jsonb_build_object(
      'mode', 'READ_ONLY',
      'snapshotRequired', TRUE,
      'liveCheckoutMount', FALSE
    )
  ) AS policy
)
UPDATE core.agent_runtime_installations i
SET adapter_version = 'codex-app-server-readonly.v1',
    protocol_schema_digest = COALESCE(i.protocol_schema_digest, 'PINNED_CODEX_APP_SERVER_SCHEMA'),
    capability_manifest_revision = 'phase19.3a1.codex-readonly.v1',
    capability_manifest_digest = upper(encode(digest(convert_to(p.policy::text, 'UTF8'), 'sha256'), 'hex')),
    capability_manifest = p.policy || jsonb_build_object(
      'schemaVersion', 'agent-capability-manifest.v1',
      'runtimeKind', 'OPENAI_CODEX_APP_SERVER',
      'executionEnabled', TRUE,
      'providerTurnEnabled', TRUE,
      'browserCapabilityInvocationEnabled', TRUE,
      'appServerRpcAllowlist', jsonb_build_array('initialize', 'initialized', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt')
    ),
    runtime_profile = 'CODEX_READ_ONLY_PILOT',
    certification_state = 'CERTIFIED',
    enabled = TRUE,
    execution_enabled = TRUE,
    execution_enablement_source = 'GOVERNED_CODEX_PILOT',
    reviewed_source_revision = 'phase19.3a1',
    configuration_revision = 'phase19.3a1.codex-readonly.v1',
    configuration_digest = upper(encode(digest(convert_to((p.policy || jsonb_build_object('configurationRevision', 'phase19.3a1.codex-readonly.v1'))::text, 'UTF8'), 'sha256'), 'hex')),
    freshness_status = 'CURRENT',
    metadata = COALESCE(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'phase', '19.3A1',
      'providerCode', 'OPENAI_CODEX',
      'runtimeKind', 'OPENAI_CODEX_APP_SERVER',
      'executionEnabled', TRUE,
      'executionSource', 'GOVERNED_CODEX_PILOT',
      'protocolSchemaSource', 'pinned-generated-schema'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM pilot_policy p
WHERE i.installation_code = 'phase19-3a0-managed-codex';

WITH pilot_policy AS (
  SELECT jsonb_build_object(
    'provider', 'OPENAI_CODEX',
    'executionMode', 'READ_ONLY_MANAGED_PILOT',
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object(
      'surfaces', jsonb_build_array(
        jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW', 'reason', 'Only the registered read-only Browser capability is exposed to the managed Codex turn.')
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
    ),
    'nativeRoutes', jsonb_build_object(
      'shell', 'DENY',
      'filesystemWrite', 'DENY',
      'git', 'DENY',
      'docker', 'DENY',
      'externalMessaging', 'DENY',
      'spawn', 'DENY',
      'providerNativeTools', 'DENY'
    ),
    'workspace', jsonb_build_object('mode', 'READ_ONLY', 'snapshotRequired', TRUE, 'liveCheckoutMount', FALSE)
  ) AS policy
)
UPDATE core.agent_runtime_accounts a
SET policy_revision = 'phase19.3a1.codex-account.v1',
    account_policy = p.policy || jsonb_build_object('accountAlias', 'Managed Codex Pilot'),
    execution_enabled = (a.account_state = 'CONFIGURED'),
    execution_enablement_source = CASE WHEN a.account_state = 'CONFIGURED' THEN 'GOVERNED_CODEX_PILOT' ELSE 'NONE' END,
    metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object(
      'phase', '19.3A1',
      'providerCode', 'OPENAI_CODEX',
      'executionEnabled', (a.account_state = 'CONFIGURED'),
      'executionSource', CASE WHEN a.account_state = 'CONFIGURED' THEN 'GOVERNED_CODEX_PILOT' ELSE 'NONE' END,
      'managedCredentialStoreReference', 'docker-volume:skycommand_codex_managed_home'
    ),
    updated_at = CURRENT_TIMESTAMP
FROM pilot_policy p
WHERE a.account_code = 'phase19-3a0-managed-account';

WITH pilot_policy AS (
  SELECT jsonb_build_object(
    'provider', 'OPENAI_CODEX',
    'executionMode', 'READ_ONLY_MANAGED_PILOT',
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
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
    ),
    'nativeRoutes', jsonb_build_object('shell', 'DENY', 'filesystemWrite', 'DENY', 'git', 'DENY', 'docker', 'DENY', 'externalMessaging', 'DENY', 'spawn', 'DENY', 'providerNativeTools', 'DENY'),
    'workspace', jsonb_build_object('mode', 'READ_ONLY', 'snapshotRequired', TRUE, 'liveCheckoutMount', FALSE)
  ) AS policy
)
INSERT INTO core.agent_capability_profiles (
  profile_code, profile_name, policy_schema_version, policy_revision,
  policy_digest, policy, active, execution_enabled, execution_enablement_source
)
SELECT
  'CODEX_READ_ONLY_PILOT',
  'Phase 19.3A1 Managed Codex Read-Only Pilot',
  'agent-capability-policy.v1',
  'phase19.3a1.codex-readonly.v1',
  upper(encode(digest(convert_to(p.policy::text, 'UTF8'), 'sha256'), 'hex')),
  p.policy,
  TRUE,
  TRUE,
  'GOVERNED_CODEX_PILOT'
FROM pilot_policy p
ON CONFLICT (profile_code)
DO UPDATE SET
  profile_name = EXCLUDED.profile_name,
  policy_schema_version = EXCLUDED.policy_schema_version,
  policy_revision = EXCLUDED.policy_revision,
  policy_digest = EXCLUDED.policy_digest,
  policy = EXCLUDED.policy,
  active = TRUE,
  execution_enabled = TRUE,
  execution_enablement_source = 'GOVERNED_CODEX_PILOT',
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO core.agent_definitions (agent_code, agent_name, description, lifecycle_state, active)
VALUES (
  'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER',
  'Phase 19.3A1 Managed Codex Read-Only Observer',
  'Immutable provider-backed Codex Agent definition limited to one read-only managed Browser Automation capability in DEV_LOCAL.',
  'ACTIVE',
  TRUE
)
ON CONFLICT (agent_code)
DO UPDATE SET agent_name = EXCLUDED.agent_name, description = EXCLUDED.description, lifecycle_state = 'ACTIVE', active = TRUE, updated_at = CURRENT_TIMESTAMP;

WITH definition_row AS (
  SELECT definition_id FROM core.agent_definitions WHERE agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
), installation_row AS (
  SELECT installation_id FROM core.agent_runtime_installations WHERE installation_code = 'phase19-3a0-managed-codex'
), account_row AS (
  SELECT account_binding_id FROM core.agent_runtime_accounts WHERE account_code = 'phase19-3a0-managed-account'
), profile_row AS (
  SELECT capability_profile_id FROM core.agent_capability_profiles WHERE profile_code = 'CODEX_READ_ONLY_PILOT'
)
INSERT INTO core.agent_definition_versions (
  definition_id, revision, content_digest, instruction_reference, instruction_digest,
  installation_id, account_binding_id, capability_profile_id, policy_revision, configuration
)
SELECT
  d.definition_id,
  1,
  repeat('9', 64),
  'work-order:phase19.3a1/first-real-codex-read-only-run',
  repeat('8', 64),
  i.installation_id,
  a.account_binding_id,
  p.capability_profile_id,
  'phase19.3a1.codex-readonly.v1',
  jsonb_build_object(
    'provider', 'OPENAI_CODEX',
    'runtimeKind', 'OPENAI_CODEX_APP_SERVER',
    'managedCapabilityCase', 'codex-read-only-pilot',
    'model', 'gpt-6-sol',
    'reasoningEffort', 'low',
    'sessionModel', 'PERSISTENT',
    'managedCapabilityAllowlist', jsonb_build_object('kind', 'BROWSER_AUTOMATION', 'codes', jsonb_build_array('command-center-status-snapshot'), 'version', 'registered.v1'),
    'scope', jsonb_build_object('capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'), 'actions', jsonb_build_array('AGENT_RUN', 'RUN'), 'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'), 'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'nativeRoutes', jsonb_build_object('shell', 'DENY', 'filesystemWrite', 'DENY', 'git', 'DENY', 'docker', 'DENY', 'externalMessaging', 'DENY', 'spawn', 'DENY', 'providerNativeTools', 'DENY'),
    'workspace', jsonb_build_object('mode', 'READ_ONLY', 'snapshotRequired', TRUE, 'liveCheckoutMount', FALSE)
  )
FROM definition_row d CROSS JOIN installation_row i CROSS JOIN account_row a CROSS JOIN profile_row p
WHERE NOT EXISTS (
  SELECT 1 FROM core.agent_definition_versions v WHERE v.definition_id = d.definition_id AND v.revision = 1
);

WITH project_policy AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'),
      'actions', jsonb_build_array('AGENT_RUN', 'RUN'),
      'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'),
      'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'),
      'dataClasses', jsonb_build_array('INTERNAL')
    ),
    'constraints', jsonb_build_object('maxChildren', 0, 'maxConcurrentChildren', 0, 'maxDurationMs', 300000),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'obligations', jsonb_build_array('REAL_CODEX_READ_ONLY_PILOT', 'REGISTERED_WORKSPACE_SNAPSHOT_ONLY', 'MANAGED_BROWSER_AUTOMATION_ONLY', 'NO_NATIVE_TOOLS', 'NO_PROVIDER_CREDENTIALS')
  ) AS policy
), project_row AS (
  INSERT INTO core.projects (project_code, project_name, description, lifecycle_state, data_classification, policy_revision, authority_policy, active)
  SELECT 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE', 'Phase 19.3A1 Real Codex Read-Only Acceptance', 'Source-controlled DEV acceptance Project for the first real managed Codex Agent Run.', 'ACTIVE', 'INTERNAL', 'phase19.3a1.acceptance', policy, TRUE
  FROM project_policy
  ON CONFLICT (project_code)
  DO UPDATE SET project_name = EXCLUDED.project_name, description = EXCLUDED.description, lifecycle_state = 'ACTIVE', data_classification = 'INTERNAL', policy_revision = EXCLUDED.policy_revision, authority_policy = EXCLUDED.authority_policy, active = TRUE, updated_at = CURRENT_TIMESTAMP
  RETURNING project_id
)
INSERT INTO core.project_repositories (project_id, repo_id, active)
SELECT p.project_id, r.repo_id, TRUE
FROM project_row p
JOIN core.repositories r ON r.repo_code = 'SkyCommand' AND r.active = TRUE
ON CONFLICT (project_id, repo_id) DO UPDATE SET active = TRUE, updated_at = CURRENT_TIMESTAMP;

WITH project_row AS (
  SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
), policy_row AS (
  SELECT jsonb_build_object(
    'scope', jsonb_build_object('capabilities', jsonb_build_array('AGENT_RUN', 'BROWSER_AUTOMATION'), 'actions', jsonb_build_array('AGENT_RUN', 'RUN'), 'resources', jsonb_build_array('codex-read-only', 'command-center-status-snapshot'), 'environments', jsonb_build_array('DEV_LOCAL', 'LOCAL'), 'dataClasses', jsonb_build_array('INTERNAL')),
    'constraints', jsonb_build_object('maxChildren', 0, 'maxConcurrentChildren', 0, 'maxDurationMs', 300000),
    'executionSurfaces', jsonb_build_object('surfaces', jsonb_build_array(jsonb_build_object('surface', 'SKYCOMMAND_MCP_API', 'mode', 'ALLOW'))),
    'obligations', jsonb_build_array('REAL_CODEX_READ_ONLY_PILOT', 'REGISTERED_WORKSPACE_SNAPSHOT_ONLY', 'MANAGED_BROWSER_AUTOMATION_ONLY', 'NO_NATIVE_TOOLS')
  ) AS policy
)
INSERT INTO core.project_workspaces (project_id, repo_path_id, environment_code, workspace_mode, policy_revision, workspace_policy, active)
SELECT p.project_id, rp.repo_path_id, 'DEV_LOCAL', 'READ_ONLY', 'phase19.3a1.acceptance', policy, TRUE
FROM project_row p
JOIN core.repository_paths rp ON rp.repo_id = (SELECT repo_id FROM core.repositories WHERE repo_code = 'SkyCommand')
JOIN core.config_profiles cp ON cp.profile_id = rp.profile_id AND cp.profile_code = 'DEV_LOCAL' AND cp.active = TRUE
CROSS JOIN policy_row
WHERE rp.active = TRUE
ON CONFLICT (project_id, repo_path_id, workspace_mode)
DO UPDATE SET active = TRUE, environment_code = 'DEV_LOCAL', policy_revision = EXCLUDED.policy_revision, workspace_policy = EXCLUDED.workspace_policy, updated_at = CURRENT_TIMESTAMP;

WITH project_row AS (
  SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE'
), definition_row AS (
  SELECT d.definition_id, v.definition_version_id
  FROM core.agent_definitions d
  JOIN core.agent_definition_versions v ON v.definition_id = d.definition_id AND v.revision = 1
  WHERE d.agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER'
)
INSERT INTO core.project_agent_allow_rules (project_id, definition_id, definition_version_id, allow_state, policy_revision)
SELECT p.project_id, d.definition_id, d.definition_version_id, 'ACTIVE', 'phase19.3a1.acceptance'
FROM project_row p CROSS JOIN definition_row d
WHERE NOT EXISTS (
  SELECT 1 FROM core.project_agent_allow_rules existing
  WHERE existing.project_id = p.project_id
    AND existing.definition_id = d.definition_id
    AND existing.definition_version_id = d.definition_version_id
);

UPDATE core.project_agent_allow_rules rule
SET allow_state = 'ACTIVE', policy_revision = 'phase19.3a1.acceptance', updated_at = CURRENT_TIMESTAMP
WHERE rule.project_id = (SELECT project_id FROM core.projects WHERE project_code = 'PHASE19_3A1_CODEX_READ_ONLY_ACCEPTANCE')
  AND rule.definition_id = (SELECT definition_id FROM core.agent_definitions WHERE agent_code = 'PHASE19_3A1_CODEX_READ_ONLY_OBSERVER');
