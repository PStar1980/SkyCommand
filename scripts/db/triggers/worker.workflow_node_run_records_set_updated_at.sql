-- Trigger: worker.workflow_node_run_records_workflow_node_run_records_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_node_run_records.

DROP TRIGGER IF EXISTS workflow_node_run_records_set_updated_at ON worker.workflow_node_run_records;

CREATE TRIGGER workflow_node_run_records_set_updated_at
BEFORE UPDATE ON worker.workflow_node_run_records
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
