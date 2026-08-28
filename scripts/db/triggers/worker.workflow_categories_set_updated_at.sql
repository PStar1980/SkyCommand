-- Trigger: worker.workflow_categories_workflow_categories_set_updated_at
-- Purpose: Maintains updated_at on worker.workflow_categories.

DROP TRIGGER IF EXISTS workflow_categories_set_updated_at ON worker.workflow_categories;

CREATE TRIGGER workflow_categories_set_updated_at
BEFORE UPDATE ON worker.workflow_categories
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
