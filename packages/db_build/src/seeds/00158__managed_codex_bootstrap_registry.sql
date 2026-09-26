-- Seed: 00158__managed_codex_bootstrap_registry.sql
-- Purpose: Register one non-executable Codex app-server bootstrap runtime,
-- isolated installation, pilot account binding, and disabled profile.

INSERT INTO core.agent_runtimes (runtime_code, runtime_name, description, active)
VALUES (
  'OPENAI_CODEX_APP_SERVER',
  'Managed OpenAI Codex App Server',
  'Dedicated isolated Codex app-server cell for Phase 19.3A0 enrollment and bootstrap certification only.',
  TRUE
)
ON CONFLICT (runtime_code) DO NOTHING;

WITH runtime_row AS (
  SELECT agent_runtime_id
  FROM core.agent_runtimes
  WHERE runtime_code = 'OPENAI_CODEX_APP_SERVER' AND active = TRUE
), manifest AS (
  SELECT jsonb_build_object(
    'schemaVersion', 'agent-capability-manifest.v1',
    'scope', jsonb_build_object(
      'capabilities', '[]'::jsonb,
      'actions', '[]'::jsonb,
      'resources', '[]'::jsonb,
      'environments', '[]'::jsonb,
      'dataClasses', '[]'::jsonb
    ),
    'executionSurfaces', jsonb_build_object('surfaces', '[]'::jsonb),
    'bootstrapOnly', TRUE,
    'agentExecutionEnabled', FALSE,
    'providerTurnEnabled', FALSE,
    'browserCapabilityInvocationEnabled', FALSE
  ) AS value
), installation AS (
  INSERT INTO core.agent_runtime_installations (
    agent_runtime_id,
    installation_code,
    adapter_version,
    capability_manifest_revision,
    capability_manifest_digest,
    capability_manifest,
    host_code,
    runtime_profile,
    containment_class,
    certification_state,
    enabled,
    execution_enabled,
    reviewed_source_revision,
    configuration_revision,
    configuration_digest,
    freshness_status,
    metadata
  )
  SELECT
    r.agent_runtime_id,
    'phase19-3a0-managed-codex',
    'codex-app-server-bootstrap.v1',
    'phase19.3a0.bootstrap.v1',
    upper(encode(digest(convert_to(m.value::text, 'UTF8'), 'sha256'), 'hex')),
    m.value,
    'DEV_LOCAL',
    'CODEX_MANAGED_BOOTSTRAP',
    'DEDICATED_CODEX_ISOLATED_CELL',
    'UNVERIFIED',
    FALSE,
    FALSE,
    NULL,
    'phase19.3a0.bootstrap.v1',
    'FC16A154D03EA0236167ADC6FDDCA8249E9DE48BA3F8171C201C3213ACD39BB8',
    'UNKNOWN',
    jsonb_build_object(
      'phase', '19.3A0',
      'providerCode', 'OPENAI_CODEX',
      'platform', 'linux-x64',
      'package', '@openai/codex-linux-x64',
      'version', '0.155.0-alpha.9.2',
      'packageIntegrity', 'sha512-tnUaq2ejXz8afrEODlmlph3yoZlSXgOFj8mFww2+kyG6rep1sKaelqkyHB2L3V/vYVHzF3gfiurZWwh7+ClebA==',
      'networkPolicyDigest', '15A52E18475439F10AADA0308F2663863257B425D9C91E0B79E65194C231A974',
      'managedHomeReference', 'docker-volume:skycommand_codex_managed_home',
      'readiness', 'INSTALLATION_UNCERTIFIED',
      'executionEnabled', FALSE
    )
  FROM runtime_row r CROSS JOIN manifest m
  ON CONFLICT (installation_code) DO NOTHING
  RETURNING installation_id
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
  metadata
)
SELECT
  COALESCE(
    (SELECT installation_id FROM installation),
    (SELECT installation_id FROM core.agent_runtime_installations WHERE installation_code = 'phase19-3a0-managed-codex')
  ),
  'phase19-3a0-managed-account',
  'Managed Codex Pilot',
  'openai-managed-codex',
  'OWNER_ONLY',
  'UNCONFIGURED',
  'phase19.3a0.managed-account.v1',
  jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', '[]'::jsonb,
      'actions', '[]'::jsonb,
      'resources', '[]'::jsonb,
      'environments', '[]'::jsonb,
      'dataClasses', '[]'::jsonb
    ),
    'executionSurfaces', jsonb_build_object('surfaces', '[]'::jsonb),
    'bootstrapOnly', TRUE,
    'executionEnabled', FALSE
  ),
  FALSE,
  jsonb_build_object(
    'phase', '19.3A0',
    'providerCode', 'OPENAI_CODEX',
    'authMode', 'chatgptDeviceCode',
    'managedCredentialStoreReference', 'docker-volume:skycommand_codex_managed_home',
    'executionEnabled', FALSE
  )
FROM core.agent_runtime_installations i
WHERE i.installation_code = 'phase19-3a0-managed-codex'
ON CONFLICT (installation_id, account_code) DO NOTHING;

INSERT INTO core.agent_capability_profiles (
  profile_code,
  profile_name,
  policy_schema_version,
  policy_revision,
  policy,
  active,
  execution_enabled
)
VALUES (
  'CODEX_BOOTSTRAP_DISABLED',
  'Managed Codex Bootstrap · Execution Disabled',
  'agent-capability-policy.v1',
  'phase19.3a0.bootstrap.v1',
  jsonb_build_object(
    'scope', jsonb_build_object(
      'capabilities', '[]'::jsonb,
      'actions', '[]'::jsonb,
      'resources', '[]'::jsonb,
      'environments', '[]'::jsonb,
      'dataClasses', '[]'::jsonb
    ),
    'executionSurfaces', jsonb_build_object('surfaces', '[]'::jsonb),
    'constraints', jsonb_build_object('maxChildren', 0, 'maxConcurrentChildren', 0),
    'obligations', jsonb_build_array('CODEX_BOOTSTRAP_ONLY', 'REAL_AGENT_EXECUTION_DISABLED')
  ),
  TRUE,
  FALSE
)
ON CONFLICT (profile_code) DO NOTHING;
