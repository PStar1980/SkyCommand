-- View: worker.vw_schedule_runs_recent
-- Purpose: Recent scheduler run history with linked script execution metadata.

CREATE OR REPLACE VIEW worker.vw_schedule_runs_recent AS
SELECT
  sr.schedule_run_id,
  sr.schedule_id,
  s.schedule_code,
  s.schedule_name,
  t.tool_code,
  t.label AS tool_label,
  sr.worker_node_id,
  wn.node_name,
  sr.execution_id,
  sr.status,
  sr.queued_at,
  sr.started_at,
  sr.finished_at,
  sr.message,
  sr.metadata,
  el.script_name,
  el.script_file,
  el.category,
  el.parameters AS execution_parameters,
  el.status AS execution_status,
  el.exit_code,
  el.duration_ms,
  el.summary AS execution_summary,
  sr.created_at,
  sr.updated_at
FROM worker.schedule_runs sr
JOIN worker.schedules s
  ON s.schedule_id = sr.schedule_id
JOIN core.tools t
  ON t.tool_id = s.tool_id
LEFT JOIN worker.worker_nodes wn
  ON wn.worker_node_id = sr.worker_node_id
LEFT JOIN auth.script_execution_log el
  ON el.execution_id = sr.execution_id
ORDER BY sr.queued_at DESC;

ALTER VIEW worker.vw_schedule_runs_recent OWNER TO postgres;
