-- Trigger: worker.listener_events_set_updated_at
-- Purpose: Maintains updated_at on worker.listener_events.

DROP TRIGGER IF EXISTS listener_events_set_updated_at ON worker.listener_events;

CREATE TRIGGER listener_events_set_updated_at
BEFORE UPDATE ON worker.listener_events
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
