ALTER TABLE worker.listeners
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_worker_listeners_active_definitions
  ON worker.listeners (deleted_at, listener_type, enabled);

COMMENT ON COLUMN worker.listeners.deleted_at IS 'Soft-delete/archive timestamp. Deleted listeners are hidden from active listener lists but history is preserved.';
COMMENT ON COLUMN worker.listeners.delete_reason IS 'Optional reason captured when a listener is archived/deleted from the active list.';
