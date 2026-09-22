-- Migration: 00153__agent_capability_effects.sql
-- Purpose: Phase 19.2B managed Agent capability credentials, durable effect
-- intent/idempotency, and managed links into the canonical Browser ledger.

ALTER TABLE worker.agent_runs
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

ALTER TABLE auth.execution_grants
  ADD COLUMN IF NOT EXISTS capability_effect_id UUID,
  ADD COLUMN IF NOT EXISTS grant_audience TEXT,
  ADD COLUMN IF NOT EXISTS credential_hash TEXT,
  ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grant_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE auth.execution_grants
  DROP CONSTRAINT IF EXISTS execution_grants_grant_kind_check;

ALTER TABLE auth.execution_grants
  ADD CONSTRAINT execution_grants_grant_kind_check
  CHECK (grant_kind IN ('ROOT_RUN', 'MANAGED_CAPABILITY'));

ALTER TABLE auth.execution_grants
  DROP CONSTRAINT IF EXISTS execution_grants_credential_hash_check;

ALTER TABLE auth.execution_grants
  ADD CONSTRAINT execution_grants_credential_hash_check
  CHECK (credential_hash IS NULL OR credential_hash ~ '^[A-F0-9]{64}$');

ALTER TABLE auth.execution_grants
  DROP CONSTRAINT IF EXISTS execution_grants_metadata_object;

ALTER TABLE auth.execution_grants
  ADD CONSTRAINT execution_grants_metadata_object
  CHECK (jsonb_typeof(grant_metadata) = 'object');

ALTER TABLE auth.execution_grants
  DROP CONSTRAINT IF EXISTS execution_grants_root_or_managed_shape;

ALTER TABLE auth.execution_grants
  ADD CONSTRAINT execution_grants_root_or_managed_shape
  CHECK (
    (grant_kind = 'ROOT_RUN'
      AND capability_effect_id IS NULL
      AND credential_hash IS NULL
      AND credential_expires_at IS NULL)
    OR
    (grant_kind = 'MANAGED_CAPABILITY'
      AND capability_effect_id IS NOT NULL
      AND grant_audience IS NOT NULL
      AND credential_hash IS NOT NULL
      AND credential_expires_at IS NOT NULL)
  );

ALTER TABLE auth.execution_grants
  DROP CONSTRAINT IF EXISTS execution_grants_agent_run_id_grant_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_grants_root_run
  ON auth.execution_grants (agent_run_id)
  WHERE grant_kind = 'ROOT_RUN';

CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_grants_managed_effect
  ON auth.execution_grants (agent_run_id, capability_effect_id)
  WHERE grant_kind = 'MANAGED_CAPABILITY';

ALTER TABLE worker.browser_automation_runs
  ADD COLUMN IF NOT EXISTS managed_effect_id UUID,
  ADD COLUMN IF NOT EXISTS managed_project_id UUID,
  ADD COLUMN IF NOT EXISTS managed_execution_scope_id UUID,
  ADD COLUMN IF NOT EXISTS managed_agent_run_id UUID,
  ADD COLUMN IF NOT EXISTS managed_session_id UUID,
  ADD COLUMN IF NOT EXISTS managed_turn_id UUID,
  ADD COLUMN IF NOT EXISTS managed_agent_definition_id UUID,
  ADD COLUMN IF NOT EXISTS managed_definition_version_id UUID,
  ADD COLUMN IF NOT EXISTS managed_initiating_user_id UUID,
  ADD COLUMN IF NOT EXISTS managed_initiating_actor_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS managed_authority_snapshot_id UUID,
  ADD COLUMN IF NOT EXISTS managed_authority_epoch INTEGER,
  ADD COLUMN IF NOT EXISTS managed_policy_revision TEXT;

ALTER TABLE worker.browser_automation_runs
  DROP CONSTRAINT IF EXISTS browser_automation_managed_actor_snapshot_object;

ALTER TABLE worker.browser_automation_runs
  ADD CONSTRAINT browser_automation_managed_actor_snapshot_object
  CHECK (managed_initiating_actor_snapshot IS NULL OR jsonb_typeof(managed_initiating_actor_snapshot) = 'object');

ALTER TABLE worker.browser_automation_runs
  DROP CONSTRAINT IF EXISTS browser_automation_managed_epoch_nonnegative;

ALTER TABLE worker.browser_automation_runs
  ADD CONSTRAINT browser_automation_managed_epoch_nonnegative
  CHECK (managed_authority_epoch IS NULL OR managed_authority_epoch >= 0);

CREATE TABLE IF NOT EXISTS worker.agent_capability_effects (
  agent_capability_effect_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effect_key TEXT NOT NULL,
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  agent_turn_id UUID REFERENCES worker.agent_turns(agent_turn_id) ON DELETE RESTRICT,
  provider_operation_id UUID REFERENCES worker.agent_provider_operations(provider_operation_id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  agent_definition_id UUID NOT NULL REFERENCES core.agent_definitions(definition_id) ON DELETE RESTRICT,
  definition_version_id UUID NOT NULL REFERENCES core.agent_definition_versions(definition_version_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  initiating_actor_kind TEXT NOT NULL,
  initiating_actor_id TEXT NOT NULL,
  initiating_actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(initiating_actor_snapshot) = 'object'),
  capability_kind TEXT NOT NULL CHECK (capability_kind = 'BROWSER_AUTOMATION'),
  capability_code TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-F0-9]{64}$'),
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(request_metadata) = 'object'),
  authority_decision TEXT NOT NULL
    CHECK (authority_decision IN ('ALLOW', 'DENY', 'EXPLICIT_APPROVAL_REQUIRED')),
  authority_snapshot_id UUID REFERENCES worker.agent_authority_snapshots(authority_snapshot_id) ON DELETE RESTRICT,
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 0),
  policy_revision TEXT NOT NULL,
  policy_digest TEXT CHECK (policy_digest IS NULL OR policy_digest ~ '^[A-F0-9]{64}$'),
  execution_surface_decision JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(execution_surface_decision) = 'object'),
  managed_credential_reference TEXT,
  native_browser_execution_id TEXT,
  native_browser_workflow_id TEXT,
  browser_automation_run_id UUID REFERENCES worker.browser_automation_runs(browser_automation_run_id) ON DELETE RESTRICT,
  runtime_worker_identity TEXT,
  runtime_worker_generation TEXT,
  runtime_task_queue TEXT,
  runtime_observed_at TIMESTAMPTZ,
  dispatch_state TEXT NOT NULL DEFAULT 'INTENT'
    CHECK (dispatch_state IN ('INTENT', 'DISPATCHING', 'DISPATCHED', 'RECONCILING', 'COMPLETED', 'FAILED', 'DENIED', 'APPROVAL_REQUIRED', 'CANCELED')),
  outcome_certainty TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (outcome_certainty IN ('NOT_STARTED_PROVEN', 'ACKNOWLEDGED', 'REJECTED', 'UNKNOWN', 'NOT_CONFIRMED')),
  denial_reason TEXT,
  reconciliation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(reconciliation_metadata) = 'object'),
  result_summary JSONB
    CHECK (result_summary IS NULL OR jsonb_typeof(result_summary) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_run_id, effect_key)
);

ALTER TABLE worker.agent_capability_effects OWNER TO postgres;

ALTER TABLE worker.browser_automation_runs
  ADD CONSTRAINT browser_automation_managed_effect_fk
  FOREIGN KEY (managed_effect_id)
  REFERENCES worker.agent_capability_effects(agent_capability_effect_id)
  ON DELETE SET NULL;

ALTER TABLE auth.execution_grants
  ADD CONSTRAINT execution_grants_capability_effect_fk
  FOREIGN KEY (capability_effect_id)
  REFERENCES worker.agent_capability_effects(agent_capability_effect_id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_browser_automation_runs_managed_effect
  ON worker.browser_automation_runs (managed_effect_id)
  WHERE managed_effect_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_effect_native_workflow
  ON worker.agent_capability_effects (native_browser_workflow_id)
  WHERE native_browser_workflow_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_effect_native_execution
  ON worker.agent_capability_effects (native_browser_execution_id)
  WHERE native_browser_execution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_capability_effects_run_created
  ON worker.agent_capability_effects (agent_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_capability_effects_project_created
  ON worker.agent_capability_effects (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_capability_effects_dispatch
  ON worker.agent_capability_effects (dispatch_state, updated_at);

CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_managed_project
  ON worker.browser_automation_runs (managed_project_id, created_at DESC)
  WHERE managed_effect_id IS NOT NULL;

DROP TRIGGER IF EXISTS agent_capability_effects_set_updated_at ON worker.agent_capability_effects;
CREATE TRIGGER agent_capability_effects_set_updated_at
BEFORE UPDATE ON worker.agent_capability_effects
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

CREATE OR REPLACE VIEW worker.vw_browser_automation_runs AS
SELECT
  r.browser_automation_run_id,
  r.execution_id,
  r.automation_id,
  r.automation_code,
  r.automation_label,
  r.category_code,
  bac.label AS category_label,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.temporal_status,
  r.status,
  r.trigger_source,
  r.initiated_by_user_id,
  COALESCE(r.initiated_by_label, u.username, u.email) AS initiated_by,
  r.environment_code,
  r.browser_type,
  r.execution_mode,
  r.parameters,
  r.source_repo_code,
  r.source_commit_sha,
  r.side_effect_level,
  r.idempotency_mode,
  r.risk_code,
  r.artifact_root,
  r.result_summary,
  r.failure_summary,
  r.started_at,
  r.completed_at,
  r.duration_ms,
  r.created_at,
  r.updated_at,
  (SELECT COUNT(*) FROM worker.browser_automation_artifacts a WHERE a.browser_automation_run_id = r.browser_automation_run_id) AS artifact_count,
  r.managed_effect_id,
  r.managed_project_id,
  r.managed_execution_scope_id,
  r.managed_agent_run_id,
  r.managed_session_id,
  r.managed_turn_id,
  r.managed_agent_definition_id,
  r.managed_definition_version_id,
  r.managed_initiating_user_id,
  r.managed_initiating_actor_snapshot,
  r.managed_authority_snapshot_id,
  r.managed_authority_epoch,
  r.managed_policy_revision
FROM worker.browser_automation_runs r
LEFT JOIN core.browser_automations ba ON ba.automation_id = r.automation_id
LEFT JOIN core.browser_automation_categories bac ON bac.category_id = ba.category_id
LEFT JOIN auth.users u ON u.user_id = r.initiated_by_user_id;

ALTER VIEW worker.vw_browser_automation_runs OWNER TO postgres;

COMMENT ON TABLE worker.agent_capability_effects IS
  'Phase 19.2B provider-neutral managed Agent capability effect intent, authorization, native Browser linkage, idempotency, and outcome evidence.';
COMMENT ON TABLE auth.execution_grants IS
  'Phase 19.2B root/run and short-lived managed capability grants with immediate revocation epochs; raw credentials are never stored.';
COMMENT ON COLUMN worker.browser_automation_runs.managed_effect_id IS
  'Optional Phase 19.2B managed Agent link. NULL preserves legacy Browser and Assistant origin behavior.';
