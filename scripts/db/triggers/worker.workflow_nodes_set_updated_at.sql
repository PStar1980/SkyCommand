-- Trigger: worker.workflow_nodes_workflow_nodes_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_nodes.

DROP TRIGGER IF EXISTS workflow_nodes_set_updated_at ON worker.workflow_nodes;

CREATE TRIGGER workflow_nodes_set_updated_at
BEFORE UPDATE ON worker.workflow_nodes
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
