-- View: worker.vw_temporal_worker_heartbeats
-- Purpose: Temporal worker heartbeats enriched with freshness state.

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

ALTER VIEW worker.vw_temporal_worker_heartbeats OWNER TO postgres;

COMMENT ON VIEW worker.vw_temporal_worker_heartbeats IS 'Temporal worker heartbeats enriched with freshness state for Admin-Web health dashboards.';
