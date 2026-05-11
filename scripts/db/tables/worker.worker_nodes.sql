-- Table: worker.worker_nodes
-- Purpose: Tracks active/background worker processes and heartbeat state.

CREATE TABLE IF NOT EXISTS worker.worker_nodes (
  worker_node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_name TEXT NOT NULL UNIQUE,
  process_id INTEGER,
  hostname TEXT,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'ONLINE'
    CHECK (status IN ('ONLINE', 'OFFLINE', 'STOPPING', 'ERROR')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE worker.worker_nodes OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_worker_nodes_status_heartbeat
  ON worker.worker_nodes (status, last_heartbeat_at DESC);

COMMENT ON TABLE worker.worker_nodes IS 'Registered SkyServer worker processes with heartbeat timestamps and runtime metadata.';
COMMENT ON COLUMN worker.worker_nodes.node_name IS 'Stable worker node identifier, normally hostname plus process id or an explicit WORKER_NODE_NAME.';
