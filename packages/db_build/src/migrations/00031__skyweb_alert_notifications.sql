-- ============================================================
-- Migration: 00031__skyweb_alert_notifications.sql
-- Purpose:
-- Adds user-facing SkyWeb alert notifications generated from
-- triggered alert evaluation events. Notifications are separate
-- from the audit trail so users can acknowledge or dismiss
-- triggered macro signals without losing evaluation history.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS skyweb.alert_notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  alert_id UUID NOT NULL,
  event_id UUID NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  message TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  target_type TEXT NOT NULL,
  indicator_code TEXT,
  view_key TEXT,
  metric_key TEXT,
  observed_value NUMERIC,
  previous_value NUMERIC,
  threshold_value NUMERIC,
  observed_at DATE,
  evaluated_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT alert_notifications_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT alert_notifications_alert_id_fkey
    FOREIGN KEY (alert_id)
    REFERENCES skyweb.alert_rules(alert_id)
    ON DELETE CASCADE,

  CONSTRAINT alert_notifications_event_id_fkey
    FOREIGN KEY (event_id)
    REFERENCES skyweb.alert_rule_events(event_id)
    ON DELETE CASCADE,

  CONSTRAINT alert_notifications_event_unique
    UNIQUE (event_id),

  CONSTRAINT alert_notifications_status_check
    CHECK (notification_status IN ('open', 'acknowledged', 'dismissed')),

  CONSTRAINT alert_notifications_title_length_check
    CHECK (char_length(title) BETWEEN 1 AND 180),

  CONSTRAINT alert_notifications_message_length_check
    CHECK (message IS NULL OR char_length(message) <= 1000),

  CONSTRAINT alert_notifications_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  CONSTRAINT alert_notifications_target_type_check
    CHECK (target_type IN ('indicator', 'view_metric')),

  CONSTRAINT alert_notifications_target_fields_check
    CHECK (
      (
        target_type = 'indicator'
        AND indicator_code IS NOT NULL
        AND view_key IS NULL
        AND metric_key IS NULL
      )
      OR
      (
        target_type = 'view_metric'
        AND indicator_code IS NULL
        AND view_key IS NOT NULL
        AND metric_key IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS alert_notifications_user_status_idx
  ON skyweb.alert_notifications (user_id, notification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_notifications_alert_id_idx
  ON skyweb.alert_notifications (alert_id, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_notifications_severity_idx
  ON skyweb.alert_notifications (severity, created_at DESC);

DROP TRIGGER IF EXISTS alert_notifications_set_updated_at ON skyweb.alert_notifications;

CREATE TRIGGER alert_notifications_set_updated_at
BEFORE UPDATE ON skyweb.alert_notifications
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.alert_notifications OWNER TO postgres;

COMMENT ON TABLE skyweb.alert_notifications IS
'User-facing SkyWeb Analytics alert notifications generated from triggered alert evaluation events.';

INSERT INTO skyweb.alert_notifications (
  user_id,
  alert_id,
  event_id,
  notification_status,
  title,
  message,
  severity,
  target_type,
  indicator_code,
  view_key,
  metric_key,
  observed_value,
  previous_value,
  threshold_value,
  observed_at,
  evaluated_at,
  created_at,
  updated_at
)
SELECT
  r.user_id,
  r.alert_id,
  e.event_id,
  'open',
  r.title,
  e.message,
  r.severity,
  r.target_type,
  r.indicator_code,
  r.view_key,
  r.metric_key,
  e.observed_value,
  e.previous_value,
  e.threshold_value,
  e.observed_at,
  e.evaluated_at,
  e.evaluated_at,
  CURRENT_TIMESTAMP
FROM skyweb.alert_rule_events e
JOIN skyweb.alert_rules r
  ON r.alert_id = e.alert_id
WHERE e.event_status = 'triggered'
ON CONFLICT (event_id) DO NOTHING;

DROP VIEW IF EXISTS skyweb.vw_alert_notifications;

CREATE VIEW skyweb.vw_alert_notifications AS
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

COMMIT;
