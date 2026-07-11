-- View: skyweb.vw_alert_rules
-- Purpose: Alert rules with user identity and evaluation counts.

CREATE OR REPLACE VIEW skyweb.vw_alert_rules AS
SELECT
  r.alert_id,
  r.user_id,
  u.email,
  u.username,
  r.alert_key,
  r.title,
  r.description,
  r.target_type,
  r.indicator_code,
  r.view_key,
  r.metric_key,
  r.condition_type,
  r.threshold_value,
  r.severity,
  r.active,
  r.evaluation_metadata,
  r.last_status,
  r.last_message,
  r.last_observed_value,
  r.last_previous_value,
  r.last_evaluated_at,
  r.last_triggered_at,
  COUNT(e.event_id)::int AS event_count,
  COUNT(e.event_id) FILTER (WHERE e.event_status = 'triggered')::int AS triggered_event_count,
  MAX(e.evaluated_at) AS latest_event_at,
  r.created_at,
  r.updated_at
FROM skyweb.alert_rules r
JOIN auth.users u
  ON u.user_id = r.user_id
LEFT JOIN skyweb.alert_rule_events e
  ON e.alert_id = r.alert_id
GROUP BY
  r.alert_id,
  r.user_id,
  u.email,
  u.username,
  r.alert_key,
  r.title,
  r.description,
  r.target_type,
  r.indicator_code,
  r.view_key,
  r.metric_key,
  r.condition_type,
  r.threshold_value,
  r.severity,
  r.active,
  r.evaluation_metadata,
  r.last_status,
  r.last_message,
  r.last_observed_value,
  r.last_previous_value,
  r.last_evaluated_at,
  r.last_triggered_at,
  r.created_at,
  r.updated_at;

ALTER VIEW skyweb.vw_alert_rules OWNER TO postgres;
