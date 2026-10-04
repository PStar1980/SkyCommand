-- Phase 19.3B: archive is an independent, durable history-preserving flag.
-- It never deletes provider state, cancels Runs, or changes canonical Run status.
ALTER TABLE worker.agent_sessions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN worker.agent_sessions.archived_at IS
  'History-preserving archive time. Non-null prevents new continuation admission; existing Runs retain their lifecycle.';
