CREATE OR REPLACE VIEW worker.vw_workflow_run_node_outputs AS
SELECT
  o.workflow_run_node_output_id,
  o.workflow_run_record_id,
  r.workflow_code,
  r.status AS workflow_status,
  o.workflow_node_run_record_id,
  o.workflow_node_id,
  o.node_key,
  o.node_type_code,
  o.target_code,
  o.output_key,
  o.output_type,
  o.input_snapshot_json,
  o.output_json,
  o.output_summary,
  o.status,
  o.attempt_count,
  o.metadata,
  o.created_at,
  o.updated_at
FROM worker.workflow_run_node_outputs o
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = o.workflow_run_record_id;
