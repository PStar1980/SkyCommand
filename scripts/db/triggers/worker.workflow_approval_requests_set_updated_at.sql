-- Trigger: worker.workflow_approval_requests_workflow_approval_requests_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_approval_requests.

DROP TRIGGER IF EXISTS workflow_approval_requests_set_updated_at ON worker.workflow_approval_requests;

CREATE TRIGGER workflow_approval_requests_set_updated_at
BEFORE UPDATE ON worker.workflow_approval_requests
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
