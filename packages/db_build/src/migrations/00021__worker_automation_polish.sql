-- Migration: 00021__worker_automation_polish.sql
-- Purpose: Adds queue/unqueue metadata, soft-delete/archive support, and refreshed worker views for Phase 8.5 Automation UX.
-- Note: view definitions preserve the existing 00020 column order and append new columns at the end.
--       PostgreSQL CREATE OR REPLACE VIEW cannot rename/reorder existing view columns.

BEGIN;

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

ALTER TABLE worker.listeners
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_worker_listeners_active_definitions
  ON worker.listeners (deleted_at, listener_type, enabled);

COMMENT ON COLUMN worker.listeners.deleted_at IS 'Soft-delete/archive timestamp. Deleted listeners are hidden from active listener lists but history is preserved.';
COMMENT ON COLUMN worker.listeners.delete_reason IS 'Optional reason captured when a listener is archived/deleted from the active list.';

-- View: worker.vw_schedules
-- Purpose: Admin-friendly schedule configuration view with tool/profile metadata and Phase 8.5 queue/archive fields.
-- Important: Existing 00020 columns remain in their original order. New 8.5 columns are appended.

CREATE OR REPLACE VIEW worker.vw_schedules AS
SELECT
  s.schedule_id,
  s.schedule_code,
  s.schedule_name,
  s.description,
  s.schedule_type,
  s.timezone,
  s.run_at,
  s.interval_value,
  s.interval_unit,
  s.cron_expression,
  s.parameters,
  s.enabled,
  s.max_concurrent_runs,
  s.misfire_policy,
  s.next_run_at,
  s.last_run_at,
  s.last_status,
  t.tool_id,
  t.tool_code,
  t.label AS tool_label,
  t.risk_code,
  t.permission_code,
  cp.profile_id,
  cp.profile_code,
  cp.profile_name,
  creator.user_id AS created_by_user_id,
  creator.email AS created_by_email,
  creator.display_name AS created_by_display_name,
  updater.user_id AS updated_by_user_id,
  updater.email AS updated_by_email,
  updater.display_name AS updated_by_display_name,
  s.created_at,
  s.updated_at,
  s.queue_requested_at,
  s.queue_requested_by_user_id,
  queue_requester.email AS queue_requested_by_email,
  queue_requester.display_name AS queue_requested_by_display_name,
  s.queued_previous_next_run_at,
  s.deleted_at,
  s.deleted_by_user_id,
  deleter.email AS deleted_by_email,
  deleter.display_name AS deleted_by_display_name,
  s.delete_reason
FROM worker.schedules s
JOIN core.tools t
  ON t.tool_id = s.tool_id
LEFT JOIN core.config_profiles cp
  ON cp.profile_id = s.profile_id
LEFT JOIN auth.users creator
  ON creator.user_id = s.created_by_user_id
LEFT JOIN auth.users updater
  ON updater.user_id = s.updated_by_user_id
LEFT JOIN auth.users queue_requester
  ON queue_requester.user_id = s.queue_requested_by_user_id
LEFT JOIN auth.users deleter
  ON deleter.user_id = s.deleted_by_user_id;

ALTER VIEW worker.vw_schedules OWNER TO postgres;

-- View: worker.vw_listeners
-- Purpose: Admin-friendly listener configuration view with tool/profile metadata and archive fields.
-- Important: Existing 00020 columns remain in their original order. New 8.5 columns are appended.

CREATE OR REPLACE VIEW worker.vw_listeners AS
SELECT
  l.listener_id,
  l.listener_code,
  l.listener_name,
  l.description,
  l.listener_type,
  l.config,
  l.parameters_template,
  l.enabled,
  l.poll_interval_seconds,
  l.last_checked_at,
  l.last_event_at,
  l.last_status,
  t.tool_id,
  t.tool_code,
  t.label AS tool_label,
  t.risk_code,
  t.permission_code,
  cp.profile_id,
  cp.profile_code,
  cp.profile_name,
  l.created_by_user_id,
  l.updated_by_user_id,
  l.created_at,
  l.updated_at,
  l.deleted_at,
  l.deleted_by_user_id,
  l.delete_reason
FROM worker.listeners l
JOIN core.tools t
  ON t.tool_id = l.tool_id
LEFT JOIN core.config_profiles cp
  ON cp.profile_id = l.profile_id;

ALTER VIEW worker.vw_listeners OWNER TO postgres;

COMMIT;
