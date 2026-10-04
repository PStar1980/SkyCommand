-- Phase 19.3B-R3: extend the durable Assistant DEV runtime refresh contract
-- with one fixed Agent Session profile. The profile may rebuild exactly the
-- API + Node Worker and nothing else.

ALTER TABLE worker.dev_runtime_refresh_operations
  DROP CONSTRAINT IF EXISTS dev_runtime_refresh_operations_profile_code_check;

ALTER TABLE worker.dev_runtime_refresh_operations
  DROP CONSTRAINT IF EXISTS dev_runtime_refresh_operations_check;

ALTER TABLE worker.dev_runtime_refresh_operations
  ADD CONSTRAINT dev_runtime_refresh_operations_profile_code_check
  CHECK (profile_code IN ('CODEX_BOOTSTRAP', 'TEMPORAL_WORKER', 'AGENT_SESSION_RUNTIME'));

ALTER TABLE worker.dev_runtime_refresh_operations
  ADD CONSTRAINT dev_runtime_refresh_operations_check
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
    OR
    (profile_code = 'AGENT_SESSION_RUNTIME'
      AND target_service = 'agent-session-runtime'
      AND action = 'REBUILD_AGENT_SESSION_RUNTIME'
      AND affected_services = '["api","node-worker"]'::jsonb)
  );
