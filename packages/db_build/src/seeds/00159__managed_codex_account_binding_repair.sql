-- Seed: 00159__managed_codex_account_binding_repair.sql
-- Purpose: Idempotently restore the bootstrap-disabled Phase 19.3A0 account
-- binding without changing any existing enrollment-managed account state.

DO $managed_codex_account_binding_repair$
DECLARE
  installation_ids UUID[];
  installation_count INTEGER;
  target_installation_id UUID;
  account_binding_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER, array_agg(installation_id)
  INTO installation_count, installation_ids
  FROM core.agent_runtime_installations
  WHERE installation_code = 'phase19-3a0-managed-codex';

  IF installation_count <> 1 THEN
    RAISE EXCEPTION
      '00159: expected exactly one phase19-3a0-managed-codex installation, found %',
      installation_count;
  END IF;

  target_installation_id := installation_ids[1];

  SELECT COUNT(*)::INTEGER
  INTO account_binding_count
  FROM core.agent_runtime_accounts
  WHERE installation_id = target_installation_id
    AND account_code = 'phase19-3a0-managed-account';

  IF account_binding_count = 0 THEN
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
    VALUES (
      target_installation_id,
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
    )
    ON CONFLICT (installation_id, account_code) DO NOTHING;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO account_binding_count
  FROM core.agent_runtime_accounts
  WHERE installation_id = target_installation_id
    AND account_code = 'phase19-3a0-managed-account';

  IF account_binding_count <> 1 THEN
    RAISE EXCEPTION
      '00159: expected exactly one phase19-3a0-managed-account binding for the target installation, found %',
      account_binding_count;
  END IF;
END
$managed_codex_account_binding_repair$;
