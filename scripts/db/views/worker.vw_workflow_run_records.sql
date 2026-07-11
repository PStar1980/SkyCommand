-- View: worker.vw_workflow_run_records
-- Purpose: SkyServer workflow run records joined to user and workflow metadata.

CREATE OR REPLACE VIEW worker.vw_workflow_run_records AS
SELECT
  r.workflow_run_record_id,
  r.workflow_definition_id,
  d.workflow_code AS definition_workflow_code,
  d.display_name AS workflow_display_name,
  r.workflow_version_id,
  v.version_number AS definition_version_number,
  r.workflow_code,
  r.version_number,
  r.run_source,
  r.trigger_type,
  r.status,
  r.temporal_workflow_id,
  r.temporal_run_id,
  r.input,
  r.request_context,
  r.summary,
  r.started_by_user_id,
  u.email AS started_by_email,
  u.display_name AS started_by_display_name,
  r.started_at,
  r.completed_at,
  r.metadata,
  r.created_at,
  r.updated_at
FROM worker.workflow_run_records r
LEFT JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = r.workflow_definition_id
LEFT JOIN worker.workflow_versions v
  ON v.workflow_version_id = r.workflow_version_id
LEFT JOIN auth.users u
  ON u.user_id = r.started_by_user_id;

ALTER VIEW worker.vw_workflow_run_records OWNER TO postgres;

COMMENT ON VIEW worker.vw_workflow_run_records IS 'SkyServer workflow run records joined to user and workflow metadata.';
