-- Trigger: worker.schedule_runs_set_updated_at
-- Purpose: Maintains updated_at on worker.schedule_runs.

DROP TRIGGER IF EXISTS schedule_runs_set_updated_at ON worker.schedule_runs;

CREATE TRIGGER schedule_runs_set_updated_at
BEFORE UPDATE ON worker.schedule_runs
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
