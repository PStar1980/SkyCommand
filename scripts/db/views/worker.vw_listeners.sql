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
