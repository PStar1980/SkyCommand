-- View: skyweb.vw_alert_notifications
-- Purpose: Alert notifications joined to user, alert, and event metadata.

CREATE OR REPLACE VIEW skyweb.vw_alert_notifications AS
SELECT
  n.notification_id,
  n.user_id,
  u.email,
  u.username,
  n.alert_id,
  r.alert_key,
  n.event_id,
  n.notification_status,
  n.title,
  n.message,
  n.severity,
  n.target_type,
  n.indicator_code,
  n.view_key,
  n.metric_key,
  n.observed_value,
  n.previous_value,
  n.threshold_value,
  n.observed_at,
  n.evaluated_at,
  e.event_metadata,
  n.acknowledged_at,
  n.dismissed_at,
  n.created_at,
  n.updated_at
FROM skyweb.alert_notifications n
JOIN auth.users u
  ON u.user_id = n.user_id
JOIN skyweb.alert_rules r
  ON r.alert_id = n.alert_id
JOIN skyweb.alert_rule_events e
  ON e.event_id = n.event_id;

ALTER VIEW skyweb.vw_alert_notifications OWNER TO postgres;
