-- Trigger: core.tool_parameters_set_updated_at
-- Purpose: Maintains updated_at on core.tool_parameters.

DROP TRIGGER IF EXISTS tool_parameters_set_updated_at ON core.tool_parameters;

CREATE TRIGGER tool_parameters_set_updated_at
BEFORE UPDATE ON core.tool_parameters
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
