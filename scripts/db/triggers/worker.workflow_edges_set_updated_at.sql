-- Trigger: worker.workflow_edges_workflow_edges_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_edges.

DROP TRIGGER IF EXISTS workflow_edges_set_updated_at ON worker.workflow_edges;

CREATE TRIGGER workflow_edges_set_updated_at
BEFORE UPDATE ON worker.workflow_edges
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
