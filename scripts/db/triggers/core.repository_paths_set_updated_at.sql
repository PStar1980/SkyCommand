-- Trigger: core.repository_paths_set_updated_at
-- Purpose: Maintains updated_at on core.repository_paths.

DROP TRIGGER IF EXISTS repository_paths_set_updated_at ON core.repository_paths;

CREATE TRIGGER repository_paths_set_updated_at
BEFORE UPDATE ON core.repository_paths
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
