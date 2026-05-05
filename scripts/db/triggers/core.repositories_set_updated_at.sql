-- Trigger: core.repositories_set_updated_at
-- Purpose: Maintains updated_at on core.repositories.

DROP TRIGGER IF EXISTS repositories_set_updated_at ON core.repositories;

CREATE TRIGGER repositories_set_updated_at
BEFORE UPDATE ON core.repositories
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
