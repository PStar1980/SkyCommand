-- Trigger: worker.temporal_workflow_run_records_temporal_workflow_run_records_set_updated_at
-- Purpose: Maintains updated_at on worker.temporal_workflow_run_records.

DROP TRIGGER IF EXISTS temporal_workflow_run_records_set_updated_at ON worker.temporal_workflow_run_records;

CREATE TRIGGER temporal_workflow_run_records_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_run_records
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
