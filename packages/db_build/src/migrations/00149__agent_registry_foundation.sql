-- Migration: 00149__agent_registry_foundation.sql
-- Purpose: Phase 19.1 registered Agent Projects, Agent definitions, runtime
-- metadata, workspace bindings, and authority-preview persistence.
--
-- This migration deliberately stops before Agent Runs, Sessions, provider
-- launching, Temporal AgentRunWorkflow, scheduler integration, delegation,
-- or managed writable workspaces. Runtime and account execution flags are
-- constrained to FALSE until a separately authorized phase implements them.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS core.projects (
  project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  description TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_state IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  data_classification TEXT NOT NULL DEFAULT 'INTERNAL',
  policy_revision TEXT NOT NULL DEFAULT 'agent-policy.v1',
  authority_policy JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(authority_policy) = 'object'),
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT projects_code_not_blank CHECK (btrim(project_code) <> ''),
  CONSTRAINT projects_name_not_blank CHECK (btrim(project_name) <> '')
);

CREATE TABLE IF NOT EXISTS core.project_members (
  project_member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  membership_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (membership_state IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS core.project_member_rights (
  project_member_right_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_member_id UUID NOT NULL REFERENCES core.project_members(project_member_id) ON DELETE CASCADE,
  right_code TEXT NOT NULL
    CHECK (right_code IN ('PROJECT_READ', 'PROJECT_MANAGE', 'AUTHORITY_PREVIEW')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_member_id, right_code)
);

CREATE TABLE IF NOT EXISTS core.project_repositories (
  project_repository_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES core.repositories(repo_id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, repo_id)
);

CREATE TABLE IF NOT EXISTS core.project_workspaces (
  project_workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE CASCADE,
  repo_path_id UUID NOT NULL REFERENCES core.repository_paths(repo_path_id) ON DELETE RESTRICT,
  environment_code TEXT NOT NULL,
  workspace_mode TEXT NOT NULL DEFAULT 'READ_ONLY'
    CHECK (workspace_mode IN ('READ_ONLY', 'MANAGED_DEVELOPMENT')),
  policy_revision TEXT NOT NULL DEFAULT 'workspace-policy.v1',
  workspace_policy JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(workspace_policy) = 'object'),
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, repo_path_id, workspace_mode)
);

CREATE TABLE IF NOT EXISTS core.agent_runtimes (
  agent_runtime_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_code TEXT NOT NULL UNIQUE,
  runtime_name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_runtimes_code_not_blank CHECK (btrim(runtime_code) <> ''),
  CONSTRAINT agent_runtimes_name_not_blank CHECK (btrim(runtime_name) <> '')
);

CREATE TABLE IF NOT EXISTS core.agent_runtime_installations (
  installation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_runtime_id UUID NOT NULL REFERENCES core.agent_runtimes(agent_runtime_id) ON DELETE RESTRICT,
  installation_code TEXT NOT NULL UNIQUE,
  adapter_version TEXT,
  protocol_schema_digest TEXT,
  capability_manifest_revision TEXT,
  capability_manifest_digest TEXT,
  capability_manifest JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(capability_manifest) = 'object'),
  host_code TEXT,
  runtime_profile TEXT,
  containment_class TEXT,
  certification_state TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (certification_state IN ('UNVERIFIED', 'CERTIFIED', 'REVOKED', 'DISABLED')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  execution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_source_revision TEXT,
  configuration_revision TEXT,
  configuration_digest TEXT,
  process_generation TEXT,
  process_started_at TIMESTAMPTZ,
  service_generation TEXT,
  observed_at TIMESTAMPTZ,
  freshness_status TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (freshness_status IN ('CURRENT', 'STALE_RECONCILABLE', 'STALE_BLOCKED', 'UNKNOWN')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_installations_code_not_blank CHECK (btrim(installation_code) <> ''),
  CONSTRAINT agent_installations_execution_disabled CHECK (execution_enabled = FALSE)
);

CREATE TABLE IF NOT EXISTS core.agent_runtime_accounts (
  account_binding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL REFERENCES core.agent_runtime_installations(installation_id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  account_alias TEXT,
  owner_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  trust_domain TEXT,
  usage_visibility TEXT NOT NULL DEFAULT 'OWNER_ONLY'
    CHECK (usage_visibility IN ('OWNER_ONLY', 'PROJECT_MEMBERS', 'ADMIN_ONLY')),
  account_state TEXT NOT NULL DEFAULT 'UNCONFIGURED'
    CHECK (account_state IN ('UNCONFIGURED', 'CONFIGURED', 'DISABLED', 'REVOKED')),
  policy_revision TEXT NOT NULL DEFAULT 'account-policy.v1',
  account_policy JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(account_policy) = 'object'),
  execution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (installation_id, account_code),
  CONSTRAINT agent_accounts_code_not_blank CHECK (btrim(account_code) <> ''),
  CONSTRAINT agent_accounts_execution_disabled CHECK (execution_enabled = FALSE)
);

CREATE TABLE IF NOT EXISTS core.agent_capability_profiles (
  capability_profile_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code TEXT NOT NULL UNIQUE,
  profile_name TEXT NOT NULL,
  policy_schema_version TEXT NOT NULL DEFAULT 'agent-capability-policy.v1',
  policy_revision TEXT NOT NULL DEFAULT 'agent-capability-policy.v1',
  policy_digest TEXT,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(policy) = 'object'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  execution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_capability_profiles_code_not_blank CHECK (btrim(profile_code) <> ''),
  CONSTRAINT agent_capability_profiles_name_not_blank CHECK (btrim(profile_name) <> ''),
  CONSTRAINT agent_capability_profiles_execution_disabled CHECK (execution_enabled = FALSE)
);

CREATE TABLE IF NOT EXISTS core.agent_definitions (
  definition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  description TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_state IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version > 0),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_definitions_code_not_blank CHECK (btrim(agent_code) <> ''),
  CONSTRAINT agent_definitions_name_not_blank CHECK (btrim(agent_name) <> '')
);

CREATE TABLE IF NOT EXISTS core.agent_definition_versions (
  definition_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES core.agent_definitions(definition_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_digest TEXT NOT NULL,
  instruction_reference TEXT,
  instruction_digest TEXT,
  installation_id UUID NOT NULL REFERENCES core.agent_runtime_installations(installation_id) ON DELETE RESTRICT,
  account_binding_id UUID REFERENCES core.agent_runtime_accounts(account_binding_id) ON DELETE RESTRICT,
  capability_profile_id UUID NOT NULL REFERENCES core.agent_capability_profiles(capability_profile_id) ON DELETE RESTRICT,
  policy_revision TEXT NOT NULL DEFAULT 'agent-definition-policy.v1',
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (definition_id, revision),
  CONSTRAINT agent_definition_versions_digest_not_blank CHECK (btrim(content_digest) <> '')
);

CREATE TABLE IF NOT EXISTS core.project_agent_allow_rules (
  project_agent_allow_rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES core.agent_definitions(definition_id) ON DELETE RESTRICT,
  definition_version_id UUID REFERENCES core.agent_definition_versions(definition_version_id) ON DELETE RESTRICT,
  allow_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (allow_state IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  policy_revision TEXT NOT NULL DEFAULT 'project-agent-allow.v1',
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_agent_allow_rule_scope
  ON core.project_agent_allow_rules (
    project_id,
    definition_id,
    COALESCE(definition_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE IF NOT EXISTS auth.execution_principals (
  execution_principal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type TEXT NOT NULL
    CHECK (principal_type IN ('USER', 'SERVICE', 'EXTERNAL', 'AGENT_RUN')),
  user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  principal_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT execution_principals_user_shape CHECK (
    (principal_type = 'USER' AND user_id IS NOT NULL)
    OR (principal_type <> 'USER')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_principals_active_user
  ON auth.execution_principals (user_id)
  WHERE principal_type = 'USER' AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_project_members_user_state
  ON core.project_members (user_id, membership_state, project_id);
CREATE INDEX IF NOT EXISTS idx_project_member_rights_lookup
  ON core.project_member_rights (project_member_id, right_code, active);
CREATE INDEX IF NOT EXISTS idx_project_workspaces_project_state
  ON core.project_workspaces (project_id, active, environment_code);
CREATE INDEX IF NOT EXISTS idx_agent_installations_eligibility
  ON core.agent_runtime_installations (enabled, certification_state, freshness_status);
CREATE INDEX IF NOT EXISTS idx_agent_definition_versions_definition
  ON core.agent_definition_versions (definition_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_project_agent_allow_lookup
  ON core.project_agent_allow_rules (project_id, definition_id, allow_state);

DO $agent_registry_function$
BEGIN
  CREATE OR REPLACE FUNCTION core.prevent_agent_definition_version_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $agent_registry_function_body$
  BEGIN
    RAISE EXCEPTION 'Agent definition versions are immutable.'
      USING ERRCODE = '55006';
  END;
  $agent_registry_function_body$;
END;
$agent_registry_function$;

DROP TRIGGER IF EXISTS agent_definition_versions_immutable ON core.agent_definition_versions;
CREATE TRIGGER agent_definition_versions_immutable
BEFORE UPDATE OR DELETE ON core.agent_definition_versions
FOR EACH ROW
EXECUTE FUNCTION core.prevent_agent_definition_version_mutation();

DROP TRIGGER IF EXISTS projects_set_updated_at ON core.projects;
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON core.projects FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS project_members_set_updated_at ON core.project_members;
CREATE TRIGGER project_members_set_updated_at BEFORE UPDATE ON core.project_members FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS project_member_rights_set_updated_at ON core.project_member_rights;
CREATE TRIGGER project_member_rights_set_updated_at BEFORE UPDATE ON core.project_member_rights FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS project_repositories_set_updated_at ON core.project_repositories;
CREATE TRIGGER project_repositories_set_updated_at BEFORE UPDATE ON core.project_repositories FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS project_workspaces_set_updated_at ON core.project_workspaces;
CREATE TRIGGER project_workspaces_set_updated_at BEFORE UPDATE ON core.project_workspaces FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS agent_runtimes_set_updated_at ON core.agent_runtimes;
CREATE TRIGGER agent_runtimes_set_updated_at BEFORE UPDATE ON core.agent_runtimes FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS agent_runtime_installations_set_updated_at ON core.agent_runtime_installations;
CREATE TRIGGER agent_runtime_installations_set_updated_at BEFORE UPDATE ON core.agent_runtime_installations FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS agent_runtime_accounts_set_updated_at ON core.agent_runtime_accounts;
CREATE TRIGGER agent_runtime_accounts_set_updated_at BEFORE UPDATE ON core.agent_runtime_accounts FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS agent_capability_profiles_set_updated_at ON core.agent_capability_profiles;
CREATE TRIGGER agent_capability_profiles_set_updated_at BEFORE UPDATE ON core.agent_capability_profiles FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS agent_definitions_set_updated_at ON core.agent_definitions;
CREATE TRIGGER agent_definitions_set_updated_at BEFORE UPDATE ON core.agent_definitions FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS project_agent_allow_rules_set_updated_at ON core.project_agent_allow_rules;
CREATE TRIGGER project_agent_allow_rules_set_updated_at BEFORE UPDATE ON core.project_agent_allow_rules FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
DROP TRIGGER IF EXISTS execution_principals_set_updated_at ON auth.execution_principals;
CREATE TRIGGER execution_principals_set_updated_at BEFORE UPDATE ON auth.execution_principals FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

COMMENT ON TABLE core.projects IS 'Phase 19.1 registered Agent Projects. Project membership and rights are evaluated before authority preview.';
COMMENT ON TABLE core.project_workspaces IS 'Registered project workspace bindings. Phase 19.1 service APIs permit READ_ONLY only; arbitrary paths are never accepted.';
COMMENT ON TABLE core.agent_runtime_installations IS 'Registered runtime installation metadata and freshness identity. Execution remains disabled in Phase 19.1.';
COMMENT ON TABLE core.agent_runtime_accounts IS 'Non-secret runtime account metadata. Credential values and references are intentionally absent.';
COMMENT ON TABLE core.agent_definition_versions IS 'Immutable, provider-neutral Agent definition revisions. No Agent Run or launch state is stored here.';
COMMENT ON TABLE auth.execution_principals IS 'Generic execution-principal identity boundary. Existing auth.workflow_execution_principals remains unchanged.';
