-- View: worker.vw_listener_events_recent
-- Purpose: Recent listener event history with linked script execution metadata.

CREATE OR REPLACE VIEW worker.vw_listener_events_recent AS
SELECT
  le.listener_event_id,
  le.listener_id,
  l.listener_code,
  l.listener_name,
  l.listener_type,
  le.worker_node_id,
  wn.node_name,
  le.execution_id,
  le.event_key,
  le.event_payload,
  le.status,
  le.detected_at,
  le.processed_at,
  le.message,
  le.metadata,
  el.script_name,
  el.status AS execution_status,
  el.exit_code,
  el.duration_ms,
  el.summary AS execution_summary,
  le.created_at,
  le.updated_at
FROM worker.listener_events le
JOIN worker.listeners l
  ON l.listener_id = le.listener_id
LEFT JOIN worker.worker_nodes wn
  ON wn.worker_node_id = le.worker_node_id
LEFT JOIN auth.script_execution_log el
  ON el.execution_id = le.execution_id
ORDER BY le.detected_at DESC;

ALTER VIEW worker.vw_listener_events_recent OWNER TO postgres;
