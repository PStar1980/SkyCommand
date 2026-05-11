-- Trigger: worker.schedules_set_updated_at
-- Purpose: Maintains updated_at on worker.schedules.

DROP TRIGGER IF EXISTS schedules_set_updated_at ON worker.schedules;

CREATE TRIGGER schedules_set_updated_at
BEFORE UPDATE ON worker.schedules
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
