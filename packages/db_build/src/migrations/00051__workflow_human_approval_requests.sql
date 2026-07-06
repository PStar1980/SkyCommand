-- ============================================================
-- Migration: 00051__workflow_human_approval_requests.sql
-- Purpose:
-- Adds durable human approval request tracking for SkyServer
-- workflow HUMAN_APPROVAL nodes. Temporal-backed workflows pause
-- on these rows and resume when an authorized user signals a
-- decision from Admin-Web.
-- ============================================================

CREATE TABLE IF NOT EXISTS worker.workflow_approval_requests (
  approval_request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_record_id UUID NOT NULL REFERENCES worker.workflow_run_records(workflow_run_record_id) ON DELETE CASCADE,
  workflow_node_run_record_id UUID NOT NULL REFERENCES worker.workflow_node_run_records(workflow_node_run_record_id) ON DELETE CASCADE,
  workflow_node_id UUID REFERENCES worker.workflow_nodes(workflow_node_id) ON DELETE SET NULL,
  node_key TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  approval_title TEXT NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT', 'CANCELED')),
  required_role_code TEXT,
  on_reject TEXT NOT NULL DEFAULT 'STOP_SUCCESS'
    CHECK (on_reject IN ('STOP_SUCCESS', 'FAIL_WORKFLOW', 'CONTINUE')),
  on_timeout TEXT NOT NULL DEFAULT 'FAIL_WORKFLOW'
    CHECK (on_timeout IN ('STOP_SUCCESS', 'FAIL_WORKFLOW', 'CONTINUE')),
  timeout_ms BIGINT CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  temporal_workflow_id TEXT,
  temporal_run_id TEXT,
  signal_name TEXT NOT NULL DEFAULT 'humanApprovalDecision',
  requested_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  decided_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  decision_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT workflow_approval_node_key_not_blank CHECK (btrim(node_key) <> ''),
  CONSTRAINT workflow_approval_key_not_blank CHECK (btrim(approval_key) <> ''),
  CONSTRAINT workflow_approval_title_not_blank CHECK (btrim(approval_title) <> ''),
  CONSTRAINT workflow_approval_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (workflow_node_run_record_id, approval_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_status_requested
  ON worker.workflow_approval_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_run_node
  ON worker.workflow_approval_requests (workflow_run_record_id, workflow_node_run_record_id);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_temporal
  ON worker.workflow_approval_requests (temporal_workflow_id, temporal_run_id);

DROP TRIGGER IF EXISTS workflow_approval_requests_set_updated_at ON worker.workflow_approval_requests;
CREATE TRIGGER workflow_approval_requests_set_updated_at
BEFORE UPDATE ON worker.workflow_approval_requests
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();

COMMENT ON TABLE worker.workflow_approval_requests IS 'Durable human approval checkpoints for SkyServer workflow HUMAN_APPROVAL nodes.';
COMMENT ON COLUMN worker.workflow_approval_requests.signal_name IS 'Temporal signal used to resume the paused workflow execution.';

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
  a.updated_at
FROM worker.workflow_approval_requests a
JOIN worker.workflow_run_records r
  ON r.workflow_run_record_id = a.workflow_run_record_id
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

COMMENT ON VIEW worker.vw_workflow_approval_requests IS 'Human approval requests joined to workflow run, node run, and approver identity metadata.';
