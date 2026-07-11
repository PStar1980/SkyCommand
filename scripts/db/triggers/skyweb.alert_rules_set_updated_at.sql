-- Trigger: skyweb.alert_rules_alert_rules_set_updated_at
-- Purpose: Maintains updated_at on skyweb.alert_rules.

DROP TRIGGER IF EXISTS alert_rules_set_updated_at ON skyweb.alert_rules;

CREATE TRIGGER alert_rules_set_updated_at
BEFORE UPDATE ON skyweb.alert_rules
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
