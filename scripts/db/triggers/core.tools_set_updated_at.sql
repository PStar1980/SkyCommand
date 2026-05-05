-- Trigger: core.tools_set_updated_at
-- Purpose: Maintains updated_at on core.tools.

DROP TRIGGER IF EXISTS tools_set_updated_at ON core.tools;

CREATE TRIGGER tools_set_updated_at
BEFORE UPDATE ON core.tools
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
