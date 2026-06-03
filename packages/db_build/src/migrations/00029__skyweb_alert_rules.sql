-- ============================================================
-- Migration: 00029__skyweb_alert_rules.sql
-- Purpose:
-- Adds SkyWeb Analytics macro alert-rule tables and views.
-- Alerts can watch either direct indicators or a numeric metric
-- from a grouped macro view.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS skyweb.alert_rules (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  alert_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_type TEXT NOT NULL,
  indicator_code TEXT,
  view_key TEXT,
  metric_key TEXT,
  condition_type TEXT NOT NULL,
  threshold_value NUMERIC NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  evaluation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_status TEXT NOT NULL DEFAULT 'never',
  last_message TEXT,
  last_observed_value NUMERIC,
  last_previous_value NUMERIC,
  last_evaluated_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT alert_rules_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT alert_rules_user_key_unique
    UNIQUE (user_id, alert_key),

  CONSTRAINT alert_rules_key_check
    CHECK (alert_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT alert_rules_title_length_check
    CHECK (char_length(title) BETWEEN 1 AND 160),

  CONSTRAINT alert_rules_description_length_check
    CHECK (description IS NULL OR char_length(description) <= 800),

  CONSTRAINT alert_rules_target_type_check
    CHECK (target_type IN ('indicator', 'view_metric')),

  CONSTRAINT alert_rules_target_fields_check
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
    ),

  CONSTRAINT alert_rules_indicator_code_check
    CHECK (indicator_code IS NULL OR indicator_code ~ '^[A-Z0-9_]+$'),

  CONSTRAINT alert_rules_view_key_check
    CHECK (view_key IS NULL OR view_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),

  CONSTRAINT alert_rules_metric_key_check
    CHECK (metric_key IS NULL OR metric_key ~ '^[A-Za-z][A-Za-z0-9_]{0,127}$'),

  CONSTRAINT alert_rules_condition_type_check
    CHECK (condition_type IN (
      'above',
      'below',
      'crosses_above',
      'crosses_below',
      'changes_by',
      'percent_changes_by'
    )),

  CONSTRAINT alert_rules_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  CONSTRAINT alert_rules_last_status_check
    CHECK (last_status IN ('never', 'ok', 'triggered', 'error'))
);

CREATE INDEX IF NOT EXISTS alert_rules_user_id_idx
  ON skyweb.alert_rules (user_id);

CREATE INDEX IF NOT EXISTS alert_rules_user_active_idx
  ON skyweb.alert_rules (user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS alert_rules_indicator_code_idx
  ON skyweb.alert_rules (indicator_code)
  WHERE indicator_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS alert_rules_view_metric_idx
  ON skyweb.alert_rules (view_key, metric_key)
  WHERE view_key IS NOT NULL;

DROP TRIGGER IF EXISTS alert_rules_set_updated_at ON skyweb.alert_rules;

CREATE TRIGGER alert_rules_set_updated_at
BEFORE UPDATE ON skyweb.alert_rules
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();

ALTER TABLE skyweb.alert_rules OWNER TO postgres;

COMMENT ON TABLE skyweb.alert_rules IS
'User-owned SkyWeb Analytics alert rules for direct indicators and view metrics.';

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

CREATE INDEX IF NOT EXISTS alert_rule_events_alert_id_idx
  ON skyweb.alert_rule_events (alert_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS alert_rule_events_status_idx
  ON skyweb.alert_rule_events (event_status, evaluated_at DESC);

ALTER TABLE skyweb.alert_rule_events OWNER TO postgres;

COMMENT ON TABLE skyweb.alert_rule_events IS
'Evaluation history for SkyWeb Analytics alert rules.';

DROP VIEW IF EXISTS skyweb.vw_alert_rule_events;
DROP VIEW IF EXISTS skyweb.vw_alert_rules;

CREATE VIEW skyweb.vw_alert_rules AS
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

CREATE VIEW skyweb.vw_alert_rule_events AS
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

COMMIT;
