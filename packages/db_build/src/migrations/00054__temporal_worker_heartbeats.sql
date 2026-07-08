-- ============================================================
-- Migration: 00054__temporal_worker_heartbeats.sql
-- Purpose:
-- Tracks SkyServer Temporal worker process heartbeats so Admin-Web
-- can distinguish Temporal server reachability from actual task
-- queue polling / worker process health.
-- ============================================================

CREATE TABLE IF NOT EXISTS worker.temporal_worker_heartbeats (
  worker_heartbeat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_identity TEXT NOT NULL UNIQUE,
  namespace TEXT NOT NULL DEFAULT 'default',
  task_queue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'STARTING'
    CHECK (status IN ('STARTING', 'ONLINE', 'STOPPING', 'STOPPED', 'ERROR', 'UNKNOWN')),
  process_id INTEGER,
  hostname TEXT,
  app_version TEXT,
  temporal_address TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT temporal_worker_heartbeat_identity_not_blank CHECK (btrim(worker_identity) <> ''),
  CONSTRAINT temporal_worker_heartbeat_task_queue_not_blank CHECK (btrim(task_queue) <> ''),
  CONSTRAINT temporal_worker_heartbeat_namespace_not_blank CHECK (btrim(namespace) <> ''),
  CONSTRAINT temporal_worker_heartbeat_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_task_queue_seen
  ON worker.temporal_worker_heartbeats (namespace, task_queue, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_status_seen
  ON worker.temporal_worker_heartbeats (status, last_seen_at DESC);

DROP TRIGGER IF EXISTS temporal_worker_heartbeats_set_updated_at ON worker.temporal_worker_heartbeats;
CREATE TRIGGER temporal_worker_heartbeats_set_updated_at
BEFORE UPDATE ON worker.temporal_worker_heartbeats
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.temporal_worker_heartbeats IS 'SkyServer Temporal worker process heartbeat ledger for task queue health diagnostics.';
COMMENT ON COLUMN worker.temporal_worker_heartbeats.worker_identity IS 'Stable process identity emitted by the SkyServer Temporal worker.';
COMMENT ON COLUMN worker.temporal_worker_heartbeats.last_seen_at IS 'Most recent heartbeat observed from the worker process.';

CREATE OR REPLACE VIEW worker.vw_temporal_worker_heartbeats AS
SELECT
  h.worker_heartbeat_id,
  h.worker_identity,
  h.namespace,
  h.task_queue,
  h.status,
  h.process_id,
  h.hostname,
  h.app_version,
  h.temporal_address,
  h.started_at,
  h.last_seen_at,
  h.stopped_at,
  EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - h.last_seen_at))::int AS seconds_since_seen,
  (h.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '60 seconds' AND h.status IN ('STARTING', 'ONLINE')) AS is_recent,
  h.metadata,
  h.created_at,
  h.updated_at
FROM worker.temporal_worker_heartbeats h;

COMMENT ON VIEW worker.vw_temporal_worker_heartbeats IS 'Temporal worker heartbeats enriched with freshness state for Admin-Web health dashboards.';
