-- Migration: 00155__agent_interactions_recovery_hardening.sql
-- Purpose: Phase 19.2C durable Agent interaction waits, decision delivery,
--          and fail-closed runtime-stop quarantine evidence.
--
-- The interaction ledger is deliberately separate from Workflow Human Approval.
-- It is scoped to an admitted Agent Run and never stores raw credentials or
-- caller-supplied authority identities.

CREATE TABLE IF NOT EXISTS worker.agent_interaction_requests (
  agent_interaction_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_scope_id UUID NOT NULL REFERENCES worker.execution_scopes(execution_scope_id) ON DELETE RESTRICT,
  agent_run_id UUID NOT NULL REFERENCES worker.agent_runs(agent_run_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL REFERENCES worker.agent_sessions(session_id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES core.projects(project_id) ON DELETE RESTRICT,
  initiating_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN ('APPROVAL', 'USER_INPUT')),
  operation_kind TEXT NOT NULL,
  operation_id UUID REFERENCES worker.agent_provider_operations(provider_operation_id) ON DELETE RESTRICT,
  capability_effect_id UUID REFERENCES worker.agent_capability_effects(agent_capability_effect_id) ON DELETE RESTRICT,
  operation_key TEXT NOT NULL,
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[A-F0-9]{64}$'),
  safe_prompt TEXT NOT NULL CHECK (btrim(safe_prompt) <> ''),
  validation_schema JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_schema) = 'object'),
  policy_revision TEXT NOT NULL,
  eligible_responder_scope JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligible_responder_scope) = 'object'),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SAVED', 'DELIVERED', 'APPLIED', 'BLOCKED', 'REJECTED', 'EXPIRED', 'CANCELED')),
  status_reason TEXT,
  decision_id UUID,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  saved_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (agent_run_id, operation_key, interaction_type)
);

CREATE TABLE IF NOT EXISTS worker.agent_interaction_decisions (
  agent_interaction_decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_interaction_request_id UUID NOT NULL UNIQUE REFERENCES worker.agent_interaction_requests(agent_interaction_request_id) ON DELETE RESTRICT,
  responder_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  responder_actor_kind TEXT NOT NULL,
  responder_actor_id TEXT NOT NULL,
  responder_actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(responder_actor_snapshot) = 'object'),
  decision_type TEXT NOT NULL CHECK (decision_type IN ('APPROVE', 'REJECT', 'SUBMIT_INPUT')),
  decision_value TEXT NOT NULL,
  safe_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_payload) = 'object'),
  decision_digest TEXT NOT NULL CHECK (decision_digest ~ '^[A-F0-9]{64}$'),
  delivery_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (delivery_state IN ('PENDING', 'DISPATCHED', 'ACKNOWLEDGED', 'FAILED')),
  application_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (application_status IN ('PENDING', 'APPLIED', 'BLOCKED', 'REJECTED', 'EXPIRED', 'CANCELED')),
  application_reason TEXT,
  application_result JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(application_result) = 'object'),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE worker.agent_interaction_requests
  DROP CONSTRAINT IF EXISTS agent_interaction_request_decision_fk;
ALTER TABLE worker.agent_interaction_requests
  ADD CONSTRAINT agent_interaction_request_decision_fk
  FOREIGN KEY (decision_id) REFERENCES worker.agent_interaction_decisions(agent_interaction_decision_id) ON DELETE RESTRICT;

ALTER TABLE worker.execution_outbox
  DROP CONSTRAINT IF EXISTS execution_outbox_aggregate_type_check;
ALTER TABLE worker.execution_outbox
  ADD CONSTRAINT execution_outbox_aggregate_type_check
  CHECK (aggregate_type IN ('AGENT_RUN', 'EXECUTION_SCOPE', 'AGENT_INTERACTION'));

ALTER TABLE worker.execution_outbox
  DROP CONSTRAINT IF EXISTS execution_outbox_event_type_check;
ALTER TABLE worker.execution_outbox
  ADD CONSTRAINT execution_outbox_event_type_check
  CHECK (event_type IN ('AGENT_RUN_DISPATCH', 'AGENT_ROOT_STOP', 'AGENT_INTERACTION_DECISION'));

ALTER TABLE worker.execution_outbox
  ADD COLUMN IF NOT EXISTS interaction_request_id UUID,
  ADD COLUMN IF NOT EXISTS interaction_decision_id UUID;

ALTER TABLE worker.execution_outbox
  DROP CONSTRAINT IF EXISTS execution_outbox_interaction_shape;
ALTER TABLE worker.execution_outbox
  ADD CONSTRAINT execution_outbox_interaction_shape
  CHECK (
    (event_type = 'AGENT_INTERACTION_DECISION'
      AND aggregate_type = 'AGENT_INTERACTION'
      AND interaction_request_id IS NOT NULL
      AND interaction_decision_id IS NOT NULL
      AND stable_workflow_id IS NULL)
    OR
    (event_type <> 'AGENT_INTERACTION_DECISION'
      AND interaction_request_id IS NULL
      AND interaction_decision_id IS NULL)
  );

ALTER TABLE worker.execution_outbox
  DROP CONSTRAINT IF EXISTS execution_outbox_interaction_request_fk;
ALTER TABLE worker.execution_outbox
  ADD CONSTRAINT execution_outbox_interaction_request_fk
  FOREIGN KEY (interaction_request_id) REFERENCES worker.agent_interaction_requests(agent_interaction_request_id) ON DELETE RESTRICT;

ALTER TABLE worker.execution_outbox
  DROP CONSTRAINT IF EXISTS execution_outbox_interaction_decision_fk;
ALTER TABLE worker.execution_outbox
  ADD CONSTRAINT execution_outbox_interaction_decision_fk
  FOREIGN KEY (interaction_decision_id) REFERENCES worker.agent_interaction_decisions(agent_interaction_decision_id) ON DELETE RESTRICT;

ALTER TABLE worker.agent_runs
  ADD COLUMN IF NOT EXISTS stop_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE worker.agent_runtime_cells
  ADD COLUMN IF NOT EXISTS quarantine_state TEXT NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quarantine_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quarantine_cleared_at TIMESTAMPTZ;

ALTER TABLE worker.agent_runtime_cells
  DROP CONSTRAINT IF EXISTS agent_runtime_cells_quarantine_state_check;
ALTER TABLE worker.agent_runtime_cells
  ADD CONSTRAINT agent_runtime_cells_quarantine_state_check
  CHECK (quarantine_state IN ('HEALTHY', 'QUARANTINED', 'CLEARED'));

ALTER TABLE worker.agent_resource_leases
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quarantine_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE worker.agent_resource_leases
  DROP CONSTRAINT IF EXISTS agent_resource_leases_lease_state_check;
ALTER TABLE worker.agent_resource_leases
  ADD CONSTRAINT agent_resource_leases_lease_state_check
  CHECK (lease_state IN ('ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED', 'QUARANTINED'));

CREATE INDEX IF NOT EXISTS idx_agent_interaction_requests_project_status
  ON worker.agent_interaction_requests (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_interaction_requests_run_status
  ON worker.agent_interaction_requests (agent_run_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_interaction_requests_expiry
  ON worker.agent_interaction_requests (expires_at, status);
CREATE INDEX IF NOT EXISTS idx_agent_interaction_decisions_delivery
  ON worker.agent_interaction_decisions (delivery_state, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_outbox_interaction_dispatch
  ON worker.execution_outbox (event_type, dispatch_state, available_at, created_at)
  WHERE event_type = 'AGENT_INTERACTION_DECISION';

DROP TRIGGER IF EXISTS agent_interaction_requests_set_updated_at ON worker.agent_interaction_requests;
CREATE TRIGGER agent_interaction_requests_set_updated_at
BEFORE UPDATE ON worker.agent_interaction_requests
FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();

DROP TRIGGER IF EXISTS agent_interaction_decisions_set_updated_at ON worker.agent_interaction_decisions;
CREATE TRIGGER agent_interaction_decisions_set_updated_at
BEFORE UPDATE ON worker.agent_interaction_decisions
FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.agent_interaction_requests IS
  'Phase 19.2C durable Agent approval and validated user-input waits. Safe prompts and schemas only; no raw credentials.';
COMMENT ON TABLE worker.agent_interaction_decisions IS
  'Phase 19.2C one-effective-decision ledger with durable outbox delivery and separate application status.';
COMMENT ON COLUMN worker.agent_runs.stop_evidence IS
  'Safe physical-stop and quarantine evidence. A requested stop is never treated as confirmed without durable runtime evidence.';
COMMENT ON COLUMN worker.agent_runtime_cells.quarantine_state IS
  'Fail-closed runtime-cell state after an unconfirmed physical stop; only durable reconciliation may clear it.';
