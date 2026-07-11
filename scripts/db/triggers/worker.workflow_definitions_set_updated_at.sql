-- Trigger: worker.workflow_definitions_workflow_definitions_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_definitions.

DROP TRIGGER IF EXISTS workflow_definitions_set_updated_at ON worker.workflow_definitions;

CREATE TRIGGER workflow_definitions_set_updated_at
BEFORE UPDATE ON worker.workflow_definitions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
