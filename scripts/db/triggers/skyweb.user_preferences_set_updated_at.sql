-- Trigger: skyweb.user_preferences_set_updated_at
-- Purpose: Maintains updated_at on skyweb.user_preferences.

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON skyweb.user_preferences;

CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON skyweb.user_preferences
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
