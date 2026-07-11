-- Trigger: worker.temporal_worker_heartbeats_temporal_worker_heartbeats_set_updated_at
-- Purpose: Maintains updated_at on worker.temporal_worker_heartbeats.

DROP TRIGGER IF EXISTS temporal_worker_heartbeats_set_updated_at ON worker.temporal_worker_heartbeats;

CREATE TRIGGER temporal_worker_heartbeats_set_updated_at
BEFORE UPDATE ON worker.temporal_worker_heartbeats
FOR EACH ROW
EXECUTE FUNCTION worker.set_updated_at();
