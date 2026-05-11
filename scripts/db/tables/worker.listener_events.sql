-- Table: worker.listener_events
-- Purpose: Tracks deduplicated events detected by configured listeners.

CREATE TABLE IF NOT EXISTS worker.listener_events (
  listener_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listener_id UUID NOT NULL REFERENCES worker.listeners(listener_id) ON DELETE CASCADE,
  worker_node_id UUID REFERENCES worker.worker_nodes(worker_node_id) ON DELETE SET NULL,
  execution_id UUID REFERENCES auth.script_execution_log(execution_id) ON DELETE SET NULL,

  event_key TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'DETECTED'
    CHECK (status IN ('DETECTED', 'QUEUED', 'STARTED', 'SUCCESS', 'FAILED', 'IGNORED')),

  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,

  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT worker_listener_events_key_not_blank CHECK (btrim(event_key) <> ''),
  CONSTRAINT worker_listener_events_payload_object CHECK (jsonb_typeof(event_payload) = 'object'),
  CONSTRAINT worker_listener_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (listener_id, event_key)
);

ALTER TABLE worker.listener_events OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_listener_detected
  ON worker.listener_events (listener_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_status
  ON worker.listener_events (status);

CREATE INDEX IF NOT EXISTS idx_worker_listener_events_execution
  ON worker.listener_events (execution_id);

COMMENT ON TABLE worker.listener_events IS 'Detected listener events with idempotent event_key deduplication and optional link to auth.script_execution_log.';
