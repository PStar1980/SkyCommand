-- Trigger: worker.workflow_versions_workflow_versions_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_versions.

DROP TRIGGER IF EXISTS workflow_versions_set_updated_at ON worker.workflow_versions;

CREATE TRIGGER workflow_versions_set_updated_at
BEFORE UPDATE ON worker.workflow_versions
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
