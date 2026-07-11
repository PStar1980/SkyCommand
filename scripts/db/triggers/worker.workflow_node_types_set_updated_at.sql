-- Trigger: worker.workflow_node_types_workflow_node_types_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_node_types.

DROP TRIGGER IF EXISTS workflow_node_types_set_updated_at ON worker.workflow_node_types;

CREATE TRIGGER workflow_node_types_set_updated_at
BEFORE UPDATE ON worker.workflow_node_types
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
