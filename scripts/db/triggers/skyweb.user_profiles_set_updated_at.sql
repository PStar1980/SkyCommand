-- Trigger: skyweb.user_profiles_set_updated_at
-- Purpose: Maintains updated_at on skyweb.user_profiles.

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON skyweb.user_profiles;

CREATE TRIGGER user_profiles_set_updated_at
BEFORE UPDATE ON skyweb.user_profiles
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
