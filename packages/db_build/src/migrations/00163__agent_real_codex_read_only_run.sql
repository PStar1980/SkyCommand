-- Migration: 00163__agent_real_codex_read_only_run.sql
-- Purpose: Phase 19.3A1 bounded real Codex read-only Agent Run admission.
--
-- This migration opens one separately named execution source/profile for the
-- pinned Codex app-server adapter. It does not enable arbitrary provider
-- execution, writable workspaces, provider-native tools, or provider secrets.

ALTER TABLE worker.agent_runs
  ALTER COLUMN fake_runtime_case_id DROP NOT NULL;

ALTER TABLE core.agent_runtime_installations
  DROP CONSTRAINT IF EXISTS agent_installations_execution_source_shape;
ALTER TABLE core.agent_runtime_accounts
  DROP CONSTRAINT IF EXISTS agent_accounts_execution_source_shape;
ALTER TABLE core.agent_capability_profiles
  DROP CONSTRAINT IF EXISTS agent_capability_profiles_execution_source_shape;

ALTER TABLE core.agent_runtime_installations
  ADD CONSTRAINT agent_installations_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source IN ('INTERNAL_FAKE_FIXTURE', 'GOVERNED_CODEX_PILOT'))
  );
ALTER TABLE core.agent_runtime_accounts
  ADD CONSTRAINT agent_accounts_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source IN ('INTERNAL_FAKE_FIXTURE', 'GOVERNED_CODEX_PILOT'))
  );
ALTER TABLE core.agent_capability_profiles
  ADD CONSTRAINT agent_capability_profiles_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source IN ('INTERNAL_FAKE_FIXTURE', 'GOVERNED_CODEX_PILOT'))
  );

DO $agent_bounded_runtime_enablement_wrapper$
BEGIN
CREATE OR REPLACE FUNCTION core.assert_internal_fake_runtime_enablement()
RETURNS trigger
LANGUAGE plpgsql
AS $agent_bounded_runtime_enablement$
DECLARE
  runtime_code_value TEXT;
BEGIN
  IF TG_TABLE_NAME = 'agent_runtime_installations' THEN
    IF NEW.execution_enabled = TRUE THEN
      SELECT runtime_code INTO runtime_code_value
      FROM core.agent_runtimes
      WHERE agent_runtime_id = NEW.agent_runtime_id;

      IF NEW.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE' THEN
        IF runtime_code_value NOT IN ('FAKE_PERSISTENT', 'FAKE_EPHEMERAL')
           OR COALESCE(NEW.reviewed_source_revision, '') = '' THEN
          RAISE EXCEPTION 'Only source-controlled internal fake runtime installations may use INTERNAL_FAKE_FIXTURE enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.execution_enablement_source = 'GOVERNED_CODEX_PILOT' THEN
        IF runtime_code_value <> 'OPENAI_CODEX_APP_SERVER'
           OR NEW.runtime_profile <> 'CODEX_READ_ONLY_PILOT'
           OR NEW.certification_state <> 'CERTIFIED'
           OR COALESCE(NEW.reviewed_source_revision, '') = ''
           OR COALESCE(NEW.configuration_revision, '') = ''
           OR COALESCE(NEW.configuration_digest, '') = '' THEN
          RAISE EXCEPTION 'Only the certified bounded Codex read-only pilot installation may use GOVERNED_CODEX_PILOT enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Execution-enabled runtime installations require a registered enablement source.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_runtime_accounts' THEN
    IF NEW.execution_enabled = TRUE THEN
      SELECT r.runtime_code INTO runtime_code_value
      FROM core.agent_runtime_installations i
      JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
      WHERE i.installation_id = NEW.installation_id;

      IF NEW.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE' THEN
        IF runtime_code_value NOT IN ('FAKE_PERSISTENT', 'FAKE_EPHEMERAL')
           OR NEW.account_state <> 'CONFIGURED' THEN
          RAISE EXCEPTION 'Only configured accounts for source-controlled internal fake runtimes may use INTERNAL_FAKE_FIXTURE enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.execution_enablement_source = 'GOVERNED_CODEX_PILOT' THEN
        IF runtime_code_value <> 'OPENAI_CODEX_APP_SERVER'
           OR NEW.account_state <> 'CONFIGURED'
           OR COALESCE(NEW.account_policy ->> 'provider', '') <> 'OPENAI_CODEX'
           OR COALESCE(NEW.account_policy ->> 'executionMode', '') <> 'READ_ONLY_MANAGED_PILOT' THEN
          RAISE EXCEPTION 'Only the configured managed Codex read-only pilot account may use GOVERNED_CODEX_PILOT enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Execution-enabled runtime accounts require a registered enablement source.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_capability_profiles' THEN
    IF NEW.execution_enabled = TRUE THEN
      IF NEW.execution_enablement_source = 'INTERNAL_FAKE_FIXTURE' THEN
        IF NEW.profile_code NOT IN ('FAKE_PERSISTENT_DEFAULT', 'FAKE_EPHEMERAL_DEFAULT') THEN
          RAISE EXCEPTION 'Only source-controlled internal fake runtime profiles may use INTERNAL_FAKE_FIXTURE enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.execution_enablement_source = 'GOVERNED_CODEX_PILOT' THEN
        IF NEW.profile_code <> 'CODEX_READ_ONLY_PILOT'
           OR COALESCE(NEW.policy ->> 'provider', '') <> 'OPENAI_CODEX'
           OR COALESCE(NEW.policy ->> 'executionMode', '') <> 'READ_ONLY_MANAGED_PILOT' THEN
          RAISE EXCEPTION 'Only the bounded Codex read-only pilot profile may use GOVERNED_CODEX_PILOT enablement.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Execution-enabled capability profiles require a registered enablement source.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$agent_bounded_runtime_enablement$;

END;
$agent_bounded_runtime_enablement_wrapper$;

COMMENT ON COLUMN worker.agent_runs.fake_runtime_case_id IS
  'Legacy fake-runtime fixture case. NULL is required for real provider-backed runs; provider operation identity is persisted in the normalized Turn/operation journal.';
COMMENT ON TABLE worker.agent_runs IS
  'Phase 19.2A provider-neutral Agent Run identity, extended in Phase 19.3A1 for one governed real Codex read-only pilot profile.';
