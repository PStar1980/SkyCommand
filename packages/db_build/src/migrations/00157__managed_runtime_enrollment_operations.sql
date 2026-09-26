-- Migration: 00157__managed_runtime_enrollment_operations.sql
-- Purpose: Provider-neutral, safe lifecycle records for managed runtime-account
-- enrollment. Raw provider credentials are deliberately outside the database.

CREATE TABLE IF NOT EXISTS core.agent_runtime_enrollment_operations (
  enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id UUID NOT NULL
    REFERENCES core.agent_runtime_installations(installation_id) ON DELETE RESTRICT,
  account_binding_id UUID NOT NULL
    REFERENCES core.agent_runtime_accounts(account_binding_id) ON DELETE RESTRICT,
  provider_code TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  operation_state TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (operation_state IN (
      'CREATED', 'AUTHENTICATING', 'PENDING_USER', 'COMPLETED',
      'FAILED', 'EXPIRED', 'CANCELLED', 'REVOKED', 'RECONCILIATION_REQUIRED'
    )),
  provider_login_reference TEXT,
  verification_url TEXT,
  user_code TEXT,
  expires_at TIMESTAMPTZ,
  provider_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (provider_attempt_count BETWEEN 0 AND 2),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  failure_code TEXT,
  safe_result JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_result) = 'object'),
  created_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT runtime_enrollment_provider_not_blank CHECK (btrim(provider_code) <> ''),
  CONSTRAINT runtime_enrollment_auth_mode_not_blank CHECK (btrim(auth_mode) <> ''),
  CONSTRAINT runtime_enrollment_active_code_shape CHECK (
    (operation_state = 'PENDING_USER' AND verification_url IS NOT NULL AND user_code IS NOT NULL)
    OR (operation_state <> 'PENDING_USER' AND verification_url IS NULL AND user_code IS NULL)
  ),
  CONSTRAINT runtime_enrollment_user_code_nonblank CHECK (
    user_code IS NULL OR btrim(user_code) <> ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runtime_enrollment_active_binding
  ON core.agent_runtime_enrollment_operations (account_binding_id)
  WHERE operation_state IN ('CREATED', 'AUTHENTICATING', 'PENDING_USER', 'RECONCILIATION_REQUIRED');

CREATE INDEX IF NOT EXISTS idx_agent_runtime_enrollment_history
  ON core.agent_runtime_enrollment_operations (account_binding_id, created_at DESC);

DROP TRIGGER IF EXISTS agent_runtime_enrollment_operations_set_updated_at
  ON core.agent_runtime_enrollment_operations;
CREATE TRIGGER agent_runtime_enrollment_operations_set_updated_at
  BEFORE UPDATE ON core.agent_runtime_enrollment_operations
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

COMMENT ON TABLE core.agent_runtime_enrollment_operations IS
  'Provider-neutral managed runtime account enrollment operations. Device codes are present only while an operation is pending; provider tokens remain in the isolated runtime credential store.';
COMMENT ON COLUMN core.agent_runtime_enrollment_operations.safe_result IS
  'Allowlisted account/plan/rate-limit/usage observations only; never raw provider protocol payloads or credentials.';
COMMENT ON COLUMN core.agent_runtime_enrollment_operations.provider_attempt_count IS
  'Bounded provider login-start attempts for this same durable enrollment operation; maximum two.';
