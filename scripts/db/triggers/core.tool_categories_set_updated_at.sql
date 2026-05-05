-- Trigger: core.tool_categories_set_updated_at
-- Purpose: Maintains updated_at on core.tool_categories.

DROP TRIGGER IF EXISTS tool_categories_set_updated_at ON core.tool_categories;

CREATE TRIGGER tool_categories_set_updated_at
BEFORE UPDATE ON core.tool_categories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
