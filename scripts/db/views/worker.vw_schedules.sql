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
