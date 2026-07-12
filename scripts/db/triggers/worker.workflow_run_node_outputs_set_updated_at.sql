DROP TRIGGER IF EXISTS workflow_run_node_outputs_set_updated_at ON worker.workflow_run_node_outputs;
CREATE TRIGGER workflow_run_node_outputs_set_updated_at
BEFORE UPDATE ON worker.workflow_run_node_outputs
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
