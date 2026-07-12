CREATE OR REPLACE VIEW worker.vw_workflow_run_context_values AS
SELECT
  c.workflow_run_context_value_id,
  c.workflow_run_record_id,
  r.workflow_code,
  r.status AS workflow_status,
  c.context_key,
  c.value_json,
  c.value_type,
  c.source_node_key,
  c.source_node_run_record_id,
  c.metadata,
  c.created_at,
  c.updated_at
FROM worker.workflow_run_context_values c
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = c.workflow_run_record_id;
