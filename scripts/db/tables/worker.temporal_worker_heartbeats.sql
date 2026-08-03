-- Table: worker.temporal_worker_heartbeats
-- Purpose: SkyCommand Temporal worker process heartbeat ledger for task queue health diagnostics.

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

ALTER TABLE worker.temporal_worker_heartbeats OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_task_queue_seen
  ON worker.temporal_worker_heartbeats (namespace, task_queue, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_temporal_worker_heartbeats_status_seen
  ON worker.temporal_worker_heartbeats (status, last_seen_at DESC);

COMMENT ON TABLE worker.temporal_worker_heartbeats IS 'SkyCommand Temporal worker process heartbeat ledger for task queue health diagnostics.';
COMMENT ON COLUMN worker.temporal_worker_heartbeats.worker_identity IS 'Stable process identity emitted by the SkyCommand Temporal worker.';
COMMENT ON COLUMN worker.temporal_worker_heartbeats.last_seen_at IS 'Most recent heartbeat observed from the worker process.';
