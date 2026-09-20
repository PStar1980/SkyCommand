-- Migration: 00148__host_agent_heartbeat_freshness_index.sql
-- Purpose: Narrow the Host Agent heartbeat lookup used by governed preflight/readiness.
-- The generic heartbeat view remains unchanged; callers calculate recency from the
-- configured application threshold rather than the view's fixed is_recent expression.

CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_host_agent_lookup
  ON worker.temporal_worker_heartbeats (namespace, task_queue, last_seen_at DESC)
  WHERE metadata ->> 'role' = 'HOST_AGENT'
     OR metadata ->> 'executionTarget' = 'HOST';

COMMENT ON INDEX worker.idx_temporal_worker_heartbeats_host_agent_lookup IS
  'Supports governed Host Agent namespace/task-queue heartbeat lookups ordered by freshness.';
