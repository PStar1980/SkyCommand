-- View: worker.vw_worker_nodes
-- Purpose: Operational worker node heartbeat view.

CREATE OR REPLACE VIEW worker.vw_worker_nodes AS
SELECT
  worker_node_id,
  node_name,
  process_id,
  hostname,
  app_version,
  status,
  started_at,
  last_heartbeat_at,
  FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - last_heartbeat_at)))::int AS seconds_since_heartbeat,
  metadata,
  created_at,
  updated_at
FROM worker.worker_nodes;

ALTER VIEW worker.vw_worker_nodes OWNER TO postgres;
