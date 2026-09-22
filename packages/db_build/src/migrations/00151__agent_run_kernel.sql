-- Migration: 00151__agent_run_kernel.sql
-- Purpose: Phase 19.2A durable fake Agent Run execution kernel.
--
-- This migration is intentionally limited to the first provider-neutral fake
-- runtime vertical slice. It does not add managed credentials, capability
-- effects, interactions, delegation, scheduler targets, or writable
-- workspaces.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE core.agent_runtime_installations
  ADD COLUMN IF NOT EXISTS execution_enablement_source TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE core.agent_runtime_accounts
  ADD COLUMN IF NOT EXISTS execution_enablement_source TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE core.agent_capability_profiles
  ADD COLUMN IF NOT EXISTS execution_enablement_source TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE core.agent_runtime_installations
  DROP CONSTRAINT IF EXISTS agent_installations_execution_disabled;
ALTER TABLE core.agent_runtime_accounts
  DROP CONSTRAINT IF EXISTS agent_accounts_execution_disabled;
ALTER TABLE core.agent_capability_profiles
  DROP CONSTRAINT IF EXISTS agent_capability_profiles_execution_disabled;

ALTER TABLE core.agent_runtime_installations
  ADD CONSTRAINT agent_installations_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source = 'INTERNAL_FAKE_FIXTURE')
  );
ALTER TABLE core.agent_runtime_accounts
  ADD CONSTRAINT agent_accounts_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source = 'INTERNAL_FAKE_FIXTURE')
  );
ALTER TABLE core.agent_capability_profiles
  ADD CONSTRAINT agent_capability_profiles_execution_source_shape CHECK (
    (execution_enabled = FALSE AND execution_enablement_source = 'NONE')
    OR (execution_enabled = TRUE AND execution_enablement_source = 'INTERNAL_FAKE_FIXTURE')
  );

DO $agent_fake_runtime_enablement_wrapper$
BEGIN
  CREATE OR REPLACE FUNCTION core.assert_internal_fake_runtime_enablement()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $agent_fake_runtime_enablement$
  DECLARE
    runtime_code_value TEXT;
  BEGIN
    IF TG_TABLE_NAME = 'agent_runtime_installations' THEN
      IF NEW.execution_enabled = TRUE THEN
        SELECT runtime_code INTO runtime_code_value
        FROM core.agent_runtimes
        WHERE agent_runtime_id = NEW.agent_runtime_id;

        IF NEW.execution_enablement_source <> 'INTERNAL_FAKE_FIXTURE'
           OR runtime_code_value NOT IN ('FAKE_PERSISTENT', 'FAKE_EPHEMERAL')
           OR COALESCE(NEW.reviewed_source_revision, '') = '' THEN
          RAISE EXCEPTION 'Only source-controlled internal fake runtime installations may be execution enabled.'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'agent_runtime_accounts' THEN
      IF NEW.execution_enabled = TRUE THEN
        SELECT r.runtime_code INTO runtime_code_value
        FROM core.agent_runtime_installations i
        JOIN core.agent_runtimes r ON r.agent_runtime_id = i.agent_runtime_id
        WHERE i.installation_id = NEW.installation_id;

        IF NEW.execution_enablement_source <> 'INTERNAL_FAKE_FIXTURE'
           OR runtime_code_value NOT IN ('FAKE_PERSISTENT', 'FAKE_EPHEMERAL')
           OR NEW.account_state <> 'CONFIGURED' THEN
          RAISE EXCEPTION 'Only configured accounts for source-controlled internal fake runtimes may be execution enabled.'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME = 'agent_capability_profiles' THEN
      IF NEW.execution_enabled = TRUE
         AND (NEW.execution_enablement_source <> 'INTERNAL_FAKE_FIXTURE'
              OR NEW.profile_code NOT IN ('FAKE_PERSISTENT_DEFAULT', 'FAKE_EPHEMERAL_DEFAULT')) THEN
        RAISE EXCEPTION 'Only source-controlled internal fake runtime profiles may be execution enabled.'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $agent_fake_runtime_enablement$;
END;
$agent_fake_runtime_enablement_wrapper$;

DROP TRIGGER IF EXISTS agent_installations_fake_enablement ON core.agent_runtime_installations;
CREATE TRIGGER agent_installations_fake_enablement
BEFORE INSERT OR UPDATE ON core.agent_runtime_installations
FOR EACH ROW EXECUTE FUNCTION core.assert_internal_fake_runtime_enablement();

DROP TRIGGER IF EXISTS agent_accounts_fake_enablement ON core.agent_runtime_accounts;
CREATE TRIGGER agent_accounts_fake_enablement
BEFORE INSERT OR UPDATE ON core.agent_runtime_accounts
FOR EACH ROW EXECUTE FUNCTION core.assert_internal_fake_runtime_enablement();

DROP TRIGGER IF EXISTS agent_capability_profiles_fake_enablement ON core.agent_capability_profiles;
CREATE TRIGGER agent_capability_profiles_fake_enablement
BEFORE INSERT OR UPDATE ON core.agent_capability_profiles
FOR EACH ROW EXECUTE FUNCTION core.assert_internal_fake_runtime_enablement();

CREATE TABLE IF NOT EXISTS worker.execution_scopes (
  execution_scope_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind TEXT NOT NULL DEFAULT 'ROOT' CHECK (scope_kind = 'ROOT'),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiating_principal_id UUID REFERENCES auth.execution_principals(execution_principal_id) ON DELETE RESTRICT,
  initiating_actor_kind TEXT NOT NULL,
  initiating_actor_id TEXT NOT NULL,
  initiating_actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(initiating_actor_snapshot) = 'object'),
  requesting_actor_kind TEXT NOT NULL,
  requesting_actor_id TEXT NOT NULL,
  requesting_actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(requesting_actor_snapshot) = 'object'),
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('MANUAL', 'WORKFLOW', 'SCHEDULER', 'AGENT_DELEGATION', 'EXTERNAL_ASSISTANT')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOP_REQUESTED', 'STOPPING', 'STOPPED', 'RECOVERY_REQUIRED')),
  revocation_epoch INTEGER NOT NULL DEFAULT 0 CHECK (revocation_epoch >= 0),
  stop_reason TEXT,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker.agent_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  session_model TEXT NOT NULL CHECK (session_model IN ('PERSISTENT', 'EPHEMERAL')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSING', 'CLOSED', 'RECOVERY_REQUIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker.agent_admission_requests (
  admission_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_scope_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  submitted_intent_digest TEXT NOT NULL CHECK (submitted_intent_digest ~ '^[A-F0-9]{64}$'),
  resolved_spec_digest TEXT NOT NULL CHECK (resolved_spec_digest ~ '^[A-F0-9]{64}$'),
  submitted_intent JSONB NOT NULL CHECK (jsonb_typeof(submitted_intent) = 'object'),
  resolved_spec JSONB NOT NULL CHECK (jsonb_typeof(resolved_spec) = 'object'),
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiating_principal_id UUID REFERENCES auth.execution_principals(execution_principal_id) ON DELETE RESTRICT,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('MANUAL', 'WORKFLOW', 'SCHEDULER', 'AGENT_DELEGATION', 'EXTERNAL_ASSISTANT')),
  agent_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (caller_scope_key, idempotency_key),
  UNIQUE (agent_run_id)
);

CREATE TABLE IF NOT EXISTS worker.agent_runs (
  agent_run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  definition_id UUID NOT NULL REFERENCES core.agent_definitions(definition_id) ON DELETE RESTRICT,
  definition_version_id UUID NOT NULL REFERENCES core.agent_definition_versions(definition_version_id) ON DELETE RESTRICT,
  project_workspace_id UUID NOT NULL REFERENCES core.project_workspaces(project_workspace_id) ON DELETE RESTRICT,
  installation_id UUID NOT NULL REFERENCES core.agent_runtime_installations(installation_id) ON DELETE RESTRICT,
  account_binding_id UUID NOT NULL REFERENCES core.agent_runtime_accounts(account_binding_id) ON DELETE RESTRICT,
  capability_profile_id UUID NOT NULL REFERENCES core.agent_capability_profiles(capability_profile_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiating_principal_id UUID REFERENCES auth.execution_principals(execution_principal_id) ON DELETE RESTRICT,
  initiating_actor_kind TEXT NOT NULL,
  initiating_actor_id TEXT NOT NULL,
  initiating_actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(initiating_actor_snapshot) = 'object'),
  requesting_actor_kind TEXT NOT NULL,
  requesting_actor_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('MANUAL', 'WORKFLOW', 'SCHEDULER', 'AGENT_DELEGATION', 'EXTERNAL_ASSISTANT')),
  instruction TEXT NOT NULL CHECK (btrim(instruction) <> ''),
  fake_runtime_case_id TEXT NOT NULL,
  requested_authority JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(requested_authority) = 'object'),
  execution_context JSONB NOT NULL CHECK (jsonb_typeof(execution_context) = 'object'),
  submitted_intent_digest TEXT NOT NULL CHECK (submitted_intent_digest ~ '^[A-F0-9]{64}$'),
  resolved_spec_digest TEXT NOT NULL CHECK (resolved_spec_digest ~ '^[A-F0-9]{64}$'),
  stable_temporal_workflow_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ADMITTED' CHECK (status IN ('ADMITTED', 'QUEUED', 'STARTING', 'RUNNING', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_USER_INPUT', 'WAITING_FOR_CHILDREN', 'CLOSING', 'FINALIZING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCEL_REQUESTED', 'CANCELLING', 'CANCELED', 'RECONCILING', 'RECOVERY_REQUIRED')),
  outcome TEXT,
  stop_state TEXT NOT NULL DEFAULT 'NONE' CHECK (stop_state IN ('NONE', 'REQUESTED', 'ACKNOWLEDGED', 'CONFIRMED', 'UNCONFIRMED')),
  revocation_epoch INTEGER NOT NULL DEFAULT 0 CHECK (revocation_epoch >= 0),
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE worker.agent_admission_requests
  ADD CONSTRAINT agent_admission_run_fk
  FOREIGN KEY (agent_run_id) REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS worker.agent_authority_snapshots (
  authority_snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL UNIQUE REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  digest TEXT NOT NULL UNIQUE CHECK (digest ~ '^[A-F0-9]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker.execution_outbox (
  execution_outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('AGENT_RUN', 'EXECUTION_SCOPE')),
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('AGENT_RUN_DISPATCH', 'AGENT_ROOT_STOP')),
  stable_workflow_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  dispatch_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (dispatch_state IN ('PENDING', 'DISPATCHING', 'DISPATCHED', 'RECONCILING', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_code TEXT,
  last_error_message TEXT,
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  claimed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (aggregate_type, aggregate_id, event_type),
  UNIQUE (stable_workflow_id)
);

CREATE TABLE IF NOT EXISTS worker.agent_temporal_segments (
  temporal_segment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  temporal_workflow_id TEXT NOT NULL,
  temporal_run_id TEXT NOT NULL,
  segment_kind TEXT NOT NULL CHECK (segment_kind IN ('START', 'CONTINUE_AS_NEW', 'RECOVERY')),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'UNKNOWN')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ,
  UNIQUE (agent_run_id, temporal_run_id)
);

CREATE TABLE IF NOT EXISTS worker.agent_turns (
  agent_turn_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  turn_number INTEGER NOT NULL CHECK (turn_number > 0),
  provider_turn_id TEXT,
  provider_session_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED', 'UNKNOWN', 'RECONCILING', 'COMPLETED', 'CANCELED', 'RECOVERY_REQUIRED')),
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[A-F0-9]{64}$'),
  output_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_run_id, turn_number)
);

CREATE TABLE IF NOT EXISTS worker.agent_provider_operations (
  provider_operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key TEXT NOT NULL UNIQUE,
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  agent_turn_id UUID REFERENCES worker.agent_turns(agent_turn_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('SUBMIT_TURN', 'RECONCILE_TURN', 'CANCEL_TURN', 'STOP_RUNTIME')),
  provider_operation_reference TEXT NOT NULL,
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[A-F0-9]{64}$'),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 0),
  deadline_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'JOURNALED' CHECK (state IN ('JOURNALED', 'SENT', 'ACKNOWLEDGED', 'REJECTED', 'UNKNOWN', 'RECONCILING', 'COMPLETED', 'CANCELED', 'RECOVERY_REQUIRED')),
  outcome_certainty TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (outcome_certainty IN ('NOT_STARTED_PROVEN', 'ACKNOWLEDGED', 'REJECTED', 'UNKNOWN', 'NOT_CONFIRMED')),
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(outcome) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker.agent_runtime_cells (
  runtime_cell_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL UNIQUE REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  runtime_kind TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  task_queue TEXT NOT NULL,
  worker_identity TEXT,
  worker_generation TEXT,
  worker_process_id INTEGER,
  worker_hostname TEXT,
  readiness_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (readiness_status IN ('CURRENT', 'STALE', 'UNKNOWN', 'ERROR')),
  observed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  containment_profile JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(containment_profile) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker.agent_resource_leases (
  resource_lease_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  lease_kind TEXT NOT NULL CHECK (lease_kind IN ('SESSION_RUN')),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 0),
  lease_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lease_state IN ('ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMPTZ,
  UNIQUE (session_id, agent_run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_session_active_run_lease
  ON worker.agent_resource_leases (session_id)
  WHERE lease_kind = 'SESSION_RUN' AND lease_state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS worker.agent_events (
  agent_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  agent_turn_id UUID REFERENCES worker.agent_turns(agent_turn_id) ON DELETE RESTRICT,
  event_sequence BIGINT NOT NULL CHECK (event_sequence > 0),
  event_type TEXT NOT NULL,
  event_scope TEXT NOT NULL CHECK (event_scope IN ('ROOT', 'RUN', 'TURN', 'SESSION', 'ACCOUNT')),
  source_kind TEXT NOT NULL,
  source_instance TEXT NOT NULL,
  source_cursor TEXT,
  availability TEXT NOT NULL CHECK (availability IN ('REPORTED', 'NOT_REPORTED', 'UNSUPPORTED', 'ERROR')),
  freshness TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (freshness IN ('CURRENT', 'STALE', 'UNKNOWN')),
  observed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_run_id, event_sequence),
  UNIQUE (agent_run_id, source_kind, source_instance, source_cursor)
);

CREATE TABLE IF NOT EXISTS worker.agent_results (
  agent_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL UNIQUE REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  result_status TEXT NOT NULL CHECK (result_status IN ('COMPLETED', 'CANCELED', 'FAILED', 'RECOVERY_REQUIRED')),
  result_digest TEXT NOT NULL UNIQUE CHECK (result_digest ~ '^[A-F0-9]{64}$'),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth.execution_grants (
  execution_grant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  principal_id UUID NOT NULL REFERENCES auth.execution_principals(execution_principal_id) ON DELETE RESTRICT,
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('ROOT_RUN')),
  authority_snapshot_id UUID NOT NULL REFERENCES worker.agent_authority_snapshots(authority_snapshot_id) ON DELETE RESTRICT,
  revocation_epoch INTEGER NOT NULL CHECK (revocation_epoch >= 0),
  grant_state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (grant_state IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  UNIQUE (agent_run_id, grant_kind)
);

CREATE INDEX IF NOT EXISTS idx_execution_scopes_project_status
  ON worker.execution_scopes (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project_status
  ON worker.agent_sessions (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_admission_project_created
  ON worker.agent_admission_requests (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project_status_created
  ON worker.agent_runs (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status_created
  ON worker.agent_runs (initiating_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_definition_status
  ON worker.agent_runs (definition_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_outbox_dispatch
  ON worker.execution_outbox (dispatch_state, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_run_sequence
  ON worker.agent_events (agent_run_id, event_sequence);
CREATE INDEX IF NOT EXISTS idx_agent_provider_operations_run_state
  ON worker.agent_provider_operations (agent_run_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_results_status_published
  ON worker.agent_results (result_status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_grants_scope_state
  ON auth.execution_grants (execution_scope_id, grant_state, revocation_epoch);

DO $agent_immutable_history_wrapper$
BEGIN
  CREATE OR REPLACE FUNCTION worker.prevent_agent_immutable_history_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $agent_immutable_history$
  BEGIN
    RAISE EXCEPTION '% history is immutable after publication.', TG_TABLE_NAME
      USING ERRCODE = '55006';
  END;
  $agent_immutable_history$;
END;
$agent_immutable_history_wrapper$;

DROP TRIGGER IF EXISTS agent_authority_snapshots_immutable ON worker.agent_authority_snapshots;
CREATE TRIGGER agent_authority_snapshots_immutable
BEFORE UPDATE OR DELETE ON worker.agent_authority_snapshots
FOR EACH ROW EXECUTE FUNCTION worker.prevent_agent_immutable_history_mutation();

DROP TRIGGER IF EXISTS agent_results_immutable ON worker.agent_results;
CREATE TRIGGER agent_results_immutable
BEFORE UPDATE OR DELETE ON worker.agent_results
FOR EACH ROW EXECUTE FUNCTION worker.prevent_agent_immutable_history_mutation();

DROP TRIGGER IF EXISTS execution_scopes_set_updated_at ON worker.execution_scopes;
CREATE TRIGGER execution_scopes_set_updated_at BEFORE UPDATE ON worker.execution_scopes FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS agent_sessions_set_updated_at ON worker.agent_sessions;
CREATE TRIGGER agent_sessions_set_updated_at BEFORE UPDATE ON worker.agent_sessions FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS agent_runs_set_updated_at ON worker.agent_runs;
CREATE TRIGGER agent_runs_set_updated_at BEFORE UPDATE ON worker.agent_runs FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS execution_outbox_set_updated_at ON worker.execution_outbox;
CREATE TRIGGER execution_outbox_set_updated_at BEFORE UPDATE ON worker.execution_outbox FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS agent_turns_set_updated_at ON worker.agent_turns;
CREATE TRIGGER agent_turns_set_updated_at BEFORE UPDATE ON worker.agent_turns FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS agent_provider_operations_set_updated_at ON worker.agent_provider_operations;
CREATE TRIGGER agent_provider_operations_set_updated_at BEFORE UPDATE ON worker.agent_provider_operations FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();
DROP TRIGGER IF EXISTS agent_runtime_cells_set_updated_at ON worker.agent_runtime_cells;
CREATE TRIGGER agent_runtime_cells_set_updated_at BEFORE UPDATE ON worker.agent_runtime_cells FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.execution_scopes IS 'Phase 19.2A root execution identity and revocation epoch.';
COMMENT ON TABLE worker.agent_sessions IS 'Phase 19.2A provider-neutral Session identity; not a user continuation surface.';
COMMENT ON TABLE worker.agent_runs IS 'Phase 19.2A durable Agent Run business identity and immutable admitted execution context.';
COMMENT ON TABLE worker.execution_outbox IS 'Phase 19.2A transactional dispatch outbox for stable Agent Run Temporal workflow identity.';
COMMENT ON TABLE worker.agent_provider_operations IS 'Phase 19.2A provider operation journal; uncertain sends reconcile the same operation.';
COMMENT ON TABLE worker.agent_runtime_cells IS 'Phase 19.2A dedicated Agent Runtime Worker generation and freshness evidence.';
COMMENT ON TABLE worker.agent_events IS 'Phase 19.2A normalized provider-neutral Agent event evidence.';
COMMENT ON TABLE worker.agent_results IS 'Phase 19.2A immutable validated terminal Agent Run result.';
COMMENT ON TABLE auth.execution_grants IS 'Phase 19.2A root/run authority grants with immediate revocation epochs.';
