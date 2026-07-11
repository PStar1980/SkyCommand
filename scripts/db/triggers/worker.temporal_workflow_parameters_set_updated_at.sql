-- Trigger: worker.temporal_workflow_parameters_temporal_workflow_parameters_set_updated_at
-- Purpose: Maintains updated_at on worker.temporal_workflow_parameters.

DROP TRIGGER IF EXISTS temporal_workflow_parameters_set_updated_at ON worker.temporal_workflow_parameters;

CREATE TRIGGER temporal_workflow_parameters_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_parameters
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
