-- Table: skyweb.alert_rule_events
-- Purpose: Evaluation history for SkyWeb Analytics alert rules.

CREATE TABLE IF NOT EXISTS skyweb.alert_rule_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL,
  event_status TEXT NOT NULL,
  observed_value NUMERIC,
  previous_value NUMERIC,
  threshold_value NUMERIC,
  observed_at DATE,
  previous_observed_at DATE,
  message TEXT,
  event_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT alert_rule_events_alert_id_fkey
    FOREIGN KEY (alert_id)
    REFERENCES skyweb.alert_rules(alert_id)
    ON DELETE CASCADE,

  CONSTRAINT alert_rule_events_status_check
    CHECK (event_status IN ('ok', 'triggered', 'error')),

  CONSTRAINT alert_rule_events_message_length_check
    CHECK (message IS NULL OR char_length(message) <= 1000)
);

ALTER TABLE skyweb.alert_rule_events OWNER TO postgres;

CREATE INDEX IF NOT EXISTS alert_rule_events_alert_id_idx
  ON skyweb.alert_rule_events (alert_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS alert_rule_events_status_idx
  ON skyweb.alert_rule_events (event_status, evaluated_at DESC);

COMMENT ON TABLE skyweb.alert_rule_events IS 'Evaluation history for SkyWeb Analytics alert rules.';
