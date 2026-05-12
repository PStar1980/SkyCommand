ALTER TABLE worker.schedules
  ADD COLUMN IF NOT EXISTS queue_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_requested_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS queued_previous_next_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_worker_schedules_queue_requested
  ON worker.schedules (queue_requested_at)
  WHERE queue_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_schedules_active_definitions
  ON worker.schedules (deleted_at, schedule_type, last_status, last_run_at);

COMMENT ON COLUMN worker.schedules.queue_requested_at IS 'Timestamp when a user requested immediate queueing through SkyServer Admin/API.';
COMMENT ON COLUMN worker.schedules.queued_previous_next_run_at IS 'The next_run_at value before an immediate queue request, used to restore the schedule when unqueued before worker claim.';
COMMENT ON COLUMN worker.schedules.deleted_at IS 'Soft-delete/archive timestamp. Deleted schedules are hidden from active scheduler lists but history is preserved.';
COMMENT ON COLUMN worker.schedules.delete_reason IS 'Optional reason captured when a schedule is archived/deleted from the active list.';
