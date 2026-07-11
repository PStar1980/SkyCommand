-- Trigger: worker.temporal_workflow_definitions_temporal_workflow_definitions_set_updated_at
-- Purpose: Maintains updated_at on worker.temporal_workflow_definitions.

DROP TRIGGER IF EXISTS temporal_workflow_definitions_set_updated_at ON worker.temporal_workflow_definitions;

CREATE TRIGGER temporal_workflow_definitions_set_updated_at
BEFORE UPDATE ON worker.temporal_workflow_definitions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
