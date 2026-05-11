-- Trigger: worker.listeners_set_updated_at
-- Purpose: Maintains updated_at on worker.listeners.

DROP TRIGGER IF EXISTS listeners_set_updated_at ON worker.listeners;

CREATE TRIGGER listeners_set_updated_at
BEFORE UPDATE ON worker.listeners
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
