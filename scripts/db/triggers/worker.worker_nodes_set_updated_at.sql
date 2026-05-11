-- Trigger: worker.worker_nodes_set_updated_at
-- Purpose: Maintains updated_at on worker.worker_nodes.

DROP TRIGGER IF EXISTS worker_nodes_set_updated_at ON worker.worker_nodes;

CREATE TRIGGER worker_nodes_set_updated_at
BEFORE UPDATE ON worker.worker_nodes
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
