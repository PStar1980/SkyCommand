-- Migration: 00160__assistant_dev_runtime_refresh_operations.sql
-- Purpose: durable, idempotent Assistant requests for source-controlled DEV
--          runtime refresh profiles. Grants and raw Supervisor responses are
--          never stored.

CREATE TABLE IF NOT EXISTS worker.dev_runtime_refresh_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_principal_code TEXT NOT NULL
    CHECK (caller_principal_code ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  caller_agent_id TEXT NOT NULL
    CHECK (caller_agent_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  idempotency_key TEXT NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200)
    CHECK (idempotency_key !~ '[[:cntrl:]]'),
  request_digest TEXT NOT NULL
    CHECK (request_digest ~ '^[a-f0-9]{128}$'),
  profile_code TEXT NOT NULL
    CHECK (profile_code IN ('CODEX_BOOTSTRAP', 'TEMPORAL_WORKER')),
  repository_code TEXT NOT NULL DEFAULT 'SkyCommand'
    CHECK (repository_code = 'SkyCommand'),
  environment_code TEXT NOT NULL DEFAULT 'DEV_LOCAL'
    CHECK (environment_code = 'DEV_LOCAL'),
  lifecycle_profile_code TEXT NOT NULL DEFAULT 'DEV_LOCAL'
    CHECK (lifecycle_profile_code = 'DEV_LOCAL'),
  target_service TEXT NOT NULL,
  affected_services JSONB NOT NULL
    CHECK (jsonb_typeof(affected_services) = 'array'),
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  supervisor_operation_id UUID,
  before_heartbeat JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_heartbeat) = 'object'),
  after_heartbeat JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_heartbeat) = 'object'),
  before_runtime_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_runtime_evidence) = 'object'),
  after_runtime_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_runtime_evidence) = 'object'),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(evidence) = 'object'),
  status_reason TEXT
    CHECK (status_reason IS NULL OR status_reason ~ '^[A-Z0-9_]{1,96}$'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (caller_principal_code, idempotency_key),
  CHECK (
    (profile_code = 'CODEX_BOOTSTRAP'
      AND target_service = 'codex-managed-bootstrap'
      AND action = 'REBUILD_CODEX_BOOTSTRAP'
      AND affected_services = '["api","codex-managed-volume-init","codex-egress-proxy","codex-mcp-gateway","codex-agent-runtime-worker","codex-control-bridge"]'::jsonb)
    OR
    (profile_code = 'TEMPORAL_WORKER'
      AND target_service = 'temporal-worker'
      AND action = 'REBUILD_TEMPORAL_WORKER'
      AND affected_services = '["temporal-worker"]'::jsonb)
  )
);

CREATE INDEX IF NOT EXISTS idx_dev_runtime_refresh_status
  ON worker.dev_runtime_refresh_operations (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_dev_runtime_refresh_supervisor
  ON worker.dev_runtime_refresh_operations (supervisor_operation_id)
  WHERE supervisor_operation_id IS NOT NULL;
