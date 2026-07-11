-- Table: skyweb.alert_rules
-- Purpose: User-owned SkyWeb Analytics alert rules for direct indicators and view metrics.

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
    CHECK (char_length(title) BETWEEN 1 AND 180),

  CONSTRAINT alert_rules_description_length_check
    CHECK (description IS NULL OR char_length(description) <= 1000),

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
    CHECK (indicator_code IS NULL OR indicator_code ~ '^[A-Z0-9_]{1,128}$'),

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

ALTER TABLE skyweb.alert_rules OWNER TO postgres;

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

COMMENT ON TABLE skyweb.alert_rules IS 'User-owned SkyWeb Analytics alert rules for direct indicators and view metrics.';
