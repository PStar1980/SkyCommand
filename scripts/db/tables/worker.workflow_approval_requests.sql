-- Table: worker.workflow_approval_requests
-- Purpose: Durable human approval checkpoints for SkyCommand workflow HUMAN_APPROVAL nodes.

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

ALTER TABLE worker.workflow_approval_requests OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_status_requested
  ON worker.workflow_approval_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_run_node
  ON worker.workflow_approval_requests (workflow_run_record_id, workflow_node_run_record_id);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_requests_temporal
  ON worker.workflow_approval_requests (temporal_workflow_id, temporal_run_id);

COMMENT ON TABLE worker.workflow_approval_requests IS 'Durable human approval checkpoints for SkyCommand workflow HUMAN_APPROVAL nodes.';
COMMENT ON COLUMN worker.workflow_approval_requests.signal_name IS 'Temporal signal used to resume the paused workflow execution.';
