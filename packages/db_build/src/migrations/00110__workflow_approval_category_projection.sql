-- Migration: 00110__workflow_approval_category_projection.sql
-- Purpose: Append workflow category metadata to Approval History while preserving the legacy view column order.
-- Depends on: 00109 workflow run category projection.

CREATE OR REPLACE VIEW worker.vw_workflow_approval_requests AS
SELECT
  a.approval_request_id,
  a.workflow_run_record_id,
  a.workflow_node_run_record_id,
  a.workflow_node_id,
  r.workflow_code,
  COALESCE(d.display_name, r.workflow_code) AS workflow_display_name,
  a.node_key,
  COALESCE(wn.display_name, nr.metadata->>'displayName', a.node_key) AS node_display_name,
  COALESCE(wn.node_type_code, nr.node_type_code, 'HUMAN_APPROVAL') AS node_type_code,
  a.approval_key,
  a.approval_title,
  a.instructions,
  a.status,
  a.required_role_code,
  a.on_reject,
  a.on_timeout,
  a.timeout_ms,
  a.temporal_workflow_id,
  a.temporal_run_id,
  a.signal_name,
  a.requested_by_user_id,
  requester.email AS requested_by_email,
  requester.display_name AS requested_by_display_name,
  a.decided_by_user_id,
  decider.email AS decided_by_email,
  decider.display_name AS decided_by_display_name,
  a.decision_note,
  a.requested_at,
  a.decided_at,
  a.expires_at,
  a.metadata,
  a.created_at,
  a.updated_at,
  rr.workflow_category_code,
  rr.workflow_category_display_name,
  rr.workflow_category_source
FROM worker.workflow_approval_requests a
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = a.workflow_run_record_id
LEFT JOIN worker.vw_workflow_run_records rr
  ON rr.workflow_run_record_id = a.workflow_run_record_id
LEFT JOIN worker.workflow_definitions d
  ON d.workflow_definition_id = r.workflow_definition_id
LEFT JOIN worker.workflow_node_run_records nr
  ON nr.workflow_node_run_record_id = a.workflow_node_run_record_id
LEFT JOIN worker.workflow_nodes wn
  ON wn.workflow_node_id = a.workflow_node_id
LEFT JOIN auth.users requester
  ON requester.user_id = a.requested_by_user_id
LEFT JOIN auth.users decider
  ON decider.user_id = a.decided_by_user_id;

ALTER VIEW worker.vw_workflow_approval_requests OWNER TO postgres;

COMMENT ON VIEW worker.vw_workflow_approval_requests IS 'Human approval requests joined to workflow run, workflow category, node run, and approver identity metadata.';
