-- Trigger: skyweb.user_dashboards_user_dashboards_set_updated_at
-- Purpose: Maintains updated_at on skyweb.user_dashboards.

DROP TRIGGER IF EXISTS user_dashboards_set_updated_at ON skyweb.user_dashboards;

CREATE TRIGGER user_dashboards_set_updated_at
BEFORE UPDATE ON skyweb.user_dashboards
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
