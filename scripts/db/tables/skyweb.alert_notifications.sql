-- Table: skyweb.alert_notifications
-- Purpose: User-facing SkyWeb Analytics alert notifications generated from triggered alert evaluation events.

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

ALTER TABLE skyweb.alert_notifications OWNER TO postgres;

CREATE INDEX IF NOT EXISTS alert_notifications_user_status_idx
  ON skyweb.alert_notifications (user_id, notification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_notifications_alert_id_idx
  ON skyweb.alert_notifications (alert_id, created_at DESC);

CREATE INDEX IF NOT EXISTS alert_notifications_severity_idx
  ON skyweb.alert_notifications (severity, created_at DESC);

COMMENT ON TABLE skyweb.alert_notifications IS 'User-facing SkyWeb Analytics alert notifications generated from triggered alert evaluation events.';
