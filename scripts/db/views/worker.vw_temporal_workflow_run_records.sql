-- View: worker.vw_temporal_workflow_run_records
-- Purpose: Admin/API-friendly run record view with template and user metadata.

CREATE OR REPLACE VIEW worker.vw_temporal_workflow_run_records AS
SELECT
  r.run_record_id,
  r.definition_id,
  COALESCE(d.workflow_code, r.workflow_code) AS workflow_code,
  COALESCE(d.workflow_type, r.workflow_type) AS workflow_type,
  COALESCE(d.display_name, r.workflow_code) AS display_name,
  r.workflow_id,
  r.temporal_run_id,
  r.namespace,
  r.task_queue,
  r.run_source,
  r.status,
  r.launch_input,
  r.request_context,
  r.metadata,
  r.history_length,
  r.temporal_started_at,
  r.temporal_execution_at,
  r.temporal_closed_at,
  r.last_seen_in_temporal_at,
  starter.user_id AS started_by_user_id,
  starter.email AS started_by_email,
  starter.display_name AS started_by_display_name,
  r.cancel_requested_at,
  canceler.user_id AS cancel_requested_by_user_id,
  canceler.email AS cancel_requested_by_email,
  canceler.display_name AS cancel_requested_by_display_name,
  r.terminate_requested_at,
  terminator.user_id AS terminate_requested_by_user_id,
  terminator.email AS terminate_requested_by_email,
  terminator.display_name AS terminate_requested_by_display_name,
  r.terminate_reason,
  r.created_at,
  r.updated_at
FROM worker.temporal_workflow_run_records r
LEFT JOIN worker.temporal_workflow_definitions d
  ON d.definition_id = r.definition_id
LEFT JOIN auth.users starter
  ON starter.user_id = r.started_by_user_id
LEFT JOIN auth.users canceler
  ON canceler.user_id = r.cancel_requested_by_user_id
LEFT JOIN auth.users terminator
  ON terminator.user_id = r.terminate_requested_by_user_id;

ALTER VIEW worker.vw_temporal_workflow_run_records OWNER TO postgres;

COMMENT ON VIEW worker.vw_temporal_workflow_run_records IS 'SkyCommand Temporal workflow run records enriched with definition and user metadata.';
