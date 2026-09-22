-- Migration: 00156__temporal_orchestrator_refresh_operations.sql
-- Purpose: Durable, idempotent evidence for the DEV-only temporal-worker
--          refresh seam. The operation is fixed to the Host Supervisor
--          rebuild primitive and stores no lifecycle grant/token material.

CREATE TABLE IF NOT EXISTS worker.temporal_orchestrator_refresh_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_principal_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{128}$'),
  repository_code TEXT NOT NULL DEFAULT 'SkyCommand'
    CHECK (repository_code = 'SkyCommand'),
  environment_code TEXT NOT NULL DEFAULT 'DEV_LOCAL'
    CHECK (environment_code = 'DEV_LOCAL'),
  target_service TEXT NOT NULL DEFAULT 'temporal-worker'
    CHECK (target_service = 'temporal-worker'),
  action TEXT NOT NULL DEFAULT 'REBUILD_TEMPORAL_WORKER'
    CHECK (action = 'REBUILD_TEMPORAL_WORKER'),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  supervisor_operation_id TEXT,
  before_heartbeat JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_heartbeat) = 'object'),
  after_heartbeat JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_heartbeat) = 'object'),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  status_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (caller_principal_code, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_temporal_orchestrator_refresh_status
  ON worker.temporal_orchestrator_refresh_operations (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_orchestrator_refresh_supervisor
  ON worker.temporal_orchestrator_refresh_operations (supervisor_operation_id)
  WHERE supervisor_operation_id IS NOT NULL;

DROP TRIGGER IF EXISTS temporal_orchestrator_refresh_operations_set_updated_at
  ON worker.temporal_orchestrator_refresh_operations;
CREATE TRIGGER temporal_orchestrator_refresh_operations_set_updated_at
BEFORE UPDATE ON worker.temporal_orchestrator_refresh_operations
FOR EACH ROW EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.temporal_orchestrator_refresh_operations IS
  'DEV-only durable evidence for the fixed Host Supervisor temporal-worker refresh seam. Signed grants are transient and never persisted.';
COMMENT ON COLUMN worker.temporal_orchestrator_refresh_operations.request_digest IS
  'Non-secret SHA-512 request digest used to reject idempotency-key reuse with a different fixed request.';
COMMENT ON COLUMN worker.temporal_orchestrator_refresh_operations.evidence IS
  'Safe Supervisor, Temporal poller, heartbeat, freshness, and generation evidence; no grant or credential material.';
