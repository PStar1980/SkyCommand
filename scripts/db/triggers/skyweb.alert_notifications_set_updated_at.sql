-- Trigger: skyweb.alert_notifications_alert_notifications_set_updated_at
-- Purpose: Maintains updated_at on skyweb.alert_notifications.

DROP TRIGGER IF EXISTS alert_notifications_set_updated_at ON skyweb.alert_notifications;

CREATE TRIGGER alert_notifications_set_updated_at
BEFORE UPDATE ON skyweb.alert_notifications
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
