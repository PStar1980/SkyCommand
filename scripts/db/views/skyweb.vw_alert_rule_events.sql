-- View: skyweb.vw_alert_rule_events
-- Purpose: Alert rule event history joined to alert and user metadata.

CREATE OR REPLACE VIEW skyweb.vw_alert_rule_events AS
SELECT
  e.event_id,
  e.alert_id,
  r.user_id,
  u.email,
  u.username,
  r.alert_key,
  r.title AS alert_title,
  r.target_type,
  r.indicator_code,
  r.view_key,
  r.metric_key,
  r.condition_type,
  e.event_status,
  e.observed_value,
  e.previous_value,
  e.threshold_value,
  e.observed_at,
  e.previous_observed_at,
  e.message,
  e.event_metadata,
  e.evaluated_at
FROM skyweb.alert_rule_events e
JOIN skyweb.alert_rules r
  ON r.alert_id = e.alert_id
JOIN auth.users u
  ON u.user_id = r.user_id;

ALTER VIEW skyweb.vw_alert_rule_events OWNER TO postgres;
